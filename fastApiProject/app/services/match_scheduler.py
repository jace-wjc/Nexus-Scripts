"""
AI 岗位匹配公平调度器

- 多 key 独立并发控制，配置动态读取
- 多用户 Round-Robin 公平调度，防止大批量任务饿死其他用户
- 支持 key 动态添加/删除（热重载）
- MiMo 等并发=1 的模型天然串行，不需要特殊处理
"""

import asyncio
import logging
import threading
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from .llm_concurrency_limiter import shared_llm_limiter
from .recruitment_task_control import RecruitmentTaskControl

logger = logging.getLogger(__name__)


def load_match_key_configs(db: Any) -> List[Dict[str, Any]]:
    """Load the runtime configs that are valid for AI position matching."""
    from ..recruitment_models import RecruitmentLLMConfig

    base_query = db.query(RecruitmentLLMConfig).filter(
        RecruitmentLLMConfig.is_active == True,
    )
    configs = (
        base_query.filter(RecruitmentLLMConfig.task_type == "ai_position_match")
        .order_by(RecruitmentLLMConfig.priority.asc(), RecruitmentLLMConfig.id.asc())
        .all()
    )
    if not configs:
        configs = (
            base_query.filter(RecruitmentLLMConfig.task_type == "default")
            .order_by(RecruitmentLLMConfig.priority.asc(), RecruitmentLLMConfig.id.asc())
            .all()
        )
    return [
        {
            "key_id": f"config_{cfg.id}",
            "config_id": cfg.id,
            "source_key": f"db:{cfg.config_key}",
            "max_concurrent": cfg.max_concurrent or 4,
            "max_qps": cfg.max_qps or 10,
        }
        for cfg in configs
    ]


# ─────────────────────────────────────────
# Key 槽：管理单个 key 的并发和 QPS
# ─────────────────────────────────────────

@dataclass
class KeySlot:
    key_id: str
    config_id: int
    source_key: str
    semaphore: asyncio.Semaphore
    max_concurrent: int
    max_qps: int  # 0 表示不限制
    _qps_window: deque = field(default_factory=deque)
    _qps_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def acquire(self):
        """获取并发槽 + QPS 检查，两个条件都满足才放行"""
        await self.semaphore.acquire()
        try:
            await shared_llm_limiter.acquire_async(
                self.source_key or self.key_id,
                max_concurrent=self.max_concurrent,
                max_qps=self.max_qps,
            )
        except BaseException:
            self.semaphore.release()
            raise

    def release(self):
        shared_llm_limiter.release(self.source_key or self.key_id)
        self.semaphore.release()

    async def _wait_for_qps(self):
        async with self._qps_lock:
            now = time.monotonic()
            # 清理 1 秒前的记录
            while self._qps_window and self._qps_window[0] < now - 1.0:
                self._qps_window.popleft()
            # QPS 已满，等到窗口最早的请求过期
            if len(self._qps_window) >= self.max_qps:
                wait = 1.0 - (now - self._qps_window[0])
                if wait > 0:
                    await asyncio.sleep(wait)
            self._qps_window.append(time.monotonic())

    @property
    def available(self) -> bool:
        """当前是否有空闲并发槽（非阻塞检查）"""
        return self.semaphore._value > 0


# ─────────────────────────────────────────
# Key 轮转器：在多个 key 之间分配请求
# ─────────────────────────────────────────

class KeyRotator:
    def __init__(self):
        self._slots: List[KeySlot] = []
        self._index = 0
        self._lock = asyncio.Lock()

    def reload(self, key_configs: List[Dict[str, Any]]):
        """
        动态重载 key 配置，不需要重启服务。

        key_configs 格式：
        [
            {"key_id": "config_key_a", "config_id": 1, "max_concurrent": 4, "max_qps": 10},
            {"key_id": "config_key_b", "config_id": 2, "max_concurrent": 4, "max_qps": 10},
            {"key_id": "config_key_c", "config_id": 3, "max_concurrent": 1, "max_qps": 5},
        ]
        """
        existing = {s.key_id: s for s in self._slots}
        new_slots = []
        for cfg in key_configs:
            key_id = cfg["key_id"]
            if key_id in existing:
                slot = existing[key_id]
                next_max_concurrent = max(1, int(cfg.get("max_concurrent", slot.max_concurrent) or slot.max_concurrent))
                next_max_qps = int(cfg.get("max_qps", slot.max_qps) or 0)
                next_config_id = cfg.get("config_id", slot.config_id)
                next_source_key = cfg.get("source_key", slot.source_key)
                if (
                    next_max_concurrent != slot.max_concurrent
                    or next_max_qps != slot.max_qps
                    or next_config_id != slot.config_id
                    or next_source_key != slot.source_key
                ):
                    # 配置变更后直接替换为新槽，让后续任务立刻使用新并发/QPS。
                    # 正在执行中的旧任务会自然释放旧槽，不影响新配置生效。
                    new_slots.append(KeySlot(
                        key_id=key_id,
                        config_id=next_config_id,
                        source_key=next_source_key,
                        semaphore=asyncio.Semaphore(next_max_concurrent),
                        max_concurrent=next_max_concurrent,
                        max_qps=next_max_qps,
                    ))
                else:
                    new_slots.append(slot)
            else:
                new_slots.append(KeySlot(
                    key_id=key_id,
                    config_id=cfg.get("config_id", 0),
                    source_key=cfg.get("source_key", key_id),
                    semaphore=asyncio.Semaphore(cfg.get("max_concurrent", 4)),
                    max_concurrent=cfg.get("max_concurrent", 4),
                    max_qps=cfg.get("max_qps", 0),
                ))
        self._slots = new_slots
        logger.info(
            "KeyRotator reloaded: %d keys, total_concurrent=%d",
            len(self._slots),
            self.total_concurrent,
        )

    async def acquire_slot(self) -> KeySlot:
        """
        找到一个可用的 key 槽并获取，Round-Robin 轮转。
        所有 key 都满时阻塞等待，直到有空槽。
        """
        if not self._slots:
            raise RuntimeError("No LLM keys configured for matching")

        while True:
            async with self._lock:
                for _ in range(len(self._slots)):
                    slot = self._slots[self._index % len(self._slots)]
                    self._index += 1
                    if slot.available:
                        await slot.acquire()
                        return slot

            # 所有 key 都满，短暂等待后重试
            await asyncio.sleep(0.05)

    @property
    def total_concurrent(self) -> int:
        return sum(s.max_concurrent for s in self._slots)

    @property
    def slots(self) -> List[KeySlot]:
        return list(self._slots)


# ─────────────────────────────────────────
# 任务包装
# ─────────────────────────────────────────

@dataclass
class MatchTask:
    user_id: str
    batch_id: str
    candidate_id: int
    candidate: Any  # RecruitmentCandidate 对象
    position_summaries: List[Dict[str, Any]]
    resume_content: Optional[str] = None
    enqueue_time: float = field(default_factory=time.monotonic)
    started_at: Optional[float] = None  # worker 真正开始执行的时间
    retry_count: int = 0  # 已重试次数
    # 请求级上下文随任务固化（P0-3）：回调必须从任务读取，不得依赖全局回调闭包，
    # 否则并发触发匹配时后一个请求会覆盖前一批任务的岗位池/会话/操作人。
    session_token: Optional[str] = None
    task_type: str = "ai_position_match"
    # CAS 快照：入队时候选人的岗位。回调落库前加锁比对，若期间 HR 手动改岗（当前岗位 != 该值）
    # 则本次 AI 匹配结果作废，绝不覆盖人工指派。
    expected_before_position_id: Optional[int] = None
    # CAS 快照：入队时候选人的业务版本。任何人工修改（含另一实例上的取消写入）都会自增版本，
    # 使迟到的匹配结果在任意实例上被判过期——这就是跨进程持久化取消。
    expected_candidate_revision: Optional[int] = None
    cancel_control: Optional[RecruitmentTaskControl] = field(default=None, repr=False)
    # 0.1-C：错误回调重新入队重试时置 True，worker 的 finally 据此保留 live 标记，
    # 避免重试延迟窗口内同一候选人被新一次 trigger 误判为"不在飞行中"而重复匹配。
    requeued_for_retry: bool = False


# ─────────────────────────────────────────
# 公平调度器：Round-Robin 多用户公平调度
# ─────────────────────────────────────────

class FairMatchScheduler:
    """
    多用户公平调度器

    设计原则：
    - 每个用户一个任务桶，Round-Robin 轮转取任务
    - 新用户加入立即插入轮转，不需要等当前用户跑完
    - 某用户任务跑完自动退出轮转
    - worker 数量 = 所有 key 的总并发上限
    """

    def __init__(self, key_rotator: KeyRotator):
        self.key_rotator = key_rotator
        self._user_queues: Dict[str, deque] = defaultdict(deque)
        self._active_users: deque = deque()
        self._queue_lock = asyncio.Lock()
        self._live_candidate_ids: set[int] = set()
        self._running_candidate_ids: set[int] = set()
        self._task_controls: Dict[int, RecruitmentTaskControl] = {}
        self._state_lock = threading.Lock()
        self._has_tasks = asyncio.Event()
        self._workers: List[asyncio.Task] = []
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self.running = False
        self._cancelled_ids: set = set()

        # 统计
        self._stats = {
            "total_enqueued": 0,
            "total_completed": 0,
            "total_failed": 0,
        }

    def cancel_match(self, candidate_id: int):
        """标记候选人为已取消，并中断正在进行的模型 HTTP 请求。"""
        normalized_id = int(candidate_id)
        with self._state_lock:
            self._cancelled_ids.add(normalized_id)
            control = self._task_controls.get(normalized_id)
        if control is not None:
            control.cancel()

    def is_cancelled(self, candidate_id: int) -> bool:
        with self._state_lock:
            return int(candidate_id) in self._cancelled_ids

    def clear_cancelled(self, candidate_id: int):
        with self._state_lock:
            self._cancelled_ids.discard(int(candidate_id))

    def register_task_control(self, candidate_id: int, control: RecruitmentTaskControl) -> None:
        with self._state_lock:
            self._task_controls[int(candidate_id)] = control

    def clear_task_control(self, candidate_id: int, control: RecruitmentTaskControl) -> None:
        with self._state_lock:
            normalized_id = int(candidate_id)
            if self._task_controls.get(normalized_id) is control:
                self._task_controls.pop(normalized_id, None)

    def is_candidate_live(self, candidate_id: int) -> bool:
        with self._state_lock:
            return int(candidate_id) in self._live_candidate_ids

    def mark_candidate_running(self, candidate_id: int):
        with self._state_lock:
            self._running_candidate_ids.add(int(candidate_id))

    def clear_live_candidate(self, candidate_id: int):
        with self._state_lock:
            normalized_id = int(candidate_id)
            self._running_candidate_ids.discard(normalized_id)
            self._live_candidate_ids.discard(normalized_id)

    async def reenqueue(self, task: MatchTask):
        """重新入队（重试场景），放到队列头部优先处理"""
        # 0.1-C：标记为重试中并确保 live 标记仍在，worker finally 不会清除它，
        # 从而在重试延迟窗口内继续对新一次 trigger 去重。
        task.requeued_for_retry = True
        with self._state_lock:
            self._live_candidate_ids.add(int(task.candidate_id))
        async with self._queue_lock:
            self._user_queues[task.user_id].appendleft(task)
            if task.user_id not in self._active_users:
                self._active_users.append(task.user_id)
        self._has_tasks.set()
        logger.info(
            "Reenqueued candidate=%d for retry (attempt %d)",
            task.candidate_id, task.retry_count,
        )

    async def start(self):
        """启动调度器，worker 数量跟随 key 总并发数"""
        self.running = True
        self._loop = asyncio.get_running_loop()
        worker_count = max(self.key_rotator.total_concurrent, 1)
        self._workers = [
            asyncio.create_task(self._worker(i))
            for i in range(worker_count)
        ]
        logger.info("FairMatchScheduler started with %d workers", worker_count)

    async def ensure_worker_count(self):
        """Resize workers after key concurrency changes."""
        if not self.running:
            return
        target_count = max(self.key_rotator.total_concurrent, 1)
        current_count = len([worker for worker in self._workers if not worker.done()])
        if current_count == target_count:
            return
        self._workers = [worker for worker in self._workers if not worker.done()]
        if current_count < target_count:
            start_index = len(self._workers)
            for offset in range(target_count - current_count):
                self._workers.append(asyncio.create_task(self._worker(start_index + offset)))
            logger.info("FairMatchScheduler scaled up workers: %d -> %d", current_count, target_count)
            return
        extra_count = current_count - target_count
        extra_workers = self._workers[-extra_count:]
        self._workers = self._workers[:-extra_count]
        for worker in extra_workers:
            worker.cancel()
        await asyncio.gather(*extra_workers, return_exceptions=True)
        logger.info("FairMatchScheduler scaled down workers: %d -> %d", current_count, target_count)

    def request_worker_reconcile(self):
        """Schedule worker resize from sync service code."""
        loop = self._loop
        if not self.running or not loop or loop.is_closed():
            return
        try:
            running_loop = asyncio.get_running_loop()
        except RuntimeError:
            running_loop = None
        if running_loop is loop:
            loop.create_task(self.ensure_worker_count())
        else:
            asyncio.run_coroutine_threadsafe(self.ensure_worker_count(), loop)

    async def stop(self):
        self.running = False
        # Stop the underlying provider requests as well as the asyncio wrappers.
        with self._state_lock:
            controls = list(self._task_controls.values())
        self._has_tasks.set()  # 唤醒所有 worker 让其退出
        for w in self._workers:
            w.cancel()
        for control in controls:
            await asyncio.to_thread(control.cancel)
        await asyncio.gather(*self._workers, return_exceptions=True)
        logger.info("FairMatchScheduler stopped")

    async def enqueue_batch(
        self,
        user_id: str,
        batch_id: str,
        candidates: List[Any],
        position_summaries: List[Dict[str, Any]],
        *,
        session_token: Optional[str] = None,
        task_type: str = "ai_position_match",
    ):
        """
        批量入队。同一 batch_id 的任务属于同一次上传。
        session_token/task_type/position_summaries 固化到每个任务，供回调读取（P0-3）。
        """
        async with self._queue_lock:
            is_new_user = (
                user_id not in self._user_queues
                or len(self._user_queues[user_id]) == 0
            )
            for candidate in candidates:
                try:
                    expected_before_position_id = int(getattr(candidate, "position_id", 0) or 0) or None
                except (TypeError, ValueError):
                    expected_before_position_id = None
                try:
                    expected_candidate_revision = int(getattr(candidate, "business_revision", 0) or 0)
                except (TypeError, ValueError):
                    expected_candidate_revision = None
                task = MatchTask(
                    user_id=user_id,
                    batch_id=batch_id,
                    candidate_id=candidate.id,
                    candidate=candidate,
                    position_summaries=position_summaries,
                    session_token=session_token,
                    task_type=task_type,
                    expected_before_position_id=expected_before_position_id,
                    expected_candidate_revision=expected_candidate_revision,
                )
                self._user_queues[user_id].append(task)
                with self._state_lock:
                    self._live_candidate_ids.add(int(candidate.id))
                self._stats["total_enqueued"] += 1

            if is_new_user and user_id not in self._active_users:
                self._active_users.append(user_id)

        self._has_tasks.set()
        logger.info(
            "Enqueued %d tasks for user=%s batch=%s",
            len(candidates), user_id, batch_id,
        )

    async def _next_task(self) -> Optional[MatchTask]:
        """Round-Robin 取下一个任务"""
        async with self._queue_lock:
            if not self._active_users:
                return None
            # 轮转尝试每个用户
            for _ in range(len(self._active_users)):
                user_id = self._active_users[0]
                self._active_users.rotate(-1)
                if self._user_queues[user_id]:
                    task = self._user_queues[user_id].popleft()
                    # 用户队列空了，退出轮转
                    if not self._user_queues[user_id]:
                        try:
                            self._active_users.remove(user_id)
                        except ValueError:
                            pass
                    return task
            return None

    async def _worker(self, worker_id: int):
        """worker 主循环，持续从队列取任务执行"""
        logger.info("MatchWorker-%d started", worker_id)
        while self.running:
            task = await self._next_task()
            if task is None:
                self._has_tasks.clear()
                await self._has_tasks.wait()
                continue

            # 检查是否已被用户取消
            if self.is_cancelled(task.candidate_id):
                self.clear_cancelled(task.candidate_id)
                self.clear_live_candidate(task.candidate_id)
                logger.info(
                    "MatchWorker-%d skipping cancelled candidate=%d",
                    worker_id, task.candidate_id,
                )
                continue

            # 记录实际开始匹配时间；开始执行即清除上一轮的重试标记
            task.started_at = time.monotonic()
            task.requeued_for_retry = False

            slot = None
            cancel_control = None
            try:
                slot = await self.key_rotator.acquire_slot()
                cancel_control = RecruitmentTaskControl(task.candidate_id)
                task.cancel_control = cancel_control
                self.register_task_control(task.candidate_id, cancel_control)
                if self.is_cancelled(task.candidate_id):
                    cancel_control.cancel()
                cancel_control.raise_if_cancelled()
                self.mark_candidate_running(task.candidate_id)
                logger.debug(
                    "MatchWorker-%d executing candidate=%d key=%s user=%s",
                    worker_id, task.candidate_id, slot.key_id, task.user_id,
                )

                if self._task_started_callback:
                    await self._task_started_callback(task, slot)

                # 调用回调执行实际匹配（由 service 层提供）
                if self._match_callback:
                    await self._match_callback(task, slot)

                self._stats["total_completed"] += 1

            except asyncio.CancelledError:
                break
            except Exception as e:
                self._stats["total_failed"] += 1
                logger.error(
                    "MatchWorker-%d task failed candidate=%d: %s",
                    worker_id, task.candidate_id, e, exc_info=True,
                )
                # 失败也要回调，写 failed 审计日志（可能在其中 reenqueue 重试）
                if self._error_callback:
                    await self._error_callback(task, e)
            finally:
                if cancel_control is not None:
                    self.clear_task_control(task.candidate_id, cancel_control)
                task.cancel_control = None
                # 0.1-C：错误回调把任务重新入队重试时保留 live 标记，不在此清除，
                # 否则重试延迟窗口内该候选人会被新一次 trigger 视为可再次入队。
                if not task.requeued_for_retry:
                    self.clear_live_candidate(task.candidate_id)
                if slot:
                    slot.release()

        logger.info("MatchWorker-%d stopped", worker_id)

    # 回调函数，由 service 层注入
    _match_callback: Optional[Callable] = None
    _error_callback: Optional[Callable] = None
    _task_started_callback: Optional[Callable] = None

    def set_callbacks(
        self,
        match_callback: Callable,
        error_callback: Callable,
        task_started_callback: Optional[Callable] = None,
    ):
        """设置匹配和错误回调（由 service 层注入）"""
        self._match_callback = match_callback
        self._error_callback = error_callback
        self._task_started_callback = task_started_callback

    def stats(self) -> Dict[str, Any]:
        return {
            **self._stats,
            "queue_depth": {
                uid: len(q)
                for uid, q in self._user_queues.items()
                if q
            },
            "active_users": list(self._active_users),
            "worker_count": len(self._workers),
            "key_slots": [
                {
                    "key_id": s.key_id,
                    "max_concurrent": s.max_concurrent,
                    "max_qps": s.max_qps,
                    "available": s.available,
                }
                for s in self.key_rotator.slots
            ],
        }


# ─────────────────────────────────────────
# 全局单例（应用启动时初始化）
# ─────────────────────────────────────────

key_rotator = KeyRotator()
scheduler = FairMatchScheduler(key_rotator)
