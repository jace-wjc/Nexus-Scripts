from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict


class JobPublishAdapter(ABC):
    adapter_code: str = "base"
    platform_name: str = "base"

    @abstractmethod
    def check_availability(self) -> Dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def publish_job(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def update_job(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def offline_job(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def query_status(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError


class MockPublishAdapter(JobPublishAdapter):
    adapter_code = "mock"
    platform_name = "Mock"

    def check_availability(self) -> Dict[str, Any]:
        return {
            "available": True,
            "mode": "mock",
            "message": "Mock adapter ready",
        }

    def publish_job(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        position_id = payload.get("position_id") or "unknown"
        platform = payload.get("target_platform") or self.platform_name.lower()
        return {
            "status": "success",
            "message": f"{self.platform_name} mock publish completed",
            "published_url": f"https://mock.example.com/{platform}/positions/{position_id}",
            "response": {
                "mode": "mock",
                "payload_preview": {
                    "title": payload.get("title"),
                    "department": payload.get("department"),
                    "location": payload.get("location"),
                },
            },
        }

    def update_job(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "status": "success",
            "message": f"{self.platform_name} mock update completed",
            "response": payload,
        }

    def offline_job(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "status": "success",
            "message": f"{self.platform_name} mock offline completed",
            "response": payload,
        }

    def query_status(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "status": "online",
            "message": f"{self.platform_name} mock status available",
            "response": payload,
        }


class BossPublishAdapter(MockPublishAdapter):
    adapter_code = "boss"
    platform_name = "BOSS 直聘"

    def check_availability(self) -> Dict[str, Any]:
        result = super().check_availability()
        result["message"] = "BOSS adapter placeholder, currently running in mock mode"
        result["capabilities"] = ["publish", "update", "offline", "query_status"]
        return result


class ZhilianPublishAdapter(MockPublishAdapter):
    adapter_code = "zhilian"
    platform_name = "智联招聘"

    def check_availability(self) -> Dict[str, Any]:
        result = super().check_availability()
        result["message"] = "Zhilian adapter placeholder, currently running in mock mode"
        result["capabilities"] = ["publish", "update", "offline", "query_status"]
        return result


def build_publish_adapter(target_platform: str, mode: str = "mock") -> JobPublishAdapter:
    if mode != "mock":
        raise ValueError("Only mock publishing is supported")
    normalized = (target_platform or "").strip().lower()
    if normalized in {"boss", "boss直聘", "boss_zhipin"}:
        return BossPublishAdapter()
    if normalized in {"zhilian", "智联", "智联招聘"}:
        return ZhilianPublishAdapter()
    return MockPublishAdapter()
