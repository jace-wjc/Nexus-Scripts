"use client";

import { runResumeUploadBatches } from "./uploadResumeBatches";
import React, {useCallback, useDeferredValue, useEffect, useMemo, useRef, useState} from "react";
import nextDynamic from "next/dynamic";
import {
    ArrowLeft,
    Bot,
    BriefcaseBusiness,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    ClipboardCheck,
    ExternalLink,
    Eye,
    FilePlus2,
    FileText,
    Loader2,
    Pencil,
    Plus,
    RefreshCw,
    RotateCcw,
    Save,
    Send,
    Settings2,
    Sparkles,
    Square,
    Trash2,
    Upload,
    Wand2,
    X,
} from "lucide-react";
import {toast} from "@/lib/toast";
import type {ScriptHubOrganizationDefinition} from "@/lib/types";

import {authenticatedFetch, getScriptHubAuthHeaderRecord, getStoredScriptHubSession} from "@/lib/auth";
import {
    DEFAULT_QUERY_CANDIDATES_LIMIT,
    type RecruitmentAssistantClarificationOption,
    type RecruitmentAssistantClarificationRequest,
    type RecruitmentAssistantClarificationResponse,
    type RecruitmentAssistantMessageCompletedPayload,
    type RecruitmentAssistantPageInfo,
    type RecruitmentAssistantPreparedResumeMail,
    type RecruitmentAssistantRunRequest,
    type RecruitmentAssistantStreamEvent,
    type RecruitmentAssistantStreamEventType,
    type RecruitmentAssistantToolResultPayload,
} from "@/lib/recruitment-assistant-protocol";
import type {ScriptHubSession} from "@/lib/auth";
import {
    isRecruitmentRequestAborted,
    joinTags,
    recruitmentApi,
    splitTags,
    type AITaskLog,
    type CandidateComparisonPreview,
    type CandidateComparisonPreviewRequest,
    type CandidateDetail,
    type CandidateSummary,
    type ChatContext,
    type InterviewAvailabilitySlot,
    type InterviewSchedule,
    type InterviewTaskList,
    type InterviewTask,
    type FollowUp,
    type RecruitmentOffer,
    type ChatResponse,
    type DashboardData,
    type JDVersion,
    type PositionDetail,
    type PositionSummary,
    type CandidateStatsData,
    type RecruitmentFunnelData,
    type DepartmentReviewBatch,
    type DepartmentReviewTask,
    type DepartmentReviewTaskList,
    type RecruitmentLLMConfig,
    type RecruitmentMailRecipient,
    type RecruitmentMailSenderConfig,
    type RecruitmentMailAutoPushGlobalConfig,
    type RecruitmentOrganizationScope,
    type RecruitmentResumeMailDispatch,
    type RecruitmentMetadata,
    type RecruitmentSkill,
    type SourceStatsData,
    type RecruitmentTaskBatchStartResponse,
    type RecruitmentVisibleScreeningCancelResponse,
    type ResumeFile,
    type ResumeUploadResponse,
    type ResumeUploadFileResult,
    type RecruitmentTaskStartResponse,
    triggerAIPositionMatch,
} from "@/lib/recruitment-api";
import {useI18n} from "@/lib/i18n";
import {cn} from "@/lib/utils";
import {Badge} from "@/components/ui/badge";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import {Button} from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {Input} from "@/components/ui/input";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {ScrollArea} from "@/components/ui/scroll-area";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {OrgScopeBreadcrumbPicker} from './OrgScopeBreadcrumbPicker';
import {Textarea} from "@/components/ui/textarea";
import {
    aiTaskLabels,
    type AssistantDisplayMode,
    auditListColumnBaseWidths,
    auditListColumnFillWeights,
    type CandidateEditorState,
    type CandidateListColumnKey,
    candidateListColumnDefaultWidths,
    candidateListColumnFillWeights,
    candidateStatusLabels,
    type CandidateViewMode,
    type ChatMessage,
    type JDViewMode,
    type LLMFormState,
    mailSenderPresets,
    type MailSenderPresetKey,
    type MailRecipientFormState,
    type MailSenderFormState,
    pageMeta,
    panelClass,
    type PositionFormState,
    positionStatusLabels,
    providerLabels,
    type RecruitmentPage,
    getRecruitmentToastLocale,
    type ResumeMailDialogMode,
    type ResumeMailFormState,
    type ScreeningSkillFormData,
    type SkillFormState,
    type SkillTaskKind,
} from "./types";
import {
    buildQuery,
    clampCandidateListColumnWidth,
    expandTableColumnWidths,
    emptyCandidateEditor,
    emptyLLMForm,
    emptyMailRecipientForm,
    emptyMailSenderForm,
    emptyPositionForm,
    emptyResumeMailForm,
    emptyScreeningSkillForm,
    emptySkillForm,
    extractFileNameFromDisposition,
    extractPublishText,
    formatActionError,
    formatDateTime,
    generateSkillContent,
    parseSkillContent,
    formatPercent,
    formatSkillNames,
    inferMailSenderPreset,
    isLiveTaskStatus,
    isTerminalTaskStatus,
    isToday,
    labelForCandidateStatus,
    labelForJDGenerationStatus,
    labelForPositionStatus,
    labelForProvider,
    labelForTaskExecutionStatus,
    parseEmailList,
    parseStructuredLogOutput,
    resolveCandidateDisplayStatus,
    resolveCandidateFacingErrorContext,
    resolveTalentPoolDisplayStatus,
    resolveLogSkillSnapshots,
    resolveTaskSkillIds,
    sanitizeCandidateFacingErrorText,
    shortText,
    sortSkillsForTaskPreference,
    statusBadgeClass,
    toggleIdInList,
    toggleSingleSkillId,
    withinDays,
} from "./utils";
import {
    EmptyState,
    Field,
    LoadingCard,
    LoadingPanel,
    NativeSelect,
} from "./components/SharedComponents";
import {
    BOSS_EDUCATION_OPTIONS,
    BOSS_EXPERIENCE_OPTIONS,
    BOSS_RECRUIT_TYPES,
    BOSS_SALARY_K_OPTIONS,
    BOSS_SALARY_MONTH_OPTIONS,
    BossJobNameCascader,
    BossJobTypeSelector,
    bossJobPathSet,
    bossJobTypeSet,
    findClosestBossJob,
    formatBossSalaryRange,
    getBossSalaryMaxKOptions,
    mergeBossMetaTag,
    normalizeBossSalarySelection,
    normalizeBossJobPath,
    parseBossPositionMeta,
    parseBossSalaryRange,
    stripBossMetaTags,
    type BossJobFlatItem,
    type BossPositionMeta,
    type BossRecommendedJob,
    type BossRecommendedJobsPayload,
} from "./components/BossJobCatalog";
import {
    RecruitmentFieldRow,
    RecruitmentFormAnchorRail,
    RecruitmentFormSection,
    RecruitmentSegmentedGroup,
    RecruitmentTextareaMeter,
    RecruitmentToggleRow,
    recruitmentFormControlClass,
    recruitmentFormInputClass,
    recruitmentFormShortControlClass,
    recruitmentFormTextareaClass,
} from "./components/RecruitmentForm";
import {StructuredSkillEditor} from "./components/StructuredSkillEditor";
import {SettingsPageLayout, type RecruitmentSettingsPage} from "./components/SettingsPageLayout";
import {CandidateAvatar} from "./components/CandidateAvatar";
import {resolveCandidateIdentity} from "./candidateIdentity";
import {AssistantPage} from "./pages/AssistantPage";
import {PositionsListPage} from "./pages/PositionsListPage";
import {WorkspacePage} from "./pages/WorkspacePage";
import {
    buildSettingsListQuery,
    normalizeSettingsListResponse,
    shouldBootstrapRecruitmentCore,
    type SettingsListResponse,
} from "./settingsPerformance";

function PageChunkLoading() {
    return (
        <div className="flex h-full min-h-[240px] items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400"/>
        </div>
    );
}

const settingsDialogSurfaceClass = "gap-0 overflow-hidden rounded-[8px] border-[#EBEEF5] bg-white p-0 text-[#0E1114] shadow-[0_8px_24px_rgba(14,17,20,0.16)] dark:border-[#2E333C] dark:bg-[#1B1E25] dark:text-[#E8EAED] dark:shadow-[0_16px_48px_rgba(0,0,0,0.6)] [&_[data-slot=dialog-close]]:right-6 [&_[data-slot=dialog-close]]:top-[18px] [&_[data-slot=dialog-close]]:rounded-[4px] [&_[data-slot=dialog-close]]:text-[#86888F] [&_[data-slot=dialog-close]]:opacity-100 [&_[data-slot=dialog-close][data-state=open]]:bg-transparent [&_[data-slot=dialog-close][data-state=open]]:text-[#86888F] [&_[data-slot=dialog-close]]:hover:bg-[#F7F8FA] [&_[data-slot=dialog-close]]:hover:text-[#0E1114] dark:[&_[data-slot=dialog-close]]:text-[#9296A0] dark:[&_[data-slot=dialog-close]]:hover:bg-white/[0.07] dark:[&_[data-slot=dialog-close]]:hover:text-[#E8EAED]";
const settingsDialogHeaderClass = "shrink-0 gap-1 border-b border-[#F2F3F5] px-6 pb-[14px] pr-14 pt-[18px] text-left dark:border-[#282C34]";
const settingsDialogFooterClass = "h-16 shrink-0 items-center gap-3 border-t border-[#F2F3F5] px-6 sm:justify-end dark:border-[#282C34]";
const settingsSecondaryButtonClass = "h-[34px] rounded-[6px] border-[#E6E7EB] bg-white px-[18px] text-[13px] font-normal text-[#33353D] shadow-none hover:border-[#1E3BFA] hover:bg-[#F7F8FA] hover:text-[#0F23D9] focus-visible:outline-none focus-visible:ring-0 dark:border-[#3A3F49] dark:bg-transparent dark:text-[#C7C9D0] dark:hover:border-[#4A505C] dark:hover:bg-white/[0.07] dark:hover:text-[#E8EAED]";
const settingsPrimaryButtonClass = "h-[34px] rounded-[6px] bg-[#1E3BFA] px-[18px] text-[13px] font-normal text-white shadow-none hover:bg-[#0F23D9] focus-visible:outline-none focus-visible:ring-0 dark:bg-[#1E3BFA] dark:text-white dark:hover:bg-[#0F23D9]";
const settingsDangerButtonClass = "h-[34px] rounded-[6px] bg-[#F53F3F] px-[18px] text-[13px] font-normal text-white shadow-none hover:bg-[#D9363E] focus-visible:outline-none focus-visible:ring-0 dark:bg-[#F53F3F] dark:text-white dark:hover:bg-[#D9363E]";
const settingsInputClass = "h-[34px] rounded-[4px] border-[#E6E7EB] bg-white px-3 text-[12px] text-[#0E1114] shadow-none placeholder:text-[#B0B2B8] focus-visible:border-[#1E3BFA] focus-visible:ring-2 focus-visible:ring-[#1E3BFA]/15 md:text-[12px] dark:border-[#3A3F49] dark:bg-[#15171C] dark:text-[#E8EAED] dark:placeholder:text-[#6E727B] dark:focus-visible:border-[#5B78FF] dark:focus-visible:ring-[rgba(91,120,255,0.2)]";
const settingsTextareaClass = "rounded-[4px] border-[#E6E7EB] bg-white px-3 py-2.5 text-[12px] leading-5 text-[#0E1114] shadow-none placeholder:text-[#B0B2B8] focus-visible:border-[#1E3BFA] focus-visible:ring-2 focus-visible:ring-[#1E3BFA]/15 md:text-[12px] dark:border-[#3A3F49] dark:bg-[#15171C] dark:text-[#E8EAED] dark:placeholder:text-[#6E727B] dark:focus-visible:border-[#5B78FF] dark:focus-visible:ring-[rgba(91,120,255,0.2)]";

function SettingsDeleteDialog({
    open,
    title,
    description,
    cancelText,
    confirmText,
    busy,
    onCancel,
    onConfirm,
}: {
    open: boolean;
    title: string;
    description: string;
    cancelText: string;
    confirmText: string;
    busy: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={(nextOpen) => {
            if (!nextOpen && !busy) onCancel();
        }}>
            <DialogContent className={cn(settingsDialogSurfaceClass, "sm:max-w-[420px]")}>
                <DialogHeader className={settingsDialogHeaderClass}>
                    <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(245,63,63,0.08)] text-[#F53F3F]">
                        <Trash2 className="h-4 w-4"/>
                    </div>
                    <DialogTitle className="text-[16px] font-semibold leading-5 text-[#0E1114]">{title}</DialogTitle>
                    <DialogDescription className="pt-1 text-[12px] leading-5 text-[#86888F]">{description}</DialogDescription>
                </DialogHeader>
                <DialogFooter className={settingsDialogFooterClass}>
                    <Button variant="outline" className={settingsSecondaryButtonClass} onClick={onCancel} disabled={busy}>{cancelText}</Button>
                    <Button variant="destructive" className={settingsDangerButtonClass} onClick={onConfirm} disabled={busy}>{confirmText}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

type KeepAliveFreezeProps = {
    frozen: boolean;
    children: React.ReactNode;
};

type CandidateComparisonLoadOptions = {
    background?: boolean;
    candidateIds?: number[];
    selectionItems?: CandidateSummary[];
};

function removeCandidateFromComparisonPreview(
    preview: CandidateComparisonPreview | null,
    candidateId: number,
): CandidateComparisonPreview | null {
    if (!preview || !preview.members.some((member) => member.candidate.id === candidateId)) {
        return preview;
    }

    const members = preview.members.filter((member) => member.candidate.id !== candidateId);
    const remainingCandidateIds = new Set(members.map((member) => member.candidate.id));
    const alignedDimensions = preview.aligned_dimensions.map((dimension) => {
        const values = dimension.values.filter((value) => remainingCandidateIds.has(value.candidate_id));
        const normalizedScores = values
            .map((value) => value.normalized_score)
            .filter((score): score is number => score != null && Number.isFinite(score));
        const highestScore = normalizedScores.length ? Math.max(...normalizedScores) : null;
        const highestCandidateIds = new Set(
            highestScore == null
                ? []
                : values
                    .filter((value) => value.normalized_score != null && Math.abs(value.normalized_score - highestScore) < 0.005)
                    .map((value) => value.candidate_id),
        );
        const hasMeaningfulHighest = highestCandidateIds.size > 0 && highestCandidateIds.size < normalizedScores.length;
        const isTiedHighest = hasMeaningfulHighest && highestCandidateIds.size > 1;
        const spread = normalizedScores.length
            ? Math.round((Math.max(...normalizedScores) - Math.min(...normalizedScores)) * 100) / 100
            : null;
        return {
            ...dimension,
            spread,
            values: values.map((value) => ({
                ...value,
                is_highest: Boolean(
                    preview.comparability.ranking_basis === "ai"
                    && hasMeaningfulHighest
                    && highestCandidateIds.has(value.candidate_id)
                ),
                is_tied_highest: Boolean(
                    preview.comparability.ranking_basis === "ai"
                    && isTiedHighest
                    && highestCandidateIds.has(value.candidate_id)
                ),
            })),
        };
    });
    const possibleDuplicateGroups = preview.possible_duplicate_groups
        .map((group) => ({
            ...group,
            candidate_ids: group.candidate_ids.filter((id) => remainingCandidateIds.has(id)),
        }))
        .filter((group) => group.candidate_ids.length > 1);
    const manualOverrideCount = members.filter((member) => member.screening?.manual_override.score != null).length;
    const manualOverrideMode = manualOverrideCount === 0
        ? "none"
        : manualOverrideCount === members.length
            ? "complete"
            : "partial";
    const keyDifferences = preview.comparability.score_deltas_allowed
        ? alignedDimensions
            .filter((dimension) => (dimension.spread || 0) > 0)
            .sort((left, right) => (right.spread || 0) - (left.spread || 0) || left.dimension_key.localeCompare(right.dimension_key))
            .slice(0, 3)
            .map((dimension) => dimension.dimension_key)
        : [];

    return {
        ...preview,
        manual_override_mode: manualOverrideMode,
        possible_duplicate_groups: possibleDuplicateGroups,
        members,
        aligned_dimensions: alignedDimensions,
        key_differences: keyDifferences,
    };
}

// keep-alive 页面隐藏期间跳过整棵子树的 React reconciliation（memo 比较器在 frozen 时判定"未变化"），
// 恢复可见的那次渲染会立刻使用最新内容。组件全程保持挂载：内部 state、滚动位置、effect 均不受影响。
const KeepAliveFreeze = React.memo(
    function KeepAliveFreeze({children}: KeepAliveFreezeProps) {
        return <>{children}</>;
    },
    (previousProps, nextProps) => nextProps.frozen && previousProps.frozen,
);

// 表单里的胶囊多选按钮（收件人/抄送/密送/候选人状态/评估方案共用同一视觉）
function TogglePillButton({active, onClick, children}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            className={cn(
                "rounded-full border px-3 py-2 text-xs transition",
                active
                    ? "border-[#1E3BFA] bg-[#1E3BFA] text-white dark:border-blue-400 dark:bg-blue-500 dark:text-white"
                    : "border-[#E6E7EB] bg-white text-[#33353D] hover:border-[#1E3BFA]/40 hover:bg-[#F7F8FA] dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300",
            )}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function PositionDetailSection({
    title,
    children,
    className,
}: {
    title: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section className={cn("rounded-[10px] border border-[#EBEEF5] bg-white px-5 py-[18px] dark:border-slate-800 dark:bg-slate-950", className)}>
            <div className="mb-[14px] flex items-center gap-2">
                <span aria-hidden="true" className="h-[13px] w-[3px] shrink-0 rounded-sm bg-[#1E3BFA]"/>
                <h2 className="text-[13px] font-semibold leading-[20px] text-[#0E1114] dark:text-slate-100">{title}</h2>
            </div>
            {children}
        </section>
    );
}

function PositionDetailBasicItem({label, value}: {label: React.ReactNode; value: React.ReactNode}) {
    return (
        <div className="flex min-w-0 flex-col gap-[5px]">
            <span className="text-[11px] leading-[17px] text-[#86888F] dark:text-slate-400">{label}</span>
            <span className="break-words text-[13px] leading-[20px] text-[#0E1114] [overflow-wrap:anywhere] dark:text-slate-100">{value}</span>
        </div>
    );
}

// 大体量页面与 recharts 图表按需加载，从招聘模块主 chunk 中拆出，首次进入该页时才下载对应代码。
const AuditPage = nextDynamic(() => import("./pages/AuditPageRedesigned").then((mod) => mod.AuditPage), {loading: PageChunkLoading, ssr: false});

function uniqueAiTaskLogs(logs: AITaskLog[]) {
    const seen = new Set<number>();
    return logs.filter((log) => {
        if (seen.has(log.id)) {
            return false;
        }
        seen.add(log.id);
        return true;
    });
}
const CandidatesPage = nextDynamic(() => import("./pages/CandidatesPage").then((mod) => mod.CandidatesPage), {loading: PageChunkLoading, ssr: false});
const MailSettingsPage = nextDynamic(() => import("./pages/MailSettingsPage").then((mod) => mod.MailSettingsPage), {loading: PageChunkLoading, ssr: false});
const ModelSettingsPage = nextDynamic(() => import("./pages/ModelSettingsPage").then((mod) => mod.ModelSettingsPage), {loading: PageChunkLoading, ssr: false});
const SkillSettingsPage = nextDynamic(() => import("./pages/SkillSettingsPage").then((mod) => mod.SkillSettingsPage), {loading: PageChunkLoading, ssr: false});
const InterviewWorkbenchPage = nextDynamic(() => import("./pages/InterviewWorkbenchPage").then((mod) => mod.InterviewWorkbenchPage), {loading: PageChunkLoading, ssr: false});
const ReviewWorkbenchPage = nextDynamic(() => import("./pages/ReviewWorkbenchPage").then((mod) => mod.ReviewWorkbenchPage), {loading: PageChunkLoading, ssr: false});
const TalentPoolPage = nextDynamic(() => import("./pages/TalentPoolPage").then((mod) => mod.TalentPoolPage), {loading: PageChunkLoading, ssr: false});
import { useOptimizedStats, useCachedListData, useCachedObjectData, useTaskSSE, type TaskSSEEvent } from "./hooks";
import {coalesceCandidatePatchesById, resolveCandidateConsistencyPollIntervalMs} from "./candidateConsistency";
import {
    INTERVIEW_REJECTED_STATUS_VALUES,
    INTERVIEW_TODO_STATUS_VALUES,
} from "./workflowStages";
import {
    ALL_COMPANY_DEPARTMENTS_VALUE,
    isOrganizationInScope,
    isSameRecruitmentOrgScope,
    normalizeRecruitmentOrgCode,
    resolveCompanyScopeCodes,
    resolveDepartmentScopeValues,
    resolveSelectedCompanyOrgCodes,
    resolveVisibleOrgCodes,
    validateRecruitmentOrgScopeSelection,
    type RecruitmentOrgScopeSelection,
} from "./orgScopeSelection";
import {
    navigateToRecruitmentPage,
    recruitmentNavBus,
    resolveRecruitmentNavigationDetail,
    syncRecruitmentActivePage,
} from '@/lib/recruitmentNavBus';

const TASK_MONITOR_VISIBLE_INTERVAL_MS = 30_000;
const SETTINGS_LIST_PAGE_SIZE = 50;
const SETTINGS_SEARCH_DEBOUNCE_MS = 300;
const SETTINGS_RECONCILIATION_INTERVAL_MS = 180_000;

type RecruitmentSkillSummary = Omit<RecruitmentSkill, "content"> & {
    content?: string;
    content_preview?: string | null;
    dimension_count?: number;
};

type RecruitmentSkillSettingsRow = RecruitmentSkill & {
    content_preview?: string | null;
    dimension_count?: number;
};

type RecruitmentResumeMailDispatchSummary = RecruitmentResumeMailDispatch & {
    candidate_names?: string[];
    position_title?: string | null;
};
const TASK_MONITOR_HIDDEN_INTERVAL_MS = 60_000;
const TASK_MONITOR_MAX_INTERVAL_MS = 30_000;
const TASK_MONITOR_BATCH_SCALE_THRESHOLD = 8;
const CANDIDATE_SSE_BATCH_WINDOW_MS = 100;
const CANDIDATE_CONSISTENCY_POLL_INTERVAL_MS = 12_000;
const CANDIDATE_CONSISTENCY_IDLE_POLL_INTERVAL_MS = 60_000;
const CANDIDATE_CONSISTENCY_FULL_REFRESH_INTERVAL_MS = 180_000;
const CANDIDATE_CONSISTENCY_EVENT_WINDOW_MS = 120_000;
const CANDIDATE_CONSISTENCY_ACTIVATION_WINDOW_MS = 30_000;
const CANDIDATE_CONSISTENCY_STATS_CONFIDENCE_MS = 30_000;
const CANDIDATE_LIST_PAGE_SIZE = 15;
const CANDIDATE_LIST_PAGE_SIZE_OPTIONS = [10, 15, 20, 30];
const CANDIDATE_LIST_CACHE_STALE_MS = 120_000;
const TERMINAL_SCREENING_TASK_STATUSES = new Set([
    "success",
    "fallback",
    "failed",
    "invalid_result",
    "json_parse_failed",
    "timeout",
    "retry_exhausted",
    "cancelled",
    "quota_exceeded",
    "rate_limited",
    "upstream_timeout",
    "request_failed",
    "screening_total_timeout",
    // 后端 P0 控制流新增终态：过期（换简历/换岗）、规则无效、简历无文本。
    "superseded",
    "screening_rule_invalid",
    "resume_text_unavailable",
]);

type CandidateSnapshotBatchUpdate = {
    snapshot: Partial<CandidateSummary>;
    insertIntoCandidateList?: boolean;
};

type JDUnsavedExitIntent = "close-dialog" | "back-list" | "switch-candidates" | "switch-config" | "switch-versions";

type CandidateListPageCache = {
    contextKey: string;
    items: CandidateSummary[];
    total: number;
    loadedAt: number;
};

type CandidateListRefreshQuerySnapshot = {
    departmentScope: string;
    orgScope: string;
    query: string;
    positionFilter: string[];
    statusFilter: string[];
    sourceFilter: string[];
    timeFilter: string;
    matchFilter: string;
    matchSortOrder: "" | "asc" | "desc";
    pageIndex: number;
    pageSize: number;
};

function mergeCandidatePatch<T extends Partial<CandidateSummary>>(current: T, patch: Partial<CandidateSummary>): T {
    let changed = false;
    const currentRecord = current as Record<string, unknown>;
    const patchRecord = patch as Record<string, unknown>;
    Object.keys(patchRecord).forEach((key) => {
        if (!Object.is(currentRecord[key], patchRecord[key])) {
            changed = true;
        }
    });
    return changed ? ({ ...current, ...patch } as T) : current;
}

function resolveStableCandidateDisplayStatus(candidate: Partial<CandidateSummary>) {
    const explicitDisplayStatus = String(candidate.display_status || "").trim();
    if (explicitDisplayStatus && explicitDisplayStatus !== "screening_running") {
        return explicitDisplayStatus;
    }
    const rawStatus = String(candidate.status || "").trim();
    if (rawStatus === "pending_screening") {
        return String(candidate.ai_recommended_status || rawStatus || "").trim();
    }
    return rawStatus || explicitDisplayStatus;
}

function sanitizeTerminalScreeningCandidateSnapshot(
    candidate?: Partial<CandidateSummary> | null,
    taskStatus?: string | null,
): Partial<CandidateSummary> | null {
    if (!candidate?.id) {
        return null;
    }
    const normalizedTaskStatus = String(taskStatus || "").trim().toLowerCase();
    const nextCandidate: Partial<CandidateSummary> = {
        ...candidate,
        active_screening_run_id: null,
        active_screening_task_id: null,
        active_screening_task_type: null,
        active_screening_stage: null,
        active_screening_status: null,
        active_screening_task_status: null,
        active_screening_auto_retry_scheduled: false,
    };
    if (normalizedTaskStatus === "success" || normalizedTaskStatus === "fallback") {
        nextCandidate.active_screening_failure_code = null;
        nextCandidate.display_status_reason = null;
    }
    // 后端 snapshot 已带明确终态 display_status 时直接保留，不走推导逻辑
    const TERMINAL_DISPLAY_STATUSES = new Set([
        "screening_passed", "screening_rejected", "screening_failed",
        "pending_screening", "unmatched", "talent_pool",
    ]);
    const originalDisplayStatus = String(nextCandidate.display_status || "").trim();
    if (TERMINAL_DISPLAY_STATUSES.has(originalDisplayStatus)) {
        // 保留后端终态值
    } else {
        nextCandidate.display_status = resolveStableCandidateDisplayStatus(nextCandidate);
    }
    return nextCandidate;
}

const POPULAR_CITIES = [
    "北京", "上海", "广州", "深圳", "杭州", "成都", "南京", "武汉",
    "西安", "重庆", "天津", "苏州", "长沙", "郑州", "东莞", "沈阳",
    "青岛", "宁波", "昆明", "厦门", "福州", "无锡", "合肥", "大连",
    "南昌", "哈尔滨", "济南", "佛山", "长春", "石家庄", "贵阳", "兰州",
];

type OrgScopedItem = {
    org_code?: string | null;
    created_by?: string | null;
    uploaded_by?: string | null;
    scope_level?: string | null;
    share_policy?: string | null;
    allow_sub_org_use?: boolean | null;
};

type PositionSkillBindingField = "jdSkillIds" | "screeningSkillIds" | "interviewSkillIds";
type PositionSkillSectionExpandedState = Record<PositionSkillBindingField, boolean>;
type PositionAssessmentDraft = Record<PositionSkillBindingField, number[]>;
type SkillAutoBindDestination = "positionForm" | "assessmentDraft";
type TalentPoolStatFilter = "all" | "matching" | "pending" | "no_match" | "ai_error" | "week_new";
type TalentPoolQueryState = {
    statFilter: TalentPoolStatFilter;
    searchQuery: string;
    sourceFilter: string;
    tagFilter: string;
    sortBy: "time" | "name" | "name_desc";
    offset: number;
    pageIndex: number;
    pageSize: number;
};
type TalentPoolStats = {
    total: number;
    matching: number;
    pending_action: number;
    no_system_position: number;
    identify_error: number;
    week_new: number;
};
type TalentPoolListResponse = {
    items: CandidateSummary[];
    total: number;
    stats: TalentPoolStats;
    available_tags?: string[];
};

const DEFAULT_POSITION_SKILL_SECTION_EXPANDED_STATE: PositionSkillSectionExpandedState = {
    jdSkillIds: false,
    screeningSkillIds: false,
    interviewSkillIds: false,
};
const TALENT_POOL_PAGE_SIZE = 15;
const TALENT_POOL_PAGE_SIZE_OPTIONS = [15, 30, 50, 100, 200, 500];
const DEFAULT_TALENT_POOL_QUERY: TalentPoolQueryState = {
    statFilter: "all",
    searchQuery: "",
    sourceFilter: "all",
    tagFilter: "all",
    sortBy: "time",
    offset: 0,
    pageIndex: 0,
    pageSize: TALENT_POOL_PAGE_SIZE,
};

type OrganizationSelectOption = {
    value: string;
    label: string;
    description?: string;
    organization?: ScriptHubOrganizationDefinition;
};

type PositionFormErrors = Partial<Record<
    | "orgCode"
    | "title"
    | "employmentType"
    | "keyRequirements"
    | "jobType"
    | "jobTypePath"
    | "experience"
    | "education"
    | "salaryMinK"
    | "salaryMaxK"
    | "salaryMonths"
    | "location"
    | "headcount",
    string
>>;
type SkillFormErrors = Partial<Record<"name" | "content" | "sortOrder", string>>;
type LLMFormErrors = Partial<Record<"configKey" | "taskType" | "provider" | "modelName" | "maxConcurrent" | "maxQps" | "priority" | "extraConfigText", string>>;

function buildBossPositionMeta(form: PositionFormState): BossPositionMeta {
    return {
        jobType: form.jobType.trim(),
        jobTypePath: normalizeBossJobPath(form.jobTypePath),
        experience: form.experience,
        education: form.education,
        salary: {
            minK: form.salaryMinK,
            maxK: form.salaryMaxK,
            months: form.salaryMonths,
        },
        autoPublish: form.autoPublish,
    };
}

function buildBossPositionJson(form: PositionFormState) {
    return {
        jobs: [
            {
                enabled: true,
                jobName: form.title.trim(),
                recruitType: form.employmentType.trim(),
                jobDescription: form.keyRequirements.trim(),
                jobType: form.jobType.trim(),
                jobTypePath: normalizeBossJobPath(form.jobTypePath),
                experience: form.experience,
                education: form.education,
                salary: {
                    minK: form.salaryMinK,
                    maxK: form.salaryMaxK,
                    months: form.salaryMonths,
                },
                addressKeyword: form.location.trim(),
                autoPublish: false,
            },
        ],
    };
}

type BossJsonCopyResult =
    | {ok: true; job: BossRecommendedJob}
    | {ok: false; title: string; errors: string[]};

function copyFailureTitle(position: PositionSummary) {
    return position.title?.trim() || `岗位 ${position.id}`;
}

function buildBossJsonCopyJob(position: PositionSummary): BossJsonCopyResult {
    const errors: string[] = [];
    const jobName = position.title.trim();
    const jobDescription = (position.key_requirements || "").trim();
    const meta = parseBossPositionMeta(position.tags || []);
    const metaPath = normalizeBossJobPath(meta.jobTypePath);
    const validMetaPath = metaPath.length && bossJobPathSet.has(metaPath.join(" / ")) ? metaPath : null;
    const closestJob = validMetaPath ? null : findClosestBossJob(meta.jobType || position.title);
    const jobTypePath = validMetaPath || closestJob?.path || [];
    const jobType = validMetaPath ? validMetaPath[2] : (closestJob?.third || "");
    const parsedSalary = parseBossSalaryRange(position.salary_range);
    const minK = Number.isFinite(meta.salary?.minK) ? Number(meta.salary?.minK) : Number(parsedSalary.minK);
    const maxK = Number.isFinite(meta.salary?.maxK) ? Number(meta.salary?.maxK) : Number(parsedSalary.maxK);
    const salaryMonths = BOSS_SALARY_MONTH_OPTIONS.includes(meta.salary?.months as typeof BOSS_SALARY_MONTH_OPTIONS[number])
        ? meta.salary!.months
        : parsedSalary.months;
    const months = BOSS_SALARY_MONTH_OPTIONS.includes(salaryMonths as typeof BOSS_SALARY_MONTH_OPTIONS[number])
        ? salaryMonths
        : "";
    const experience = BOSS_EXPERIENCE_OPTIONS.includes(meta.experience as typeof BOSS_EXPERIENCE_OPTIONS[number])
        ? meta.experience!
        : "不限";
    const education = BOSS_EDUCATION_OPTIONS.includes(meta.education as typeof BOSS_EDUCATION_OPTIONS[number])
        ? meta.education!
        : "不限";
    const addressKeyword = (position.location || "").trim();

    if (!jobName) {
        errors.push("职位名称为空");
    }
    if (!jobDescription) {
        errors.push("职位描述为空");
    }
    if (!jobType || !bossJobTypeSet.has(jobType)) {
        errors.push("缺少职位类型");
    }
    if (!jobTypePath.length || jobTypePath.length < 2 || !bossJobPathSet.has(jobTypePath.join(" / "))) {
        errors.push("职位类型路径不合法");
    }
    if (!BOSS_EXPERIENCE_OPTIONS.includes(experience as typeof BOSS_EXPERIENCE_OPTIONS[number])) {
        errors.push("经验要求不合法");
    }
    if (!BOSS_EDUCATION_OPTIONS.includes(education as typeof BOSS_EDUCATION_OPTIONS[number])) {
        errors.push("学历要求不合法");
    }
    if (!Number.isFinite(minK)) {
        errors.push("最低月薪不是数字");
    }
    if (!Number.isFinite(maxK)) {
        errors.push("最高月薪不是数字");
    }
    if (Number.isFinite(minK) && Number.isFinite(maxK) && maxK < minK) {
        errors.push("薪资范围错误");
    }
    if (!months) {
        errors.push("薪资月数不合法");
    }
    if (!addressKeyword) {
        errors.push("工作地址为空");
    }

    if (errors.length) {
        return {ok: false, title: copyFailureTitle(position), errors};
    }

    return {
        ok: true,
        job: {
            enabled: true,
            jobName,
            recruitType: "社招全职",
            jobDescription,
            jobType,
            jobTypePath: jobTypePath as BossRecommendedJob["jobTypePath"],
            experience,
            education,
            salary: {
                minK,
                maxK,
                months,
            },
            addressKeyword,
            autoPublish: false,
        },
    };
}

function buildBossJsonCopyPayload(positionsToCopy: PositionSummary[]): {ok: true; payload: BossRecommendedJobsPayload} | {ok: false; message: string} {
    const results = positionsToCopy.map(buildBossJsonCopyJob);
    const failures = results.filter((result): result is Extract<BossJsonCopyResult, {ok: false}> => !result.ok);
    if (failures.length) {
        const message = failures.length === 1
            ? `无法复制：${failures[0].errors.join("、")}`
            : `无法复制：${failures.map((failure) => `${failure.title} ${failure.errors.join("、")}`).join("；")}`;
        return {ok: false, message};
    }
    return {
        ok: true,
        payload: {
            jobs: results.map((result) => (result as Extract<BossJsonCopyResult, {ok: true}>).job),
        },
    };
}

async function writeTextToClipboard(text: string) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
}

function resolveBossFieldsFromPosition(position: PositionSummary): Pick<
    PositionFormState,
    "jobType" | "jobTypePath" | "experience" | "education" | "salaryMinK" | "salaryMaxK" | "salaryMonths" | "autoPublish" | "tagsText"
> {
    const tags = position.tags || [];
    const meta = parseBossPositionMeta(tags);
    const inferredJob = meta.jobType ? findClosestBossJob(meta.jobType) : findClosestBossJob(position.title);
    const inferredPath = normalizeBossJobPath(meta.jobTypePath).length
        ? normalizeBossJobPath(meta.jobTypePath)
        : (inferredJob?.path || []);
    const parsedSalary = parseBossSalaryRange(position.salary_range);
    const salary = meta.salary || parsedSalary;
    const normalizedSalary = normalizeBossSalarySelection(
        Number.isFinite(salary.minK) ? Number(salary.minK) : parsedSalary.minK,
        Number.isFinite(salary.maxK) ? Number(salary.maxK) : parsedSalary.maxK,
    );

    return {
        jobType: meta.jobType || inferredJob?.third || "",
        jobTypePath: inferredPath,
        experience: BOSS_EXPERIENCE_OPTIONS.includes(meta.experience as typeof BOSS_EXPERIENCE_OPTIONS[number])
            ? meta.experience!
            : "不限",
        education: BOSS_EDUCATION_OPTIONS.includes(meta.education as typeof BOSS_EDUCATION_OPTIONS[number])
            ? meta.education!
            : "不限",
        salaryMinK: normalizedSalary.minK,
        salaryMaxK: normalizedSalary.maxK,
        salaryMonths: BOSS_SALARY_MONTH_OPTIONS.includes(salary.months as typeof BOSS_SALARY_MONTH_OPTIONS[number])
            ? salary.months
            : parsedSalary.months,
        autoPublish: Boolean(meta.autoPublish),
        tagsText: joinTags(stripBossMetaTags(tags)),
    };
}

function clearPositionFormLocationHash() {
    if (typeof window === "undefined" || !window.location.hash.startsWith("#position-form-")) {
        return;
    }
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

function buildOrganizationScopeRequestKey(session: ScriptHubSession | null) {
    const user = session?.user;
    const roles = [...(user?.roles || [])].sort().join(",");
    const customOrgCodes = [...(user?.customOrgCodes || [])]
        .map(normalizeRecruitmentOrgCode)
        .sort()
        .join(",");
    return [
        session?.token || "",
        user?.id || "",
        user?.permissionVersion || "",
        user?.primaryOrgCode || "",
        user?.dataScope || "",
        user?.isSuperAdmin ? "super" : "normal",
        roles,
        customOrgCodes,
    ].join("|");
}

function isSelfDataScope(value?: string | null) {
    return String(value || "").trim().toUpperCase() === "SELF";
}

function getBusinessRowOwnerCode(row: OrgScopedItem) {
    return String(row.created_by || row.uploaded_by || "").trim();
}

function buildLocalCandidateStats(candidates: CandidateSummary[]): CandidateStatsData {
    const statusCounts: Record<string, number> = {};
    const todayStatusCounts: Record<string, number> = {};
    candidates.forEach((candidate) => {
        const status = resolveCandidateDisplayStatus(candidate);
        statusCounts[status] = (statusCounts[status] || 0) + 1;
        if (isToday(candidate.updated_at || candidate.created_at)) {
            todayStatusCounts[status] = (todayStatusCounts[status] || 0) + 1;
        }
    });
    return {
        total: candidates.length,
        pending_screening: statusCounts.pending_screening || 0,
        status_counts: statusCounts,
        today_total: Object.values(todayStatusCounts).reduce((sum, count) => sum + Number(count || 0), 0),
        today_status_counts: todayStatusCounts,
    };
}

function decrementCandidateStatsData(stats: CandidateStatsData | null, deletedCandidates: CandidateSummary[]) {
    if (!stats || deletedCandidates.length === 0) {
        return stats;
    }
    const statusCounts = {...(stats.status_counts || {})};
    const todayStatusCounts = {...(stats.today_status_counts || {})};
    let pendingScreeningDelta = 0;
    let todayDelta = 0;

    deletedCandidates.forEach((candidate) => {
        const status = resolveCandidateDisplayStatus(candidate);
        statusCounts[status] = Math.max(0, Number(statusCounts[status] || 0) - 1);
        if (status === "pending_screening") {
            pendingScreeningDelta += 1;
        }
        if (isToday(candidate.updated_at || candidate.created_at)) {
            todayStatusCounts[status] = Math.max(0, Number(todayStatusCounts[status] || 0) - 1);
            todayDelta += 1;
        }
    });

    return {
        ...stats,
        total: Math.max(0, Number(stats.total || 0) - deletedCandidates.length),
        pending_screening: Math.max(0, Number(stats.pending_screening || 0) - pendingScreeningDelta),
        status_counts: statusCounts,
        today_total: Math.max(0, Number(stats.today_total || 0) - todayDelta),
        today_status_counts: todayStatusCounts,
    };
}

function moveCandidateStatsDisplayStatus(
    stats: CandidateStatsData | null,
    candidate: CandidateSummary,
    fromStatus: string,
    toStatus: string,
) {
    if (!stats || !fromStatus || !toStatus || fromStatus === toStatus) {
        return stats;
    }
    const statusCounts = {...(stats.status_counts || {})};
    const todayStatusCounts = {...(stats.today_status_counts || {})};
    statusCounts[fromStatus] = Math.max(0, Number(statusCounts[fromStatus] || 0) - 1);
    statusCounts[toStatus] = Number(statusCounts[toStatus] || 0) + 1;
    if (isToday(candidate.updated_at || candidate.created_at)) {
        todayStatusCounts[fromStatus] = Math.max(0, Number(todayStatusCounts[fromStatus] || 0) - 1);
        todayStatusCounts[toStatus] = Number(todayStatusCounts[toStatus] || 0) + 1;
    }
    return {
        ...stats,
        pending_screening: Number(statusCounts.pending_screening || 0),
        status_counts: statusCounts,
        today_status_counts: todayStatusCounts,
    };
}

function countCandidatesByStatuses(candidates: CandidateSummary[], statuses: string[]) {
    const statusSet = new Set(statuses);
    return candidates.reduce((count, candidate) => (
        statusSet.has(resolveCandidateDisplayStatus(candidate)) ? count + 1 : count
    ), 0);
}

function buildLocalRecruitmentFunnelData(candidates: CandidateSummary[], talentPoolCount: number): RecruitmentFunnelData {
    return {
        stages: [
            {key: "total", label_zh: "全部候选人", label_en: "All Candidates", count: candidates.length},
            {key: "new_or_pending", label_zh: "待筛选", label_en: "Pending Screening", count: countCandidatesByStatuses(candidates, ["new_imported", "pending_screening"])},
            {key: "screening_passed", label_zh: "初筛通过", label_en: "Screening Passed", count: countCandidatesByStatuses(candidates, ["screening_passed"])},
            {key: "interview", label_zh: "面试阶段", label_en: "Interview Stage", count: countCandidatesByStatuses(candidates, [...INTERVIEW_TODO_STATUS_VALUES, "pending_interview", "interview_passed"])},
            {key: "offer", label_zh: "Offer 阶段", label_en: "Offer Stage", count: countCandidatesByStatuses(candidates, ["pending_offer", "offer_sent"])},
            {key: "hired", label_zh: "已入职", label_en: "Hired", count: countCandidatesByStatuses(candidates, ["hired"])},
        ],
        rejected_count: countCandidatesByStatuses(candidates, ["screening_failed", "screening_rejected", ...INTERVIEW_REJECTED_STATUS_VALUES]),
        talent_pool_count: talentPoolCount,
    };
}

function buildLocalSourceStatsData(candidates: CandidateSummary[]): SourceStatsData {
    const sourceCounts = new Map<string, number>();
    candidates.forEach((candidate) => {
        const source = String(candidate.source || "unknown").trim() || "unknown";
        sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    });
    return {
        total: candidates.length,
        sources: Array.from(sourceCounts.entries())
            .map(([source, count]) => ({source, count}))
            .sort((left, right) => right.count - left.count),
    };
}

function getFallbackOrganizationLabel(orgCode?: string | null) {
    const code = normalizeRecruitmentOrgCode(orgCode);
    const knownLabels: Record<string, string> = {
        group: "集团",
        haoshi: "好柿公司",
        chunmiao: "春苗公司",
    };
    return knownLabels[code] || code;
}

function deduplicateCandidates(candidates: CandidateSummary[]): CandidateSummary[] {
    const seen = new Map<number, CandidateSummary>();
    for (const c of candidates) {
        seen.set(c.id, c);
    }
    return Array.from(seen.values());
}

const TALENT_POOL_PIPELINE_REASONS = new Set(["auto_archived", "moved_by_hr", "evidence_review_required"]);
const TALENT_POOL_LIST_STATUSES = new Set(["matching", "unmatched", "talent_pool"]);

function isPositionPipelineTalentPoolCandidate(candidate: CandidateSummary) {
    const status = String(candidate.status || "").trim().toLowerCase();
    const reason = String(candidate.talent_pool_reason || "").trim().toLowerCase();
    return status === "talent_pool"
        || (
            status === "unmatched"
            && Boolean(candidate.position_id)
            && TALENT_POOL_PIPELINE_REASONS.has(reason)
        );
}

function shouldShowCandidateInPipelineList(candidate: CandidateSummary) {
    const status = String(candidate.status || "").trim().toLowerCase();
    if (!status || status === "matching") {
        return false;
    }
    if (status === "unmatched") {
        return isPositionPipelineTalentPoolCandidate(candidate);
    }
    return true;
}

function shouldShowCandidateInTalentPoolList(candidate: CandidateSummary) {
    const status = String(candidate.status || "").trim().toLowerCase();
    return TALENT_POOL_LIST_STATUSES.has(status);
}

const POSITION_CANDIDATE_STATUS_OPTIONS = [
    "screening_failed",
    "screening_passed",
    "screening_rejected",
    "pending_interview",
    "interview_passed",
    "interview_rejected",
    "pending_offer",
    "offer_sent",
    "hired",
];
let sharedRecruitmentMetadataCache: RecruitmentMetadata | null = null;
let sharedRecruitmentMetadataPromise: Promise<RecruitmentMetadata> | null = null;
let sharedOrganizationScopePromise: { cacheKey: string; promise: Promise<RecruitmentOrganizationScope> } | null = null;

function resolveScrollAreaViewport(node: HTMLDivElement | null): HTMLDivElement | null {
    if (!node) {
        return null;
    }
    return (node.querySelector("[data-slot='scroll-area-viewport']") as HTMLDivElement | null) || node;
}

function getOrganizationPathLabel(
    orgCode: string,
    organizations: Map<string, ScriptHubOrganizationDefinition>,
) {
    const organization = organizations.get(normalizeRecruitmentOrgCode(orgCode));
    if (!organization) {
        return getFallbackOrganizationLabel(orgCode);
    }
    const segments: string[] = [];
    let current: ScriptHubOrganizationDefinition | undefined = organization;
    const visited = new Set<string>();
    while (current && !visited.has(current.org_code)) {
        visited.add(current.org_code);
        if (current.org_type !== "group" || current.org_code === organization.org_code) {
            segments.unshift(current.name || current.org_code);
        }
        current = current.parent_org_code ? organizations.get(current.parent_org_code) : undefined;
    }
    return segments.join(" / ") || organization.name || organization.org_code;
}

function getOrganizationRelativePathLabel(
    orgCode: string,
    rootOrgCode: string,
    organizations: Map<string, ScriptHubOrganizationDefinition>,
) {
    const organization = organizations.get(normalizeRecruitmentOrgCode(orgCode));
    if (!organization) {
        return getFallbackOrganizationLabel(orgCode);
    }

    const rootCode = normalizeRecruitmentOrgCode(rootOrgCode);
    const segments: string[] = [];
    let current: ScriptHubOrganizationDefinition | undefined = organization;
    const visited = new Set<string>();
    while (current && !visited.has(current.org_code)) {
        visited.add(current.org_code);
        if (current.org_code === rootCode) {
            break;
        }
        if (current.org_type !== "group" || current.org_code === organization.org_code) {
            segments.unshift(current.name || current.org_code);
        }
        current = current.parent_org_code ? organizations.get(current.parent_org_code) : undefined;
    }
    return segments.join(" / ") || organization.name || organization.org_code;
}

function filterBusinessRowsByOrgCodes<T extends OrgScopedItem>(
    rows: T[],
    orgCodes: string[],
    options?: { selfOnly?: boolean; actorUserCode?: string | null },
) {
    const allowedOrgCodes = new Set(orgCodes.map(normalizeRecruitmentOrgCode));
    if (!allowedOrgCodes.size) {
        return [];
    }
    const actorUserCode = String(options?.actorUserCode || "").trim();
    const shouldFilterSelf = Boolean(options?.selfOnly && actorUserCode);
    return rows.filter((row) => {
        if (!allowedOrgCodes.has(normalizeRecruitmentOrgCode(row.org_code))) {
            return false;
        }
        if (!shouldFilterSelf) {
            return true;
        }
        return getBusinessRowOwnerCode(row) === actorUserCode;
    });
}

function resourceMatchesAnyOrgCode<T extends OrgScopedItem>(
    row: T,
    orgCodes: string[],
    organizations: Map<string, ScriptHubOrganizationDefinition>,
) {
    const targetOrgCodes = orgCodes.map(normalizeRecruitmentOrgCode);
    if (!targetOrgCodes.length) {
        return false;
    }
    const rowOrgCode = normalizeRecruitmentOrgCode(row.org_code);
    if (targetOrgCodes.includes(rowOrgCode)) {
        return true;
    }
    const scopeLevel = String(row.scope_level || "").toUpperCase();
    if (scopeLevel === "GLOBAL") {
        return true;
    }
    const sharePolicy = String(row.share_policy || "").toUpperCase();
    if (sharePolicy === "PUBLIC_IN_GROUP") {
        return true;
    }
    return Boolean(row.allow_sub_org_use) && targetOrgCodes.some((targetOrgCode) => (
        isOrganizationInScope(organizations, rowOrgCode, targetOrgCode)
    ));
}

function filterResourceRowsByOrgCodes<T extends OrgScopedItem>(
    rows: T[],
    orgCodes: string[],
    organizations: Map<string, ScriptHubOrganizationDefinition>,
) {
    return rows.filter((row) => resourceMatchesAnyOrgCode(row, orgCodes, organizations));
}

function getPollingDelay(
    visible: boolean,
    failureCount: number,
    visibleInterval: number,
    hiddenInterval: number,
    maxInterval: number,
) {
    const baseInterval = visible ? visibleInterval : hiddenInterval;
    return Math.min(baseInterval * (2 ** Math.min(failureCount, 3)), maxInterval);
}

interface RecruitmentAutomationContainerProps {
    onBack: () => void;
    hasExternalBackTarget?: boolean;
    initialPage?: RecruitmentPage;
    orgScopeSelection: RecruitmentOrgScopeSelection | null;
    onOrgScopeSelectionChange: (selection: RecruitmentOrgScopeSelection) => void;
}

type OrganizationCatalogStatus = "idle" | "loading" | "ready" | "error";

type OrganizationCatalogLoadResult = {
    authoritative: boolean;
    data: RecruitmentOrganizationScope;
};

// ---- 岗位内嵌候选人列表：行组件（模块级，稳定引用） ----
const POSITION_CANDIDATE_PAGE_SIZE = 10;
const POSITION_CANDIDATE_GRID_COLUMNS = "40px minmax(110px,1.2fr) minmax(120px,1.1fr) minmax(120px,1.2fr) 62px minmax(120px,1.1fr) 118px 96px 84px 92px 40px";

function compactText(value: unknown) {
    return String(value ?? "").trim();
}

function formatPositionCandidateName(candidate: CandidateSummary) {
    return resolveCandidateIdentity(candidate).displayName;
}

function formatMaskedContact(candidate: CandidateSummary, isZh: boolean) {
    if (candidate.phone) return compactText(candidate.phone);
    if (candidate.email) return compactText(candidate.email);
    return isZh ? "联系方式待补充" : "Contact needed";
}

function formatResumeState(candidate: CandidateSummary, isZh: boolean) {
    if (!candidate.latest_resume_file_id && !candidate.latest_parse_result_id) {
        return isZh ? "简历待上传" : "Resume needed";
    }
    if (!candidate.latest_parse_result_id) {
        return isZh ? "简历待解析" : "Parse pending";
    }
    return isZh ? "简历已解析" : "Resume parsed";
}

function formatPositionCandidateAge(candidate: CandidateSummary, isZh: boolean) {
    const age = Number(candidate.age);
    if (Number.isFinite(age) && age > 0) {
        return isZh ? `${age}岁` : `${age}`;
    }
    return isZh ? "年龄待补充" : "Age needed";
}

function formatPositionCandidateYears(candidate: CandidateSummary, isZh: boolean) {
    const years = compactText(candidate.years_of_experience);
    if (!years) return isZh ? "年限待解析" : "Pending";
    if (/年|月|以上|以内|近/.test(years)) return years;
    if (/^\d+(\.\d+)?$/.test(years)) return isZh ? `${years}年` : `${years}y`;
    return years;
}

function formatPositionCandidateIntent(candidate: CandidateSummary, isZh: boolean) {
    const city = compactText(candidate.city);
    const expectedCity = compactText(candidate.expected_city);
    if (city && expectedCity) return `${city} → ${expectedCity}`;
    if (city) return city;
    if (expectedCity) return isZh ? `期望 ${expectedCity}` : `Expected ${expectedCity}`;
    return isZh ? "城市待补充" : "City needed";
}

function getPositionCandidateMatchPercent(value?: number | null) {
    if (value === undefined || value === null || Number.isNaN(Number(value))) {
        return null;
    }
    return Math.max(0, Math.min(100, Number(value)));
}

function formatRelativeTime(value?: string | null, isZh = true) {
    const text = compactText(value);
    if (!text) return isZh ? "暂无更新时间" : "No update time";
    const timestamp = new Date(text).getTime();
    if (!Number.isFinite(timestamp)) return isZh ? "暂无更新时间" : "No update time";
    const diff = Math.max(0, Date.now() - timestamp);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) return isZh ? "刚刚" : "just now";
    if (diff < hour) {
        const minutes = Math.floor(diff / minute);
        return isZh ? `${minutes} 分钟前` : `${minutes}m ago`;
    }
    if (diff < day) {
        const hours = Math.floor(diff / hour);
        return isZh ? `${hours} 小时前` : `${hours}h ago`;
    }
    if (diff < 30 * day) {
        const days = Math.floor(diff / day);
        return isZh ? `${days} 天前` : `${days}d ago`;
    }
    return formatDateTime(text);
}

function sourceLabel(value?: string | null, isZh = true) {
    const source = compactText(value);
    if (!source) return isZh ? "暂无来源" : "No source";
    const zhLabels: Record<string, string> = {
        manual_upload: "手动上传",
        boss_zhipin: "BOSS直聘",
        liepin: "猎聘",
        headhunter: "猎头推荐",
        other: "其他来源",
    };
    const enLabels: Record<string, string> = {
        manual_upload: "Manual upload",
        boss_zhipin: "BOSS Zhipin",
        liepin: "Liepin",
        headhunter: "Headhunter",
        other: "Other",
    };
    return (isZh ? zhLabels : enLabels)[source] || source;
}

const JDStreamingPreview = React.memo(function JDStreamingPreview({
    content,
    jdGenerationStatus,
    isZh,
}: {
    content: string;
    jdGenerationStatus: string;
    isZh: boolean;
}) {
    const contentRef = useRef<HTMLDivElement | null>(null);
    const shouldAutoFollowRef = useRef(true);
    const [autoFollowPaused, setAutoFollowPaused] = useState(false);

    const scrollToLatest = useCallback(() => {
        const element = contentRef.current;
        if (!element) {
            return;
        }
        element.scrollTop = element.scrollHeight;
        shouldAutoFollowRef.current = true;
        setAutoFollowPaused(false);
    }, []);

    const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
        const element = event.currentTarget;
        const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
        const nextPaused = distanceToBottom > 32;
        shouldAutoFollowRef.current = !nextPaused;
        setAutoFollowPaused((current) => (current === nextPaused ? current : nextPaused));
    }, []);

    useEffect(() => {
        if (!content) {
            shouldAutoFollowRef.current = true;
            setAutoFollowPaused(false);
            return;
        }
        if (!shouldAutoFollowRef.current) {
            return;
        }
        const frameId = window.requestAnimationFrame(scrollToLatest);
        return () => window.cancelAnimationFrame(frameId);
    }, [content, scrollToLatest]);

    return (
        <div className="rounded-[8px] border border-[#1E3BFA]/20 bg-[#1E3BFA]/5 px-4 py-3.5 dark:border-blue-900 dark:bg-blue-950/30">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-medium text-[#0F23D9] dark:text-blue-200">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin"/>
                    {jdGenerationStatus === "syncing" ? (isZh ? "正在同步最新 JD 到页面…" : "Syncing the latest JD to page…") : (isZh ? "正在生成 JD…" : "Generating JD…")}
                </div>
                {autoFollowPaused ? (
                    <button
                        type="button"
                        className="rounded-[6px] border border-[#1E3BFA]/25 bg-white px-2.5 py-1 text-xs font-medium text-[#0F23D9] transition hover:border-[#1E3BFA] hover:bg-[#1E3BFA]/5 dark:border-blue-900 dark:bg-blue-950/70 dark:text-blue-200"
                        onClick={scrollToLatest}
                    >
                        {isZh ? "回到最新" : "Jump to latest"}
                    </button>
                ) : null}
            </div>
            {content ? (
                <div
                    ref={contentRef}
                    className="mt-3 max-h-[260px] overflow-y-auto whitespace-pre-wrap rounded-[6px] border border-[#EBEEF5] bg-white px-3 py-2.5 text-[12px] leading-[1.9] text-[#33353D] dark:bg-slate-900/70 dark:text-slate-200"
                    onScroll={handleScroll}
                >
                    {content}
                </div>
            ) : null}
        </div>
    );
});

const PositionCandidateRow = React.memo(function PositionCandidateRow({
    candidate,
    rowIndex,
    isExpanded,
    isDetailSelected,
    onToggleExpand,
    onViewDetails,
    isZh,
}: {
    candidate: CandidateSummary;
    rowIndex: number;
    isExpanded: boolean;
    isDetailSelected: boolean;
    onToggleExpand: (id: number) => void;
    onViewDetails: (id: number) => void;
    isZh: boolean;
}) {
    const displayStatus = resolveCandidateDisplayStatus(candidate);
    const candidateName = formatPositionCandidateName(candidate);
    const contactText = formatMaskedContact(candidate, isZh);
    const resumeState = formatResumeState(candidate, isZh);
    const tags = (candidate.tags || []).filter(Boolean).slice(0, 5);
    const matchPercentValue = getPositionCandidateMatchPercent(candidate.match_percent);
    const matchPercentText = matchPercentValue === null
        ? (isZh ? "待分析" : "Pending")
        : formatPercent(matchPercentValue);
    const matchColor = matchPercentValue === null
        ? "#B0B2B8"
        : matchPercentValue >= 80
            ? "#0A9C71"
            : matchPercentValue >= 60
                ? "#1E3BFA"
                : "#D48806";
    const aiReason = compactText(candidate.ai_match_reason) || compactText(candidate.note_summary);
    const potentialPosition = compactText(candidate.ai_potential_position);
    const potentialReason = compactText(candidate.ai_potential_reason);
    const aiRecommendedPosition = compactText(candidate.ai_match_position_title);
    const appliedPosition = compactText(candidate.position_title) || compactText(candidate.screened_position_title) || (isZh ? "岗位待补充" : "Position needed");
    const screenedPosition = compactText(candidate.screened_position_title) || appliedPosition;
    const yearsText = formatPositionCandidateYears(candidate, isZh);
    const educationText = compactText(candidate.education) || (isZh ? "学历待补充" : "Education needed");
    const ageText = formatPositionCandidateAge(candidate, isZh);
    const companyText = compactText(candidate.current_company);
    const intentText = formatPositionCandidateIntent(candidate, isZh);
    const sourceText = sourceLabel(candidate.source, isZh);
    const sourceDetail = compactText(candidate.source_detail);
    const updatedText = formatRelativeTime(candidate.updated_at || candidate.created_at, isZh);
    const workLines = [
        companyText ? `${companyText} · ${yearsText}` : "",
        !companyText ? (isZh ? "当前公司待补充" : "Company needed") : "",
    ].filter(Boolean);

    return (
        <div
            className={cn(
                "min-w-[1080px] border-b border-[#F2F3F5] bg-white transition-colors dark:border-slate-800/80 dark:bg-slate-950/70",
                isDetailSelected ? "shadow-[inset_3px_0_0_#1E3BFA]" : "",
                isExpanded ? "bg-[#F7F8FC] dark:bg-slate-950" : "hover:bg-[#F7F8FC] dark:hover:bg-slate-900/75"
            )}
        >
            <div
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                className="grid min-h-[56px] w-full cursor-pointer items-center px-5 py-2 text-left text-[13px] text-[#0E1114] outline-none transition-colors focus-visible:bg-[#1E3BFA]/5 dark:text-slate-200 dark:focus-visible:bg-slate-900"
                style={{ gridTemplateColumns: POSITION_CANDIDATE_GRID_COLUMNS }}
                onClick={() => onToggleExpand(candidate.id)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onToggleExpand(candidate.id);
                    }
                }}
            >
                <div className="min-w-0 text-[#B0B2B8] dark:text-slate-400">
                    <span className="block min-w-0 text-[13px] tabular-nums">{rowIndex}</span>
                </div>

                <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold leading-5 text-[#0E1114] dark:text-slate-50">{candidateName}</p>
                </div>

                <div className="min-w-0">
                    <p className="truncate text-[13px] leading-5 text-[#33353D] dark:text-slate-200">{ageText}</p>
                    <p className="truncate text-[11px] leading-4 text-[#B0B2B8] dark:text-slate-500">{contactText}</p>
                </div>

                <span className="truncate pr-2 text-[12px] text-[#33353D] dark:text-slate-200">{educationText}</span>
                <span className="truncate text-[12px] text-[#33353D] dark:text-slate-200">{yearsText}</span>
                <span className="truncate pr-2 text-[12px] text-[#33353D] dark:text-slate-200">{intentText}</span>

                <div className="min-w-0 pr-3">
                    <p className="text-[12px] font-semibold leading-4 tabular-nums" style={{color: matchColor}}>{matchPercentText}</p>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-[2px] bg-[#EBEEF5] dark:bg-slate-800">
                        <div className="h-full rounded-[2px]" style={{ width: `${matchPercentValue ?? 0}%`, backgroundColor: matchColor }}/>
                    </div>
                </div>

                <div className="min-w-0">
                    <Badge className={cn("h-[22px] w-fit rounded-full border px-[9px] py-0 text-[11px] font-normal", statusBadgeClass("candidate", displayStatus))}>
                        {labelForCandidateStatus(displayStatus)}
                    </Badge>
                </div>

                <span className="truncate text-[12px] text-[#33353D] dark:text-slate-200">{sourceText}</span>
                <span className="truncate text-[12px] text-[#86888F] dark:text-slate-300">{updatedText}</span>

                <div className="flex justify-end">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                className={cn(
                                    "flex h-7 w-7 items-center justify-center rounded-[4px] text-[#B0B2B8] transition hover:bg-[#1E3BFA]/5 hover:text-[#1E3BFA] dark:text-slate-400 dark:hover:bg-slate-900",
                                    isExpanded && "text-[#1E3BFA]",
                                )}
                                aria-label={isZh ? "查看候选人详情" : "View candidate details"}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onViewDetails(candidate.id);
                                }}
                            >
                                <Eye className="h-4 w-4"/>
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="top"><p>{isZh ? "查看详情" : "View details"}</p></TooltipContent>
                    </Tooltip>
                </div>
            </div>

            {isExpanded ? (
                <div
                    className="grid gap-x-12 bg-[#F7F8FC] pb-5 pl-[60px] pr-5 pt-1.5 text-[13px] text-[#0E1114] dark:bg-slate-950/80 dark:text-slate-200 lg:grid-cols-2"
                    onClick={(event) => event.stopPropagation()}
                >
                    <div className="flex min-w-0 flex-col gap-3">
                        <div className="flex min-w-0 gap-[14px]">
                            <span className="w-[72px] shrink-0 text-[12px] text-[#86888F] dark:text-slate-400">{isZh ? "联系电话" : "Contact"}</span>
                            <span className="min-w-0 break-words">{contactText}</span>
                        </div>
                        <div className="flex min-w-0 gap-[14px]">
                            <span className="w-[72px] shrink-0 text-[12px] text-[#86888F] dark:text-slate-400">{isZh ? "应聘岗位" : "Applied"}</span>
                            <span className="min-w-0 break-words">{appliedPosition}</span>
                        </div>
                        <div className="flex min-w-0 gap-[14px]">
                            <span className="w-[72px] shrink-0 text-[12px] text-[#86888F] dark:text-slate-400">{isZh ? "教育经历" : "Education"}</span>
                            <span className="min-w-0 break-words">{educationText}</span>
                        </div>
                        <div className="flex min-w-0 gap-[14px]">
                            <span className="w-[72px] shrink-0 text-[12px] text-[#86888F] dark:text-slate-400">{isZh ? "简历状态" : "Resume"}</span>
                            <span className="min-w-0 break-words">{resumeState}</span>
                        </div>
                        <div className="flex min-w-0 gap-[14px]">
                            <span className="w-[72px] shrink-0 text-[12px] text-[#86888F] dark:text-slate-400">{isZh ? "工作经历" : "Work"}</span>
                            <div className="min-w-0 space-y-1">
                                {workLines.length ? workLines.map((line) => (
                                    <p key={line} className="break-words">· {line}</p>
                                )) : (
                                    <p className="text-[#86888F] dark:text-slate-400">{isZh ? "工作经历待解析" : "Work history pending"}</p>
                                )}
                                <p className="break-words">· {isZh ? "工作年限" : "Experience"}：{yearsText}</p>
                            </div>
                        </div>
                        <div className="flex min-w-0 gap-[14px]">
                            <span className="w-[72px] shrink-0 text-[12px] text-[#86888F] dark:text-slate-400">{isZh ? "标签" : "Tags"}</span>
                            <span className="min-w-0 break-words">{tags.length ? tags.join("、") : (isZh ? "暂无标签" : "No tags")}</span>
                        </div>
                    </div>

                    <div className="mt-3 flex min-w-0 flex-col gap-3 lg:mt-0">
                        <div className="flex min-w-0 gap-[14px]">
                            <span className="w-[72px] shrink-0 text-[12px] text-[#86888F] dark:text-slate-400">{isZh ? "推荐岗位" : "Recommend"}</span>
                            <span className="min-w-0 break-words font-medium">{aiRecommendedPosition || (isZh ? "暂无 AI 推荐岗位" : "No AI recommendation")}</span>
                        </div>
                        <div className="flex min-w-0 gap-[14px]">
                            <span className="w-[72px] shrink-0 text-[12px] text-[#86888F] dark:text-slate-400">{isZh ? "转岗方向" : "Potential"}</span>
                            <span className="min-w-0 break-words">{potentialPosition || (isZh ? "暂无明确转岗建议" : "No clear role")}</span>
                        </div>
                        <div className="flex min-w-0 gap-[14px]">
                            <span className="w-[72px] shrink-0 text-[12px] text-[#86888F] dark:text-slate-400">{isZh ? "匹配说明" : "Reason"}</span>
                            <div className="min-w-0 space-y-2 text-[#33353D] dark:text-slate-300">
                                <p className="break-words leading-[1.75]">{aiReason || (isZh ? "暂无 AI 推荐说明，建议进入详情查看简历解析结果。" : "No AI reason yet. View detail for parsed resume.")}</p>
                                {potentialReason ? <p className="break-words leading-[1.75]">{potentialReason}</p> : null}
                            </div>
                        </div>
                        <div className="flex min-w-0 gap-[14px]">
                            <span className="w-[72px] shrink-0 text-[12px] text-[#86888F] dark:text-slate-400">{isZh ? "业务筛选" : "Stage"}</span>
                            <span className="min-w-0 break-words">{labelForCandidateStatus(displayStatus)}</span>
                        </div>
                        <div className="flex min-w-0 gap-[14px]">
                            <span className="w-[72px] shrink-0 text-[12px] text-[#86888F] dark:text-slate-400">{isZh ? "初筛岗位" : "Screened"}</span>
                            <span className="min-w-0 break-words">{screenedPosition}</span>
                        </div>
                        <div className="flex min-w-0 gap-[14px]">
                            <span className="w-[72px] shrink-0 text-[12px] text-[#86888F] dark:text-slate-400">{isZh ? "来源详情" : "Source"}</span>
                            {sourceDetail && /^https?:\/\//i.test(sourceDetail) ? (
                                <a className="min-w-0 break-all text-[#1E3BFA] hover:text-[#0F23D9] hover:underline" href={sourceDetail} target="_blank" rel="noreferrer">
                                    {sourceDetail}
                                </a>
                            ) : (
                                <span className="min-w-0 break-words">{sourceDetail || sourceText}</span>
                            )}
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}, (prev, next) => {
    return prev.candidate.id === next.candidate.id
        && prev.candidate.status === next.candidate.status
        && prev.candidate.display_status === next.candidate.display_status
        && prev.candidate.name === next.candidate.name
        && prev.candidate.phone === next.candidate.phone
        && prev.candidate.email === next.candidate.email
        && prev.candidate.current_company === next.candidate.current_company
        && prev.candidate.city === next.candidate.city
        && prev.candidate.expected_city === next.candidate.expected_city
        && prev.candidate.education === next.candidate.education
        && prev.candidate.years_of_experience === next.candidate.years_of_experience
        && prev.candidate.source === next.candidate.source
        && prev.candidate.source_detail === next.candidate.source_detail
        && prev.candidate.age === next.candidate.age
        && prev.candidate.position_title === next.candidate.position_title
        && prev.candidate.screened_position_title === next.candidate.screened_position_title
        && prev.candidate.match_percent === next.candidate.match_percent
        && prev.candidate.latest_resume_file_id === next.candidate.latest_resume_file_id
        && prev.candidate.latest_parse_result_id === next.candidate.latest_parse_result_id
        && prev.candidate.latest_score_id === next.candidate.latest_score_id
        && prev.candidate.latest_total_score === next.candidate.latest_total_score
        && prev.candidate.ai_match_position_title === next.candidate.ai_match_position_title
        && prev.candidate.ai_match_reason === next.candidate.ai_match_reason
        && prev.candidate.ai_potential_position === next.candidate.ai_potential_position
        && prev.candidate.ai_potential_reason === next.candidate.ai_potential_reason
        && prev.candidate.note_summary === next.candidate.note_summary
        && prev.candidate.updated_at === next.candidate.updated_at
        && prev.rowIndex === next.rowIndex
        && prev.isExpanded === next.isExpanded
        && prev.isDetailSelected === next.isDetailSelected
        && JSON.stringify(prev.candidate.tags || []) === JSON.stringify(next.candidate.tags || [])
        && prev.isZh === next.isZh;
});

// ---- 岗位内嵌候选人列表：无限滚动哨兵组件 ----
function PositionCandidatesLoadMoreSentinel({ onVisible, label }: { onVisible: () => void; label: string }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                observer.disconnect();
                onVisible();
            }
        }, { rootMargin: "200px" });
        observer.observe(el);
        return () => observer.disconnect();
    }, [onVisible]);
    return (
        <div ref={ref} className="flex items-center justify-center py-3 text-xs text-slate-400">
            {label}
        </div>
    );
}

const PositionCandidateSearchInput = React.memo(function PositionCandidateSearchInput({
    initialValue,
    onChange,
    placeholder,
}: {
    initialValue: string;
    onChange: (v: string) => void;
    placeholder: string;
}) {
    const [localValue, setLocalValue] = React.useState(initialValue);

    React.useEffect(() => {
        setLocalValue(initialValue);
    }, [initialValue]);

    const handleChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setLocalValue(e.target.value);
        onChange(e.target.value);
    }, [onChange]);

    return (
        <div className="relative w-[280px] max-w-full shrink-0">
            <Input
                className="h-[34px] min-w-[120px] rounded-[6px] border-[#E6E7EB] pl-[34px] pr-3 text-[13px] shadow-none placeholder:text-[#B0B2B8] focus-visible:border-[#1E3BFA] focus-visible:ring-[#1E3BFA]/10 md:text-[13px]"
                placeholder={placeholder}
                value={localValue}
                onChange={handleChange}
            />
            <svg className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#B0B2B8]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <circle cx="11" cy="11" r="8" strokeWidth="2"/>
                <path d="m21 21-4.35-4.35" strokeWidth="2" strokeLinecap="round"/>
            </svg>
        </div>
    );
});

const PositionQuerySearchInput = React.memo(function PositionQuerySearchInput({
    initialValue,
    onChange,
    placeholder,
    inputClassName,
}: {
    initialValue: string;
    onChange: (v: string) => void;
    placeholder: string;
    inputClassName?: string;
}) {
    const [localValue, setLocalValue] = React.useState(initialValue);

    React.useEffect(() => {
        setLocalValue(initialValue);
    }, [initialValue]);

    const handleChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setLocalValue(e.target.value);
        onChange(e.target.value);
    }, [onChange]);

    return (
        <div className="relative">
            <Input
                className={inputClassName}
                placeholder={placeholder}
                value={localValue}
                onChange={handleChange}
            />
            <svg className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <circle cx="11" cy="11" r="8" strokeWidth="2"/>
                <path d="m21 21-4.35-4.35" strokeWidth="2" strokeLinecap="round"/>
            </svg>
        </div>
    );
});

interface PositionCandidatesViewProps {
    positionDetail: PositionDetail;
    positionCandidatesData: CandidateSummary[];
    positionCandidatesLoading: boolean;
    positionCandidatesInitialLoaded: boolean;
    positionCandidatesTotal: number;
    positionCandidateStatusFilter: string;
    positionFilteredSortedCandidates: CandidateSummary[];
    onSelectCandidate: (id: number) => void;
    isLoadingMorePositionCandidates: boolean;
    selectedCandidateId: number | null;
    initialSearchValue: string;
    isZh: boolean;
    recruitmentUiText: { positionCandidatesSearch: string; viewInCandidatePage: string; noCandidates: string; noCandidatesDesc: string };
    candidateStatusLabels: Record<string, string>;
    onSearchChange: (v: string) => void;
    onStatusFilterChange: (v: string) => void;
    onViewAllCandidates: () => void;
    onLoadMore: () => void;
}

const PositionCandidatesView = React.memo(function PositionCandidatesView(props: PositionCandidatesViewProps) {
    const {
        positionDetail,
        positionCandidatesData,
        positionCandidatesLoading,
        positionCandidatesInitialLoaded,
        positionCandidatesTotal,
        positionCandidateStatusFilter,
        positionFilteredSortedCandidates,
        isLoadingMorePositionCandidates,
        selectedCandidateId,
        initialSearchValue,
        isZh,
        recruitmentUiText,
        candidateStatusLabels,
        onSearchChange,
        onStatusFilterChange,
        onSelectCandidate,
        onViewAllCandidates,
        onLoadMore,
    } = props;
    const [expandedCandidateId, setExpandedCandidateId] = useState<number | null>(null);

    const statusOptions = [
        {value: "__all__", label: isZh ? "全部" : "All"},
        ...POSITION_CANDIDATE_STATUS_OPTIONS.map((value) => ({
            value,
            label: candidateStatusLabels[value] || value,
        })),
    ];
    const handleToggleCandidateExpand = useCallback((candidateId: number) => {
        setExpandedCandidateId((current) => current === candidateId ? null : candidateId);
    }, []);

    useEffect(() => {
        setExpandedCandidateId(null);
    }, [positionDetail.position.id, positionCandidateStatusFilter, initialSearchValue]);

    useEffect(() => {
        if (expandedCandidateId !== null && !positionFilteredSortedCandidates.some((candidate) => candidate.id === expandedCandidateId)) {
            setExpandedCandidateId(null);
        }
    }, [expandedCandidateId, positionFilteredSortedCandidates]);

    return (
        <div className="relative flex h-full min-h-0 overflow-hidden rounded-[10px] border border-[#EBEEF5] bg-white shadow-none dark:border-slate-800 dark:bg-slate-950/85">
        {/* 左侧列表：永远100%宽度 */}
        <div className="flex w-full min-w-0 flex-col overflow-x-auto">
            {/* 工具栏 */}
            <div className="flex flex-nowrap items-center gap-[14px] border-b border-[#F2F3F5] px-5 py-[14px] dark:border-slate-800">
                <PositionCandidateSearchInput
                    initialValue={initialSearchValue}
                    onChange={onSearchChange}
                    placeholder={recruitmentUiText.positionCandidatesSearch}
                />
                <Select value={positionCandidateStatusFilter} onValueChange={onStatusFilterChange}>
                    <SelectTrigger className="h-[34px] w-fit rounded-[6px] border-[#E6E7EB] px-3 text-[13px] shadow-none focus:ring-[#1E3BFA]/10 [&>span]:pr-1">
                        <SelectValue placeholder={isZh ? "筛选状态" : "Filter status"} />
                    </SelectTrigger>
                    <SelectContent>
                        {statusOptions.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <div className="ml-auto flex items-center gap-2">
                    {positionCandidatesTotal > 0 && (
                        <span className="shrink-0 text-[12px] text-[#86888F] dark:text-slate-400">
                            {positionCandidateStatusFilter !== "__all__"
                                ? `${positionFilteredSortedCandidates.length}/${positionCandidatesTotal}${isZh ? "人" : " shown"}`
                                : `${positionCandidatesTotal}${isZh ? "人" : " total"}`}
                        </span>
                    )}
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-[34px] shrink-0 rounded-[6px] border-[#E6E7EB] px-[14px] text-[12px] font-normal text-[#33353D] shadow-none hover:border-[#1E3BFA] hover:bg-[#1E3BFA]/5 hover:text-[#1E3BFA]"
                        onClick={onViewAllCandidates}
                    >
                        {recruitmentUiText.viewInCandidatePage}
                    </Button>
                </div>
            </div>
            {/* 列头 */}
            <div className="grid min-w-[1080px] items-center border-b border-[#F2F3F5] bg-[#FBFBFC] px-5 text-[12px] font-normal text-[#86888F] shadow-none dark:border-slate-700/80 dark:bg-slate-900/95 dark:text-slate-300" style={{ height: 42, gridTemplateColumns: POSITION_CANDIDATE_GRID_COLUMNS }}>
                <span>#</span>
                <span>{isZh ? "候选人" : "Candidate"}</span>
                <span>{isZh ? "基本信息" : "Profile"}</span>
                <span>{isZh ? "学历" : "Edu"}</span>
                <span>{isZh ? "年限" : "Years"}</span>
                <span>{isZh ? "意向城市" : "City"}</span>
                <span>{isZh ? "匹配度" : "Match"}</span>
                <span>{isZh ? "流程状态" : "Stage"}</span>
                <span>{isZh ? "来源" : "Source"}</span>
                <span>{isZh ? "最近投递" : "Recent"}</span>
                <span/>
            </div>
            {/* 候选人列表 */}
            <div className="min-h-0 flex-1 overflow-y-auto">
            {positionCandidatesLoading || !positionCandidatesInitialLoaded ? (
                <div className="flex items-center justify-center py-12">
                    <LoadingPanel label={isZh ? "加载候选人..." : "Loading candidates..."} />
                </div>
            ) : positionFilteredSortedCandidates.length > 0 ? (
                <>
                    {positionFilteredSortedCandidates.map((c, index) => (
                        <PositionCandidateRow
                            key={c.id}
                            candidate={c}
                            rowIndex={index + 1}
                            isExpanded={expandedCandidateId === c.id}
                            isDetailSelected={selectedCandidateId === c.id}
                            onToggleExpand={handleToggleCandidateExpand}
                            onViewDetails={onSelectCandidate}
                            isZh={isZh}
                        />
                    ))}
                    {/* 加载更多指示器 */}
                    {positionCandidatesData.length < positionCandidatesTotal && (
                        <PositionCandidatesLoadMoreSentinel
                            onVisible={onLoadMore}
                            label={isLoadingMorePositionCandidates
                                ? (isZh ? "加载中..." : "Loading...")
                                : (isZh ? "滚动加载更多" : "Scroll to load more")}
                        />
                    )}
                </>
            ) : (
                <div className="flex items-center justify-center py-12">
                    <EmptyState
                        title={positionCandidatesData.length ? (isZh ? "没有匹配的候选人" : "No matching candidates") : recruitmentUiText.noCandidates}
                        description={positionCandidatesData.length ? (isZh ? "尝试调整筛选条件" : "Try adjusting filters") : recruitmentUiText.noCandidatesDesc}
                    />
                </div>
            )}
            </div>
        </div>

        </div>
    );
});

export default function RecruitmentAutomationContainer({
    onBack,
    hasExternalBackTarget = false,
    initialPage,
    orgScopeSelection,
    onOrgScopeSelectionChange,
}: RecruitmentAutomationContainerProps) {
    const {language, t} = useI18n();
    const isZh = language === "zh-CN";
    const candidateComparisonText = t.recruitment.candidateComparison;
    const uploadRecoveryText = t.recruitment.uploadRecovery;
    // Temporary UI toggle: keep the top-right assistant button in code for quick restore later.
    const hideTopRightAssistantEntry = true;
    const sessionUser = useMemo(() => getStoredScriptHubSession()?.user ?? null, []);
    const defaultOrgScope = normalizeRecruitmentOrgCode(sessionUser?.primaryOrgCode);
    const selectedOrgScope = normalizeRecruitmentOrgCode(orgScopeSelection?.orgScope || defaultOrgScope);
    const selectedDepartmentScope = String(orgScopeSelection?.departmentScope || "").trim()
        || ALL_COMPANY_DEPARTMENTS_VALUE;
    const updateOrgScopeSelection = useCallback((selection: RecruitmentOrgScopeSelection) => {
        onOrgScopeSelectionChange({
            orgScope: normalizeRecruitmentOrgCode(selection.orgScope),
            departmentScope: String(selection.departmentScope || "").trim()
                || ALL_COMPANY_DEPARTMENTS_VALUE,
        });
    }, [onOrgScopeSelectionChange]);
    const recruitmentToast = useMemo(() => getRecruitmentToastLocale(language), [language]);
    const recruitmentToastEntities = recruitmentToast.entities;
    const jdGenerationInFlightRef = useRef(false);
    const jdAbortControllerRef = useRef<AbortController | null>(null);
    const jdActiveTaskIdRef = useRef<number | null>(null);
    const skillAbortControllerRef = useRef<AbortController | null>(null);
    const skillActiveTaskIdRef = useRef<number | null>(null);
    const screeningLaunchInFlightRef = useRef(false);
    const taskMonitorTimersRef = useRef<Map<number, number>>(new Map());
    const taskMonitorTokensRef = useRef<Map<number, symbol>>(new Map());
    const pendingLogUpdatesRef = useRef<AITaskLog[]>([]);
    const logFlushRafRef = useRef<number | null>(null);
    const pendingCandidateUpdateEventsRef = useRef<TaskSSEEvent[]>([]);
    const candidateUpdateBatchTimerRef = useRef<number | null>(null);
    const candidateStatsRefreshTimerRef = useRef<number | null>(null);
    const candidateStatsRefreshInFlightRef = useRef(false);
    const candidateStatsRefreshPendingRef = useRef(false);
    const candidateStatsLoadRequestIdRef = useRef(0);
    const candidatePipelineStatsLoadRequestIdRef = useRef(0);
    const candidateConsistencyPollUntilRef = useRef(0);
    const candidateConsistencyRunningStatsUntilRef = useRef(0);
    const candidateConsistencyFullRefreshAtRef = useRef(Date.now() + CANDIDATE_CONSISTENCY_FULL_REFRESH_INTERVAL_MS);
    const candidateConsistencyForceRefreshRef = useRef(false);
    const candidateConsistencyRefreshInFlightRef = useRef(false);
    const candidatePageActiveVisibleRef = useRef(false);
    const refreshActiveCandidateListRef = useRef<(options?: {silent?: boolean}) => Promise<CandidateSummary[]>>(async () => []);
    const refreshCandidatePipelineStatsRef = useRef<(
        departmentScope?: string,
        orgScope?: string,
        positionIdOverride?: string,
    ) => Promise<void>>(async () => undefined);
    const refreshCandidateStatsRef = useRef<(
        departmentScope?: string,
        orgScope?: string,
    ) => Promise<void>>(async () => undefined);
    const loadCandidatePositionsRef = useRef<(options?: {force?: boolean}) => Promise<PositionSummary[]>>(async () => []);
    const [candidateConsistencyPollEpoch, setCandidateConsistencyPollEpoch] = useState(0);
    const requestInflightRef = useRef<Map<string, Promise<unknown>>>(new Map());
    const selectedLogIdRef = useRef<number | null>(null);
    const selectedPositionIdRef = useRef<number | null>(null);
    const selectedCandidateIdRef = useRef<number | null>(null);
    const candidateDetailRequestAbortControllersRef = useRef<Set<AbortController>>(new Set());
    const candidateDetailLoadingGenerationRef = useRef(0);
    const recentlyDeletedCandidateIdsRef = useRef<Set<number>>(new Set());
    const recentlyCompletedScreeningCandidatesRef = useRef<Map<number, number>>(new Map());
    const logsFiltersInitializedRef = useRef(false);
    const workspaceDataLoadStartedRef = useRef(false);
    const positionsLoadStartedRef = useRef(false);
    const positionsLoadedOnceRef = useRef(false);
    const positionsLoadRequestIdRef = useRef(0);
    const candidatesLoadRequestIdRef = useRef(0);
    const skillSettingsLoadRequestIdRef = useRef(0);
    const skillSettingsLoadAbortControllerRef = useRef<AbortController | null>(null);
    const skillSettingsScopeKeyRef = useRef("");
    const skillDetailLoadRequestIdRef = useRef(0);
    const skillDetailLoadAbortControllerRef = useRef<AbortController | null>(null);
    const llmConfigsLoadRequestIdRef = useRef(0);
    const llmConfigsLoadAbortControllerRef = useRef<AbortController | null>(null);
    const mailSendersLoadRequestIdRef = useRef(0);
    const mailSendersLoadAbortControllerRef = useRef<AbortController | null>(null);
    const mailRecipientsLoadRequestIdRef = useRef(0);
    const mailRecipientsLoadAbortControllerRef = useRef<AbortController | null>(null);
    const mailDispatchesLoadRequestIdRef = useRef(0);
    const mailDispatchesLoadAbortControllerRef = useRef<AbortController | null>(null);
    const mailDispatchesScopeKeyRef = useRef("");
    const mailDispatchDetailLoadRequestIdRef = useRef(0);
    const mailDispatchDetailLoadAbortControllerRef = useRef<AbortController | null>(null);
    const mailAutoConfigLoadRequestIdRef = useRef(0);
    const mailAutoConfigLoadAbortControllerRef = useRef<AbortController | null>(null);
    const candidateListTransitionTokenRef = useRef(0);
    const positionDetailLoadRequestIdRef = useRef(0);
    const candidatePageTargetCandidateIdRef = useRef<number | null>(null);
    const defaultTabSetForPositionRef = useRef<number | null>(null);
    const mountedRef = useRef(true);
    const candidateListScrollElRef = useRef<HTMLDivElement | null>(null);
    const [candidateListScrollEl, setCandidateListScrollEl] = useState<HTMLDivElement | null>(null);
    const candidateListScrollRef = useCallback((node: HTMLDivElement | null) => {
        candidateListScrollElRef.current = node;
        setCandidateListScrollEl(node);
    }, []);
    const [candidateListHorizontalRailEl, setCandidateListHorizontalRailEl] = useState<HTMLDivElement | null>(null);
    const candidateListHorizontalRailRef = useCallback((node: HTMLDivElement | null) => {
        setCandidateListHorizontalRailEl(node);
    }, []);
    const [auditListScrollEl, setAuditListScrollEl] = useState<HTMLDivElement | null>(null);
    const auditListScrollRef = useCallback((node: HTMLDivElement | null) => {
        if (!node) {
            setAuditListScrollEl(null);
            return;
        }

        requestAnimationFrame(() => {
            const viewport =
                (node.querySelector("[data-slot='scroll-area-viewport']") as HTMLDivElement | null) ||
                node;
            setAuditListScrollEl(viewport);
        });
    }, []);
    const [auditListHorizontalRailEl, setAuditListHorizontalRailEl] = useState<HTMLDivElement | null>(null);
    const auditListHorizontalRailRef = useCallback((node: HTMLDivElement | null) => setAuditListHorizontalRailEl(node), []);
    const [candidateListViewportWidth, setCandidateListViewportWidth] = useState(0);
    const [auditListViewportWidth, setAuditListViewportWidth] = useState(0);
    const candidateListScrollSyncLockRef = useRef<"table" | "rail" | null>(null);
    const auditListScrollSyncLockRef = useRef<"table" | "rail" | null>(null);
    const candidateListColumnResizeRef = useRef<{
        key: CandidateListColumnKey;
        startX: number;
        startWidth: number;
    } | null>(null);
    // Fine-grained permission checks — each controls specific UI elements
    const perms = sessionUser?.permissions ?? {};
    const canManagePosition = Boolean(perms["recruitment-position-manage"]);
    const canManageCandidate = Boolean(perms["recruitment-candidate-manage"]);
    const canExecuteProcess = Boolean(perms["recruitment-process-execute"]);
    const canViewRecruitmentDashboard = Boolean(perms["recruitment-dashboard-view"]);
    const canViewTalentPool = Boolean(perms["recruitment-talent-pool-view"]);
    const canViewRecruitmentAssistant = Boolean(perms["recruitment-assistant-view"]);
    const canViewLog = Boolean(perms["recruitment-log-view"]);
    const canViewReview = Boolean(perms["recruitment-review-view"]);
    const canActReview = Boolean(perms["recruitment-review-act"]);
    const canManageReview = Boolean(perms["recruitment-review-manage"]);
    const canViewInterview = Boolean(perms["recruitment-interview-view"]);
    const canActInterview = Boolean(perms["recruitment-interview-act"]);
    const canManageInterview = Boolean(perms["recruitment-interview-manage"]);
    const canViewSkill = Boolean(perms["recruitment-skill-view"]);
    const canBindSkill = Boolean(perms["recruitment-skill-bind"]);
    const canManageSkill = Boolean(perms["recruitment-skill-manage"]);
    const canViewMail = Boolean(perms["recruitment-mail-view"]);
    const canSendMail = Boolean(perms["recruitment-mail-send"]);
    const canManageMailSenders = Boolean(perms["recruitment-mail-sender-manage"]);
    const canManageMailRecipients = Boolean(perms["recruitment-mail-config-manage"]);
    const canManageMailConfig = canManageMailSenders || canManageMailRecipients;
    const canViewLLMConfig = Boolean(perms["recruitment-llm-config-view"]);
    const canManageLLMConfig = Boolean(perms["recruitment-llm-config-manage"]);
    const canUseRecruitmentWorkspace = Boolean(
        canViewRecruitmentDashboard
        || canManagePosition
        || canManageCandidate
        || canExecuteProcess
        || canViewLog
    );
    const recruitmentUiText = useMemo(() => ({
        loadingWorkspace: isZh ? "正在加载招聘工作台..." : "Loading recruiting workspace...",
        back: isZh ? "返回" : "Back",
        refresh: isZh ? "刷新" : "Refresh",
        refreshing: isZh ? "刷新中..." : "Refreshing...",
        uploadResume: isZh ? "上传简历" : "Upload Resume",
        createPosition: isZh ? "新增招聘需求" : "New Hiring Request",
        currentOrganization: isZh ? "当前查看组织" : "Current Organization",
        currentOrgScope: isZh ? "当前组织范围" : "Organization Scope",
        currentDepartment: isZh ? "当前部门范围" : "Department Scope",
        allVisibleDepartments: isZh ? "全部可见部门" : "All Visible Departments",
        organizationField: isZh ? "所属组织/公司" : "Organization / Company",
        targetOrganization: isZh ? "组织/公司" : "Target Organization / Company",
        chooseTargetOrganization: isZh ? "请选择组织/公司" : "Choose a target organization",
        allVisibleCreateHint: isZh ? "当前范围包含多个组织，请明确选择新岗位归属公司/部门。" : "The current scope contains multiple target organizations. Choose where this position belongs.",
        allVisibleUploadHint: isZh ? "当前范围包含多个组织，未关联岗位时必须选择简历归属公司/部门。" : "The current scope contains multiple target organizations. Choose a target organization when no position is linked.",
        openAssistantDrawer: isZh ? "打开 AI 助手" : "Open AI Assistant",
        manageSettings: isZh ? "管理设置" : "Management Settings",
        settingsSkillsTitle: isZh ? "评估方案管理" : "Assessment Plan Settings",
        settingsSkillsDescription: isZh ? "维护招聘评估和题目生成所用的评估方案。" : "Manage the assessment plans used for screening and interview-question generation.",
        settingsModelsTitle: isZh ? "模型配置" : "Model Settings",
        settingsModelsDescription: isZh ? "按任务类型管理 provider、model、base URL 和 key。" : "Manage provider, model, base URL, and API key by task type.",
        settingsMailTitle: isZh ? "邮件中心" : "Mail Center",
        settingsMailDescription: isZh ? "维护发件箱、收件人和简历邮件发送记录。" : "Manage sender accounts, recipients, and resume delivery records.",
        requiredFieldHint: isZh ? "必填项" : "Required",
        nameLabel: isZh ? "名称" : "Name",
        sortLabel: isZh ? "排序" : "Sort Order",
        descriptionLabel: isZh ? "描述" : "Description",
        tagsLabel: isZh ? "标签" : "Tags",
        contentLabel: isZh ? "内容" : "Content",
        tagsPlaceholder: isZh ? "标签，使用英文逗号分隔" : "Tags, separated by commas",
        saveAndEnableLabel: isZh ? "保存后立即启用" : "Enable immediately after saving",
        saving: isZh ? "保存中..." : "Saving...",
        deleteAction: isZh ? "删除" : "Delete",
        deleting: isZh ? "删除中..." : "Deleting...",
        confirmDelete: isZh ? "确认删除" : "Confirm Delete",
        skillCreateTitle: isZh ? "新增评估方案" : "New Assessment Plan",
        skillEditTitle: isZh ? "编辑评估方案" : "Edit Assessment Plan",
        skillDialogDescription: isZh
            ? "评估方案是管理员配置项，因此入口收在管理设置里，不占用主工作台主路径。"
            : "Assessment plans are managed from admin settings so the main workspace stays focused.",
        saveSkill: isZh ? "保存评估方案" : "Save Assessment Plan",
        skillNameRequired: isZh ? "请输入评估方案名称" : "Please enter an assessment plan name",
        skillNameTooLong: isZh ? "评估方案名称不能超过 120 个字符" : "Assessment plan name cannot exceed 120 characters",
        skillContentRequired: isZh ? "请输入评估方案内容" : "Please enter the assessment plan content",
        skillSortOrderInvalid: isZh ? "排序需为 0 到 9999 之间的整数" : "Sort order must be an integer between 0 and 9999",
        skillDeleteTitle: isZh ? "确认删除评估方案" : "Delete Assessment Plan",
        skillDeleteDescription: isZh
            ? "删除后该规则将不再参与新的招聘流程，但历史对话和任务日志仍会保留这次使用痕迹。"
            : "After deletion, this assessment plan will no longer be used in new recruiting flows, while past conversations and task logs will still keep its history.",
        modelConfigCreateTitle: isZh ? "新增模型配置" : "New Model Configuration",
        modelConfigEditTitle: isZh ? "编辑模型配置" : "Edit Model Configuration",
        modelDialogDescription: isZh
            ? "按任务类型维护 provider、model、API key 和运行时环境变量，支持随时切换供应商。"
            : "Maintain provider, model, API key, and runtime environment variables by task type, and switch providers at any time.",
        configKeyLabel: isZh ? "配置键" : "Config Key",
        taskTypeLabel: isZh ? "任务类型" : "Task Type",
        providerLabel: "Provider",
        modelNameLabel: isZh ? "模型名称" : "Model Name",
        baseUrlLabel: "Base URL",
        apiKeyEnvLabel: isZh ? "API Key 环境变量" : "API Key Environment Variable",
        apiKeyValueLabel: isZh ? "API Key 值" : "API Key Value",
        maxConcurrentLabel: isZh ? "最大并发" : "Max Concurrency",
        maxQpsLabel: isZh ? "每秒请求数" : "Requests Per Second",
        priorityLabel: isZh ? "优先级" : "Priority",
        extraConfigLabel: "Extra Config",
        apiKeyEnvPlaceholder: isZh ? "例如 GEMINI_API_KEY" : "For example: GEMINI_API_KEY",
        apiKeyValuePlaceholder: isZh ? "可选，留空则使用环境变量" : "Optional. Leave empty to use the environment variable.",
        maxConcurrentHint: isZh ? "同一模型配置的并发是全局共享的。填 1 表示所有人共用同一串行队列。" : "Concurrency is shared globally for the same model config. Use 1 to force a single serial queue for everyone.",
        maxQpsHint: isZh ? "同一模型配置的 QPS 也是全局共享。填 0 表示不额外限制。" : "QPS is also shared globally for the same model config. Use 0 to disable the extra cap.",
        modelNameHint: isZh
            ? "这里就是实际调用的大模型标识。如果你要换模型版本，直接编辑这里即可。"
            : "This is the actual model identifier used at runtime. Edit it directly when you want to switch model versions.",
        saveModelConfig: isZh ? "保存配置" : "Save Configuration",
        llmConfigKeyRequired: isZh ? "请输入配置键" : "Please enter a config key",
        llmConfigKeyTooLong: isZh ? "配置键不能超过 120 个字符" : "Config key cannot exceed 120 characters",
        llmConfigKeyDuplicate: (value: string) => (
            isZh ? `配置键"${value}"已存在，请换一个` : `The config key "${value}" already exists. Please use another one.`
        ),
        llmTaskTypeRequired: isZh ? "请输入任务类型" : "Please enter a task type",
        llmTaskTypeTooLong: isZh ? "任务类型不能超过 80 个字符" : "Task type cannot exceed 80 characters",
        llmProviderRequired: isZh ? "请选择 Provider" : "Please choose a provider",
        llmProviderTooLong: isZh ? "Provider 不能超过 80 个字符" : "Provider cannot exceed 80 characters",
        llmModelNameRequired: isZh ? "请输入模型名称" : "Please enter a model name",
        llmModelNameTooLong: isZh ? "模型名称不能超过 120 个字符" : "Model name cannot exceed 120 characters",
        llmMaxConcurrentInvalid: isZh ? "最大并发需为 1 到 100 之间的整数" : "Max concurrency must be an integer between 1 and 100",
        llmMaxQpsInvalid: isZh ? "每秒请求数需为 0 到 1000 之间的整数" : "Requests per second must be an integer between 0 and 1000",
        llmPriorityInvalid: isZh ? "优先级需为 0 到 999 之间的整数" : "Priority must be an integer between 0 and 999",
        llmExtraConfigInvalidJson: isZh ? "Extra Config 必须是合法 JSON" : "Extra Config must be valid JSON",
        llmExtraConfigObjectOnly: isZh ? "Extra Config 必须是 JSON 对象" : "Extra Config must be a JSON object",
        llmDeleteTitle: isZh ? "确认删除模型配置" : "Delete Model Configuration",
        llmDeleteDescription: isZh
            ? "删除后将不再参与任务路由。如果它是当前生效模型，系统会自动回落到其他可用配置。"
            : "After deletion, this config will no longer participate in task routing. If it is currently active, the system will fall back to another available configuration.",
        currentModelSwitched: (taskType: string, modelName: string) => (
            isZh ? `已切换 ${taskType} 的当前模型为 ${modelName}` : `Switched the current model for ${taskType} to ${modelName}`
        ),
        workSections: isZh ? "工作分区" : "Work Areas",
        workspaceTitle: isZh ? "工作台" : "Workspace",
        workspaceDescription: isZh ? "首页指标、待办、快捷操作与近期活动" : "Overview metrics, to-dos, quick actions, and recent activity",
        positionsTitle: isZh ? "招聘需求与职位" : "Hiring Requests & Positions",
        positionsDescription: isZh ? "以招聘需求为入口，维护职位信息、JD、候选人与流程配置" : "Manage hiring requests, position details, JDs, candidates, and workflow settings",
        candidatesTitle: isZh ? "候选人" : "Recruits",
        candidatesDescription: isZh ? "ATS 列表、筛选、状态推进与档案查看" : "ATS list, filtering, status updates, and candidate profiles",
        auditTitle: isZh ? "审计中心" : "Audit Center",
        auditDescription: isZh ? "看 AI 处理记录、模型、错误与留痕" : "Inspect AI task logs, models, errors, and audit traces",
        assistantNavTitle: isZh ? "招聘助手" : "Recruiting Assistant",
        assistantNavDescription: isZh ? "自然语言驱动岗位、候选人和评估方案上下文" : "Natural-language workspace for positions, candidates, and assessment plan context",
        quickAddPosition: isZh ? "新增招聘需求" : "Add Hiring Request",
        preferredInterviewSkillFromMemory: isZh ? "工作记忆中的面试题评估方案" : "Interview assessment plans from workflow memory",
        positionBoundSkills: isZh ? "岗位绑定评估方案" : "Position-bound assessment plans",
        noConfiguredSkills: isZh ? "未配置评估方案" : "No assessment plans configured",
        screeningMemorySkills: isZh ? "初筛工作记忆评估方案" : "Screening assessment plans from workflow memory",
        interviewMemorySkills: isZh ? "面试题工作记忆评估方案" : "Interview assessment plans from workflow memory",
        manualSelectedSkills: isZh ? "手动选择评估方案" : "Manually selected assessment plans",
        unspecifiedCandidate: isZh ? "未指定候选人" : "No candidate selected",
        candidateWithId: (id: number) => (isZh ? `候选人 #${id}` : `Candidate #${id}`),
        modelUnrecognized: isZh ? "暂未识别" : "Unrecognized",
        resendResumeMailTitle: isZh ? "再次发送简历邮件" : "Resend Resume Email",
        sendResumeMailTitle: isZh ? "发送简历邮件" : "Send Resume Email",
        resendResumeMailDescription: (dispatchId: number | null) => (
            isZh
                ? `已基于发送记录 #${dispatchId || "-"} 预填内容。你可以修改收件人、标题和正文后再次发送。`
                : `The form has been prefilled from dispatch #${dispatchId || "-"}. You can edit recipients, subject, and body before sending again.`
        ),
        sendResumeMailDescription: isZh
            ? "支持单个或批量发送给一个或多个收件人。上方可直接填写收件人邮箱，下方可快捷勾选内部收件人。邮件标题和正文都允许留空，留空时由系统按默认模板生成。"
            : "Send one or many resumes to one or more recipients. You can enter email addresses directly or choose internal recipients below. Subject and body may be left blank to use the default template.",
        mailSentMessage: (dispatchId: number, recipientEmails: string[], attachmentCount: number, isResend: boolean) => {
            const title = isResend
                ? (isZh ? "已再次发送简历邮件。" : "Resume email resent.")
                : (isZh ? "已发送简历邮件。" : "Resume email sent.");
            const sep = isZh ? "、" : ", ";
            const dispatchLabel = isZh ? "发送记录" : "Dispatch";
            const recipientsLabel = isZh ? "收件人" : "Recipients";
            const attachmentsLabel = isZh ? "附件" : "Attachments";
            const attachmentText = isZh ? `${attachmentCount} 份简历` : `${attachmentCount} resume(s)`;
            return `${title}\n- ${dispatchLabel}：#${dispatchId}\n- ${recipientsLabel}：${recipientEmails.join(sep)}\n- ${attachmentsLabel}：${attachmentText}`;
        },
        sending: isZh ? "发送中..." : "Sending...",
        resend: isZh ? "再次发送" : "Send Again",
        sendResume: isZh ? "发送简历" : "Send Resume",
        sentCountSummary: (count: number, latestSentAt?: string | null) => (
            latestSentAt
                ? (isZh ? `已发送 ${count} 次 · 最近 ${formatDateTime(latestSentAt)}` : `${count} sent · latest ${formatDateTime(latestSentAt)}`)
                : (isZh ? `已发送 ${count} 次` : `${count} sent`)
        ),
        allPositions: isZh ? "全部岗位" : "All positions",
        specifiedPosition: isZh ? "指定岗位" : "Specific position",
        allStatuses: isZh ? "全部状态" : "All statuses",
        allMatchPercent: isZh ? "全部匹配度" : "All match scores",
        above80: isZh ? "80% 以上" : "80%+",
        above60: isZh ? "60% 以上" : "60%+",
        above40: isZh ? "40% 以上" : "40%+",
        allSources: isZh ? "全部来源" : "All sources",
        allTime: isZh ? "全部时间" : "All time",
        today: isZh ? "今天" : "Today",
        last7Days: isZh ? "近 7 天" : "Last 7 days",
        last30Days: isZh ? "近 30 天" : "Last 30 days",
        noKeyword: isZh ? "无关键词" : "No keyword",
        keywordPrefix: isZh ? "关键词" : "Keyword",
        allTaskTypes: isZh ? "全部任务类型" : "All task types",
        queueJoined: isZh ? "已将初筛任务加入队列" : "Screening task added to the queue",
        screeningStopped: isZh ? "已停止初筛" : "Screening stopped",
        screeningFailed: (error: string) => (isZh ? `初筛失败：${error}` : `Screening failed: ${error}`),
        batchScreening: isZh ? "批量初筛" : "Batch screening",
        screening: isZh ? "初筛" : "Screening",
        createPublishTask: isZh ? "创建发布预演" : "Create Publish Preview",
        publishTaskDesc: isZh ? "当前仅生成发布预演记录，不会向招聘平台提交职位。" : "This creates a publishing preview only and does not submit the position to a recruiting platform.",
        targetPlatform: isZh ? "目标平台" : "Target Platform",
        executionMode: isZh ? "执行方式" : "Execution Method",
        bossDirect: isZh ? "BOSS 直聘" : "Boss Zhipin",
        zhilian: isZh ? "智联招聘" : "Zhaopin",
        cancel: isZh ? "取消" : "Cancel",
        createTask: isZh ? "创建预演" : "Create Preview",
        allowedAutoMailStatuses: isZh ? "允许自动发送的候选人状态" : "Candidate statuses eligible for auto-send",
        reservedTemplateId: isZh ? "自动发送模板 ID（预留）" : "Auto-send Template ID (reserved)",
        reservedTemplatePlaceholder: isZh ? "为空时使用系统默认模板" : "Use the system default template when left empty",
        dedupMode: isZh ? "重复发送策略" : "Duplicate-send strategy",
        dedupOncePerCandidatePerStatus: isZh ? "同候选人同状态仅一次" : "Once per candidate per status",
        dedupOncePerCandidate: isZh ? "同候选人仅一次" : "Once per candidate",
        autoAdvanceOnScreeningLabel: isZh ? "初筛通过后自动推进候选人状态" : "Auto-advance candidate status after screening",
        autoMailPushTitle: isZh ? "初筛完成后自动推送邮件" : "Auto-send email after screening",
        autoMailPushDescription: isZh ? "启用后仅在候选人状态命中允许列表且解析出有效收件人时触发。岗位专属收件人优先，不受全局开关限制；使用全局收件人时需全局能力也开启。手动发送入口始终保留。" : "Triggers only when candidate status matches allowed list and valid recipient is parsed. Position-specific recipients take priority, unrestricted by global toggle; global recipients require global capability to be enabled. Manual send entry is always available.",
        autoMailEnableToggle: isZh ? "启用自动推送" : "Enable auto-push",
        positionSpecificRecipient: isZh ? "使用岗位专属收件人" : "Use position-specific recipients",
        globalDefaultRecipient: isZh ? "叠加全局默认收件人" : "Stack global default recipients",
        globalDefaultRecipientHint: isZh ? "（需全局能力也开启）" : "(requires global capability to be enabled)",
        noRecipientsInMailCenter: isZh ? "请先在邮件中心维护收件人" : "Maintain recipients in Mail Center first",
        noCCRecipients: isZh ? "暂无可选抄送人" : "No CC recipients available",
        noBCCRecipients: isZh ? "暂无可选密送人" : "No BCC recipients available",
        positionSpecificRecipients: isZh ? "岗位专属收件人" : "Position-specific recipients",
        ccRecipients: isZh ? "抄送人（CC）" : "CC Recipients",
        bccRecipients: isZh ? "密送人（BCC）" : "BCC Recipients",
        autoMailSkillBindingHint: isZh ? "每个岗位可以分别绑定 1 条 JD 分析方案、1 条初筛评估方案、1 条面试题评估方案。若某一类不选择，系统会自动使用该任务的内置通用基座约束。如果没有合适的评估方案，可以点击下方「+」直接新建，创建后会自动绑定到当前岗位。" : "Each position can bind 1 JD analysis plan, 1 screening assessment plan, and 1 interview assessment plan. If none is selected, the system uses the built-in general constraint for that task. If no suitable assessment plan exists, click '+' below to create one, which will be automatically bound to the current position.",
        jdSkillLabel: isZh ? "JD 分析方案" : "JD Analysis Plan",
        screeningSkillLabel: isZh ? "初筛评估方案" : "Screening Assessment Plan",
        interviewSkillLabel: isZh ? "面试题评估方案" : "Interview Assessment Plan",
        noSkillsAvailable: isZh ? "暂无可选评估方案，点击上方「+」新建" : "No available assessment plans, click '+' above to create",
        newSkillTitle: (skillType: string) => (isZh ? `新建 ${skillType} 评估方案` : `New ${skillType} Assessment Plan`),
        positionBasicsDialogHint: isZh ? "完善岗位基础信息，保存后可继续配置 JD、评估方案并管理候选人。" : "Complete the position details, then configure the JD and assessment plans and manage candidates.",
        cancelButton: isZh ? "取消" : "Cancel",
        savingPosition: isZh ? "保存中..." : "Saving...",
        savePosition: isZh ? "保存需求" : "Save Request",
        noLinkedPosition: isZh ? "暂不关联岗位" : "Not linked to any position",
        filesSelected: (count: number) => (isZh ? `已选择 ${count} 个文件` : `${count} file(s) selected`),
        cancelUpload: isZh ? "取消上传" : "Cancel Upload",
        loading: isZh ? "加载中..." : "Loading...",
        uploading: isZh ? "上传中..." : "Uploading...",
        startUpload: isZh ? "开始上传" : "Start Upload",
        confirmDeletePosition: isZh ? "确认删除招聘需求" : "Confirm Delete Hiring Request",
        positionDeleteHint: isZh ? "删除后该招聘需求会从工作区隐藏，已关联的候选人与日志仍会保留。请再确认一次。" : "After deletion, the hiring request will be hidden from workspace. Associated candidates and logs will be retained. Please confirm again.",
        deletingPosition: isZh ? "删除中..." : "Deleting...",
        confirmDeletePositionAction: isZh ? "确认删除" : "Confirm Delete",
        confirmDeleteCandidate: isZh ? "确认删除候选人" : "Confirm Delete Candidate",
        candidateDeleteHint: isZh ? "删除后会同步清理该候选人的简历文件、解析结果、初筛评分、面试题、状态流转记录和工作记忆。正在执行中的候选人任务需要先结束后才能删除。" : "Deletion will clean up resume files, parsing results, screening scores, interview questions, status history, and workflow memory. Tasks in progress need to be ended before deletion.",
        saved: isZh ? "已保存" : "Saved",
        savedCandidate: isZh ? "已保存候选人" : "Candidate saved",
        autoAdvanceOnScreeningHint: isZh ? "（需开启岗位初筛配置）" : "(requires position screening config)",
        positionBasics: isZh ? "招聘需求信息" : "Hiring Request Info",
        skillsAutomation: isZh ? "评估方案与自动化配置" : "Assessment Plans & Automation",
        noPublishText: isZh ? "当前还没有可直接发布的 JD 文案，点击\"AI 生成 JD\"后会在这里展示。" : "There is no publish-ready JD copy yet. Click Generate JD and it will appear here.",
        allowRepeatSending: isZh ? "允许重复发送" : "Allow repeat sending",
        // JD dialog fields
        assistantLabel: isZh ? "招聘助手" : "Recruiting Assistant",
        assistantWorkspaceHint: isZh ? "在工作台里快速切上下文、带着推荐问题打开完整助手。" : "Switch context quickly from the workspace and jump into the full assistant with suggested prompts.",
        open: isZh ? "打开" : "Open",
        collapse: isZh ? "收起" : "Collapse",
        more: isZh ? "更多" : "More",
        openFullAssistant: isZh ? "打开完整助手" : "Open Full Assistant",
        assistantContextShort: isZh ? "上下文" : "Context",
        currentPosition: isZh ? "当前职位" : "Current Position",
        activeSkills: isZh ? "激活评估方案" : "Active Assessment Plans",
        currentModel: isZh ? "当前模型" : "Current Model",
        unspecifiedPosition: isZh ? "未指定岗位" : "No position selected",
        skillCount: (count: number) => (isZh ? `${count} 项` : `${count} selected`),
        noSwitchableModel: isZh ? "暂无可切换模型" : "No switchable model available",
        stopBatchScreeningCompleted: (count: number) => (
            isZh ? `已停止 ${count} 个批量初筛任务` : `Stopped ${count} batch screening task(s)`
        ),
        stopBatchScreeningRequested: isZh ? "批量初筛停止请求已发送" : "Batch screening stop request sent",
        noBatchScreeningToStop: isZh ? "当前可见范围内没有正在进行的初筛任务" : "No running screening tasks in the current visible scope",
        noScreeningTarget: recruitmentToast.noCandidatesSelected,
        noScreeningQueued: recruitmentToast.noScreeningQueued,
        noCandidates: isZh ? "暂无候选人" : "No Candidates",
        noCandidatesDesc: isZh ? "上传简历并关联到这个岗位后，这里会出现最新候选人列表。" : "Upload resumes and link them to this position to see candidates here.",
        loadingMoreCandidates: isZh ? "加载中…" : "Loading more…",
        allCandidatesLoaded: isZh ? "已加载全部候选人" : "All candidates loaded",
        positionCandidates: isZh ? "候选人" : "Candidates",
        viewInCandidatePage: isZh ? "在候选人页中完整查看" : "View in Candidates",
        positionCandidatesSearch: isZh ? "搜索候选人..." : "Search candidates...",
        positionDialogNew: isZh ? "新增招聘需求" : "New Hiring Request",
        positionDialogEdit: isZh ? "编辑招聘需求" : "Edit Hiring Request",
        uploadResumeAutoScreenHint: isZh ? "上传简历后自动进入初筛" : "Auto-enter screening after upload",
        uploadResumeAutoScreenHintNoSkill: isZh ? "请先在下方「初筛评估方案」中绑定至少一个初筛评估方案，再开启此功能" : "Bind at least one screening assessment plan below before enabling this",
        uploadResumeTitle: isZh ? "上传简历" : "Upload Resume",
        uploadResumeDesc: isZh ? "支持批量上传 PDF / DOCX。若岗位开启自动初筛，系统会自动进入新的初筛流程；否则可在候选人页手动触发。" : "Supports batch PDF and DOCX upload. If auto-screening is enabled, the system will start a new screening flow automatically; otherwise trigger it manually from the candidates page.",
        // Position form fields
        positionName: isZh ? "需求/职位名称" : "Request / Position Name",
        department: isZh ? "部门" : "Department",
        location: isZh ? "地点" : "Location",
        employmentType: isZh ? "用工类型" : "Employment Type",
        salaryRange: isZh ? "薪资范围" : "Salary Range",
        headcount: isZh ? "需求人数" : "Required Headcount",
        positionStatus: isZh ? "需求状态" : "Request Status",
        tags: isZh ? "标签" : "Tags",
        keyRequirements: isZh ? "关键要求" : "Key Requirements",
        bonusPoints: isZh ? "加分项" : "Bonus Points",
        screeningConfig: isZh ? "初筛配置" : "Screening Config",
        positionSummary: isZh ? "职位摘要" : "Position Summary",
        linkPosition: isZh ? "关联岗位" : "Link Position",
        selectFiles: isZh ? "选择文件" : "Select Files",
        city: isZh ? "所在城市" : "City",
        expectedCity: isZh ? "期望城市" : "Expected City",
        manualCityEntry: isZh ? "手动指定" : "Manual",
        autoDetectCity: isZh ? "自动识别" : "Auto Detect",
        cityPlaceholder: isZh ? "输入或选择城市" : "Enter or select city",
        cityAutoHint: isZh ? "系统将从文件名中自动提取城市，未识别到的由AI解析兜底" : "System extracts city from filename; AI parsing as fallback if not detected",
        uploadedProgress: (uploaded: number, total: number) => (isZh ? `已上传 ${uploaded} / ${total} 份` : `Uploaded ${uploaded} / ${total}`),
        currentCandidate: isZh ? "当前候选人" : "Current Candidate",
        candidateDeleteWarning: isZh ? "删除后不可恢复；历史删除审计会保留，但该候选人不会再出现在候选人列表和详情区中。" : "Deletion is irreversible; history will be kept in audit logs, but the candidate will no longer appear in the candidate list or details.",
        // JD dialog fields
        aiGenerationNotes: isZh ? "AI 生成附加要求" : "AI Generation Notes",
        versionTitle: isZh ? "版本标题" : "Version Title",
        versionNotes: isZh ? "版本备注" : "Version Notes",
        jdMarkdownSource: isZh ? "JD Markdown 源文本" : "JD Markdown Source",
        preview: isZh ? "预览版" : "Preview",
        expandMenu: isZh ? "展开左侧菜单" : "Expand left menu",
        collapseMenu: isZh ? "收起左侧菜单" : "Collapse left menu",
        assistantPanelTitle: isZh ? "AI 助手" : "AI Assistant",
        assistantPanelDescription: isZh ? "用于生成 JD、查看岗位候选人、筛选简历和生成面试题的招聘助手对话面板。" : "Assistant panel for generating JDs, viewing candidates, screening resumes, and creating interview questions.",
        resumeUploadDescription: isZh ? '支持批量上传 PDF / DOCX。若岗位开启"上传自动初筛"，系统会自动进入新的初筛流程；否则可在候选人页手动触发。' : "Supports batch PDF and DOCX upload. If auto-screening is enabled, the system will start a new screening flow automatically; otherwise trigger it manually from the candidates page.",
        confirmDeleteCandidates: isZh ? "确认批量删除候选人" : "Confirm Batch Delete Candidates",
        batchDeleteDescription: (count: number) => isZh ? `将删除选中的 ${count} 位候选人及其简历文件、解析结果、初筛评分、面试题、状态流转记录和工作记忆。有活动AI任务（解析或初筛中）的候选人将自动跳过。` : `Will delete ${count} selected candidates and their resume files, parsing results, screening scores, interview questions, status history, and workflow memory. Candidates with active AI tasks (parsing or screening) will be skipped automatically.`,
        confirmDeleteResume: isZh ? "确认删除简历" : "Confirm Delete Resume",
        resumeDeleteDescription: isZh ? "删除后会同步清理这份简历对应的解析结果和初筛评分；如果该候选人还有其他简历，系统会自动切换到下一份可用简历。正在解析或初筛中的简历暂时不能删除。" : "Deletion will clean up parsing results and screening scores for this resume; if the candidate has other resumes, the system will automatically switch to the next available one. Resumes being parsed or screened cannot be deleted.",
        currentResume: isZh ? "当前简历" : "Current Resume",
        resumeDeleteWarning: isZh ? "删除后不可恢复，请确认当前候选人不再需要这份原始文件。" : "Deletion is irreversible. Please confirm the current candidate no longer needs this original file.",
        confirmDeleteMailSender: isZh ? "确认删除发件箱" : "Confirm Delete Mail Sender",
        mailSenderDeleteDescription: isZh ? "删除后它将无法继续发送简历邮件；已有发送记录会继续保留。" : "After deletion, it will no longer be able to send resume emails; existing send records will be retained.",
        confirmDeleteMailRecipient: isZh ? "确认删除收件人" : "Confirm Delete Mail Recipient",
        mailRecipientDeleteDescription: isZh ? "删除后发送简历时将不再出现在可选名单里，历史发送记录不会受影响。" : "After deletion, it will no longer appear in the recipient list when sending resumes; historical send records will not be affected.",
        publishing: isZh ? "发布中..." : "Publishing...",
        editMailSender: isZh ? "编辑发件箱" : "Edit Mail Sender",
        newMailSender: isZh ? "新增发件箱" : "New Mail Sender",
        mailSenderDescription: isZh ? "支持配置 163、Outlook、企业邮箱等 SMTP 发件箱。编辑已有发件箱时，密码可留空以继续使用当前密码。" : "Supports configuring SMTP senders like 163, Outlook, corporate email, etc. When editing an existing sender, password can be left empty to keep the current one.",
        mailSenderName: isZh ? "名称" : "Name",
        mailSenderFromName: isZh ? "发件人名称" : "Sender Name",
        mailSenderFromNamePlaceholder: isZh ? "例如：某某科技招聘中心" : "e.g., HR Center of Company",
        mailSenderEmail: isZh ? "发件邮箱" : "Sender Email",
        mailSenderEmailPlaceholder: isZh ? "name@example.com" : "name@example.com",
        mailSenderUsername: isZh ? "登录账号" : "Login Username",
        smtpHost: isZh ? "SMTP Host" : "SMTP Host",
        smtpHostPlaceholder: isZh ? "smtp.163.com" : "smtp.163.com",
        smtpPort: isZh ? "SMTP Port" : "SMTP Port",
        smtpHostAutoHint: isZh ? "如果 SMTP Host 留空，系统会尝试根据发件邮箱自动识别 163 / Outlook 默认配置。" : "If SMTP Host is left empty, the system will try to auto-detect 163/Outlook default settings based on the sender email.",
        mailSenderPassword: isZh ? "密码" : "Password",
        mailSenderPasswordEdit: isZh ? "密码（留空则不修改）" : "Password (leave empty to keep current)",
        useSSL: isZh ? "使用 SSL" : "Use SSL",
        useSTARTTLS: isZh ? "使用 STARTTLS" : "Use STARTTLS",
        setAsDefaultSender: isZh ? "设为默认发件箱" : "Set as default sender",
        enableSender: isZh ? "启用此发件箱" : "Enable this sender",
        editMailRecipient: isZh ? "编辑收件人" : "Edit Recipient",
        newMailRecipient: isZh ? "新增收件人" : "New Recipient",
        mailRecipientDescription: isZh ? "可维护公司招聘团队、面试官、部门负责人等收件人，发送简历时支持多选和复用。" : "Maintain recipients like HR team, interviewers, department heads, etc. Supports multi-select and reuse when sending resumes.",
        recipientName: isZh ? "姓名" : "Name",
        recipientEmail: isZh ? "邮箱" : "Email",
        recipientDepartment: isZh ? "部门" : "Department",
        recipientRoleTitle: isZh ? "岗位" : "Role Title",
        recipientTags: isZh ? "标签" : "Tags",
        recipientTagsPlaceholder: isZh ? "例如：招聘同事，技术面试官，业务负责人" : "e.g., HR colleague, tech interviewer, business lead",
        recipientNotes: isZh ? "备注" : "Notes",
        enableRecipient: isZh ? "启用此收件人" : "Enable this recipient",
        candidatesInThisSend: isZh ? "本次发送的候选人" : "Candidates in this send",
        resumeNoLinkedPosition: isZh ? "未关联岗位" : "Not linked to position",
        alreadySent: isZh ? "已发送" : "Sent",
        firstSend: isZh ? "首次发送" : "First send",
        saveMailSender: isZh ? "保存发件箱" : "Save Mail Sender",
        saveMailRecipient: isZh ? "保存收件人" : "Save Recipient",
        candidatesInThisSendLabel: isZh ? "本次发送的候选人" : "Candidates in this send",
        noSendHistory: isZh ? "当前候选人还没有成功发送记录。" : "This candidate has no successful send history yet.",
        noCandidateDetails: isZh ? "未找到候选人详情，请返回候选人中心重新选择。" : "Candidate details not found. Please go back to candidates center and select again.",
        senderConfig: isZh ? "发件箱" : "Sender",
        useDefaultSender: isZh ? "使用默认发件箱" : "Use default sender",
        recipientEmailsOptional: isZh ? "收件人邮箱（可选）" : "Recipient emails (optional)",
        recipientEmailsPlaceholder: isZh ? "可直接填写一个或多个收件人邮箱，多个请用英文逗号分隔" : "Enter one or more recipient emails, separated by commas",
        selectInternalRecipients: isZh ? "选择内部收件人" : "Select internal recipients",
        noDepartmentSet: isZh ? "未设置部门" : "No department set",
        noRoleSet: isZh ? "未设置岗位" : "No role set",
        noRecipientsAvailable: isZh ? "暂无可选收件人" : "No recipients available",
        noRecipientsAvailableDesc: isZh ? "可以直接填写上方收件人邮箱，也可以先在邮件中心维护公司内部收件人。" : "You can directly fill in recipient emails above, or maintain internal recipients in Mail Center first.",
        emailSubjectOptional: isZh ? "邮件标题（可留空）" : "Email subject (optional)",
        emailSubjectPlaceholder: isZh ? "例如：候选人简历推荐 / IoT 测试工程师" : "e.g., Candidate Resume Referral / IoT Test Engineer",
        emailBodyOptional: isZh ? "邮件正文（可留空）" : "Email body (optional)",
        emailBodyPlaceholder: isZh ? "可填写本次推荐理由、安排建议等；留空时将使用系统默认正文。" : "Fill in referral reasons, scheduling suggestions, etc.; leave empty to use default body.",
    }), [isZh, recruitmentToast]);
    const localizeCandidateStatusValue = useCallback((value?: string | null, fallback?: string | null) => {
        const normalized = String(value || "").trim();
        if (!normalized) {
            return fallback || "";
        }
        return candidateStatusLabels[normalized] || fallback || normalized;
    }, []);

    const [activePage, setActivePage] = useState<RecruitmentPage>(initialPage || "workspace");
    const isSettingsPage = activePage === "settings-mail" || activePage === "settings-models" || activePage === "settings-skills";
    const activePageRef = useRef<RecruitmentPage>(initialPage || "workspace");
    // 记录访问过的 keep-alive 页面：candidates/positions/audit 首次访问后才挂载（挂载后保持,以保留滚动位置与选中状态）
    const visitedKeepAlivePagesRef = useRef<Set<RecruitmentPage>>(new Set([initialPage || "workspace"]));
    visitedKeepAlivePagesRef.current.add(activePage);
    const recruitmentPageHistoryRef = useRef<RecruitmentPage[]>([initialPage || "workspace"]);
    const canGoBack = hasExternalBackTarget || recruitmentPageHistoryRef.current.length > 1;
    const lastInitialPageRef = useRef<RecruitmentPage | null>(null);
    const taskSSEPageActive = (
        activePage === "workspace"
        || activePage === "candidates"
        || activePage === "positions"
        || activePage === "review-workbench"
        || activePage === "interviews"
        || activePage === "audit"
        || activePage === "talent-pool"
        || activePage === "assistant"
    );
    const taskSSEEnabled = taskSSEPageActive && (
        canExecuteProcess
        || canViewLog
        || canViewReview
        || canActReview
        || canViewInterview
        || canActInterview
        || canManageInterview
    );

    const applyRecruitmentPageChange = useCallback((
        page: RecruitmentPage,
        mode: "push" | "replace" = "push",
    ) => {
        setActivePage((current) => {
            const baseHistory = recruitmentPageHistoryRef.current.length
                ? recruitmentPageHistoryRef.current
                : [current];
            let nextHistory = baseHistory;

            if (mode === "replace") {
                nextHistory = [...baseHistory.slice(0, -1), page];
                if (!nextHistory.length) {
                    nextHistory = [page];
                } else if (nextHistory.length > 1 && nextHistory[nextHistory.length - 1] === nextHistory[nextHistory.length - 2]) {
                    nextHistory = nextHistory.slice(0, -1);
                }
            } else if (baseHistory[baseHistory.length - 1] !== page) {
                nextHistory = [...baseHistory, page];
            }

            recruitmentPageHistoryRef.current = nextHistory;
            return current === page ? current : page;
        });
    }, []);

    const resolveFallbackRecruitmentPage = useCallback((): RecruitmentPage => {
        if (canUseRecruitmentWorkspace) return "workspace";
        if (canViewReview || canActReview) return "review-workbench";
        if (canViewInterview || canActInterview || canManageInterview) return "interviews";
        if (canViewTalentPool) return "talent-pool";
        if (canViewRecruitmentAssistant) return "assistant";
        return "workspace";
    }, [
        canActInterview,
        canActReview,
        canManageInterview,
        canUseRecruitmentWorkspace,
        canViewRecruitmentAssistant,
        canViewInterview,
        canViewReview,
        canViewTalentPool,
    ]);

    const handleSmartBack = useCallback(() => {
        const history = recruitmentPageHistoryRef.current;
        if (history.length > 1) {
            const nextHistory = history.slice(0, -1);
            const previousPage = nextHistory[nextHistory.length - 1];
            recruitmentPageHistoryRef.current = nextHistory;
            setActivePage(previousPage);
            return;
        }
        onBack();
    }, [onBack]);

    // 从侧边栏切换时同步 initialPage prop，并将其作为模块内导航的一部分纳入历史栈。
    useEffect(() => {
        const targetPage = initialPage || "workspace";
        if (lastInitialPageRef.current === null) {
            lastInitialPageRef.current = targetPage;
            recruitmentPageHistoryRef.current = [targetPage];
            if (activePage !== targetPage) {
                setActivePage(targetPage);
            }
            return;
        }
        if (lastInitialPageRef.current === targetPage) {
            return;
        }
        lastInitialPageRef.current = targetPage;
        if (activePage !== targetPage) {
            applyRecruitmentPageChange(targetPage, "push");
        }
    }, [activePage, applyRecruitmentPageChange, initialPage]);

    useEffect(() => {
        clearPositionFormLocationHash();
        syncRecruitmentActivePage(activePage);
    }, [activePage]);

    const [assistantOpen, setAssistantOpen] = useState(false);
    const [positionListCollapsed, setPositionListCollapsed] = useState(false);
    const [positionDetailViewOpen, setPositionDetailViewOpen] = useState(false);
    const [positionWorkspaceView, setPositionWorkspaceView] = useState<"jd" | "config" | "candidates" | "versions">("config");
    // 岗位内嵌候选人列表状态
    const [positionCandidateSearch, setPositionCandidateSearch] = useState("");
    const [positionCandidateStatusFilter, setPositionCandidateStatusFilter] = useState<string>("__all__");
    const [talentPoolCandidateDetailOpen, setTalentPoolCandidateDetailOpen] = useState(false);
    const [talentPoolDetailAssignOpen, setTalentPoolDetailAssignOpen] = useState(false);
    const [talentPoolDetailAssignPositionId, setTalentPoolDetailAssignPositionId] = useState("");
    const [talentPoolDetailAssigning, setTalentPoolDetailAssigning] = useState(false);
    const [talentPoolDetailReidentifyConfirmOpen, setTalentPoolDetailReidentifyConfirmOpen] = useState(false);
    const [talentPoolDetailAction, setTalentPoolDetailAction] = useState<"reidentify" | "cancel-match" | null>(null);

    const [positionCandidatesData, setPositionCandidatesData] = useState<CandidateSummary[]>([]);
    const [positionCandidatesLoading, setPositionCandidatesLoading] = useState(false);
    const [positionCandidatesInitialLoaded, setPositionCandidatesInitialLoaded] = useState(false);
    const [positionCandidatesTotal, setPositionCandidatesTotal] = useState(0);
    const [isLoadingMorePositionCandidates, setIsLoadingMorePositionCandidates] = useState(false);
    const loadingMorePositionCandidatesRef = useRef(false);
    const positionCandidatesLoadRequestIdRef = useRef(0);
    const [auditFiltersCollapsed, setAuditFiltersCollapsed] = useState(false);
    const [bootstrapping, setBootstrapping] = useState(true);
    const [pageVisible, setPageVisible] = useState(() => (
        typeof document === "undefined" ? true : document.visibilityState === "visible"
    ));
    const pageVisibleRef = useRef(pageVisible);

    const [metadata, setMetadata] = useState<RecruitmentMetadata | null>(null);
    const [organizationCatalog, setOrganizationCatalog] = useState<ScriptHubOrganizationDefinition[]>([]);
    const [allPositions, setAllPositions] = useState<PositionSummary[]>([]);
    const [positionDetail, setPositionDetail] = useState<PositionDetail | null>(null);
    const [allCandidates, setAllCandidates] = useState<CandidateSummary[]>([]);
    const [candidates, setCandidates] = useState<CandidateSummary[]>([]);
    const [candidateDetail, setCandidateDetail] = useState<CandidateDetail | null>(null);
    const [departmentReviews, setDepartmentReviews] = useState<DepartmentReviewBatch[]>([]);
    const [departmentReviewTasks, setDepartmentReviewTasks] = useState<DepartmentReviewTask[]>([]);
    const [departmentReviewCounts, setDepartmentReviewCounts] = useState({pending: 0, deferred: 0, completed: 0, todo: 0});
    const [departmentReviewLoading, setDepartmentReviewLoading] = useState(false);
    const [departmentReviewLoadError, setDepartmentReviewLoadError] = useState<string | null>(null);
    const [departmentReviewFilter, setDepartmentReviewFilter] = useState<"todo" | "completed" | "pending" | "deferred" | "passed" | "rejected">("todo");
    const [interviewWorkbenchTasks, setInterviewWorkbenchTasks] = useState<InterviewTask[]>([]);
    const [myInterviewCalendarTasks, setMyInterviewCalendarTasks] = useState<InterviewTask[]>([]);
    const [interviewWorkbenchCounts, setInterviewWorkbenchCounts] = useState({todo: 0, today: 0, completed: 0, cancelled: 0});
    const [interviewWorkbenchLoading, setInterviewWorkbenchLoading] = useState(false);
    const [interviewWorkbenchFilter, setInterviewWorkbenchFilter] = useState<"todo" | "today" | "completed" | "cancelled">("todo");
    const [autoOpenInterviewScheduleCandidateId, setAutoOpenInterviewScheduleCandidateId] = useState<number | null>(null);
    const [myInterviewAvailabilitySlots, setMyInterviewAvailabilitySlots] = useState<InterviewAvailabilitySlot[]>([]);
    const [myInterviewAvailabilityLoading, setMyInterviewAvailabilityLoading] = useState(false);
    const [myInterviewAvailabilitySaving, setMyInterviewAvailabilitySaving] = useState(false);
    const [candidateDetailReviewContext, setCandidateDetailReviewContext] = useState<{
        candidateId: number;
        assignmentId: number;
        status: string;
        comment?: string | null;
        reviewerName?: string | null;
    } | null>(null);
    const candidateDetailReviewContextRef = useRef<typeof candidateDetailReviewContext>(null);
    const [allTalentPoolCandidates, setAllTalentPoolCandidates] = useState<CandidateSummary[]>([]);
    const [talentPoolCandidates, setTalentPoolCandidates] = useState<CandidateSummary[]>([]);
    const [talentPoolLoading, setTalentPoolLoading] = useState(false);
    const [talentPoolLoadingMore, setTalentPoolLoadingMore] = useState(false);
    const [talentPoolTotal, setTalentPoolTotal] = useState(0);
    const [talentPoolStats, setTalentPoolStats] = useState<TalentPoolStats | null>(null);
    const [talentPoolAvailableTags, setTalentPoolAvailableTags] = useState<string[]>([]);
    const [talentPoolPageIndex, setTalentPoolPageIndex] = useState(0);
    const [talentPoolPageSize, setTalentPoolPageSize] = useState(TALENT_POOL_PAGE_SIZE);
    const [allSkills, setAllSkills] = useState<RecruitmentSkill[]>([]);
    const [skills, setSkills] = useState<RecruitmentSkill[]>([]);
    const [allAiLogs, setAllAiLogs] = useState<AITaskLog[]>([]);
    const [aiLogs, setAiLogs] = useState<AITaskLog[]>([]);
    const [candidateStatsData, setCandidateStatsData] = useState<import("@/lib/recruitment-api").CandidateStatsData | null>(null);
    const [candidatePipelineStatsData, setCandidatePipelineStatsData] = useState<import("@/lib/recruitment-api").CandidateStatsData | null>(null);
    const [candidatePipelineStatsScopeKey, setCandidatePipelineStatsScopeKey] = useState("");
    const [funnelData, setFunnelData] = useState<import("@/lib/recruitment-api").RecruitmentFunnelData | null>(null);
    const [sourceStatsData, setSourceStatsData] = useState<import("@/lib/recruitment-api").SourceStatsData | null>(null);
    const [candidateTotal, setCandidateTotal] = useState(0);
    const [candidateScopeTotal, setCandidateScopeTotal] = useState(0);
    const [candidatePageIndex, setCandidatePageIndex] = useState(0);
    const [candidatePageSize, setCandidatePageSize] = useState(CANDIDATE_LIST_PAGE_SIZE);
    const [aiLogTotal, setAiLogTotal] = useState(0);
    const allCandidatesRef = useRef<CandidateSummary[]>(allCandidates);
    const allTalentPoolCandidatesRef = useRef<CandidateSummary[]>(allTalentPoolCandidates);
    const talentPoolQueryRef = useRef<TalentPoolQueryState>({ ...DEFAULT_TALENT_POOL_QUERY });
    const talentPoolPageIndexRef = useRef(talentPoolPageIndex);
    const talentPoolPageSizeRef = useRef(talentPoolPageSize);
    const candidateTotalRef = useRef(candidateTotal);
    const candidatePageIndexRef = useRef(candidatePageIndex);
    const candidatePageSizeRef = useRef(candidatePageSize);
    const candidateListUsingVisibleFiltersRef = useRef(false);
    const candidateListContextKeyRef = useRef("");
    const candidateListPageCacheRef = useRef<CandidateListPageCache | null>(null);
    const candidateListPreloadLoadedAtRef = useRef(0);
    const candidateListLoadAbortControllerRef = useRef<AbortController | null>(null);
    const [talentPoolPreferredStatFilter, setTalentPoolPreferredStatFilter] = useState<TalentPoolStatFilter | null>(null);
    const clearTalentPoolPreferredStatFilter = useCallback(() => setTalentPoolPreferredStatFilter(null), []);
    const skillsLoadedOnceRef = useRef(false);
    const mailSendersLoadedOnceRef = useRef(false);
    const mailRecipientsLoadedOnceRef = useRef(false);
    const mailDispatchesLoadedOnceRef = useRef(false);
    const resumeMailDispatchHistoryLoadedOnceRef = useRef(false);
    const mailAutoConfigLoadedOnceRef = useRef(false);
    const llmConfigsLoadedOnceRef = useRef(false);
    allCandidatesRef.current = allCandidates;
    allTalentPoolCandidatesRef.current = allTalentPoolCandidates;
    talentPoolPageIndexRef.current = talentPoolPageIndex;
    talentPoolPageSizeRef.current = talentPoolPageSize;
    candidateTotalRef.current = candidateTotal;
    candidatePageIndexRef.current = candidatePageIndex;
    candidatePageSizeRef.current = candidatePageSize;
    const [selectedLogDetail, setSelectedLogDetail] = useState<AITaskLog | null>(null);
    const [chatContext, setChatContext] = useState<ChatContext>({
        position_id: null,
        position_title: null,
        skill_ids: [],
        skills: [],
    });
    const [skillSettingsRows, setSkillSettingsRows] = useState<RecruitmentSkillSettingsRow[]>([]);
    const [skillSettingsTotal, setSkillSettingsTotal] = useState(0);
    const [skillSettingsPageIndex, setSkillSettingsPageIndex] = useState(0);
    const [skillSettingsQueryInput, setSkillSettingsQueryInput] = useState("");
    const [skillSettingsQuery, setSkillSettingsQuery] = useState("");
    const [skillSettingsTaskFilter, setSkillSettingsTaskFilter] = useState<"all" | SkillTaskKind>("all");
    const [allLlmConfigs, setAllLlmConfigs] = useState<RecruitmentLLMConfig[]>([]);
    const [llmConfigs, setLlmConfigs] = useState<RecruitmentLLMConfig[]>([]);
    const [allMailSenderConfigs, setAllMailSenderConfigs] = useState<RecruitmentMailSenderConfig[]>([]);
    const [mailSenderConfigs, setMailSenderConfigs] = useState<RecruitmentMailSenderConfig[]>([]);
    const [allMailRecipients, setAllMailRecipients] = useState<RecruitmentMailRecipient[]>([]);
    const [mailRecipients, setMailRecipients] = useState<RecruitmentMailRecipient[]>([]);
    const enabledMailRecipients = useMemo(
        () => mailRecipients.filter((recipient) => recipient.is_enabled),
        [mailRecipients],
    );
    const [allResumeMailDispatches, setAllResumeMailDispatches] = useState<RecruitmentResumeMailDispatch[]>([]);
    const [resumeMailDispatches, setResumeMailDispatches] = useState<RecruitmentResumeMailDispatch[]>([]);
    const [mailDispatchSettingsRows, setMailDispatchSettingsRows] = useState<RecruitmentResumeMailDispatchSummary[]>([]);
    const [resumeMailDispatchTotal, setResumeMailDispatchTotal] = useState(0);
    const [resumeMailDispatchPageIndex, setResumeMailDispatchPageIndex] = useState(0);
    const [mailAutoPushGlobalConfig, setMailAutoPushGlobalConfig] = useState<RecruitmentMailAutoPushGlobalConfig>({
        global_default_recipient_ids: [],
        global_default_recipient_emails: [],
        global_auto_push_enabled: false,
    });
    const [authorizedOrgCodes, setAuthorizedOrgCodes] = useState<string[]>([defaultOrgScope]);
    const [hasAllOrgScope, setHasAllOrgScope] = useState(false);
    const [organizationPrimaryOrgScope, setOrganizationPrimaryOrgScope] = useState(defaultOrgScope);
    const [organizationCatalogStatus, setOrganizationCatalogStatus] = useState<OrganizationCatalogStatus>("idle");

    const [positionQuery, setPositionQuery] = useState("");
    const [positionStatusFilter, setPositionStatusFilter] = useState("all");
    const deferredPositionQuery = useDeferredValue(positionQuery);

    const [candidateQuery, setCandidateQuery] = useState("");
    const [candidateStatusFilter, setCandidateStatusFilter] = useState<string[]>([]);
    const [candidatePositionFilter, setCandidatePositionFilter] = useState<string[]>([]);
    const [candidateSourceFilter, setCandidateSourceFilter] = useState<string[]>([]);
    const [candidateTimeFilter, setCandidateTimeFilter] = useState("all");
    const [candidateMatchFilter, setCandidateMatchFilter] = useState("all");
    const [candidateMatchSortOrder, setCandidateMatchSortOrder] = useState<"" | "asc" | "desc">("");
    const [candidateMatchSortLoading, setCandidateMatchSortLoading] = useState(false);
    const candidateMatchSortOrderRef = useRef<"" | "asc" | "desc">("");
    const candidateMatchSortRequestTokenRef = useRef(0);
    const [candidateViewMode] = useState<CandidateViewMode>("list");
    const [candidateListColumnWidths, setCandidateListColumnWidths] = useState<Record<CandidateListColumnKey, number>>(
        candidateListColumnDefaultWidths,
    );
    const deferredCandidateQuery = useDeferredValue(candidateQuery);
    const candidateListRefreshQueryRef = useRef<CandidateListRefreshQuerySnapshot>({
        departmentScope: selectedDepartmentScope,
        orgScope: selectedOrgScope,
        query: deferredCandidateQuery,
        positionFilter: candidatePositionFilter,
        statusFilter: candidateStatusFilter,
        sourceFilter: candidateSourceFilter,
        timeFilter: candidateTimeFilter,
        matchFilter: candidateMatchFilter,
        matchSortOrder: candidateMatchSortOrder,
        pageIndex: candidatePageIndex,
        pageSize: candidatePageSize,
    });
    candidateListRefreshQueryRef.current = {
        departmentScope: selectedDepartmentScope,
        orgScope: selectedOrgScope,
        query: deferredCandidateQuery,
        positionFilter: candidatePositionFilter,
        statusFilter: candidateStatusFilter,
        sourceFilter: candidateSourceFilter,
        timeFilter: candidateTimeFilter,
        matchFilter: candidateMatchFilter,
        matchSortOrder: candidateMatchSortOrder,
        pageIndex: candidatePageIndex,
        pageSize: candidatePageSize,
    };

    const [logTaskTypeFilter, setLogTaskTypeFilter] = useState("all");
    const [logStatusFilter, setLogStatusFilter] = useState("all");
    const auditLogRequestKey = `${logStatusFilter}::${logTaskTypeFilter}`;
    const auditLogRequestKeyRef = useRef(auditLogRequestKey);

    const [selectedPositionId, setSelectedPositionId] = useState<number | null>(null);
    const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null);
    const [selectedCandidateIds, setSelectedCandidateIds] = useState<number[]>([]);
    const [candidateWorkspaceMode, setCandidateWorkspaceMode] = useState<"list" | "comparison">("list");
    const [comparisonCandidateIds, setComparisonCandidateIds] = useState<number[]>([]);
    const [comparisonSelectionItems, setComparisonSelectionItems] = useState<CandidateSummary[]>([]);
    const [comparisonPreview, setComparisonPreview] = useState<CandidateComparisonPreview | null>(null);
    const [comparisonLoading, setComparisonLoading] = useState(false);
    const [comparisonRefreshing, setComparisonRefreshing] = useState(false);
    const [comparisonFailed, setComparisonFailed] = useState(false);
    const [comparisonStale, setComparisonStale] = useState(false);
    const comparisonCandidateIdsRef = useRef<number[]>([]);
    const comparisonRequestIdRef = useRef(0);
    const comparisonAbortControllerRef = useRef<AbortController | null>(null);
    const comparisonReconcileAttemptsRef = useRef(0);
    const comparisonInvalidationRevisionRef = useRef(0);
    const candidateSelectionItemCacheRef = useRef<Map<number, CandidateSummary>>(new Map());
    const [selectedLogId, setSelectedLogId] = useState<number | null>(null);
    const lastCandidateMenuPageRef = useRef<RecruitmentPage>(initialPage || "workspace");
    const candidateMenuSelectionResetRef = useRef(false);
    const candidateMenuSuppressStaleDetailRef = useRef(false);

    const [positionsLoading, setPositionsLoading] = useState(false);
    const [positionListRequiresRefresh, setPositionListRequiresRefresh] = useState(false);
    const [positionDetailLoading, setPositionDetailLoading] = useState(false);
    const [candidatesLoading, setCandidatesLoading] = useState(false);
    const [candidatesInitialLoaded, setCandidatesInitialLoaded] = useState(false);
    const [candidateListTransitionLoading, setCandidateListTransitionLoading] = useState(false);
    const [candidateDetailLoading, setCandidateDetailLoading] = useState(false);
    const [duplicateCandidates, setDuplicateCandidates] = useState<Array<{id: number; candidate_code: string; name: string; phone: string | null; email: string | null; status: string}>>([]);
    const duplicateCheckGenerationRef = useRef(0);
    const checkedDuplicateCandidateIdRef = useRef<number | null>(null);
    const [logsLoading, setLogsLoading] = useState(false);
    const [logDetailLoading, setLogDetailLoading] = useState(false);
    const [, setSkillsLoading] = useState(false);
    const [skillSettingsLoading, setSkillSettingsLoading] = useState(false);
    const [skillDetailLoadingId, setSkillDetailLoadingId] = useState<number | null>(null);
    const [modelsLoading, setModelsLoading] = useState(false);
    const [mailSendersLoading, setMailSendersLoading] = useState(false);
    const [mailRecipientsLoading, setMailRecipientsLoading] = useState(false);
    const [mailDispatchesLoading, setMailDispatchesLoading] = useState(false);
    const [mailAutoConfigLoading, setMailAutoConfigLoading] = useState(false);
    const mailSettingsLoading = mailSendersLoading || mailRecipientsLoading || mailDispatchesLoading || mailAutoConfigLoading;
    const [mailAutoPushConfigSaving, setMailAutoPushConfigSaving] = useState(false);
    const [orgSwitching, setOrgSwitching] = useState(false);
    const [skillSubmitting, setSkillSubmitting] = useState(false);
    const [llmSubmitting, setLlmSubmitting] = useState(false);
    const [resumeMailSubmitting, setResumeMailSubmitting] = useState(false);
    const [mailDispatchActionKey, setMailDispatchActionKey] = useState<string | null>(null);
    const [mailDispatchDetailLoadingId, setMailDispatchDetailLoadingId] = useState<number | null>(null);
    const [chatSending, setChatSending] = useState(false);
    const [cancellingTaskIds, setCancellingTaskIds] = useState<number[]>([]);
    const [batchScreeningStopSubmitting, setBatchScreeningStopSubmitting] = useState(false);
    const [activeJDTaskId, setActiveJDTaskId] = useState<number | null>(null);
    const [activeJDPositionId, setActiveJDPositionId] = useState<number | null>(null);
    const [activeScreeningTaskMap, setActiveScreeningTaskMap] = useState<Record<number, number>>({});
    const [activeBatchScreeningTaskIds, setActiveBatchScreeningTaskIds] = useState<number[]>([]);
    const [activeInterviewTaskId, setActiveInterviewTaskId] = useState<number | null>(null);
    const [activeInterviewCandidateId, setActiveInterviewCandidateId] = useState<number | null>(null);
    const [activeChatTaskId, setActiveChatTaskId] = useState<number | null>(null);
    const [activeChatMessageId, setActiveChatMessageId] = useState<string | null>(null);
    const [currentAssistantRunId, setCurrentAssistantRunId] = useState<string | null>(null);
    const [assistantStreamStopping, setAssistantStreamStopping] = useState(false);
    const [assistantContextExpanded, setAssistantContextExpanded] = useState(false);
    const [assistantQuickActionsExpanded, setAssistantQuickActionsExpanded] = useState(false);
    const [autoFollowStream, setAutoFollowStream] = useState(true);
    const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
    const [assistantMailActionState, setAssistantMailActionState] = useState<Record<string, {
        status: "idle" | "sending" | "sent" | "error";
        editing?: boolean;
        error?: string | null;
        dispatchId?: number | null;
    }>>({});

    const [positionDialogOpen, setPositionDialogOpen] = useState(false);
    const [positionDialogMode, setPositionDialogMode] = useState<"create" | "edit">("create");
    const [positionCardActionMenuOpen, setPositionCardActionMenuOpen] = useState(false);
    const [positionJDConfigOpen, setPositionJDConfigOpen] = useState(false);
    const [positionAssessmentDialogOpen, setPositionAssessmentDialogOpen] = useState(false);
    const [positionAssessmentDraft, setPositionAssessmentDraft] = useState<PositionAssessmentDraft>({
        jdSkillIds: [],
        screeningSkillIds: [],
        interviewSkillIds: [],
    });
    const [positionAssessmentSaving, setPositionAssessmentSaving] = useState(false);
    const [positionForm, setPositionForm] = useState<PositionFormState>(emptyPositionForm);
    const [positionFormErrors, setPositionFormErrors] = useState<PositionFormErrors>({});
    const [positionFormSubmitError, setPositionFormSubmitError] = useState<string | null>(null);
    const [positionSubmitting, setPositionSubmitting] = useState(false);

    const [resumeUploadOpen, setResumeUploadOpen] = useState(false);
    const [uploadingResume, setUploadingResume] = useState(false);
    const [resumeUploadFileList, setResumeUploadFileList] = useState<File[] | null>(null);
    const [resumeUploadMode, setResumeUploadMode] = useState<"position" | "none" | "smart">("smart");
    const [resumeUploadPositionId, setResumeUploadPositionId] = useState("all");
    const [resumeUploadOrgCode, setResumeUploadOrgCode] = useState(defaultOrgScope);
    const [resumeUploadCity, setResumeUploadCity] = useState("");
    const [resumeUploadCitySource, setResumeUploadCitySource] = useState<"manual" | "auto">("auto");
    const [resumeUploadSource, setResumeUploadSource] = useState<"manual" | "boss" | "liepin" | "headhunter" | "other">("manual");
    const [resumeUploadDuplicateStrategy, setResumeUploadDuplicateStrategy] = useState<"skip" | "overwrite">("skip");
    const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
    const [isDraggingFile, setIsDraggingFile] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadCompletedCount, setUploadCompletedCount] = useState(0);
    const [resumeUploadError, setResumeUploadError] = useState<string | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const resumeUploadInFlightRef = useRef(false);
    const [resumeUploadResults, setResumeUploadResults] = useState<ResumeUploadFileResult[]>([]);
    const uploadContextRef = useRef("");
    uploadContextRef.current = `${selectedOrgScope}\u0000${getStoredScriptHubSession()?.token || ""}`;
    useEffect(() => () => abortControllerRef.current?.abort(), []);

    const [publishDialogOpen, setPublishDialogOpen] = useState(false);
    const [publishPlatform, setPublishPlatform] = useState("boss");
    const [publishSubmitting, setPublishSubmitting] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [candidateSaving, setCandidateSaving] = useState(false);

    const [jdExtraPrompt, setJdExtraPrompt] = useState("");
    const [jdViewMode, setJdViewMode] = useState<JDViewMode>("publish");
    const [jdGenerationStatus, setJdGenerationStatus] = useState<string>("idle");
    const [jdGenerationError, setJdGenerationError] = useState("");
    const [jdStreamingContent, setJdStreamingContent] = useState("");
    const [jdGeneratedDraftUnsaved, setJdGeneratedDraftUnsaved] = useState(false);
    const [jdUnsavedCloseConfirmOpen, setJdUnsavedCloseConfirmOpen] = useState(false);
    const [jdUnsavedExitIntent, setJdUnsavedExitIntent] = useState<JDUnsavedExitIntent | null>(null);
    const jdDraftContextKeyRef = useRef("");
    const [jdVersionSaving, setJdVersionSaving] = useState(false);
    const [jdVersionActivating, setJdVersionActivating] = useState(false);
    const [screeningSubmitting, setScreeningSubmitting] = useState(false);
    const [interviewGenerating, setInterviewGenerating] = useState(false);
    const [positionDeleting, setPositionDeleting] = useState(false);
    const [positionDeleteConfirmOpen, setPositionDeleteConfirmOpen] = useState(false);
    // 招聘需求表单打开时的初始快照，用于关闭前的脏数据检测（JSON 序列化对比，字段顺序由初始对象决定且后续 spread 更新不改变顺序）
    const positionFormInitialSnapshotRef = useRef<string | null>(null);
    const [positionFormCloseConfirmOpen, setPositionFormCloseConfirmOpen] = useState(false);
    const [candidateDeleteTarget, setCandidateDeleteTarget] = useState<CandidateSummary | null>(null);
    const [candidateDeleting, setCandidateDeleting] = useState(false);
    const [candidateDeleteError, setCandidateDeleteError] = useState<string | null>(null);
    const [batchDeleteTargetIds, setBatchDeleteTargetIds] = useState<number[] | null>(null);
    const [batchDeleting, setBatchDeleting] = useState(false);
    const [batchDeleteError, setBatchDeleteError] = useState<string | null>(null);
    const [resumeDeleteTarget, setResumeDeleteTarget] = useState<ResumeFile | null>(null);
    const [resumeDeleting, setResumeDeleting] = useState(false);
    const [skillDeleteTarget, setSkillDeleteTarget] = useState<RecruitmentSkill | null>(null);
    const [llmDeleteTarget, setLlmDeleteTarget] = useState<RecruitmentLLMConfig | null>(null);
    const [mailSenderDeleteTarget, setMailSenderDeleteTarget] = useState<RecruitmentMailSenderConfig | null>(null);
    const [mailRecipientDeleteTarget, setMailRecipientDeleteTarget] = useState<RecruitmentMailRecipient | null>(null);
    const [deleteActionKey, setDeleteActionKey] = useState<string | null>(null);
    const [jdDraft, setJdDraft] = useState({
        title: "",
        jdMarkdown: "",
        notes: "",
        autoActivate: true,
    });

    const assistantIntroText = isZh
        ? "我是招聘助手。你可以直接让我生成 JD、查看岗位候选人、重新初筛某位候选人并追加硬性条件，或者说明这次对话实际使用了哪些评估方案。"
        : "I'm your recruiting assistant. I can generate a JD, inspect candidates for the current position, re-screen a candidate with stricter requirements, or explain which assessment plans were used in this conversation.";
    const localizedInitialInterviewRoundName = isZh ? "初试" : "Round 1";

    const [candidateEditor, setCandidateEditor] = useState<CandidateEditorState>(emptyCandidateEditor);
    const [statusUpdateReason, setStatusUpdateReason] = useState("");
    const [pendingStatus, setPendingStatus] = useState<string | null>(null); // ← 新增
    const [interviewRoundName, setInterviewRoundName] = useState(localizedInitialInterviewRoundName);
    const [interviewCustomRequirements, setInterviewCustomRequirements] = useState("");
    const [selectedInterviewSkillIds, setSelectedInterviewSkillIds] = useState<number[]>([]);
    const [interviewSchedules, setInterviewSchedules] = useState<InterviewSchedule[]>([]);
    const [followUps, setFollowUps] = useState<FollowUp[]>([]);
    const [offers, setOffers] = useState<RecruitmentOffer[]>([]);

    const [chatInput, setChatInput] = useState("");
    const [assistantDisplayMode, setAssistantDisplayMode] = useState<AssistantDisplayMode>("drawer");
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
        {
            id: "intro",
            role: "assistant",
            content: assistantIntroText,
            createdAt: new Date().toISOString(),
        },
    ]);

    useEffect(() => {
        setInterviewRoundName((current) => (
            current === "初试" || current === "Round 1" || !current
                ? localizedInitialInterviewRoundName
                : current
        ));
    }, [localizedInitialInterviewRoundName]);

    useEffect(() => {
        setChatMessages((current) => (
            current.length === 1 && current[0]?.id === "intro"
                ? [{...current[0], content: assistantIntroText}]
                : current
        ));
    }, [assistantIntroText]);

    const assistantScrollAnchorRef = useRef<HTMLDivElement | null>(null);
    const assistantScrollAreaRef = useRef<HTMLDivElement | null>(null);
    const assistantInputRef = useRef<HTMLTextAreaElement | null>(null);
    const assistantStreamAbortRef = useRef<AbortController | null>(null);
    const chatContextRef = useRef(chatContext);
    const positionTitleInputRef = useRef<HTMLInputElement | null>(null);
    const positionHeadcountInputRef = useRef<HTMLInputElement | null>(null);
    const skillNameInputRef = useRef<HTMLInputElement | null>(null);
    const skillContentInputRef = useRef<HTMLTextAreaElement | null>(null);
    const llmConfigKeyInputRef = useRef<HTMLInputElement | null>(null);
    const llmTaskTypeInputRef = useRef<HTMLInputElement | null>(null);
    const llmModelNameInputRef = useRef<HTMLInputElement | null>(null);
    const llmExtraConfigInputRef = useRef<HTMLTextAreaElement | null>(null);

    const [skillDialogOpen, setSkillDialogOpen] = useState(false);
    const [skillGeneratedDraftUnsaved, setSkillGeneratedDraftUnsaved] = useState(false);
    const [skillUnsavedCloseConfirmOpen, setSkillUnsavedCloseConfirmOpen] = useState(false);
    const [skillEditingId, setSkillEditingId] = useState<number | null>(null);
    const [skillForm, setSkillForm] = useState<SkillFormState>(emptySkillForm);
    const [skillFormErrors, setSkillFormErrors] = useState<SkillFormErrors>({});
    const [skillFormSubmitError, setSkillFormSubmitError] = useState<string | null>(null);
    const [skillEditorData, setSkillEditorData] = useState<ScreeningSkillFormData>(emptyScreeningSkillForm());
    const [skillDialogMode, setSkillDialogMode] = useState<"structured" | "basic">("structured");
    const [skillEditorDefaultTab, setSkillEditorDefaultTab] = useState<"structured" | "advanced" | "ai">("structured");
    const [skillEditorPositionId, setSkillEditorPositionId] = useState<number | null>(null);
    const [skillGenerating, setSkillGenerating] = useState(false);
    const [skillAutoBindCategory, setSkillAutoBindCategory] = useState<"jdSkillIds" | "screeningSkillIds" | "interviewSkillIds" | null>(null);
    const [skillAutoBindDestination, setSkillAutoBindDestination] = useState<SkillAutoBindDestination>("positionForm");
    const [skillBoundPositionId, setSkillBoundPositionId] = useState<string>("");
    const [skillExtraConditions, setSkillExtraConditions] = useState("");
    const [positionSkillSearch, setPositionSkillSearch] = useState("");
    const [positionSkillSectionExpanded, setPositionSkillSectionExpanded] = useState<PositionSkillSectionExpandedState>(DEFAULT_POSITION_SKILL_SECTION_EXPANDED_STATE);

    const [llmDialogOpen, setLlmDialogOpen] = useState(false);
    const [llmEditingId, setLlmEditingId] = useState<number | null>(null);
    const [llmForm, setLlmForm] = useState<LLMFormState>(emptyLLMForm);
    const [llmFormErrors, setLlmFormErrors] = useState<LLMFormErrors>({});
    const [llmFormSubmitError, setLlmFormSubmitError] = useState<string | null>(null);
    const [mailSenderDialogOpen, setMailSenderDialogOpen] = useState(false);
    const [mailSenderEditingId, setMailSenderEditingId] = useState<number | null>(null);
    const [mailSenderForm, setMailSenderForm] = useState<MailSenderFormState>(emptyMailSenderForm);
    const [mailRecipientDialogOpen, setMailRecipientDialogOpen] = useState(false);
    const [mailRecipientEditingId, setMailRecipientEditingId] = useState<number | null>(null);
    const [mailRecipientForm, setMailRecipientForm] = useState<MailRecipientFormState>(emptyMailRecipientForm);
    const [mailSenderSaving, setMailSenderSaving] = useState(false);
    const [mailRecipientSaving, setMailRecipientSaving] = useState(false);
    const [resumeMailDialogOpen, setResumeMailDialogOpen] = useState(false);
    const [resumeMailDialogMode, setResumeMailDialogMode] = useState<ResumeMailDialogMode>("send");
    const [resumeMailSourceDispatchId, setResumeMailSourceDispatchId] = useState<number | null>(null);
    const [resumeMailSourceAssistantMessageId, setResumeMailSourceAssistantMessageId] = useState<string | null>(null);
    const [resumeMailForm, setResumeMailForm] = useState<ResumeMailFormState>(emptyResumeMailForm);
    const [resumeMailError, setResumeMailError] = useState<string | null>(null);
    const [interviewSkillSelectionDirty, setInterviewSkillSelectionDirty] = useState(false);
    const [candidateProcessLogsExpanded, setCandidateProcessLogsExpanded] = useState(false);

    const organizationMap = useMemo(
        () => new Map(organizationCatalog.map((organization) => [organization.org_code, organization])),
        [organizationCatalog],
    );
    const visibleOrgCodes = useMemo(() => (
        resolveVisibleOrgCodes(authorizedOrgCodes, organizationPrimaryOrgScope, organizationMap)
    ), [authorizedOrgCodes, organizationMap, organizationPrimaryOrgScope]);
    const companyScopeCodes = useMemo(() => resolveCompanyScopeCodes({
        defaultOrgScope: organizationPrimaryOrgScope,
        hasAllOrgScope,
        organizationCatalog,
        visibleOrgCodes: authorizedOrgCodes,
    }), [authorizedOrgCodes, hasAllOrgScope, organizationCatalog, organizationPrimaryOrgScope]);
    const orgScopeOptions = useMemo<OrganizationSelectOption[]>(() => {
        return companyScopeCodes.map((orgCode) => {
            const organization = organizationMap.get(orgCode);
            return {
                value: orgCode,
                label: organization?.name || getFallbackOrganizationLabel(orgCode),
                description: organization ? getOrganizationPathLabel(orgCode, organizationMap) : undefined,
                organization,
            };
        });
    }, [companyScopeCodes, organizationMap]);
    const selectedCompanyOrgCodes = useMemo(() => resolveSelectedCompanyOrgCodes(
        selectedOrgScope,
        visibleOrgCodes,
        organizationMap,
    ), [organizationMap, selectedOrgScope, visibleOrgCodes]);
    const departmentScopeValues = useMemo(() => resolveDepartmentScopeValues(
        selectedOrgScope,
        visibleOrgCodes,
        organizationMap,
    ), [organizationMap, selectedOrgScope, visibleOrgCodes]);
    const departmentScopeOptions = useMemo<OrganizationSelectOption[]>(() => {
        return departmentScopeValues.map((orgCode) => {
            if (orgCode === ALL_COMPANY_DEPARTMENTS_VALUE) {
                return {
                value: ALL_COMPANY_DEPARTMENTS_VALUE,
                label: recruitmentUiText.allVisibleDepartments,
                };
            }
            const organization = organizationMap.get(orgCode);
            return {
                value: orgCode,
                label: getOrganizationRelativePathLabel(orgCode, selectedOrgScope, organizationMap),
                description: organization ? getOrganizationPathLabel(orgCode, organizationMap) : undefined,
                organization,
            };
        });
    }, [departmentScopeValues, organizationMap, recruitmentUiText.allVisibleDepartments, selectedOrgScope]);
    const activeBusinessOrgCodes = useMemo(() => {
        if (
            selectedDepartmentScope !== ALL_COMPANY_DEPARTMENTS_VALUE
            && selectedCompanyOrgCodes.includes(normalizeRecruitmentOrgCode(selectedDepartmentScope))
        ) {
            const selectedDepartmentCode = normalizeRecruitmentOrgCode(selectedDepartmentScope);
            const scopedDepartmentCodes = selectedCompanyOrgCodes.filter((orgCode) => (
                orgCode === selectedDepartmentCode || isOrganizationInScope(organizationMap, selectedDepartmentCode, orgCode)
            ));
            return scopedDepartmentCodes.length ? scopedDepartmentCodes : [selectedDepartmentCode];
        }
        return selectedCompanyOrgCodes;
    }, [organizationMap, selectedCompanyOrgCodes, selectedDepartmentScope]);
    const activeBusinessOrgScopeKey = useMemo(
        () => activeBusinessOrgCodes.join("|"),
        [activeBusinessOrgCodes],
    );
    const recruitmentDataCacheKey = useMemo(
        () => buildOrganizationScopeRequestKey(getStoredScriptHubSession()),
        [],
    );
    const businessRowFilterOptions = useMemo(() => ({
        selfOnly: isSelfDataScope(sessionUser?.dataScope),
        actorUserCode: sessionUser?.id || null,
    }), [sessionUser?.dataScope, sessionUser?.id]);
    const positions = useMemo(
        () => filterBusinessRowsByOrgCodes(allPositions, activeBusinessOrgCodes, businessRowFilterOptions),
        [activeBusinessOrgCodes, allPositions, businessRowFilterOptions],
    );
    const organizationSelectOptions = useMemo(
        () => activeBusinessOrgCodes.map((orgCode) => {
            const organization = organizationMap.get(orgCode);
            return {
                value: orgCode,
                label: getOrganizationPathLabel(orgCode, organizationMap),
                organization,
            };
        }),
        [activeBusinessOrgCodes, organizationMap],
    );
    const showOrganizationFields = organizationSelectOptions.length > 1;
    const showOrganizationColumn = orgScopeOptions.length > 1 || organizationSelectOptions.length > 1;
    const getOrganizationLabel = useCallback((orgCode?: string | null) => (
        getOrganizationPathLabel(normalizeRecruitmentOrgCode(orgCode), organizationMap)
    ), [organizationMap]);
    const defaultFormOrgCode = useMemo(() => (
        organizationSelectOptions[0]?.value || activeBusinessOrgCodes[0] || organizationPrimaryOrgScope
    ), [activeBusinessOrgCodes, organizationPrimaryOrgScope, organizationSelectOptions]);
    const activeCreateOrgCode = useMemo(() => (
        showOrganizationFields ? defaultFormOrgCode : (activeBusinessOrgCodes[0] || defaultFormOrgCode)
    ), [activeBusinessOrgCodes, defaultFormOrgCode, showOrganizationFields]);
    const currentResumeUploadDefaultOrgCode = useMemo(() => {
        const selectedDepartmentCode = normalizeRecruitmentOrgCode(selectedDepartmentScope);
        if (
            selectedDepartmentCode
            && selectedDepartmentCode !== ALL_COMPANY_DEPARTMENTS_VALUE
            && organizationSelectOptions.some((option) => option.value === selectedDepartmentCode)
        ) {
            return selectedDepartmentCode;
        }
        const selectedCompanyCode = normalizeRecruitmentOrgCode(selectedOrgScope);
        if (organizationSelectOptions.some((option) => option.value === selectedCompanyCode)) {
            return selectedCompanyCode;
        }
        return activeCreateOrgCode;
    }, [activeCreateOrgCode, organizationSelectOptions, selectedDepartmentScope, selectedOrgScope]);
    const positionMap = useMemo(() => new Map(positions.map((item) => [item.id, item])), [positions]);
    const candidateMap = useMemo(() => new Map(candidates.map((item) => [item.id, item])), [candidates]);
    const skillMap = useMemo(() => new Map(skills.map((item) => [item.id, item])), [skills]);
    const enabledSkills = useMemo(() => skills.filter((skill) => skill.is_enabled !== false), [skills]);
    const enabledSkillMap = useMemo(() => new Map(enabledSkills.map((item) => [item.id, item])), [enabledSkills]);
    const normalizedPositionSkillSearch = positionSkillSearch.trim().toLowerCase();
    const activePositionSkillBindingId = positionDialogMode === "edit" ? selectedPositionId : null;
    const positionSkillFieldConfig = useMemo(() => ({
        jdSkillIds: {
            taskKind: "jd" as const,
            label: recruitmentUiText.jdSkillLabel,
            emptyLabel: isZh ? "未选择" : "Not selected",
            selectedPrefix: isZh ? "已选：" : "Selected: ",
            placeholder: isZh ? "搜索可用于当前岗位的 JD 方案" : "Search JD plans for this position",
        },
        screeningSkillIds: {
            taskKind: "screening" as const,
            label: recruitmentUiText.screeningSkillLabel,
            emptyLabel: isZh ? "未选择" : "Not selected",
            selectedPrefix: isZh ? "已选：" : "Selected: ",
            placeholder: isZh ? "搜索可用于当前岗位的初筛方案" : "Search screening plans for this position",
        },
        interviewSkillIds: {
            taskKind: "interview" as const,
            label: recruitmentUiText.interviewSkillLabel,
            emptyLabel: isZh ? "未选择" : "Not selected",
            selectedPrefix: isZh ? "已选：" : "Selected: ",
            placeholder: isZh ? "搜索可用于当前岗位的面试题方案" : "Search interview plans for this position",
        },
    }), [isZh, recruitmentUiText.interviewSkillLabel, recruitmentUiText.jdSkillLabel, recruitmentUiText.screeningSkillLabel]);
    const filterBindableSkillsForPosition = useCallback((taskKind: SkillTaskKind) => (
        enabledSkills.filter((skill) => {
            const matchesTask = !skill.task_types?.length || skill.task_types.includes(taskKind);
            const matchesPosition = !skill.bound_position_id || skill.bound_position_id === activePositionSkillBindingId;
            const searchHaystack = [
                skill.name,
                skill.description,
                skill.bound_position_title,
                ...(skill.tags || []),
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            const matchesSearch = !normalizedPositionSkillSearch || searchHaystack.includes(normalizedPositionSkillSearch);
            return matchesTask && matchesPosition && matchesSearch;
        })
    ), [activePositionSkillBindingId, enabledSkills, normalizedPositionSkillSearch]);
    const jdAuthoringSkills = useMemo(() => sortSkillsForTaskPreference(filterBindableSkillsForPosition("jd"), "jd"), [filterBindableSkillsForPosition]);
    const screeningAuthoringSkills = useMemo(() => sortSkillsForTaskPreference(filterBindableSkillsForPosition("screening"), "screening"), [filterBindableSkillsForPosition]);
    const interviewAuthoringSkills = useMemo(() => sortSkillsForTaskPreference(filterBindableSkillsForPosition("interview"), "interview"), [filterBindableSkillsForPosition]);
    const positionSkillChoicesByField = useMemo<Record<PositionSkillBindingField, RecruitmentSkill[]>>(() => ({
        jdSkillIds: jdAuthoringSkills,
        screeningSkillIds: screeningAuthoringSkills,
        interviewSkillIds: interviewAuthoringSkills,
    }), [interviewAuthoringSkills, jdAuthoringSkills, screeningAuthoringSkills]);
    const selectedPositionSkillText = useMemo<Record<PositionSkillBindingField, string>>(() => {
        const formatSelected = (ids: number[], emptyLabel: string) => (
            ids.length ? formatSkillNames(ids.slice(0, 1), skillMap, language) : emptyLabel
        );
        return {
            jdSkillIds: formatSelected(positionForm.jdSkillIds, positionSkillFieldConfig.jdSkillIds.emptyLabel),
            screeningSkillIds: formatSelected(positionForm.screeningSkillIds, positionSkillFieldConfig.screeningSkillIds.emptyLabel),
            interviewSkillIds: formatSelected(positionForm.interviewSkillIds, positionSkillFieldConfig.interviewSkillIds.emptyLabel),
        };
    }, [
        language,
        positionForm.interviewSkillIds,
        positionForm.jdSkillIds,
        positionForm.screeningSkillIds,
        positionSkillFieldConfig.interviewSkillIds.emptyLabel,
        positionSkillFieldConfig.jdSkillIds.emptyLabel,
        positionSkillFieldConfig.screeningSkillIds.emptyLabel,
        skillMap,
    ]);
    const skillDialogBindingTaskKind = skillDialogMode === "structured" ? "screening" : (skillForm.taskTypes[0] || null);
    const isAssessmentDraftSkillCreation = skillAutoBindDestination === "assessmentDraft" && Boolean(skillAutoBindCategory);
    const bindablePositionsForSkillDialog = useMemo(() => {
        if (!skillDialogBindingTaskKind) {
            return positions;
        }
        const currentBoundPositionId = skillBoundPositionId ? Number(skillBoundPositionId) : null;
        return positions.filter((position) => {
            if ((currentBoundPositionId && position.id === currentBoundPositionId) || (skillEditingId && (
                (skillDialogBindingTaskKind === "jd" && (position.jd_skill_ids || []).includes(skillEditingId))
                || (skillDialogBindingTaskKind === "screening" && (position.screening_skill_ids || []).includes(skillEditingId))
                || (skillDialogBindingTaskKind === "interview" && (position.interview_skill_ids || []).includes(skillEditingId))
            ))) {
                return true;
            }
            const occupiedSkillIds = skillDialogBindingTaskKind === "jd"
                ? (position.jd_skill_ids || [])
                : skillDialogBindingTaskKind === "screening"
                    ? (position.screening_skill_ids || [])
                    : (position.interview_skill_ids || []);
            return occupiedSkillIds.length === 0;
        });
    }, [positions, skillBoundPositionId, skillDialogBindingTaskKind, skillEditingId]);
    const mailSenderMap = useMemo(() => new Map(mailSenderConfigs.map((item) => [item.id, item])), [mailSenderConfigs]);
    const mailRecipientMap = useMemo(() => new Map(mailRecipients.map((item) => [item.id, item])), [mailRecipients]);
    const currentJDVersion = positionDetail?.current_jd_version || null;
    const isJDDraftDirty = jdDraft.jdMarkdown.trim() !== (currentJDVersion?.jd_markdown || "").trim();
    const hasUnsavedJDDraft = (jdGeneratedDraftUnsaved || isJDDraftDirty) && isJDDraftDirty && jdDraft.jdMarkdown.trim().length > 0;
    const currentPublishText = useMemo(
        () => (isJDDraftDirty
            ? extractPublishText(jdDraft.jdMarkdown, null)
            : extractPublishText(currentJDVersion?.jd_markdown || jdDraft.jdMarkdown, currentJDVersion?.publish_text)),
        [currentJDVersion?.jd_markdown, currentJDVersion?.publish_text, isJDDraftDirty, jdDraft.jdMarkdown],
    );
    const currentPreviewHtml = isJDDraftDirty
        ? jdDraft.jdMarkdown.replace(/\n/g, "<br />")
        : currentJDVersion?.jd_html || jdDraft.jdMarkdown.replace(/\n/g, "<br />");
    const currentJDGenerationStatus = jdGenerationStatus !== "idle"
        ? jdGenerationStatus
        : positionDetail?.jd_generation?.status || "idle";
    const isJDGenerating = isLiveTaskStatus(currentJDGenerationStatus) || currentJDGenerationStatus === "syncing";
    const latestJDGenerationError = jdGenerationError || positionDetail?.jd_generation?.error_message || "";
    const defaultMailSenderId = useMemo(() => {
        const defaultSender = mailSenderConfigs.find((item) => item.is_default && item.is_enabled);
        return String(defaultSender?.id || mailSenderConfigs.find((item) => item.is_enabled)?.id || "");
    }, [mailSenderConfigs]);
    const effectiveLLMConfigs = useMemo(() => {
        const byTask = new Map<string, RecruitmentLLMConfig>();
        llmConfigs.filter((item) => item.is_active).forEach((item) => {
            const current = byTask.get(item.task_type);
            if (!current || item.priority < current.priority || (item.priority === current.priority && item.id < current.id)) {
                byTask.set(item.task_type, item);
            }
        });
        return byTask;
    }, [llmConfigs]);
    const preferredLLMConfigIds = useMemo(() => {
        const selected = new Set<number>();
        effectiveLLMConfigs.forEach((item) => selected.add(item.id));
        return selected;
    }, [effectiveLLMConfigs]);
    const assistantActiveLLMConfig = useMemo(() => {
        return effectiveLLMConfigs.get("chat_orchestrator") || effectiveLLMConfigs.get("default") || null;
    }, [effectiveLLMConfigs]);
    const interviewActiveLLMConfig = useMemo(() => {
        return effectiveLLMConfigs.get("interview_question_generation") || effectiveLLMConfigs.get("default") || null;
    }, [effectiveLLMConfigs]);
    const assistantModelSwitchOptions = useMemo(() => {
        const preferredTaskType = llmConfigs.some((item) => item.task_type === "chat_orchestrator")
            ? "chat_orchestrator"
            : "default";
        return llmConfigs
            .filter((item) => item.is_active && item.task_type === preferredTaskType)
            .sort((left, right) => {
                if (left.priority !== right.priority) return left.priority - right.priority;
                return left.id - right.id;
            });
    }, [llmConfigs]);
    const chatContextCandidateLabel = useMemo(() => {
        if (!chatContext.candidate_id) {
            return recruitmentUiText.unspecifiedCandidate;
        }
        const candidate = candidateMap.get(chatContext.candidate_id);
        return candidate
            ? resolveCandidateIdentity(candidate).displayName
            : recruitmentUiText.candidateWithId(chatContext.candidate_id);
    }, [candidateMap, chatContext.candidate_id, recruitmentUiText]);
    const assistantModelLabel = assistantActiveLLMConfig
        ? `${labelForProvider(assistantActiveLLMConfig.resolved_provider || assistantActiveLLMConfig.provider)} / ${assistantActiveLLMConfig.resolved_model_name || assistantActiveLLMConfig.model_name}`
        : recruitmentUiText.modelUnrecognized;
    const markCandidatesDeleted = useCallback((candidateIds: number[]) => {
        const normalizedIds = Array.from(new Set(candidateIds.filter((id) => Number.isFinite(id) && id > 0)));
        if (!normalizedIds.length) {
            return;
        }
        normalizedIds.forEach((id) => recentlyDeletedCandidateIdsRef.current.add(id));
        window.setTimeout(() => {
            normalizedIds.forEach((id) => recentlyDeletedCandidateIdsRef.current.delete(id));
        }, 60_000);
    }, []);
    const buildOptimisticChatContext = useCallback((
        nextPositionId: number | null,
        nextSkillIds: number[],
        nextCandidateId: number | null,
        currentContext: ChatContext,
    ): ChatContext => ({
        ...currentContext,
        position_id: nextPositionId,
        position_title: nextPositionId ? (positionMap.get(nextPositionId)?.title || currentContext.position_title || null) : null,
        candidate_id: nextCandidateId,
        skill_ids: nextSkillIds,
        skills: nextSkillIds
            .map((skillId) => enabledSkillMap.get(skillId))
            .filter(Boolean) as RecruitmentSkill[],
        updated_at: new Date().toISOString(),
    }), [enabledSkillMap, positionMap]);
    const assistantContextSkillIds = useMemo(
        () => chatContext.skill_ids.filter((skillId) => enabledSkillMap.has(skillId)),
        [chatContext.skill_ids, enabledSkillMap],
    );
    const assistantContextSkills = useMemo(
        () => assistantContextSkillIds
            .map((skillId) => enabledSkillMap.get(skillId))
            .filter(Boolean) as RecruitmentSkill[],
        [assistantContextSkillIds, enabledSkillMap],
    );
    const positionScreeningSkillIds = useMemo(
        () => candidateDetail?.candidate.position_screening_skill_ids || [],
        [candidateDetail?.candidate.position_screening_skill_ids],
    );
    const positionInterviewSkillIds = useMemo(
        () => candidateDetail?.candidate.position_interview_skill_ids || [],
        [candidateDetail?.candidate.position_interview_skill_ids],
    );
    const workflowScreeningSkillIds = useMemo(
        () => candidateDetail?.workflow_memory?.screening_skill_ids || [],
        [candidateDetail?.workflow_memory?.screening_skill_ids],
    );
    const workflowInterviewSkillIds = useMemo(
        () => candidateDetail?.workflow_memory?.interview_skill_ids || [],
        [candidateDetail?.workflow_memory?.interview_skill_ids],
    );
    const candidateAssistantActivity = useMemo(() => {
        return (candidateDetail?.activity || []).filter((item) => item.task_type === "chat_orchestrator");
    }, [candidateDetail?.activity]);
    const candidateProcessActivity = useMemo(() => {
        return (candidateDetail?.activity || []).filter((item) => item.task_type !== "chat_orchestrator");
    }, [candidateDetail?.activity]);
    const preferredInterviewSkillSourceLabel = workflowInterviewSkillIds.length
        ? recruitmentUiText.preferredInterviewSkillFromMemory
        : (positionInterviewSkillIds.length
                ? recruitmentUiText.positionBoundSkills
                : recruitmentUiText.noConfiguredSkills);
    const effectiveScreeningSkillIds = useMemo(() => {
        if (positionScreeningSkillIds.length) {
            return resolveTaskSkillIds(positionScreeningSkillIds, "screening", skillMap);
        }
        if (workflowScreeningSkillIds.length) {
            return resolveTaskSkillIds(workflowScreeningSkillIds, "screening", skillMap);
        }
        return [];
    }, [positionScreeningSkillIds, skillMap, workflowScreeningSkillIds]);
    const effectiveScreeningSkillSourceLabel = positionScreeningSkillIds.length
        ? recruitmentUiText.positionBoundSkills
        : (workflowScreeningSkillIds.length ? recruitmentUiText.screeningMemorySkills : recruitmentUiText.noConfiguredSkills);
    const autoInterviewSkillIds = useMemo(() => {
        if (positionInterviewSkillIds.length) {
            return resolveTaskSkillIds(positionInterviewSkillIds, "interview", skillMap);
        }
        if (workflowInterviewSkillIds.length) {
            return resolveTaskSkillIds(workflowInterviewSkillIds, "interview", skillMap);
        }
        return [];
    }, [positionInterviewSkillIds, skillMap, workflowInterviewSkillIds]);
    const autoInterviewSkillSourceLabel = positionInterviewSkillIds.length
        ? recruitmentUiText.positionBoundSkills
        : workflowInterviewSkillIds.length
            ? recruitmentUiText.interviewMemorySkills
            : recruitmentUiText.noConfiguredSkills;
    const effectiveInterviewSkillIds = interviewSkillSelectionDirty ? selectedInterviewSkillIds : autoInterviewSkillIds;
    const effectiveInterviewSkillSourceLabel = interviewSkillSelectionDirty ? recruitmentUiText.manualSelectedSkills : autoInterviewSkillSourceLabel;
    useEffect(() => {
        if (assistantContextSkillIds.length === chatContext.skill_ids.length) {
            return;
        }
        void saveChatContext(
            chatContext.position_id || null,
            assistantContextSkillIds,
            chatContext.candidate_id || null,
            {quiet: true},
        );
    }, [assistantContextSkillIds, chatContext.candidate_id, chatContext.position_id, chatContext.skill_ids.length]);
    const selectedCandidateScreeningTaskId = selectedCandidateId
        ? (() => {
            const trackedTaskId = activeScreeningTaskMap[selectedCandidateId];
            if (trackedTaskId) {
                return trackedTaskId;
            }
            const snapshot = candidateMap.get(selectedCandidateId)
                || (candidateDetail?.candidate.id === selectedCandidateId ? candidateDetail.candidate : null);
            const taskId = snapshot?.active_screening_task_id || null;
            const taskStatus = snapshot?.active_screening_task_status || snapshot?.active_screening_status || null;
            return taskId && isLiveTaskStatus(taskStatus) ? taskId : null;
        })()
        : null;
    const currentCandidateInterviewTaskId = activeInterviewCandidateId === selectedCandidateId ? activeInterviewTaskId : null;
    const isTaskCancelling = useCallback((taskId?: number | null) => {
        if (!taskId) {
            return false;
        }
        return cancellingTaskIds.includes(taskId);
    }, [cancellingTaskIds]);
    const isSelectedCandidateScreeningCancelling = isTaskCancelling(selectedCandidateScreeningTaskId);
    const isCurrentInterviewTaskCancelling = isTaskCancelling(currentCandidateInterviewTaskId);
    const isCurrentChatTaskCancelling = isTaskCancelling(activeChatTaskId);
    const isStreaming = chatSending;
    const canStopCurrentRun = Boolean(activeChatTaskId || currentAssistantRunId || assistantStreamAbortRef.current);
    const isCurrentRunStopping = isCurrentChatTaskCancelling || assistantStreamStopping;
    const showScrollToBottomButton = isUserScrolledUp && chatMessages.length > 0;
    const resumeMailTargetCandidates = useMemo(() => {
        return resumeMailForm.candidateIds
            .map((candidateId) => (
                candidateMap.get(candidateId)
                || (candidateDetail?.candidate.id === candidateId ? candidateDetail.candidate : null)
            ))
            .filter((item): item is CandidateSummary => Boolean(item));
    }, [candidateDetail, candidateMap, resumeMailForm.candidateIds]);
    const candidateResumeMailStats = useMemo(() => {
        const stats = new Map<number, { sentCount: number; failedCount: number; latestSentAt: string | null }>();
        resumeMailDispatches.forEach((dispatch) => {
            dispatch.candidate_ids.forEach((candidateId) => {
                const current = stats.get(candidateId) || {sentCount: 0, failedCount: 0, latestSentAt: null};
                if (dispatch.status === "sent") {
                    current.sentCount += 1;
                    const candidateSentAt = dispatch.sent_at || dispatch.created_at || null;
                    if (!current.latestSentAt || (candidateSentAt && new Date(candidateSentAt).getTime() > new Date(current.latestSentAt).getTime())) {
                        current.latestSentAt = candidateSentAt;
                    }
                }
                if (dispatch.status === "failed") {
                    current.failedCount += 1;
                }
                stats.set(candidateId, current);
            });
        });
        return stats;
    }, [resumeMailDispatches]);
    const resumeMailDialogTitle = resumeMailDialogMode === "resend" ? recruitmentUiText.resendResumeMailTitle : recruitmentUiText.sendResumeMailTitle;
    const resumeMailDialogDescription = resumeMailDialogMode === "resend"
        ? recruitmentUiText.resendResumeMailDescription(resumeMailSourceDispatchId)
        : recruitmentUiText.sendResumeMailDescription;
    const resumeMailSubmitLabel = resumeMailSubmitting
        ? recruitmentUiText.sending
        : (resumeMailDialogMode === "resend" ? recruitmentUiText.resend : recruitmentUiText.sendResume);

    const getCandidateResumeMailSummary = useCallback((candidateId: number): string | null => {
        const stat = candidateResumeMailStats.get(candidateId);
        if (!stat || stat.sentCount <= 0) {
            return null;
        }
        return recruitmentUiText.sentCountSummary(stat.sentCount, stat.latestSentAt);
    }, [candidateResumeMailStats, recruitmentUiText]);

    const isCandidatePageActive = activePage === "candidates";

    const sourceOptions = useMemo(() => {
        return Array.from(new Set([
            ...(sourceStatsData?.sources || [])
                .map((item) => item.source)
                .filter((item): item is string => Boolean(item)),
            ...candidates
                .map((candidate) => candidate.source)
                .filter((item): item is string => Boolean(item)),
        ]));
    }, [candidates, sourceStatsData]);

    const visiblePositions = useMemo(() => {
        const normalizedQuery = deferredPositionQuery.trim().toLowerCase();
        return positions.filter((position) => {
            if (positionStatusFilter !== "all" && position.status !== positionStatusFilter) {
                return false;
            }
            if (!normalizedQuery) {
                return true;
            }
            return [
                position.title,
                position.position_code,
                position.department,
                position.location,
                position.summary,
            ].some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
        });
    }, [deferredPositionQuery, positionStatusFilter, positions]);

    const visibleCandidates = useMemo(() => {
        const useServerDrivenPrimaryFilters = isCandidatePageActive;
        const normalizedQuery = useServerDrivenPrimaryFilters ? "" : deferredCandidateQuery.trim().toLowerCase();
        return candidates.filter((candidate) => {
            if (
                !useServerDrivenPrimaryFilters
                && candidatePositionFilter.length > 0
                && !candidatePositionFilter.includes(String(candidate.position_id || ""))
            ) {
                return false;
            }
            if (
                !useServerDrivenPrimaryFilters
                && candidateStatusFilter.length > 0
                && !candidateStatusFilter.includes(resolveCandidateDisplayStatus(candidate))
            ) {
                return false;
            }
            if (normalizedQuery && ![
                candidate.name,
                candidate.phone,
                candidate.email,
                candidate.current_company,
            ].some((value) => String(value || "").toLowerCase().includes(normalizedQuery))) {
                return false;
            }
            if (candidateSourceFilter.length > 0) {
                const source = String(candidate.source || "unknown");
                const matchesUnknown = !candidate.source && candidateSourceFilter.some((item) => ["unknown", "未知来源", "__unknown__"].includes(String(item).trim().toLowerCase()));
                if (!matchesUnknown && !candidateSourceFilter.includes(source)) {
                    return false;
                }
            }
            if (candidateTimeFilter === "today" && !isToday(candidate.created_at)) {
                return false;
            }
            if (candidateTimeFilter === "7d" && !withinDays(candidate.created_at, 7)) {
                return false;
            }
            if (candidateTimeFilter === "30d" && !withinDays(candidate.created_at, 30)) {
                return false;
            }
            const match = candidate.match_percent ?? 0;
            if (candidateMatchFilter === "80+" && match < 80) {
                return false;
            }
            if (candidateMatchFilter === "60+" && match < 60) {
                return false;
            }
            if (candidateMatchFilter === "40+" && match < 40) {
                return false;
            }
            return true;
        });
    }, [candidateMatchFilter, candidatePositionFilter, candidateSourceFilter, candidateStatusFilter, candidateTimeFilter, candidates, deferredCandidateQuery, isCandidatePageActive]);

    useEffect(() => {
        const retainedCandidateIds = new Set([...selectedCandidateIds, ...comparisonCandidateIds]);
        candidateSelectionItemCacheRef.current.forEach((_candidate, candidateId) => {
            if (!retainedCandidateIds.has(candidateId)) {
                candidateSelectionItemCacheRef.current.delete(candidateId);
            }
        });
        visibleCandidates.forEach((candidate) => {
            if (retainedCandidateIds.has(candidate.id)) {
                candidateSelectionItemCacheRef.current.set(candidate.id, candidate);
            }
        });
        const detailCandidate = candidateDetail?.candidate;
        if (detailCandidate && retainedCandidateIds.has(detailCandidate.id)) {
            candidateSelectionItemCacheRef.current.set(detailCandidate.id, detailCandidate);
        }
    }, [candidateDetail, comparisonCandidateIds, selectedCandidateIds, visibleCandidates]);

    function getLiveScreeningTaskId(candidate?: CandidateSummary | null) {
        const taskId = Number(candidate?.active_screening_task_id || 0);
        if (!taskId) {
            return null;
        }
        const taskStatus = candidate?.active_screening_task_status || candidate?.active_screening_status;
        return isLiveTaskStatus(taskStatus) ? taskId : null;
    }

    const visibleLiveScreeningTaskIds = useMemo(() => {
        const taskIds = new Set<number>();
        visibleCandidates.forEach((candidate) => {
            const taskId = getLiveScreeningTaskId(candidate);
            if (taskId) {
                taskIds.add(taskId);
            }
        });
        return Array.from(taskIds);
    }, [visibleCandidates]);

    const batchStopScreeningTaskIds = useMemo(() => (
        Array.from(new Set([...activeBatchScreeningTaskIds, ...visibleLiveScreeningTaskIds]))
    ), [activeBatchScreeningTaskIds, visibleLiveScreeningTaskIds]);

    const visibleScopeScreeningRunningCount = Number(candidateStatsData?.status_counts?.screening_running || 0);
    const candidateConsistencyStatsScopeKey = resolveCandidatePipelineStatsScopeKey();
    const candidateConsistencyStats = candidatePipelineStatsScopeKey === candidateConsistencyStatsScopeKey
        ? candidatePipelineStatsData
        : candidateStatsData;
    const candidateConsistencyRunningCount = Number(candidateConsistencyStats?.status_counts?.screening_running || 0);
    const isBatchScreeningRunning = batchStopScreeningTaskIds.length > 0 || visibleScopeScreeningRunningCount > 0;
    const isBatchScreeningCancelling = batchScreeningStopSubmitting || (
        batchStopScreeningTaskIds.length > 0
        && batchStopScreeningTaskIds.every((taskId) => cancellingTaskIds.includes(taskId))
    );

    const armCandidateConsistencyPolling = useCallback((
        durationMs = CANDIDATE_CONSISTENCY_EVENT_WINDOW_MS,
        options?: { forceRefresh?: boolean },
    ) => {
        const now = Date.now();
        const wasInactive = candidateConsistencyPollUntilRef.current <= now;
        candidateConsistencyPollUntilRef.current = Math.max(
            candidateConsistencyPollUntilRef.current,
            now + durationMs,
        );
        if (options?.forceRefresh) {
            candidateConsistencyForceRefreshRef.current = true;
        }
        if (wasInactive || options?.forceRefresh) {
            setCandidateConsistencyPollEpoch((current) => current + 1);
        }
    }, []);

    const visibleCandidateIdSet = useMemo(
        () => new Set(visibleCandidates.map((c) => c.id)),
        [visibleCandidates]
    );

    const visibleAiLogs = useMemo(() => {
        return aiLogs.filter((log) => {
            if (logTaskTypeFilter !== "all" && log.task_type !== logTaskTypeFilter) {
                return false;
            }
            if (logStatusFilter !== "all" && log.status !== logStatusFilter) {
                return false;
            }
            return true;
        });
    }, [aiLogs, logStatusFilter, logTaskTypeFilter]);

    const groupedCandidates = useMemo(() => {
        const configuredOrder = metadata?.candidate_statuses?.map((item) => item.value) || Object.keys(candidateStatusLabels);
        const displayStatuses = visibleCandidates.map((candidate) => resolveCandidateDisplayStatus(candidate));
        const order = Array.from(new Set([...configuredOrder, ...displayStatuses]));
        return order.map((status) => ({
            status,
            label: labelForCandidateStatus(status),
            items: visibleCandidates.filter((candidate) => resolveCandidateDisplayStatus(candidate) === status),
        }));
    }, [language, metadata, visibleCandidates]);

    const candidateListDisplayColumnWidths = useMemo(() => (
        expandTableColumnWidths(
            candidateListColumnWidths,
            candidateListViewportWidth,
            56,
            candidateListColumnFillWeights,
        )
    ), [candidateListColumnWidths, candidateListViewportWidth]);

    const auditListDisplayColumnWidths = useMemo(() => (
        expandTableColumnWidths(
            auditListColumnBaseWidths,
            auditListViewportWidth,
            0,
            auditListColumnFillWeights,
        )
    ), [auditListViewportWidth]);

    const auditListTableWidth = useMemo(() => {
        return Object.values(auditListDisplayColumnWidths).reduce((sum, width) => sum + width, 0);
    }, [auditListDisplayColumnWidths]);

    // 使用优化的统计计算 hook (单次遍历完成所有统计)
    const stats = useOptimizedStats(positions, candidates, aiLogs);
    const shouldUseLocalScopedStats = Boolean(businessRowFilterOptions.selfOnly);
    const localCandidateStatsData = useMemo(() => buildLocalCandidateStats(candidates), [candidates]);
    const localVisibleCandidateStatsData = useMemo(() => buildLocalCandidateStats(visibleCandidates), [visibleCandidates]);
    const effectiveCandidateTotal = shouldUseLocalScopedStats ? localCandidateStatsData.total : candidateTotal;
    const effectiveVisibleCandidateTotal = shouldUseLocalScopedStats ? localVisibleCandidateStatsData.total : candidateTotal;
    const effectiveAllCandidatesCount = shouldUseLocalScopedStats ? candidates.length : allCandidates.length;
    const effectiveTalentPoolTotal = shouldUseLocalScopedStats ? talentPoolCandidates.length : talentPoolTotal;
    const effectiveFunnelData = useMemo(() => (
        shouldUseLocalScopedStats
            ? buildLocalRecruitmentFunnelData(candidates, effectiveTalentPoolTotal)
            : funnelData
    ), [candidates, effectiveTalentPoolTotal, funnelData, shouldUseLocalScopedStats]);
    const effectiveSourceStatsData = useMemo(() => (
        shouldUseLocalScopedStats
            ? buildLocalSourceStatsData(candidates)
            : sourceStatsData
    ), [candidates, shouldUseLocalScopedStats, sourceStatsData]);

    // 兼容原有接口
    const scopedDashboard: DashboardData = useMemo(() => ({
        cards: {
            ...stats.cards,
            candidates_total: effectiveCandidateTotal,
        },
        status_distribution: stats.status_distribution,
        recent_candidates: [...candidates]
            .sort((left, right) => new Date(right.updated_at || right.created_at || 0).getTime() - new Date(left.updated_at || left.created_at || 0).getTime())
            .slice(0, 8),
    }), [effectiveCandidateTotal, stats, candidates]);

    const todayNewResumes = stats.todayNewResumes;

    const recentCandidates = scopedDashboard.recent_candidates || [];
    const auditFilterSummary = useMemo(() => {
        const taskTypeLabel = logTaskTypeFilter === "all"
            ? recruitmentUiText.allTaskTypes
            : (aiTaskLabels[logTaskTypeFilter] || logTaskTypeFilter);
        const statusLabel = logStatusFilter === "all" ? recruitmentUiText.allStatuses : logStatusFilter;
        return `${taskTypeLabel} · ${statusLabel}`;
    }, [language, logStatusFilter, logTaskTypeFilter, recruitmentUiText]);

    useEffect(() => {
        if (organizationCatalogStatus !== "ready") {
            return;
        }
        const currentSelection = {
            orgScope: selectedOrgScope,
            departmentScope: selectedDepartmentScope,
        };
        const validatedSelection = validateRecruitmentOrgScopeSelection(currentSelection, {
            defaultOrgScope: organizationPrimaryOrgScope,
            hasAllOrgScope,
            organizationCatalog,
            visibleOrgCodes: authorizedOrgCodes,
        });
        if (isSameRecruitmentOrgScope(currentSelection, validatedSelection)) {
            return;
        }
        candidateListRefreshQueryRef.current = {
            ...candidateListRefreshQueryRef.current,
            departmentScope: validatedSelection.departmentScope,
            orgScope: validatedSelection.orgScope,
        };
        updateOrgScopeSelection(validatedSelection);
    }, [
        authorizedOrgCodes,
        hasAllOrgScope,
        organizationCatalog,
        organizationCatalogStatus,
        organizationPrimaryOrgScope,
        selectedDepartmentScope,
        selectedOrgScope,
        updateOrgScopeSelection,
    ]);

    useEffect(() => {
        setCandidates(filterBusinessRowsByOrgCodes(allCandidates, activeBusinessOrgCodes, businessRowFilterOptions));
        setTalentPoolCandidates(filterBusinessRowsByOrgCodes(allTalentPoolCandidates, activeBusinessOrgCodes, businessRowFilterOptions));
        setSkills(filterResourceRowsByOrgCodes(allSkills, activeBusinessOrgCodes, organizationMap));
        setAiLogs(filterBusinessRowsByOrgCodes(allAiLogs, activeBusinessOrgCodes, businessRowFilterOptions));
        setLlmConfigs(filterResourceRowsByOrgCodes(allLlmConfigs, activeBusinessOrgCodes, organizationMap));
        setMailSenderConfigs(filterResourceRowsByOrgCodes(allMailSenderConfigs, activeBusinessOrgCodes, organizationMap));
        setMailRecipients(filterResourceRowsByOrgCodes(allMailRecipients, activeBusinessOrgCodes, organizationMap));
        setResumeMailDispatches(filterBusinessRowsByOrgCodes(allResumeMailDispatches, activeBusinessOrgCodes, businessRowFilterOptions));
    }, [
        activeBusinessOrgCodes,
        allAiLogs,
        allCandidates,
        allTalentPoolCandidates,
        allLlmConfigs,
        allMailRecipients,
        allMailSenderConfigs,
        allResumeMailDispatches,
        allSkills,
        businessRowFilterOptions,
        organizationMap,
    ]);

    const applyCandidateListSnapshot = useCallback((items: CandidateSummary[], total: number, options?: { updateScopeTotal?: boolean }) => {
        allCandidatesRef.current = items;
        candidateTotalRef.current = total;
        setAllCandidates(items);
        setCandidates(filterBusinessRowsByOrgCodes(items, activeBusinessOrgCodes, businessRowFilterOptions));
        setCandidateTotal(total);
        if (options?.updateScopeTotal) {
            setCandidateScopeTotal(total);
        }
    }, [activeBusinessOrgCodes, businessRowFilterOptions]);

    const removeDeletedCandidatesFromLocalState = useCallback((candidateIds: number[]) => {
        const normalizedIds = Array.from(new Set(candidateIds.filter((id) => Number.isFinite(id) && id > 0)));
        if (!normalizedIds.length) {
            return;
        }
        const deletedIdSet = new Set(normalizedIds);
        const snapshotById = new Map<number, CandidateSummary>();
        [
            ...allCandidatesRef.current,
            ...candidates,
            ...allTalentPoolCandidatesRef.current,
        ].forEach((candidate) => {
            if (deletedIdSet.has(candidate.id) && !snapshotById.has(candidate.id)) {
                snapshotById.set(candidate.id, candidate);
            }
        });
        const deletedSnapshots = normalizedIds
            .map((id) => snapshotById.get(id))
            .filter((candidate): candidate is CandidateSummary => Boolean(candidate));

        const nextAllCandidates = allCandidatesRef.current.filter((candidate) => !deletedIdSet.has(candidate.id));
        allCandidatesRef.current = nextAllCandidates;
        setAllCandidates(nextAllCandidates);
        setCandidates((current) => current.filter((candidate) => !deletedIdSet.has(candidate.id)));

        const previousTalentPoolCount = allTalentPoolCandidatesRef.current.length;
        const nextTalentPoolCandidates = allTalentPoolCandidatesRef.current.filter((candidate) => !deletedIdSet.has(candidate.id));
        const removedTalentPoolCount = previousTalentPoolCount - nextTalentPoolCandidates.length;
        if (removedTalentPoolCount > 0) {
            allTalentPoolCandidatesRef.current = nextTalentPoolCandidates;
            setAllTalentPoolCandidates(nextTalentPoolCandidates);
            setTalentPoolTotal((current) => Math.max(0, current - removedTalentPoolCount));
        }

        const deletedCount = normalizedIds.length;
        const nextCandidateTotal = Math.max(0, candidateTotalRef.current - deletedCount);
        candidateTotalRef.current = nextCandidateTotal;
        setCandidateTotal(nextCandidateTotal);
        setCandidateScopeTotal((current) => Math.max(0, current - deletedCount));
        setSelectedCandidateIds((current) => current.filter((id) => !deletedIdSet.has(id)));
        if (comparisonCandidateIdsRef.current.some((id) => deletedIdSet.has(id))) {
            comparisonRequestIdRef.current += 1;
            comparisonAbortControllerRef.current?.abort();
            comparisonAbortControllerRef.current = null;
            comparisonReconcileAttemptsRef.current = 0;
            const nextComparisonIds = comparisonCandidateIdsRef.current.filter((id) => !deletedIdSet.has(id));
            comparisonCandidateIdsRef.current = nextComparisonIds;
            setComparisonCandidateIds(nextComparisonIds);
            setComparisonSelectionItems((current) => current.filter((candidate) => !deletedIdSet.has(candidate.id)));
            setComparisonPreview(null);
            setComparisonFailed(false);
            setComparisonStale(false);
            setCandidateWorkspaceMode("list");
        }
        setCandidateStatsData((current) => decrementCandidateStatsData(current, deletedSnapshots));
        setCandidatePipelineStatsData((current) => decrementCandidateStatsData(current, deletedSnapshots));

        if (candidateListPageCacheRef.current) {
            const cache = candidateListPageCacheRef.current;
            const nextCacheItems = cache.items.filter((candidate) => !deletedIdSet.has(candidate.id));
            const removedFromCache = cache.items.length - nextCacheItems.length;
            candidateListPageCacheRef.current = {
                ...cache,
                items: nextCacheItems,
                total: Math.max(0, cache.total - Math.max(removedFromCache, deletedCount)),
                loadedAt: Date.now(),
            };
        }
    }, [candidates]);

    useEffect(() => {
        if (positionDetailViewOpen) {
            return;
        }
        setSelectedPositionId((current) => {
            if (current && visiblePositions.some((position) => position.id === current)) {
                return current;
            }
            return null;
        });
    }, [positionDetailViewOpen, visiblePositions]);

    useEffect(() => {
        const targetPage = initialPage || "workspace";
        const previousPage = lastCandidateMenuPageRef.current;
        lastCandidateMenuPageRef.current = targetPage;
        if (targetPage !== "candidates" || previousPage === targetPage) {
            return;
        }
        if (candidatePageTargetCandidateIdRef.current) {
            candidateMenuSelectionResetRef.current = false;
            candidateMenuSuppressStaleDetailRef.current = false;
            return;
        }
        candidateMenuSelectionResetRef.current = true;
        candidateMenuSuppressStaleDetailRef.current = false;
    }, [initialPage]);

    useEffect(() => {
        if (activePage !== "candidates") {
            return;
        }
        setSelectedCandidateId((current) => {
            const shouldResetSelection = candidateMenuSelectionResetRef.current;
            if (candidateMenuSelectionResetRef.current) {
                candidateMenuSelectionResetRef.current = false;
            }
            const targetCandidateId = candidatePageTargetCandidateIdRef.current;
            if (targetCandidateId) {
                return current === targetCandidateId ? current : targetCandidateId;
            }
            if (!shouldResetSelection && current && visibleCandidateIdSet.has(current)) {
                return current;
            }
            return null;
        });
    }, [activePage, selectedCandidateId, visibleCandidateIdSet, visibleCandidates]);

    useEffect(() => {
        setSelectedLogId((current) => {
            if (!current) {
                return current;
            }
            if (visibleAiLogs.some((log) => log.id === current)) {
                return current;
            }
            return null;
        });
    }, [visibleAiLogs]);

    useEffect(() => {
        const fallbackPage = resolveFallbackRecruitmentPage();
        if (activePage === "workspace" && !canUseRecruitmentWorkspace) {
            applyRecruitmentPageChange(fallbackPage, "replace");
        } else if (activePage === "assistant" && !canViewRecruitmentAssistant) {
            applyRecruitmentPageChange(fallbackPage, "replace");
        } else if (activePage === "positions" && !canManagePosition) {
            applyRecruitmentPageChange(fallbackPage, "replace");
        } else if (activePage === "candidates" && !canManageCandidate) {
            applyRecruitmentPageChange(fallbackPage, "replace");
        } else if (activePage === "talent-pool" && !canViewTalentPool) {
            applyRecruitmentPageChange(fallbackPage, "replace");
        } else if (activePage === "review-workbench" && !canViewReview && !canActReview) {
            applyRecruitmentPageChange(fallbackPage, "replace");
        } else if (activePage === "interviews" && !canViewInterview && !canActInterview && !canManageInterview) {
            applyRecruitmentPageChange(fallbackPage, "replace");
        } else if (activePage === "audit" && !canViewLog) {
            applyRecruitmentPageChange(fallbackPage, "replace");
        } else if (activePage === "settings-skills" && !canViewSkill && !canManageSkill) {
            applyRecruitmentPageChange(fallbackPage, "replace");
        } else if (activePage === "settings-models" && !canViewLLMConfig && !canManageLLMConfig) {
            applyRecruitmentPageChange(fallbackPage, "replace");
        } else if (activePage === "settings-mail" && !canViewMail && !canManageMailConfig) {
            applyRecruitmentPageChange(fallbackPage, "replace");
        }
    }, [
        activePage,
        applyRecruitmentPageChange,
        resolveFallbackRecruitmentPage,
        canUseRecruitmentWorkspace,
        canViewRecruitmentAssistant,
        canManagePosition,
        canManageCandidate,
        canViewTalentPool,
        canViewReview,
        canActReview,
        canViewInterview,
        canActInterview,
        canManageInterview,
        canViewLog,
        canViewSkill,
        canManageSkill,
        canViewLLMConfig,
        canManageLLMConfig,
        canViewMail,
        canManageMailConfig,
    ]);

    // 进入人才库页面时加载完整列表；上传后的识别中入口只生效一次。
    useEffect(() => {
        const organizationScopeResolved = organizationCatalogStatus === "ready" || organizationCatalogStatus === "error";
        if (activePage === "talent-pool" && organizationScopeResolved) {
            const nextStatFilter = talentPoolPreferredStatFilter || DEFAULT_TALENT_POOL_QUERY.statFilter;
            const nextQuery: TalentPoolQueryState = {
                ...DEFAULT_TALENT_POOL_QUERY,
                ...talentPoolQueryRef.current,
                statFilter: nextStatFilter,
                pageIndex: 0,
                offset: 0,
            };
            setTalentPoolPageIndex(0);
            talentPoolPageIndexRef.current = 0;
            talentPoolQueryRef.current = nextQuery;
            const scope = candidateListRefreshQueryRef.current;
            loadTalentPoolCandidates({
                query: nextQuery,
                departmentScope: scope.departmentScope,
                orgScope: scope.orgScope,
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePage, organizationCatalogStatus]);

    useEffect(() => {
        if (activePage !== "talent-pool") {
            return;
        }
        const hasMatchingCandidate = allTalentPoolCandidates.some((candidate) => (
            String(candidate.status || "").trim().toLowerCase() === "matching"
        ));
        if (!hasMatchingCandidate) {
            return;
        }
        const timer = window.setInterval(() => {
            void loadTalentPoolCandidates({ silent: true });
        }, 6000);
        return () => window.clearInterval(timer);
        // SSE 仍是主通道；这里仅在有识别中候选人时兜底跨进程/断线漏推送。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePage, allTalentPoolCandidates]);

    // 监听顶栏侧边栏的导航事件
    useEffect(() => {
        const handler = (e: Event) => {
            const { page, replace } = resolveRecruitmentNavigationDetail((e as CustomEvent).detail);
            applyRecruitmentPageChange(page as RecruitmentPage, replace ? "replace" : "push");
        };
        recruitmentNavBus.addEventListener('navigate', handler);
        return () => recruitmentNavBus.removeEventListener('navigate', handler);
    }, [applyRecruitmentPageChange]);

    const candidateSelectionScopeKey = useMemo(() => JSON.stringify({
        dataScope: recruitmentDataCacheKey,
        departmentScope: selectedDepartmentScope,
        orgScope: selectedOrgScope,
        query: candidateQuery.trim(),
        positionFilter: candidatePositionFilter,
        statusFilter: candidateStatusFilter,
        sourceFilter: candidateSourceFilter,
        timeFilter: candidateTimeFilter,
        matchFilter: candidateMatchFilter,
        matchSortOrder: candidateMatchSortOrder,
    }), [
        candidateMatchFilter,
        candidateMatchSortOrder,
        candidatePositionFilter,
        candidateQuery,
        candidateSourceFilter,
        candidateStatusFilter,
        candidateTimeFilter,
        recruitmentDataCacheKey,
        selectedDepartmentScope,
        selectedOrgScope,
    ]);
    const candidateSelectionScopeKeyRef = useRef<string | null>(null);

    useEffect(() => {
        if (candidateSelectionScopeKeyRef.current === null) {
            candidateSelectionScopeKeyRef.current = candidateSelectionScopeKey;
            return;
        }
        if (candidateSelectionScopeKeyRef.current === candidateSelectionScopeKey) {
            return;
        }
        candidateSelectionScopeKeyRef.current = candidateSelectionScopeKey;
        setSelectedCandidateIds((current) => current.length ? [] : current);
    }, [candidateSelectionScopeKey]);

    const comparisonDataScopeKey = useMemo(() => JSON.stringify({
        dataScope: recruitmentDataCacheKey,
        departmentScope: selectedDepartmentScope,
        orgScope: selectedOrgScope,
        canManageCandidate,
    }), [canManageCandidate, recruitmentDataCacheKey, selectedDepartmentScope, selectedOrgScope]);
    const comparisonDataScopeKeyRef = useRef<string | null>(null);

    const clearCandidateComparison = useCallback(() => {
        comparisonRequestIdRef.current += 1;
        comparisonAbortControllerRef.current?.abort();
        comparisonAbortControllerRef.current = null;
        comparisonReconcileAttemptsRef.current = 0;
        comparisonCandidateIdsRef.current = [];
        setCandidateWorkspaceMode("list");
        setComparisonCandidateIds([]);
        setComparisonSelectionItems([]);
        setComparisonPreview(null);
        setComparisonLoading(false);
        setComparisonRefreshing(false);
        setComparisonFailed(false);
        setComparisonStale(false);
    }, []);

    useEffect(() => {
        if (comparisonDataScopeKeyRef.current === null) {
            comparisonDataScopeKeyRef.current = comparisonDataScopeKey;
            return;
        }
        if (comparisonDataScopeKeyRef.current === comparisonDataScopeKey) {
            return;
        }
        comparisonDataScopeKeyRef.current = comparisonDataScopeKey;
        candidateSelectionItemCacheRef.current.clear();
        clearCandidateComparison();
    }, [clearCandidateComparison, comparisonDataScopeKey]);

    useEffect(() => {
        comparisonCandidateIdsRef.current = comparisonCandidateIds;
    }, [comparisonCandidateIds]);

    const findComparisonCandidate = useCallback((candidateId: number) => {
        if (candidateDetail?.candidate.id === candidateId) {
            return candidateDetail.candidate;
        }
        return comparisonSelectionItems.find((candidate) => candidate.id === candidateId)
            || candidates.find((candidate) => candidate.id === candidateId)
            || allCandidates.find((candidate) => candidate.id === candidateId)
            || candidateSelectionItemCacheRef.current.get(candidateId)
            || null;
    }, [allCandidates, candidateDetail, candidates, comparisonSelectionItems]);

    const validateComparisonCandidates = useCallback((items: CandidateSummary[], options?: {silent?: boolean; allowSingle?: boolean; ignoreMaximum?: boolean}) => {
        if (items.length < (options?.allowSingle ? 1 : 2)) {
            if (!options?.silent) toast.error(candidateComparisonText.minimumRequired);
            return null;
        }
        if (items.length > 4 && !options?.ignoreMaximum) {
            if (!options?.silent) toast.error(candidateComparisonText.maximumReached);
            return null;
        }
        const expectedPositionId = items[0]?.position_id;
        if (expectedPositionId == null) {
            if (!options?.silent) toast.error(candidateComparisonText.assignedPositionRequired);
            return null;
        }
        if (items.some((candidate) => candidate.position_id == null)) {
            if (!options?.silent) toast.error(candidateComparisonText.assignedPositionRequired);
            return null;
        }
        if (items.some((candidate) => candidate.position_id !== expectedPositionId)) {
            if (!options?.silent) toast.error(candidateComparisonText.samePositionRequired);
            return null;
        }
        return expectedPositionId;
    }, [candidateComparisonText]);

    const importCandidatesToComparison = useCallback((candidateIds: number[]) => {
        const normalizedIds = Array.from(new Set(candidateIds.filter((candidateId) => Number.isFinite(candidateId) && candidateId > 0)));
        if (normalizedIds.length < 1) {
            return;
        }
        const items = normalizedIds
            .map((candidateId) => findComparisonCandidate(candidateId))
            .filter((candidate): candidate is CandidateSummary => Boolean(candidate));
        if (items.length !== normalizedIds.length) {
            toast.error(candidateComparisonText.selectedCandidateUnavailable);
            return;
        }
        const existingIds = new Set(comparisonCandidateIdsRef.current);
        const newItems = items.filter((candidate) => !existingIds.has(candidate.id));
        if (!newItems.length) {
            toast.info(candidateComparisonText.alreadyInTray);
            setSelectedCandidateIds([]);
            return;
        }
        const allRequestedItems = [...comparisonSelectionItems, ...newItems];
        if (validateComparisonCandidates(allRequestedItems, {allowSingle: true, ignoreMaximum: true}) == null) {
            return;
        }
        const availableSlots = Math.max(0, 4 - comparisonSelectionItems.length);
        const acceptedItems = newItems.slice(0, availableSlots);
        if (!acceptedItems.length) {
            toast.error(candidateComparisonText.maximumReached);
            return;
        }
        const mergedItems = [...comparisonSelectionItems, ...acceptedItems];
        comparisonRequestIdRef.current += 1;
        comparisonAbortControllerRef.current?.abort();
        comparisonAbortControllerRef.current = null;
        comparisonReconcileAttemptsRef.current = 0;
        const mergedIds = mergedItems.map((candidate) => candidate.id);
        comparisonCandidateIdsRef.current = mergedIds;
        setComparisonCandidateIds(mergedIds);
        setComparisonSelectionItems(mergedItems);
        setComparisonPreview(null);
        setComparisonFailed(false);
        setComparisonStale(false);
        setSelectedCandidateIds([]);
        toast.success(candidateComparisonText.addedToTray(mergedItems.length));
        if (acceptedItems.length < newItems.length) {
            toast.warning(candidateComparisonText.overflowSkipped);
        }
    }, [candidateComparisonText, comparisonSelectionItems, findComparisonCandidate, validateComparisonCandidates]);

    const loadCandidateComparison = useCallback(async (options?: CandidateComparisonLoadOptions) => {
        const requestedSelectionItems = options?.selectionItems ?? comparisonSelectionItems;
        const requestedCandidateIds = options?.candidateIds ?? comparisonCandidateIds;
        const expectedPositionId = validateComparisonCandidates(requestedSelectionItems, {silent: true});
        if (expectedPositionId == null) {
            setComparisonFailed(true);
            setComparisonStale(true);
            return;
        }
        const payload: CandidateComparisonPreviewRequest = {
            candidate_ids: requestedCandidateIds,
            expected_position_id: expectedPositionId,
        };
        const requestId = comparisonRequestIdRef.current + 1;
        comparisonRequestIdRef.current = requestId;
        const invalidationRevision = comparisonInvalidationRevisionRef.current;
        comparisonAbortControllerRef.current?.abort();
        const controller = new AbortController();
        comparisonAbortControllerRef.current = controller;
        if (options?.background) {
            setComparisonRefreshing(true);
        } else {
            setComparisonLoading(true);
        }
        setComparisonFailed(false);
        try {
            const preview = await recruitmentApi<CandidateComparisonPreview>("/candidate-comparisons/preview", {
                method: "POST",
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            if (comparisonRequestIdRef.current !== requestId || controller.signal.aborted) {
                return;
            }
            setComparisonPreview(preview);
            setComparisonFailed(false);
            setComparisonStale(comparisonInvalidationRevisionRef.current !== invalidationRevision);
        } catch (error) {
            if (isRecruitmentRequestAborted(error) || comparisonRequestIdRef.current !== requestId) {
                return;
            }
            setComparisonFailed(true);
            setComparisonStale(true);
        } finally {
            if (comparisonRequestIdRef.current === requestId) {
                if (comparisonAbortControllerRef.current === controller) {
                    comparisonAbortControllerRef.current = null;
                }
                setComparisonLoading(false);
                setComparisonRefreshing(false);
            }
        }
    }, [comparisonCandidateIds, comparisonSelectionItems, validateComparisonCandidates]);

    const removeCandidateFromComparison = useCallback((candidateId: number) => {
        comparisonRequestIdRef.current += 1;
        comparisonAbortControllerRef.current?.abort();
        comparisonAbortControllerRef.current = null;
        comparisonReconcileAttemptsRef.current = 0;
        const nextIds = comparisonCandidateIdsRef.current.filter((item) => item !== candidateId);
        const nextIdSet = new Set(nextIds);
        const nextItems = comparisonSelectionItems.filter((candidate) => nextIdSet.has(candidate.id));
        comparisonCandidateIdsRef.current = nextIds;
        setComparisonCandidateIds(nextIds);
        setComparisonSelectionItems(nextItems);
        setComparisonLoading(false);
        setComparisonFailed(false);
        if (candidateWorkspaceMode === "comparison" && nextIds.length < 2) {
            setComparisonPreview(null);
            setComparisonRefreshing(false);
            setComparisonStale(false);
            setCandidateWorkspaceMode("list");
            toast.info(candidateComparisonText.removedAndExited);
            return;
        }
        if (candidateWorkspaceMode !== "comparison") {
            setComparisonPreview(null);
            setComparisonRefreshing(false);
            setComparisonStale(false);
            return;
        }
        setComparisonPreview((current) => removeCandidateFromComparisonPreview(current, candidateId));
        void loadCandidateComparison({
            background: true,
            candidateIds: nextIds,
            selectionItems: nextItems,
        });
    }, [candidateComparisonText.removedAndExited, candidateWorkspaceMode, comparisonSelectionItems, loadCandidateComparison]);

    const toggleCandidateInComparison = useCallback((candidate: CandidateSummary) => {
        if (comparisonCandidateIdsRef.current.includes(candidate.id)) {
            removeCandidateFromComparison(candidate.id);
            return;
        }
        if (candidate.position_id == null) {
            toast.error(candidateComparisonText.assignedPositionRequired);
            return;
        }
        if (comparisonCandidateIdsRef.current.length >= 4) {
            toast.error(candidateComparisonText.maximumReached);
            return;
        }
        const currentPositionId = comparisonSelectionItems[0]?.position_id;
        if (currentPositionId != null && candidate.position_id !== currentPositionId) {
            toast.error(candidateComparisonText.samePositionRequired);
            return;
        }
        const nextIds = [...comparisonCandidateIdsRef.current, candidate.id];
        comparisonCandidateIdsRef.current = nextIds;
        comparisonReconcileAttemptsRef.current = 0;
        setComparisonCandidateIds(nextIds);
        setComparisonSelectionItems((current) => [...current, candidate]);
        setComparisonPreview(null);
        setComparisonFailed(false);
        setComparisonStale(false);
        toast.success(candidateComparisonText.addedToTray(nextIds.length));
    }, [candidateComparisonText, comparisonSelectionItems, removeCandidateFromComparison]);

    const startCandidateComparison = useCallback(() => {
        if (validateComparisonCandidates(comparisonSelectionItems) == null) {
            return;
        }
        comparisonReconcileAttemptsRef.current = 0;
        setComparisonPreview(null);
        setComparisonFailed(false);
        setComparisonStale(false);
        setCandidateWorkspaceMode("comparison");
    }, [comparisonSelectionItems, validateComparisonCandidates]);

    const exitCandidateComparison = useCallback(() => {
        comparisonRequestIdRef.current += 1;
        comparisonAbortControllerRef.current?.abort();
        comparisonAbortControllerRef.current = null;
        setComparisonLoading(false);
        setComparisonRefreshing(false);
        setCandidateWorkspaceMode("list");
    }, []);

    const refreshCandidateComparison = useCallback(() => {
        comparisonReconcileAttemptsRef.current = 0;
        void loadCandidateComparison({background: Boolean(comparisonPreview)});
    }, [comparisonPreview, loadCandidateComparison]);

    const comparisonProcessing = useMemo(() => Boolean(
        comparisonPreview?.members.some((member) => member.artifact_state === "processing"),
    ), [comparisonPreview]);

    useEffect(() => {
        if (
            candidateWorkspaceMode !== "comparison"
            || comparisonSelectionItems.length < 2
            || comparisonPreview
            || comparisonLoading
            || comparisonRefreshing
            || comparisonFailed
        ) {
            return;
        }
        void loadCandidateComparison();
    }, [
        candidateWorkspaceMode,
        comparisonFailed,
        comparisonLoading,
        comparisonPreview,
        comparisonRefreshing,
        comparisonSelectionItems,
        loadCandidateComparison,
    ]);

    useEffect(() => {
        if (
            candidateWorkspaceMode !== "comparison"
            || activePage !== "candidates"
            || !pageVisible
            || comparisonLoading
            || comparisonRefreshing
            || (!comparisonProcessing && !comparisonStale)
        ) {
            return undefined;
        }
        const shouldUseFastReconcile = (
            comparisonProcessing || comparisonStale
        ) && comparisonReconcileAttemptsRef.current < 6;
        const timer = window.setTimeout(() => {
            if (shouldUseFastReconcile) {
                comparisonReconcileAttemptsRef.current += 1;
            }
            void loadCandidateComparison({background: true});
        }, shouldUseFastReconcile ? 5000 : 60000);
        return () => window.clearTimeout(timer);
    }, [
        activePage,
        candidateWorkspaceMode,
        comparisonLoading,
        comparisonProcessing,
        comparisonRefreshing,
        comparisonStale,
        loadCandidateComparison,
        pageVisible,
    ]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return undefined;
        }
        const handleComparisonFocus = () => {
            if (
                candidateWorkspaceMode !== "comparison"
                || activePageRef.current !== "candidates"
                || comparisonLoading
                || comparisonRefreshing
            ) {
                return;
            }
            void loadCandidateComparison({background: true});
        };
        window.addEventListener("focus", handleComparisonFocus);
        return () => window.removeEventListener("focus", handleComparisonFocus);
    }, [candidateWorkspaceMode, comparisonLoading, comparisonRefreshing, loadCandidateComparison]);

    useEffect(() => () => {
        comparisonRequestIdRef.current += 1;
        comparisonAbortControllerRef.current?.abort();
        comparisonAbortControllerRef.current = null;
    }, []);

    const removeCandidateIdsFromSelection = useCallback((candidateIds: number[]) => {
        const removedIdSet = new Set(candidateIds.filter((candidateId) => Number.isFinite(candidateId)));
        if (!removedIdSet.size) {
            return;
        }
        setSelectedCandidateIds((current) => (
            current.length ? current.filter((candidateId) => !removedIdSet.has(candidateId)) : current
        ));
    }, []);

    useEffect(() => {
        if (candidatePositionFilter.length > 0) {
            const validIds = candidatePositionFilter.filter(id =>
                positions.some((position) => String(position.id) === id)
            );
            if (validIds.length !== candidatePositionFilter.length) {
                setCandidatePositionFilter(validIds);
            }
        }
    }, [candidatePositionFilter, positions]);

    useEffect(() => {
        selectedLogIdRef.current = selectedLogId;
    }, [selectedLogId]);

    useEffect(() => {
        chatContextRef.current = chatContext;
    }, [chatContext]);

    useEffect(() => {
        selectedPositionIdRef.current = selectedPositionId;
    }, [selectedPositionId]);

    useEffect(() => {
        setPositionWorkspaceView("config");
        setPositionCardActionMenuOpen(false);
        defaultTabSetForPositionRef.current = null;
        setPositionCandidateSearch("");
        setPositionCandidateStatusFilter("__all__");
        setPositionCandidatesData([]);
        setPositionCandidatesTotal(0);
        setPositionCandidatesInitialLoaded(false);
    }, [selectedPositionId]);

    useEffect(() => {
        if (activePage !== "talent-pool") {
            setTalentPoolCandidateDetailOpen(false);
            setTalentPoolDetailAssignOpen(false);
            setTalentPoolDetailReidentifyConfirmOpen(false);
            setTalentPoolDetailAction(null);
        }
    }, [activePage]);

    const cancelCandidateDetailRequests = useCallback(() => {
        candidateDetailRequestAbortControllersRef.current.forEach((controller) => controller.abort());
        candidateDetailRequestAbortControllersRef.current.clear();
        candidateDetailLoadingGenerationRef.current += 1;
        setCandidateDetailLoading(false);
    }, []);

    const previousCandidatePageActiveRef = useRef(activePage === "candidates");
    useEffect(() => {
        const wasCandidatePageActive = previousCandidatePageActiveRef.current;
        previousCandidatePageActiveRef.current = activePage === "candidates";
        if (!wasCandidatePageActive || activePage === "candidates") {
            return;
        }
        candidatePageTargetCandidateIdRef.current = null;
        cancelCandidateDetailRequests();
        selectedCandidateIdRef.current = null;
        checkedDuplicateCandidateIdRef.current = null;
        setSelectedCandidateId(null);
        setCandidateDetail(null);
        setCandidateDetailReviewContext(null);
    }, [activePage, cancelCandidateDetailRequests]);

    useEffect(() => {
        if (activePage === "talent-pool" && !selectedCandidateId) {
            setTalentPoolCandidateDetailOpen(false);
            setTalentPoolDetailAssignOpen(false);
            setTalentPoolDetailReidentifyConfirmOpen(false);
        }
    }, [activePage, selectedCandidateId]);

    useEffect(() => {
        if (activePage !== "candidates") {
            setCandidateListTransitionLoading(false);
            setCandidatesLoading(false);
        }
    }, [activePage]);

    useEffect(() => {
        if (activePage !== "candidates") {
            return;
        }
        // 如果没有选中候选人，清空详情
        if (!selectedCandidateId) {
            setCandidateDetail(null);
            checkedDuplicateCandidateIdRef.current = null;
        }
        // 如果选中的候选人不在候选人列表中，也清空详情（但从人才库跳转过来的情况除外）
        // 注意：这里不再检查 visibleCandidateIdSet，因为从人才库跳转过来的候选人可能不在候选人列表中
    }, [activePage, selectedCandidateId]);

    useEffect(() => {
        if (
            talentPoolCandidateDetailOpen
            && selectedCandidateId
            && !talentPoolCandidates.some((candidate) => candidate.id === selectedCandidateId)
            && !allTalentPoolCandidatesRef.current.some((candidate) => candidate.id === selectedCandidateId)
        ) {
            setTalentPoolCandidateDetailOpen(false);
        }
    }, [selectedCandidateId, talentPoolCandidateDetailOpen, talentPoolCandidates]);

    // 搜索候选人（服务端搜索，防抖 300ms）
    // 只在岗位页面且工作区视图为candidates时才加载
    useEffect(() => {
        if (!selectedPositionId) return;
        if (activePage !== "positions") return; // 只在岗位页面加载
        if (positionWorkspaceView !== "candidates") return; // 只在候选人视图加载
        
        // 如果正在加载，跳过重复请求
        if (positionCandidatesLoading) return;
        
        const timer = window.setTimeout(() => {
            void loadPositionCandidates(
                selectedPositionId,
                positionCandidateSearch || undefined,
                positionCandidateStatusFilter !== "__all__" ? positionCandidateStatusFilter : undefined,
            );
        }, 300);
        return () => window.clearTimeout(timer);
    }, [positionCandidateSearch, positionCandidateStatusFilter, positionWorkspaceView, selectedPositionId, activePage]);

    useEffect(() => {
        selectedCandidateIdRef.current = selectedCandidateId;
    }, [selectedCandidateId]);

    useEffect(() => {
        candidateDetailReviewContextRef.current = candidateDetailReviewContext;
    }, [candidateDetailReviewContext]);

    useEffect(() => {
        if (activePage !== "candidates") {
            candidatePageTargetCandidateIdRef.current = null;
        }
    }, [activePage]);

    const handleCandidatePageSelect = useCallback<React.Dispatch<React.SetStateAction<number | null>>>((value) => {
        const currentCandidateId = selectedCandidateIdRef.current;
        const nextCandidateId = typeof value === "function" ? value(currentCandidateId) : value;
        candidatePageTargetCandidateIdRef.current = null;
        setCandidateDetailReviewContext(null);
        if (nextCandidateId !== currentCandidateId) {
            cancelCandidateDetailRequests();
        }
        selectedCandidateIdRef.current = nextCandidateId;
        if (
            nextCandidateId
            && currentCandidateId === nextCandidateId
            && candidateDetail?.candidate.id !== nextCandidateId
        ) {
            const shouldCheckDuplicates = checkedDuplicateCandidateIdRef.current !== nextCandidateId;
            if (shouldCheckDuplicates) {
                checkedDuplicateCandidateIdRef.current = nextCandidateId;
            }
            void loadCandidateDetail(nextCandidateId, {
                force: true,
                includeDuplicates: shouldCheckDuplicates,
            });
        }
        setSelectedCandidateId(nextCandidateId);
    }, [candidateDetail?.candidate.id, cancelCandidateDetailRequests]);

    useEffect(() => {
        auditLogRequestKeyRef.current = auditLogRequestKey;
    }, [auditLogRequestKey]);

    useEffect(() => {
        pageVisibleRef.current = pageVisible;
    }, [pageVisible]);

    useEffect(() => {
        activePageRef.current = activePage;
    }, [activePage]);

    useEffect(() => {
        if (typeof document === "undefined") {
            return undefined;
        }
        const handleVisibilityChange = () => {
            const visible = document.visibilityState === "visible";
            pageVisibleRef.current = visible;
            setPageVisible(visible);
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, []);

    useEffect(() => {
        if (bootstrapping || !canUseRecruitmentWorkspace || isSettingsPage) {
            return;
        }
        if ((activePage === "workspace" || activePage === "assistant") && !workspaceDataLoadStartedRef.current) {
            workspaceDataLoadStartedRef.current = true;
            const query = candidateListRefreshQueryRef.current;
            void Promise.allSettled([
                loadPositions(),
                loadCandidates({silent: true, force: true, useVisibleFilters: false}),
                refreshCandidateStatsRef.current(query.departmentScope, query.orgScope),
            ]);
            return;
        }
        if (
            (activePage === "positions" || activePage === "candidates")
            && !positionsLoadStartedRef.current
            && !positionsLoadedOnceRef.current
        ) {
            void loadPositions().catch(() => undefined);
        }
        // 页面切换后的加载函数通过自身 requestId 保证 latest-wins。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePage, bootstrapping, canUseRecruitmentWorkspace, isSettingsPage]);

    useEffect(() => {
        mountedRef.current = true;
        const taskMonitorTimers = taskMonitorTimersRef.current;
        const taskMonitorTokens = taskMonitorTokensRef.current;
        const inflightRequests = requestInflightRef.current;
        return () => {
            mountedRef.current = false;
            candidateDetailRequestAbortControllersRef.current.forEach((controller) => controller.abort());
            candidateDetailRequestAbortControllersRef.current.clear();
            skillSettingsLoadAbortControllerRef.current?.abort();
            skillDetailLoadAbortControllerRef.current?.abort();
            llmConfigsLoadAbortControllerRef.current?.abort();
            mailSendersLoadAbortControllerRef.current?.abort();
            mailRecipientsLoadAbortControllerRef.current?.abort();
            mailDispatchesLoadAbortControllerRef.current?.abort();
            mailDispatchDetailLoadAbortControllerRef.current?.abort();
            mailAutoConfigLoadAbortControllerRef.current?.abort();
            taskMonitorTimers.forEach((timerId) => window.clearTimeout(timerId));
            taskMonitorTimers.clear();
            taskMonitorTokens.clear();
            inflightRequests.clear();
            if (logFlushRafRef.current != null) {
                window.cancelAnimationFrame(logFlushRafRef.current);
                logFlushRafRef.current = null;
            }
            if (candidateUpdateBatchTimerRef.current != null) {
                window.clearTimeout(candidateUpdateBatchTimerRef.current);
                candidateUpdateBatchTimerRef.current = null;
            }
            if (candidateStatsRefreshTimerRef.current != null) {
                window.clearTimeout(candidateStatsRefreshTimerRef.current);
                candidateStatsRefreshTimerRef.current = null;
            }
            candidateStatsRefreshInFlightRef.current = false;
            candidateStatsRefreshPendingRef.current = false;
            pendingCandidateUpdateEventsRef.current = [];
        };
    }, []);

    useEffect(() => {
        setInterviewGenerating(Boolean(activeInterviewTaskId));
    }, [activeInterviewTaskId]);

    useEffect(() => {
        setChatSending(Boolean(activeChatTaskId));
    }, [activeChatTaskId]);

    useEffect(() => {
        const viewport = assistantScrollAreaRef.current;
        if (!viewport || !assistantScrollAnchorRef.current) {
            return undefined;
        }
        if (!autoFollowStream) {
            return undefined;
        }
        const frameId = window.requestAnimationFrame(() => {
            viewport.scrollTo({
                top: viewport.scrollHeight,
                behavior: chatSending ? "auto" : "smooth",
            });
        });
        return () => window.cancelAnimationFrame(frameId);
    }, [assistantDisplayMode, assistantOpen, autoFollowStream, chatMessages, chatSending]);

    useEffect(() => {
        const shouldFocusAssistantInput = assistantOpen || activePage === "assistant";
        if (!shouldFocusAssistantInput) {
            return undefined;
        }
        const timer = window.setTimeout(() => {
            focusAssistantInput(true);
        }, 50);
        return () => window.clearTimeout(timer);
    }, [activePage, assistantOpen, assistantDisplayMode]);

    // 使用缓存 hook
    const { getCachedOrFetch: getCachedPositions, invalidateCache: invalidatePositionsCache } = useCachedListData<PositionSummary>({ ttl: 60000 });
    const { getCachedOrFetch: getCachedCandidates, invalidateCache: invalidateCandidatesCache } = useCachedObjectData<{items: CandidateSummary[]; total: number}>({ ttl: 60000 });
    const { getCachedOrFetch: getCachedLogs, invalidateCache: invalidateLogsCache } = useCachedObjectData<{items: AITaskLog[]; total: number}>({ ttl: 30000 });

    // 优化的分阶段加载策略
    useEffect(() => {
        let cancelled = false;
        let criticalLoaded = false;

        async function bootstrap() {
            setBootstrapping(true);
            logsFiltersInitializedRef.current = false;

            try {
                // 阶段 1: 关键数据 (阻塞渲染，最高优先级)
                const [, organizationCatalogResult] = await Promise.allSettled([
                    loadMetadata(),
                    loadOrganizationCatalog(),
                ]);

                if (cancelled) return;

                const mountedSelection = {
                    orgScope: selectedOrgScope,
                    departmentScope: selectedDepartmentScope,
                };
                let bootstrapSelection = mountedSelection;
                if (
                    organizationCatalogResult.status === "fulfilled"
                    && organizationCatalogResult.value.authoritative
                ) {
                    const organizationScope = organizationCatalogResult.value.data;
                    const catalogDefaultOrgScope = normalizeRecruitmentOrgCode(
                        organizationScope.primary_org_code || defaultOrgScope,
                    );
                    const catalogVisibleOrgCodes = organizationScope.visible_org_codes?.length
                        ? organizationScope.visible_org_codes.map(normalizeRecruitmentOrgCode)
                        : [catalogDefaultOrgScope];
                    bootstrapSelection = validateRecruitmentOrgScopeSelection(mountedSelection, {
                        defaultOrgScope: catalogDefaultOrgScope,
                        hasAllOrgScope: Boolean(organizationScope.has_all_orgs),
                        organizationCatalog: organizationScope.organizations || [],
                        visibleOrgCodes: catalogVisibleOrgCodes,
                    });
                    if (!isSameRecruitmentOrgScope(mountedSelection, bootstrapSelection)) {
                        updateOrgScopeSelection(bootstrapSelection);
                    }
                    setOrganizationCatalogStatus("ready");
                } else {
                    // 目录瞬时失败时保留本次挂载的选择，不把降级目录当成权威结果写回父级。
                    // 后续业务请求仍由后端权限范围做最终校验，组织选择器保持禁用直至重新进入模块。
                    setOrganizationCatalogStatus("error");
                }
                candidateListRefreshQueryRef.current = {
                    ...candidateListRefreshQueryRef.current,
                    departmentScope: bootstrapSelection.departmentScope,
                    orgScope: bootstrapSelection.orgScope,
                };

                if (!shouldBootstrapRecruitmentCore(activePageRef.current, canUseRecruitmentWorkspace)) {
                    criticalLoaded = true;
                    setBootstrapping(false);
                    return;
                }

                // 阶段 2: 关键首屏列表尽早开始，避免被统计接口阻塞
                workspaceDataLoadStartedRef.current = true;
                void loadPositionsWithCache();
                void loadCandidatesFirstPage(bootstrapSelection);
                criticalLoaded = true;
                setBootstrapping(false);

                // 阶段 3: 工作台统计延后，避免抢占首屏
                const scheduleDeferredLoad = () => {
                    if (cancelled) {
                        return;
                    }
                    const query = candidateListRefreshQueryRef.current;
                    void refreshCandidateStatsRef.current(query.departmentScope, query.orgScope);
                };
                if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
                    window.requestIdleCallback(() => {
                        scheduleDeferredLoad();
                    }, { timeout: 2000 });
                } else {
                    setTimeout(() => {
                        scheduleDeferredLoad();
                    }, 200);
                }
            } catch (error) {
                if (!criticalLoaded && !cancelled) {
                    setBootstrapping(false);
                }
            }
        }

        async function loadPositionsWithCache(): Promise<void> {
            const requestId = positionsLoadRequestIdRef.current + 1;
            positionsLoadRequestIdRef.current = requestId;
            positionsLoadStartedRef.current = true;
            setPositionsLoading(true);
            try {
                const data = await getCachedPositions(
                    `positions:${recruitmentDataCacheKey}`,
                    () => recruitmentApi<PositionSummary[]>("/positions")
                );
                if (!cancelled && positionsLoadRequestIdRef.current === requestId) {
                    setAllPositions(data);
                    setPositionListRequiresRefresh(false);
                    positionsLoadedOnceRef.current = true;
                }
            } catch (error) {
                positionsLoadStartedRef.current = false;
                toast.error(recruitmentToast.loadFailed(recruitmentToastEntities.positions, formatActionError(error)));
            } finally {
                if (!cancelled && positionsLoadRequestIdRef.current === requestId) {
                    setPositionsLoading(false);
                }
            }
        }

        async function loadCandidatesFirstPage(scope: RecruitmentOrgScopeSelection): Promise<void> {
            const requestId = candidatesLoadRequestIdRef.current + 1;
            candidatesLoadRequestIdRef.current = requestId;
            let controller: AbortController | null = null;
            try {
                // 设置 loading 状态，防止显示空状态
                setCandidatesLoading(true);
                const contextKey = buildCandidateListContextKey({
                    useVisibleFilters: false,
                    departmentScope: scope.departmentScope,
                    orgScope: scope.orgScope,
                });
                candidateListContextKeyRef.current = contextKey;
                abortCandidateListRequests();
                controller = new AbortController();
                candidateListLoadAbortControllerRef.current = controller;
                const queryString = buildCandidateListQueryString({
                    useVisibleFilters: false,
                    departmentScope: scope.departmentScope,
                    orgScope: scope.orgScope,
                });
                const url = `/candidates?${queryString}`;
                const data = await recruitmentApi<{items: CandidateSummary[]; total: number}>(url, {
                    signal: controller.signal,
                    timeoutMs: 45000,
                });
                if (
                    cancelled
                    || candidatesLoadRequestIdRef.current !== requestId
                    || candidateListContextKeyRef.current !== contextKey
                ) {
                    return;
                }
                const nextItems = deduplicateCandidates(data?.items || []);
                const nextTotal = data?.total || 0;
                candidateListUsingVisibleFiltersRef.current = false;
                candidateListPreloadLoadedAtRef.current = Date.now();
                applyCandidateListSnapshot(nextItems, nextTotal, { updateScopeTotal: true });
                setCandidatesInitialLoaded(true);
            } catch (error) {
                if (isRecruitmentRequestAborted(error)) {
                    return;
                }
                if (!cancelled && candidatesLoadRequestIdRef.current === requestId) {
                    setCandidatesInitialLoaded(true);
                    toast.error(recruitmentToast.loadFailed(recruitmentToastEntities.candidates, formatActionError(error)));
                }
            } finally {
                if (candidateListLoadAbortControllerRef.current === controller) {
                    candidateListLoadAbortControllerRef.current = null;
                }
                if (!cancelled && candidatesLoadRequestIdRef.current === requestId) {
                    setCandidatesLoading(false);
                }
            }
        }

        void bootstrap();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (bootstrapping) {
            return;
        }
        if (!logsFiltersInitializedRef.current) {
            logsFiltersInitializedRef.current = true;
            return;
        }
        void loadLogs();
    }, [bootstrapping, auditLogRequestKey]);

    useEffect(() => {
        if (!selectedPositionId) {
            setPositionDetail(null);
            return;
        }
        // 只有在岗位页面时才加载岗位详情，避免不必要的请求
        if (activePage !== "positions") {
            return;
        }
        void loadPositionDetail(selectedPositionId);
    }, [selectedPositionId, activePage]);

    useEffect(() => {
        jdGenerationInFlightRef.current = false;
        jdAbortControllerRef.current?.abort();
        jdAbortControllerRef.current = null;
        jdActiveTaskIdRef.current = null;
        setJdGenerationStatus("idle");
        setJdGenerationError("");
    }, [selectedPositionId, activePage]);

    const selectedCandidateDetailId = candidateDetail?.candidate.id ?? null;
    const selectedCandidateDetailReviewAssignmentId = candidateDetail?.department_review_context?.assignment?.id ?? null;

    useEffect(() => {
        if (activePage === "candidates" && candidateMenuSuppressStaleDetailRef.current) {
            candidateMenuSuppressStaleDetailRef.current = false;
        }
        if (!selectedCandidateId) {
            setCandidateDetail(null);
            checkedDuplicateCandidateIdRef.current = null;
            return;
        }
        const shouldLoadCandidateDetail = (
            activePage === "candidates"
            || activePage === "positions"
            || (activePage === "review-workbench" && candidateDetailReviewContext?.candidateId === selectedCandidateId)
            || talentPoolCandidateDetailOpen
        );
        if (!shouldLoadCandidateDetail) {
            return;
        }
        // 仅在详情真正可见时加载，避免 workspace 首屏预拉详情
        const isTalentPoolDetail = talentPoolCandidateDetailOpen && activePage === "talent-pool";
        const isReviewWorkbenchDetail = activePage === "review-workbench" && candidateDetailReviewContext?.candidateId === selectedCandidateId;
        const reviewAssignmentId = isReviewWorkbenchDetail ? candidateDetailReviewContext?.assignmentId ?? null : null;
        const shouldCheckDuplicates = !isTalentPoolDetail && !isReviewWorkbenchDetail && checkedDuplicateCandidateIdRef.current !== selectedCandidateId;
        const cachedDetailMatchesCurrentScope = selectedCandidateDetailId === selectedCandidateId
            && selectedCandidateDetailReviewAssignmentId === (isReviewWorkbenchDetail ? reviewAssignmentId : null);
        if (cachedDetailMatchesCurrentScope) {
            if (shouldCheckDuplicates && candidateDetail) {
                checkedDuplicateCandidateIdRef.current = selectedCandidateId;
                void checkDuplicatesForCandidate(candidateDetail);
            }
            return;
        }
        if (!isTalentPoolDetail && shouldCheckDuplicates) {
            checkedDuplicateCandidateIdRef.current = selectedCandidateId;
        }
        void loadCandidateDetail(selectedCandidateId, {
            includeDuplicates: shouldCheckDuplicates,
            skipChatContextSave: isTalentPoolDetail || isReviewWorkbenchDetail,
            reviewAssignmentId: reviewAssignmentId ?? null,
        });
    }, [activePage, candidateDetail, candidateDetailReviewContext?.assignmentId, candidateDetailReviewContext?.candidateId, selectedCandidateDetailId, selectedCandidateDetailReviewAssignmentId, selectedCandidateId, talentPoolCandidateDetailOpen]);

    useEffect(() => {
        if (!selectedLogId) {
            setSelectedLogDetail(null);
            return;
        }
        void loadLogDetail(selectedLogId);
    }, [selectedLogId]);

    // 切换到审计中心时，拉取最新日志
    useEffect(() => {
        const organizationScopeResolved = organizationCatalogStatus === "ready" || organizationCatalogStatus === "error";
        if (activePage === "audit" && organizationScopeResolved) {
            const scope = candidateListRefreshQueryRef.current;
            void loadLogs({
                silent: true,
                departmentScope: scope.departmentScope,
                orgScope: scope.orgScope,
            });
        }
    }, [activePage, organizationCatalogStatus]);

    useEffect(() => {
        if (activePage === "review-workbench") {
            void loadDepartmentReviewTasks();
        }
    }, [activePage, departmentReviewFilter]);

    useEffect(() => {
        if (activePage === "interviews") {
            void loadMyInterviewTasks();
            void loadMyInterviewAvailability({silent: true});
        }
    }, [activePage, interviewWorkbenchFilter]);

    useEffect(() => {
        if (activePage === "interviews" && canActInterview) {
            void loadMyInterviewCalendarTasks({silent: true});
        } else if (activePage !== "interviews" || !canActInterview) {
            setMyInterviewCalendarTasks([]);
        }
    }, [activePage, canActInterview]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setSkillSettingsPageIndex(0);
            setSkillSettingsQuery(skillSettingsQueryInput.trim());
        }, SETTINGS_SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [skillSettingsQueryInput]);

    useEffect(() => {
        const organizationScopeResolved = organizationCatalogStatus === "ready" || organizationCatalogStatus === "error";
        if (activePage !== "settings-skills" || !organizationScopeResolved) {
            return undefined;
        }
        const scopeChanged = skillSettingsScopeKeyRef.current !== activeBusinessOrgScopeKey;
        if (scopeChanged) {
            skillSettingsScopeKeyRef.current = activeBusinessOrgScopeKey;
            skillSettingsLoadAbortControllerRef.current?.abort();
            if (skillSettingsPageIndex !== 0) {
                setSkillSettingsPageIndex(0);
                return undefined;
            }
        }
        void loadSkillSettingsPage({pageIndex: skillSettingsPageIndex}).catch(() => undefined);
        return () => {
            skillSettingsLoadAbortControllerRef.current?.abort();
        };
        // 设置请求函数保持最新 state 闭包，并通过 requestId/AbortController 防止旧响应回写。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeBusinessOrgScopeKey, activePage, organizationCatalogStatus, skillSettingsPageIndex, skillSettingsQuery, skillSettingsTaskFilter]);

    useEffect(() => {
        const organizationScopeResolved = organizationCatalogStatus === "ready" || organizationCatalogStatus === "error";
        if (activePage !== "settings-mail" || !organizationScopeResolved) {
            return undefined;
        }
        if (!mailDispatchesScopeKeyRef.current) {
            mailDispatchesScopeKeyRef.current = activeBusinessOrgScopeKey;
        }
        void ensureMailSettingsLoaded().catch(() => undefined);
        return () => {
            mailSendersLoadAbortControllerRef.current?.abort();
            mailRecipientsLoadAbortControllerRef.current?.abort();
            mailDispatchesLoadAbortControllerRef.current?.abort();
            mailDispatchDetailLoadAbortControllerRef.current?.abort();
            mailAutoConfigLoadAbortControllerRef.current?.abort();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePage, organizationCatalogStatus]);

    useEffect(() => {
        const organizationScopeResolved = organizationCatalogStatus === "ready" || organizationCatalogStatus === "error";
        if (activePage !== "settings-mail" || !organizationScopeResolved) {
            return;
        }
        const scopeChanged = mailDispatchesScopeKeyRef.current !== activeBusinessOrgScopeKey;
        if (scopeChanged) {
            mailDispatchesScopeKeyRef.current = activeBusinessOrgScopeKey;
            mailDispatchesLoadAbortControllerRef.current?.abort();
            if (resumeMailDispatchPageIndex !== 0) {
                setResumeMailDispatchPageIndex(0);
                return;
            }
        }
        if (!mailDispatchesLoadedOnceRef.current && !scopeChanged) {
            return;
        }
        void loadMailDispatches({pageIndex: resumeMailDispatchPageIndex}).catch(() => undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeBusinessOrgScopeKey, activePage, organizationCatalogStatus, resumeMailDispatchPageIndex]);

    useEffect(() => {
        if (activePage !== "settings-models" || (!canViewLLMConfig && !canManageLLMConfig)) {
            return undefined;
        }
        void ensureLLMConfigsLoaded().catch(() => undefined);
        return () => {
            llmConfigsLoadAbortControllerRef.current?.abort();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePage, canManageLLMConfig, canViewLLMConfig]);

    useEffect(() => {
        if (!pageVisible || !isSettingsPage) {
            return undefined;
        }
        const reconcileActiveSettingsPage = () => {
            if (activePageRef.current === "settings-mail") {
                void loadMailSettings({silent: true}).catch(() => undefined);
                return;
            }
            if (activePageRef.current === "settings-models") {
                void loadLLMConfigs({silent: true}).catch(() => undefined);
                return;
            }
            if (activePageRef.current === "settings-skills") {
                void loadSkillSettingsPage({pageIndex: skillSettingsPageIndex, silent: true}).catch(() => undefined);
            }
        };
        const timer = window.setInterval(reconcileActiveSettingsPage, SETTINGS_RECONCILIATION_INTERVAL_MS);
        return () => window.clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        activeBusinessOrgScopeKey,
        isSettingsPage,
        pageVisible,
        resumeMailDispatchPageIndex,
        skillSettingsPageIndex,
        skillSettingsQuery,
        skillSettingsTaskFilter,
    ]);

    const scrollCandidateListToTop = useCallback(() => {
        const viewport = resolveScrollAreaViewport(candidateListScrollElRef.current);
        if (!viewport) {
            return;
        }
        viewport.scrollTo({
            top: 0,
            behavior: "auto",
        });
    }, []);

    useEffect(() => {
        candidateMatchSortOrderRef.current = candidateMatchSortOrder;
    }, [candidateMatchSortOrder]);

    const beginCandidateListTransition = useCallback(() => {
        if (activePageRef.current === "candidates" && candidatesInitialLoaded) {
            setCandidateListTransitionLoading(true);
            setCandidatesLoading(true);
        }
    }, [candidatesInitialLoaded]);

    const setCandidateQueryWithTransition = useCallback((value: string) => {
        beginCandidateListTransition();
        candidatePageIndexRef.current = 0;
        setCandidatePageIndex(0);
        setCandidateQuery(value);
    }, [beginCandidateListTransition]);

    const setCandidatePositionFilterWithTransition = useCallback<React.Dispatch<React.SetStateAction<string[]>>>((value) => {
        beginCandidateListTransition();
        candidatePageIndexRef.current = 0;
        setCandidatePageIndex(0);
        setCandidatePositionFilter(value);
    }, [beginCandidateListTransition]);

    const setCandidateStatusFilterWithTransition = useCallback<React.Dispatch<React.SetStateAction<string[]>>>((value) => {
        beginCandidateListTransition();
        candidatePageIndexRef.current = 0;
        setCandidatePageIndex(0);
        setCandidateStatusFilter(value);
    }, [beginCandidateListTransition]);

    const setCandidateSourceFilterWithTransition = useCallback<React.Dispatch<React.SetStateAction<string[]>>>((value) => {
        beginCandidateListTransition();
        candidatePageIndexRef.current = 0;
        setCandidatePageIndex(0);
        setCandidateSourceFilter(value);
    }, [beginCandidateListTransition]);

    const setCandidateMatchFilterWithTransition = useCallback<React.Dispatch<React.SetStateAction<string>>>((value) => {
        beginCandidateListTransition();
        candidatePageIndexRef.current = 0;
        setCandidatePageIndex(0);
        setCandidateMatchFilter(value);
    }, [beginCandidateListTransition]);

    const setCandidateTimeFilterWithTransition = useCallback<React.Dispatch<React.SetStateAction<string>>>((value) => {
        beginCandidateListTransition();
        candidatePageIndexRef.current = 0;
        setCandidatePageIndex(0);
        setCandidateTimeFilter(value);
    }, [beginCandidateListTransition]);

    const setCandidatePageIndexWithTransition = useCallback((nextPageIndex: number) => {
        const normalized = Math.max(0, nextPageIndex);
        beginCandidateListTransition();
        candidatePageIndexRef.current = normalized;
        setCandidatePageIndex(normalized);
    }, [beginCandidateListTransition]);

    const setCandidatePageSizeWithTransition = useCallback((nextPageSize: number) => {
        const normalized = CANDIDATE_LIST_PAGE_SIZE_OPTIONS.includes(nextPageSize)
            ? nextPageSize
            : CANDIDATE_LIST_PAGE_SIZE;
        beginCandidateListTransition();
        candidatePageIndexRef.current = 0;
        candidatePageSizeRef.current = normalized;
        setCandidatePageIndex(0);
        setCandidatePageSize(normalized);
    }, [beginCandidateListTransition]);

    useEffect(() => {
        if (bootstrapping || activePage !== "candidates") {
            return;
        }
        if (!candidatesInitialLoaded && candidatesLoading) {
            return;
        }
        const contextKey = buildCandidateListContextKey({
            useVisibleFilters: true,
            query: deferredCandidateQuery,
            sourceFilter: candidateSourceFilter,
            timeFilter: candidateTimeFilter,
            matchFilter: candidateMatchFilter,
            matchSortOrder: candidateMatchSortOrderRef.current,
            pageIndex: candidatePageIndex,
            pageSize: candidatePageSize,
        });
        const isFirstCandidatePage = candidatePageIndex === 0;
        const hasServerDrivenCandidateFilters = Boolean(
            deferredCandidateQuery.trim()
            || candidatePositionFilter.length
            || candidateStatusFilter.length
            || candidateSourceFilter.length
            || candidateTimeFilter !== "all"
            || candidateMatchFilter !== "all"
            || candidateMatchSortOrderRef.current
        );
        const cachedPage = candidateListPageCacheRef.current;
        const cachedPageFreshForContext = Boolean(
            cachedPage
            && cachedPage.contextKey === contextKey
            && Date.now() - cachedPage.loadedAt < CANDIDATE_LIST_CACHE_STALE_MS
        );
        if (cachedPageFreshForContext && cachedPage) {
            const currentItemsStillMatchContext = (
                candidateListUsingVisibleFiltersRef.current
                && candidateListContextKeyRef.current === contextKey
                && allCandidatesRef.current.length > 0
            );
            candidateListUsingVisibleFiltersRef.current = true;
            candidateListContextKeyRef.current = contextKey;
            applyCandidateListSnapshot(
                currentItemsStillMatchContext ? allCandidatesRef.current : cachedPage.items,
                currentItemsStillMatchContext ? candidateTotalRef.current : cachedPage.total,
            );
            setCandidatesInitialLoaded(true);
            setCandidatesLoading(false);
            setCandidateListTransitionLoading(false);
            return;
        }
        if (
            !hasServerDrivenCandidateFilters
            && isFirstCandidatePage
            && candidatesInitialLoaded
            && allCandidatesRef.current.length > 0
            && !candidateListUsingVisibleFiltersRef.current
            && Date.now() - candidateListPreloadLoadedAtRef.current < CANDIDATE_LIST_CACHE_STALE_MS
        ) {
            candidateListUsingVisibleFiltersRef.current = true;
            candidateListContextKeyRef.current = contextKey;
            candidateListPageCacheRef.current = {
                contextKey,
                items: allCandidatesRef.current,
                total: candidateTotalRef.current,
                loadedAt: candidateListPreloadLoadedAtRef.current,
            };
            setCandidateListTransitionLoading(false);
            setCandidatesLoading(false);
            return;
        }
        const transitionToken = candidateListTransitionTokenRef.current + 1;
        candidateListTransitionTokenRef.current = transitionToken;
        if (candidatesInitialLoaded) {
            setCandidateListTransitionLoading(true);
            setCandidatesLoading(true);
        }
        const timer = window.setTimeout(() => {
            scrollCandidateListToTop();
            void loadCandidates({
                silent: false,
                force: true,
                useVisibleFilters: true,
                query: deferredCandidateQuery,
                sourceFilter: candidateSourceFilter,
                timeFilter: candidateTimeFilter,
                matchFilter: candidateMatchFilter,
                matchSortOrder: candidateMatchSortOrderRef.current,
                pageIndex: candidatePageIndex,
                pageSize: candidatePageSize,
            }).catch((error) => {
                if (!isRecruitmentRequestAborted(error)) {
                    console.error("Failed to apply candidate filters:", error);
                }
            }).finally(() => {
                if (mountedRef.current && candidateListTransitionTokenRef.current === transitionToken) {
                    setCandidateListTransitionLoading(false);
                    setCandidatesLoading(false);
                }
            });
        }, 150);
        return () => window.clearTimeout(timer);
    }, [
        activePage,
        applyCandidateListSnapshot,
        bootstrapping,
        candidatePositionFilter,
        candidateStatusFilter,
        candidateSourceFilter,
        candidateTimeFilter,
        candidateMatchFilter,
        candidatePageIndex,
        candidatePageSize,
        candidatesInitialLoaded,
        candidatesLoading,
        deferredCandidateQuery,
        scrollCandidateListToTop,
    ]);

    const matchesActiveCandidateListFilters = useCallback((candidate: CandidateSummary) => {
        if (!candidateListUsingVisibleFiltersRef.current || activePageRef.current !== "candidates") {
            return true;
        }
        const activePositionId = candidatePositionFilter[0] || "";
        if (activePositionId && String(candidate.position_id || "") !== activePositionId) {
            return false;
        }
        const activeStatuses = candidateStatusFilter.map((item) => String(item || "").trim()).filter(Boolean);
        if (activeStatuses.length && !activeStatuses.includes(resolveCandidateDisplayStatus(candidate))) {
            return false;
        }
        const activeSources = candidateSourceFilter.map((item) => String(item || "").trim()).filter(Boolean);
        if (activeSources.length) {
            const source = String(candidate.source || "unknown");
            const matchesUnknown = !candidate.source && activeSources.some((item) => ["unknown", "未知来源", "__unknown__"].includes(item.toLowerCase()));
            if (!matchesUnknown && !activeSources.includes(source)) {
                return false;
            }
        }
        const match = Number(candidate.match_percent ?? 0);
        if (candidateMatchFilter === "80+" && match < 80) {
            return false;
        }
        if (candidateMatchFilter === "60+" && match < 60) {
            return false;
        }
        if (candidateMatchFilter === "40+" && match < 40) {
            return false;
        }
        if (candidateTimeFilter === "today" && !isToday(candidate.created_at)) {
            return false;
        }
        if (candidateTimeFilter === "7d" && !withinDays(candidate.created_at, 7)) {
            return false;
        }
        if (candidateTimeFilter === "30d" && !withinDays(candidate.created_at, 30)) {
            return false;
        }
        const normalizedQuery = candidateQuery.trim().toLowerCase();
        if (!normalizedQuery) {
            return true;
        }
        return [
            candidate.name,
            candidate.phone,
            candidate.email,
            candidate.current_company,
        ].some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
    }, [candidateMatchFilter, candidatePositionFilter, candidateQuery, candidateSourceFilter, candidateStatusFilter, candidateTimeFilter]);

    const syncRealtimeCandidateListsBatch = useCallback((updates: CandidateSnapshotBatchUpdate[]) => {
        const normalizedUpdates = updates
            .map((update) => {
                const candidateId = Number(update.snapshot?.id);
                if (!Number.isFinite(candidateId)) {
                    return null;
                }
                return {
                    ...update,
                    snapshot: { ...update.snapshot, id: candidateId } as Partial<CandidateSummary> & { id: number },
                };
            })
            .filter((item): item is CandidateSnapshotBatchUpdate & { snapshot: Partial<CandidateSummary> & { id: number } } => Boolean(item));
        if (!normalizedUpdates.length) {
            return;
        }

        const selectedComparisonIds = new Set(comparisonCandidateIdsRef.current);
        const selectedComparisonUpdates = normalizedUpdates.filter(({snapshot}) => selectedComparisonIds.has(snapshot.id));
        if (selectedComparisonUpdates.length) {
            comparisonInvalidationRevisionRef.current += 1;
            comparisonReconcileAttemptsRef.current = 0;
            setComparisonSelectionItems((current) => current.map((candidate) => {
                const update = selectedComparisonUpdates.find(({snapshot}) => snapshot.id === candidate.id);
                return update ? mergeCandidatePatch(candidate, update.snapshot) : candidate;
            }));
            setComparisonStale(true);
        }

        // 实时补丁只更新当前内存页；失效旧页快照，避免切页或返回页面时重新展示旧任务状态。
        candidateListPageCacheRef.current = null;
        candidateListPreloadLoadedAtRef.current = 0;
        let forceCandidateListRefresh = false;
        if (activePageRef.current === "candidates" && candidateListLoadAbortControllerRef.current) {
            candidatesLoadRequestIdRef.current += 1;
            candidateListLoadAbortControllerRef.current.abort();
            candidateListLoadAbortControllerRef.current = null;
            setCandidatesLoading(false);
            forceCandidateListRefresh = true;
        }
        armCandidateConsistencyPolling(CANDIDATE_CONSISTENCY_EVENT_WINDOW_MS, {
            forceRefresh: forceCandidateListRefresh,
        });

        let nextCandidates = allCandidatesRef.current;
        let nextTalentPoolCandidates = allTalentPoolCandidatesRef.current;
        let candidatesChanged = false;
        let talentPoolChanged = false;
        let candidateTotalDelta = 0;
        const statusTransitions: Array<{from: string; to: string; candidate: CandidateSummary}> = [];

        const ensureCandidatesCopy = () => {
            if (!candidatesChanged) {
                nextCandidates = [...nextCandidates];
                candidatesChanged = true;
            }
        };
        const ensureTalentPoolCopy = () => {
            if (!talentPoolChanged) {
                nextTalentPoolCandidates = [...nextTalentPoolCandidates];
                talentPoolChanged = true;
            }
        };
        const removeCandidateListItem = (candidateId: number) => {
            const index = nextCandidates.findIndex((candidate) => candidate.id === candidateId);
            if (index === -1) {
                return false;
            }
            ensureCandidatesCopy();
            nextCandidates.splice(index, 1);
            return true;
        };
        const removeTalentPoolItem = (candidateId: number) => {
            const index = nextTalentPoolCandidates.findIndex((candidate) => candidate.id === candidateId);
            if (index === -1) {
                return false;
            }
            ensureTalentPoolCopy();
            nextTalentPoolCandidates.splice(index, 1);
            return true;
        };
        const upsertTalentPoolItem = (candidate: CandidateSummary) => {
            const candidateId = Number(candidate.id);
            const index = nextTalentPoolCandidates.findIndex((item) => item.id === candidateId);
            if (index !== -1) {
                const merged = mergeCandidatePatch(nextTalentPoolCandidates[index], candidate);
                if (merged !== nextTalentPoolCandidates[index]) {
                    ensureTalentPoolCopy();
                    nextTalentPoolCandidates[index] = merged;
                }
                return;
            }
            ensureTalentPoolCopy();
            nextTalentPoolCandidates.unshift(candidate);
        };

        normalizedUpdates.forEach(({ snapshot, insertIntoCandidateList }) => {
            const candidateId = Number(snapshot.id);
            const candidateIndex = nextCandidates.findIndex((candidate) => candidate.id === candidateId);
            const talentPoolIndex = nextTalentPoolCandidates.findIndex((candidate) => candidate.id === candidateId);
            const currentItem = candidateIndex !== -1
                ? nextCandidates[candidateIndex]
                : talentPoolIndex !== -1
                    ? nextTalentPoolCandidates[talentPoolIndex]
                    : null;
            const nextItem = currentItem
                ? mergeCandidatePatch(currentItem, snapshot)
                : snapshot as CandidateSummary;
            if (currentItem) {
                const fromStatus = resolveCandidateDisplayStatus(currentItem);
                const toStatus = resolveCandidateDisplayStatus(nextItem);
                if (fromStatus && toStatus && fromStatus !== toStatus) {
                    statusTransitions.push({from: fromStatus, to: toStatus, candidate: currentItem});
                }
            }
            const hasCandidateStatus = Boolean(String(nextItem.status || "").trim());
            const shouldShowInCandidateList = hasCandidateStatus && shouldShowCandidateInPipelineList(nextItem);
            const shouldShowInTalentPoolList = hasCandidateStatus && shouldShowCandidateInTalentPoolList(nextItem);
            const matchesCurrentCandidateList = matchesActiveCandidateListFilters(nextItem);

            if (shouldShowInCandidateList && !matchesCurrentCandidateList) {
                if (removeCandidateListItem(candidateId)) {
                    candidateTotalDelta -= 1;
                }
                if (shouldShowInTalentPoolList) {
                    upsertTalentPoolItem(nextItem);
                } else {
                    removeTalentPoolItem(candidateId);
                }
                return;
            }

            if (shouldShowInCandidateList) {
                if (candidateIndex !== -1) {
                    const merged = mergeCandidatePatch(nextCandidates[candidateIndex], nextItem);
                    if (merged !== nextCandidates[candidateIndex]) {
                        ensureCandidatesCopy();
                        nextCandidates[candidateIndex] = merged;
                    }
                } else if (insertIntoCandidateList) {
                    ensureCandidatesCopy();
                    nextCandidates.unshift(nextItem);
                    candidateTotalDelta += 1;
                }
                if (shouldShowInTalentPoolList) {
                    upsertTalentPoolItem(nextItem);
                } else {
                    removeTalentPoolItem(candidateId);
                }
                return;
            }

            if (removeCandidateListItem(candidateId)) {
                candidateTotalDelta -= 1;
            }

            if (!shouldShowInTalentPoolList) {
                return;
            }

            upsertTalentPoolItem(nextItem);
        });

        if (candidatesChanged) {
            allCandidatesRef.current = nextCandidates;
            setAllCandidates(nextCandidates);
            setCandidates(filterBusinessRowsByOrgCodes(nextCandidates, activeBusinessOrgCodes, businessRowFilterOptions));
        }
        if (talentPoolChanged) {
            allTalentPoolCandidatesRef.current = nextTalentPoolCandidates;
            setAllTalentPoolCandidates(nextTalentPoolCandidates);
        }
        if (candidateTotalDelta !== 0) {
            const nextTotal = Math.max(0, candidateTotalRef.current + candidateTotalDelta);
            candidateTotalRef.current = nextTotal;
            setCandidateTotal(nextTotal);
        }
        if (statusTransitions.length) {
            const applyTransitions = (current: CandidateStatsData | null) => (
                statusTransitions.reduce(
                    (stats, transition) => moveCandidateStatsDisplayStatus(stats, transition.candidate, transition.from, transition.to),
                    current,
                )
            );
            setCandidateStatsData(applyTransitions);
            setCandidatePipelineStatsData(applyTransitions);
        }
    }, [activeBusinessOrgCodes, armCandidateConsistencyPolling, businessRowFilterOptions, matchesActiveCandidateListFilters]);

    const syncRealtimeCandidateLists = useCallback((
        snapshot?: Partial<CandidateSummary> | null,
        options?: { insertIntoCandidateList?: boolean },
    ) => {
        if (!snapshot?.id) {
            return;
        }
        syncRealtimeCandidateListsBatch([{
            snapshot,
            insertIntoCandidateList: options?.insertIntoCandidateList,
        }]);
    }, [syncRealtimeCandidateListsBatch]);

    const applyCandidateDetailSnapshot = useCallback((snapshot?: Partial<CandidateSummary> | null) => {
        if (!snapshot?.id) {
            return;
        }
        const candidateId = Number(snapshot.id);
        if (!Number.isFinite(candidateId)) {
            return;
        }
        setCandidateDetail((current) => {
            if (!current || current.candidate.id !== candidateId) {
                return current;
            }
            return {
                ...current,
                candidate: {
                    ...current.candidate,
                    ...snapshot,
                    id: candidateId,
                },
            };
        });
    }, []);

    const applyCandidateDetailSnapshotsBatch = useCallback((snapshots: Partial<CandidateSummary>[]) => {
        if (!snapshots.length) {
            return;
        }
        const latestByCandidateId = coalesceCandidatePatchesById(snapshots);
        if (!latestByCandidateId.size) {
            return;
        }
        setCandidateDetail((current) => {
            if (!current) {
                return current;
            }
            const patch = latestByCandidateId.get(current.candidate.id);
            if (!patch) {
                return current;
            }
            const nextCandidate = mergeCandidatePatch(current.candidate, patch);
            if (nextCandidate === current.candidate) {
                return current;
            }
            return {
                ...current,
                candidate: nextCandidate,
            };
        });
    }, []);

    const applyCandidateReasonUpdatesBatch = useCallback((updates: Map<number, string>) => {
        if (!updates.size) {
            return;
        }
        let nextCandidates = allCandidatesRef.current;
        let changed = false;
        updates.forEach((reason, candidateId) => {
            const index = nextCandidates.findIndex((candidate) => candidate.id === candidateId);
            if (index === -1 || nextCandidates[index].display_status_reason === reason) {
                return;
            }
            if (!changed) {
                nextCandidates = [...nextCandidates];
                changed = true;
            }
            nextCandidates[index] = {
                ...nextCandidates[index],
                display_status_reason: reason,
            };
        });
        if (changed) {
            allCandidatesRef.current = nextCandidates;
            setAllCandidates(nextCandidates);
        }
    }, []);

    const applyScreeningAutoRequeueUpdatesBatch = useCallback((updates: Map<number, TaskSSEEvent>) => {
        if (!updates.size) {
            return;
        }
        let nextCandidates = allCandidatesRef.current;
        let changed = false;
        updates.forEach((event, candidateId) => {
            const index = nextCandidates.findIndex((candidate) => candidate.id === candidateId);
            if (index === -1) {
                return;
            }
            const patch: Partial<CandidateSummary> = {
                active_screening_task_id: event.task_id ?? nextCandidates[index].active_screening_task_id,
                active_screening_task_type: event.task_type ?? nextCandidates[index].active_screening_task_type,
                active_screening_task_status: "queued",
                active_screening_status: "queued",
                active_screening_stage: "queued",
                active_screening_auto_retry_scheduled: true,
            };
            const merged = mergeCandidatePatch(nextCandidates[index], patch);
            if (merged === nextCandidates[index]) {
                return;
            }
            if (!changed) {
                nextCandidates = [...nextCandidates];
                changed = true;
            }
            nextCandidates[index] = merged;
        });
        if (changed) {
            allCandidatesRef.current = nextCandidates;
            setAllCandidates(nextCandidates);
        }
    }, []);

    const scheduleCandidateStatsRefresh = useCallback(() => {
        candidateStatsRefreshPendingRef.current = true;
        if (candidateStatsRefreshTimerRef.current != null || candidateStatsRefreshInFlightRef.current) {
            return;
        }
        candidateStatsRefreshTimerRef.current = window.setTimeout(() => {
            candidateStatsRefreshTimerRef.current = null;
            if (!mountedRef.current) {
                return;
            }
            candidateStatsRefreshPendingRef.current = false;
            candidateStatsRefreshInFlightRef.current = true;
            const query = candidateListRefreshQueryRef.current;
            void Promise.all([
                refreshCandidateStatsRef.current(query.departmentScope, query.orgScope),
                activePageRef.current === "candidates" ? loadCandidatePositionsRef.current({force: true}) : Promise.resolve(),
            ]).finally(() => {
                candidateStatsRefreshInFlightRef.current = false;
                if (mountedRef.current && candidateStatsRefreshPendingRef.current) {
                    scheduleCandidateStatsRefresh();
                }
            });
        }, 800);
    }, []);

    const flushPendingCandidateUpdatedEvents = useCallback(() => {
        candidateUpdateBatchTimerRef.current = null;
        const events = pendingCandidateUpdateEventsRef.current;
        pendingCandidateUpdateEventsRef.current = [];
        if (!events.length) {
            return;
        }

        const listUpdates: CandidateSnapshotBatchUpdate[] = [];
        const detailSnapshots: Partial<CandidateSummary>[] = [];
        const reasonUpdates = new Map<number, string>();
        const autoRequeueUpdates = new Map<number, TaskSSEEvent>();
        const aiPositionNoSnapshotEvents: TaskSSEEvent[] = [];
        const detailLoadCandidateIds = new Set<number>();

        events.forEach((event) => {
            const isRootScreeningTask = event.task_type === "screening_flow";
            const isAIPositionTask = Boolean(event.task_type?.startsWith("ai_position"));
            const isTerminalScreeningTask = isRootScreeningTask
                && TERMINAL_SCREENING_TASK_STATUSES.has(String(event.status || "").trim().toLowerCase());
            const sanitizedCandidateSnapshot = isTerminalScreeningTask
                ? sanitizeTerminalScreeningCandidateSnapshot(event.candidate_snapshot, event.status)
                : event.candidate_snapshot;
            if (sanitizedCandidateSnapshot) {
                const nextSnapshot = event.screening_enqueue_failed
                    ? {
                        ...sanitizedCandidateSnapshot,
                        display_status_reason: event.error_message || "自动初筛入队失败，请稍后重试",
                    }
                    : sanitizedCandidateSnapshot;
                if (isRootScreeningTask || isAIPositionTask) {
                    const nextStatus = String(event.status || sanitizedCandidateSnapshot.status || "").trim().toLowerCase();
                    listUpdates.push({
                        snapshot: nextSnapshot,
                        insertIntoCandidateList: isAIPositionTask
                            ? shouldShowCandidateInPipelineList(nextSnapshot as CandidateSummary)
                            : (nextStatus === "pending_screening" || nextStatus === "screening_running"),
                    });
                }
                detailSnapshots.push(nextSnapshot);
            } else if (event.candidate_id && event.screening_enqueue_failed) {
                reasonUpdates.set(
                    event.candidate_id,
                    event.error_message || "自动初筛入队失败，请稍后重试",
                );
            }
            if (event.candidate_id && event.task_type === "screening_flow" && event.auto_requeue_scheduled) {
                if (!event.candidate_snapshot) {
                    autoRequeueUpdates.set(event.candidate_id, event);
                }
                return;
            }
            if (event.candidate_id && event.task_type?.startsWith("ai_position")) {
                if (!event.candidate_snapshot) {
                    aiPositionNoSnapshotEvents.push(event);
                }
                if (
                    selectedCandidateIdRef.current === event.candidate_id
                    && (activePage === "candidates" || activePage === "positions" || talentPoolCandidateDetailOpen)
                ) {
                    detailLoadCandidateIds.add(event.candidate_id);
                }
            }
        });

        syncRealtimeCandidateListsBatch(listUpdates);
        applyCandidateDetailSnapshotsBatch(detailSnapshots);
        applyCandidateReasonUpdatesBatch(reasonUpdates);
        applyScreeningAutoRequeueUpdatesBatch(autoRequeueUpdates);
        if (
            listUpdates.length > 0
            || detailSnapshots.length > 0
            || reasonUpdates.size > 0
            || autoRequeueUpdates.size > 0
            || aiPositionNoSnapshotEvents.length > 0
        ) {
            scheduleCandidateStatsRefresh();
        }

        aiPositionNoSnapshotEvents.forEach((event) => {
            const newStatus = event.status;
            if (newStatus === "pending_screening" || newStatus === "screening_running") {
                const existingTalentPoolCandidate = allTalentPoolCandidatesRef.current.find((candidate) => candidate.id === event.candidate_id);
                if (existingTalentPoolCandidate) {
                    syncRealtimeCandidateLists({
                        ...existingTalentPoolCandidate,
                        status: newStatus,
                        ai_match_position_id: event.ai_match_position_id ?? existingTalentPoolCandidate.ai_match_position_id,
                        ai_match_position_title: event.ai_match_position_title ?? existingTalentPoolCandidate.ai_match_position_title,
                        ai_match_reason: event.ai_match_reason ?? existingTalentPoolCandidate.ai_match_reason,
                        ai_potential_position: event.ai_potential_position ?? existingTalentPoolCandidate.ai_potential_position,
                        ai_potential_reason: event.ai_potential_reason ?? existingTalentPoolCandidate.ai_potential_reason,
                    }, { insertIntoCandidateList: true });
                } else {
                    setAllTalentPoolCandidates((current) => current.filter((candidate) => candidate.id !== event.candidate_id));
                }
            } else {
                setAllTalentPoolCandidates((current) => current.map((candidate) => (
                    candidate.id === event.candidate_id
                        ? {
                            ...candidate,
                            status: newStatus ?? candidate.status,
                            ai_match_position_id: event.ai_match_position_id ?? candidate.ai_match_position_id,
                            ai_match_position_title: event.ai_match_position_title ?? candidate.ai_match_position_title,
                            ai_match_reason: event.ai_match_reason ?? candidate.ai_match_reason,
                            ai_potential_position: event.ai_potential_position ?? candidate.ai_potential_position,
                            ai_potential_reason: event.ai_potential_reason ?? candidate.ai_potential_reason,
                        }
                        : candidate
                )));
            }
        });
        detailLoadCandidateIds.forEach((candidateId) => {
            void loadCandidateDetail(candidateId, { silent: true, force: true, skipChatContextSave: true });
        });
    }, [
        activePage,
        applyCandidateDetailSnapshotsBatch,
        applyCandidateReasonUpdatesBatch,
        applyScreeningAutoRequeueUpdatesBatch,
        scheduleCandidateStatsRefresh,
        syncRealtimeCandidateLists,
        syncRealtimeCandidateListsBatch,
        talentPoolCandidateDetailOpen,
    ]);

    const queueCandidateUpdatedEvent = useCallback((event: TaskSSEEvent) => {
        pendingCandidateUpdateEventsRef.current.push(event);
        if (candidateUpdateBatchTimerRef.current != null) {
            return;
        }
        candidateUpdateBatchTimerRef.current = window.setTimeout(
            flushPendingCandidateUpdatedEvents,
            CANDIDATE_SSE_BATCH_WINDOW_MS,
        );
    }, [flushPendingCandidateUpdatedEvents]);

    useTaskSSE(
        taskSSEEnabled,
        {
            onConnected: ({reconnected}) => {
                armCandidateConsistencyPolling(CANDIDATE_CONSISTENCY_EVENT_WINDOW_MS, {forceRefresh: true});
                if (reconnected) {
                    scheduleCandidateStatsRefresh();
                }
            },
            onTaskCompleted: (event) => {
                armCandidateConsistencyPolling();
                const isRootScreeningTask = event.task_type === "screening_flow";
                const isTerminalScreeningTask = isRootScreeningTask
                    && TERMINAL_SCREENING_TASK_STATUSES.has(String(event.status || "").trim().toLowerCase());
                const sanitizedCandidateSnapshot = isTerminalScreeningTask
                    ? sanitizeTerminalScreeningCandidateSnapshot(event.candidate_snapshot, event.status)
                    : event.candidate_snapshot;
                if (event.task_id) {
                    stopTaskMonitor(event.task_id);
                    if (event.related_candidate_id) {
                        clearActiveScreeningTask(event.related_candidate_id, event.task_id);
                    }
                }
                if (event.related_candidate_id && isTerminalScreeningTask) {
                    recentlyCompletedScreeningCandidatesRef.current.set(event.related_candidate_id, Date.now());
                    scheduleCandidateStatsRefresh();
                }
                if (sanitizedCandidateSnapshot) {
                    applyCandidateDetailSnapshot(sanitizedCandidateSnapshot);
                    if (isRootScreeningTask) {
                        syncRealtimeCandidateLists(sanitizedCandidateSnapshot, {insertIntoCandidateList: true});
                        scheduleCandidateStatsRefresh();
                    }
                } else if (event.related_candidate_id && isTerminalScreeningTask) {
                    void refreshActiveCandidateList({ silent: true }).catch(() => {});
                    scheduleCandidateStatsRefresh();
                }
                if (event.related_candidate_id && event.task_type === "screening_flow") {
                    const failedLike = new Set(["failed", "invalid_result", "json_parse_failed", "timeout", "retry_exhausted", "quota_exceeded", "rate_limited", "upstream_timeout", "request_failed", "screening_rule_invalid", "resume_text_unavailable"]);
                    if (!event.candidate_snapshot) {
                        setAllCandidates((current) => {
                            let changed = false;
                            const next = current.map((candidate) => {
                                if (candidate.id !== event.related_candidate_id) {
                                    return candidate;
                                }
                                const failed = failedLike.has(String(event.status || "").trim());
                                const nextCandidate = mergeCandidatePatch(candidate, {
                                    status: failed ? "screening_failed" : candidate.status,
                                    display_status: failed ? "screening_failed" : candidate.display_status,
                                    display_status_reason: failed
                                        ? sanitizeCandidateFacingErrorText(event.status || "", { context: "screening", language })
                                        : candidate.display_status_reason,
                                    active_screening_task_id: null,
                                    active_screening_task_type: null,
                                    active_screening_task_status: "",
                                    active_screening_status: "",
                                    active_screening_stage: "",
                                    active_screening_auto_retry_scheduled: false,
                                });
                                if (nextCandidate !== candidate) {
                                    changed = true;
                                }
                                return nextCandidate;
                            });
                            return changed ? next : current;
                        });
                        setCandidateDetail((current) => {
                            if (!current || current.candidate.id !== event.related_candidate_id) {
                                return current;
                            }
                            const failed = failedLike.has(String(event.status || "").trim());
                            const nextCandidate = mergeCandidatePatch(current.candidate, {
                                status: failed ? "screening_failed" : current.candidate.status,
                                display_status: failed ? "screening_failed" : current.candidate.display_status,
                                display_status_reason: failed
                                    ? sanitizeCandidateFacingErrorText(event.status || "", { context: "screening", language })
                                    : current.candidate.display_status_reason,
                                active_screening_run_id: null,
                                active_screening_task_id: null,
                                active_screening_task_type: null,
                                active_screening_task_status: null,
                                active_screening_status: null,
                                active_screening_stage: null,
                                active_screening_auto_retry_scheduled: false,
                            });
                            if (nextCandidate === current.candidate) {
                                return current;
                            }
                            return {
                                ...current,
                                candidate: nextCandidate,
                            };
                        });
                    }
                    if (
                        selectedCandidateIdRef.current === event.related_candidate_id
                        && (event.candidate_snapshot || failedLike.has(String(event.status || "").trim()))
                        && (activePage === "candidates" || activePage === "positions" || talentPoolCandidateDetailOpen)
                    ) {
                        void loadCandidateDetail(event.related_candidate_id, { silent: true, force: true, skipChatContextSave: true });
                    }
                }
            },
            onCandidateUpdated: (event) => {
                armCandidateConsistencyPolling();
                queueCandidateUpdatedEvent(event);
                if (event.task_type === "department_review" && activePageRef.current === "review-workbench") {
                    void loadDepartmentReviewTasks({silent: true});
                }
                if (event.task_type === "interview_schedule" && activePageRef.current === "interviews") {
                    void loadMyInterviewTasks({silent: true});
                    if (canActInterview) {
                        void loadMyInterviewCalendarTasks({silent: true});
                    }
                    void loadMyInterviewAvailability({silent: true});
                    const assignedInterviewer = String(event.interviewer_user_code || "").trim();
                    if (
                        assignedInterviewer
                        && assignedInterviewer === String(sessionUser?.id || "").trim()
                        && event.schedule_status === "scheduled"
                    ) {
                        toast.info(isZh ? "收到新的面试安排" : "New interview scheduled");
                    }
                }
            },
            onBatchSummary: () => {
                void refreshActiveCandidateList({ silent: true }).catch(() => {});
                scheduleCandidateStatsRefresh();
            },
            // onTaskProgress 移除：审计日志不在初筛过程中实时更新
        },
    );

    useEffect(() => {
        const candidatePageActiveVisible = (
            activePage === "candidates"
            && pageVisible
            && candidatesInitialLoaded
        );
        const becameActiveVisible = candidatePageActiveVisible && !candidatePageActiveVisibleRef.current;
        candidatePageActiveVisibleRef.current = candidatePageActiveVisible;
        if (becameActiveVisible) {
            armCandidateConsistencyPolling(CANDIDATE_CONSISTENCY_ACTIVATION_WINDOW_MS, {forceRefresh: true});
        }
    }, [activePage, armCandidateConsistencyPolling, candidatesInitialLoaded, pageVisible]);

    useEffect(() => {
        const initialPollInterval = resolveCandidateConsistencyPollIntervalMs({
            candidatePageActive: activePage === "candidates",
            pageVisible,
            candidatesLoaded: candidatesInitialLoaded,
            hasVisibleLiveTask: visibleLiveScreeningTaskIds.length > 0,
            hasActiveBatchTask: activeBatchScreeningTaskIds.length > 0,
            runningCandidateCount: candidateConsistencyRunningCount,
            runningCountConfirmedUntil: candidateConsistencyRunningStatsUntilRef.current,
            pollUntil: candidateConsistencyPollUntilRef.current,
            now: Date.now(),
        }, {
            fast: CANDIDATE_CONSISTENCY_POLL_INTERVAL_MS,
            idle: CANDIDATE_CONSISTENCY_IDLE_POLL_INTERVAL_MS,
        });
        if (initialPollInterval == null) {
            return;
        }

        let stopped = false;
        let timer: number | null = null;
        const reconcileCurrentCandidatePage = async () => {
            if (
                stopped
                || candidateConsistencyRefreshInFlightRef.current
                || candidateListLoadAbortControllerRef.current
            ) {
                return;
            }
            candidateConsistencyRefreshInFlightRef.current = true;
            candidateConsistencyForceRefreshRef.current = false;
            try {
                const query = candidateListRefreshQueryRef.current;
                const shouldRefreshAggregates = Date.now() >= candidateConsistencyFullRefreshAtRef.current;
                if (shouldRefreshAggregates) {
                    candidateConsistencyFullRefreshAtRef.current = Date.now() + CANDIDATE_CONSISTENCY_FULL_REFRESH_INTERVAL_MS;
                }
                const refreshes: Promise<unknown>[] = [
                    refreshActiveCandidateListRef.current({silent: true}),
                ];
                if (shouldRefreshAggregates) {
                    refreshes.push(
                        refreshCandidateStatsRef.current(query.departmentScope, query.orgScope),
                        loadCandidatePositionsRef.current({force: true}),
                    );
                } else {
                    refreshes.push(refreshCandidatePipelineStatsRef.current(
                        query.departmentScope,
                        query.orgScope,
                        query.positionFilter[0] || "",
                    ));
                }
                await Promise.allSettled(refreshes);
            } catch {
                // SSE 和下一次列表级轮询继续兜底，避免一次网络失败中断最终一致性。
            } finally {
                candidateConsistencyRefreshInFlightRef.current = false;
            }
        };

        const scheduleNextReconcile = () => {
            if (stopped) {
                return;
            }
            const nextInterval = resolveCandidateConsistencyPollIntervalMs({
                candidatePageActive: activePageRef.current === "candidates",
                pageVisible: pageVisibleRef.current,
                candidatesLoaded: candidatesInitialLoaded,
                hasVisibleLiveTask: visibleLiveScreeningTaskIds.length > 0,
                hasActiveBatchTask: activeBatchScreeningTaskIds.length > 0,
                runningCandidateCount: candidateConsistencyRunningCount,
                runningCountConfirmedUntil: candidateConsistencyRunningStatsUntilRef.current,
                pollUntil: candidateConsistencyPollUntilRef.current,
                now: Date.now(),
            }, {
                fast: CANDIDATE_CONSISTENCY_POLL_INTERVAL_MS,
                idle: CANDIDATE_CONSISTENCY_IDLE_POLL_INTERVAL_MS,
            });
            if (nextInterval == null) {
                return;
            }
            timer = window.setTimeout(async () => {
                await reconcileCurrentCandidatePage();
                scheduleNextReconcile();
            }, nextInterval);
        };

        if (candidateConsistencyForceRefreshRef.current) {
            void reconcileCurrentCandidatePage();
        }
        scheduleNextReconcile();

        return () => {
            stopped = true;
            if (timer != null) {
                window.clearTimeout(timer);
            }
        };
    }, [
        activeBatchScreeningTaskIds.length,
        activePage,
        candidateConsistencyPollEpoch,
        candidatePageIndex,
        candidatePageSize,
        candidateSelectionScopeKey,
        candidateConsistencyRunningCount,
        candidatesInitialLoaded,
        pageVisible,
        visibleLiveScreeningTaskIds.length,
    ]);

    useEffect(() => {
        const current = positionDetail?.current_jd_version;
        const contextKey = `${positionDetail?.position.id || "none"}:${current?.id || "none"}`;
        if (jdDraftContextKeyRef.current === contextKey) {
            return;
        }
        jdDraftContextKeyRef.current = contextKey;
        setJdDraft({
            title: current?.title || `${positionDetail?.position.title || (isZh ? "岗位" : "Position")} JD`,
            jdMarkdown: current?.jd_markdown || "",
            notes: current?.notes || "",
            autoActivate: true,
        });
        setJdGeneratedDraftUnsaved(false);
        setJdUnsavedCloseConfirmOpen(false);
        setJdUnsavedExitIntent(null);
    }, [positionDetail]);

    useEffect(() => {
        const candidate = candidateDetail?.candidate;
        const score = candidateDetail?.score;
        setCandidateEditor({
            name: candidate?.name || "",
            phone: candidate?.phone || "",
            email: candidate?.email || "",
            currentCompany: candidate?.current_company || "",
            yearsOfExperience: candidate?.years_of_experience || "",
            education: candidate?.education || "",
            age: candidate?.age != null ? String(candidate.age) : "",
            city: candidate?.city || "",
            expectedCity: candidate?.expected_city || "",
            notes: candidate?.notes || "",
            tagsText: joinTags(candidate?.tags),
            manualOverrideScore: score?.manual_override_score != null ? String(score.manual_override_score) : "",
            manualOverrideReason: score?.manual_override_reason || "",
            hrFeedback: score?.hr_feedback || "",
            hrFeedbackReason: score?.hr_feedback_reason || "",
            ownerId: candidate?.owner_id || "",
            positionId: candidate?.position_id != null ? String(candidate.position_id) : "",
        });
    }, [candidateDetail]);

    useEffect(() => {
        const shouldCheckDuplicates = (
            activePage === "candidates"
            || activePage === "positions"
            || talentPoolCandidateDetailOpen
        );
        if (!shouldCheckDuplicates) {
            setDuplicateCandidates([]);
        }
    }, [activePage, talentPoolCandidateDetailOpen]);

    useEffect(() => {
        setSelectedInterviewSkillIds([]);
        setInterviewSkillSelectionDirty(false);
        setCandidateProcessLogsExpanded(false);
        const shouldLoadCandidateSideData = (
            activePage === "candidates"
            || activePage === "positions"
            || (activePage === "review-workbench" && candidateDetailReviewContext?.candidateId === selectedCandidateId)
            || talentPoolCandidateDetailOpen
        );
        if (selectedCandidateId && shouldLoadCandidateSideData) {
            if (activePage === "talent-pool" && talentPoolCandidateDetailOpen) {
                const deferredCandidateId = selectedCandidateId;
                const timer = window.setTimeout(() => {
                    if (selectedCandidateIdRef.current !== deferredCandidateId || !talentPoolCandidateDetailOpen) {
                        return;
                    }
                    void loadInterviewSchedules(deferredCandidateId);
                    void loadOffers(deferredCandidateId);
                    void loadFollowUps(deferredCandidateId);
                    void loadDepartmentReviews(deferredCandidateId);
                }, 260);
                return () => window.clearTimeout(timer);
            }
            if (activePage === "review-workbench" && candidateDetailReviewContext?.candidateId === selectedCandidateId) {
                void loadInterviewSchedules(selectedCandidateId);
                void loadDepartmentReviews(selectedCandidateId, {reviewAssignmentId: candidateDetailReviewContext.assignmentId});
                setOffers([]);
                setFollowUps([]);
                return;
            }
            void loadInterviewSchedules(selectedCandidateId);
            void loadOffers(selectedCandidateId);
            void loadFollowUps(selectedCandidateId);
            void loadDepartmentReviews(selectedCandidateId);
        } else {
            setInterviewSchedules([]);
            setOffers([]);
            setFollowUps([]);
            setDepartmentReviews([]);
        }
    }, [activePage, candidateDetailReviewContext?.assignmentId, candidateDetailReviewContext?.candidateId, selectedCandidateId, talentPoolCandidateDetailOpen]);

    useEffect(() => {
        if (activePage !== "assistant") {
            return;
        }
        void loadChatContext();
    }, [activePage]);

    useEffect(() => {
        if (candidateViewMode !== "list" || !candidateListScrollEl) {
            setCandidateListViewportWidth(0);
            return;
        }

        const updateWidth = () => setCandidateListViewportWidth(candidateListScrollEl.clientWidth);
        updateWidth();

        if (typeof ResizeObserver === "undefined") {
            window.addEventListener("resize", updateWidth);
            return () => window.removeEventListener("resize", updateWidth);
        }

        const observer = new ResizeObserver(() => updateWidth());
        observer.observe(candidateListScrollEl);
        return () => observer.disconnect();
    }, [candidateViewMode, candidateListScrollEl]);

    useEffect(() => {
        if (!auditListScrollEl) {
            setAuditListViewportWidth(0);
            return;
        }

        const updateWidth = () => setAuditListViewportWidth(auditListScrollEl.clientWidth);
        updateWidth();

        if (typeof ResizeObserver === "undefined") {
            window.addEventListener("resize", updateWidth);
            return () => window.removeEventListener("resize", updateWidth);
        }

        const observer = new ResizeObserver(() => updateWidth());
        observer.observe(auditListScrollEl);
        return () => observer.disconnect();
    }, [auditListScrollEl]);

    useEffect(() => {
        if (activePage !== "audit" || !auditListScrollEl) {
            return;
        }
        const measureAuditListWidth = () => {
            setAuditListViewportWidth(auditListScrollEl.clientWidth);
        };
        measureAuditListWidth();
        const frameId = window.requestAnimationFrame(measureAuditListWidth);
        return () => window.cancelAnimationFrame(frameId);
    }, [activePage, auditListScrollEl]);

    useEffect(() => {
        if (candidateViewMode !== "list") return;
        const targets = [candidateListScrollEl, candidateListHorizontalRailEl]
            .filter((node): node is HTMLDivElement => Boolean(node));
        if (!targets.length) return;
        const cleanups = targets.map((container) => {
            const handleWheel = (event: WheelEvent) => {
                if (!event.shiftKey) return;
                event.preventDefault();
                event.stopPropagation();
                if (container.scrollWidth <= container.clientWidth) return;
                const delta = Math.abs(event.deltaX) > 0 ? event.deltaX : event.deltaY;
                if (!delta) return;
                container.scrollLeft += delta;
            };
            container.addEventListener("wheel", handleWheel, {passive: false, capture: true});
            return () => container.removeEventListener("wheel", handleWheel, true);
        });
        return () => cleanups.forEach((cleanup) => cleanup());
    }, [candidateViewMode, candidateListScrollEl, candidateListHorizontalRailEl]);

    useEffect(() => {
        const tableScroller = candidateListScrollEl;
        const horizontalRail = candidateListHorizontalRailEl;
        if (!tableScroller || !horizontalRail || candidateViewMode !== "list") {
            return;
        }

        const releaseLock = (owner: "table" | "rail") => {
            requestAnimationFrame(() => {
                if (candidateListScrollSyncLockRef.current === owner) {
                    candidateListScrollSyncLockRef.current = null;
                }
            });
        };

        const syncScrollLeft = (
            owner: "table" | "rail",
            source: HTMLDivElement,
            target: HTMLDivElement,
        ) => {
            if (candidateListScrollSyncLockRef.current && candidateListScrollSyncLockRef.current !== owner) {
                return;
            }
            const nextScrollLeft = source.scrollLeft;
            if (Math.abs(target.scrollLeft - nextScrollLeft) < 1) {
                return;
            }
            candidateListScrollSyncLockRef.current = owner;
            target.scrollLeft = nextScrollLeft;
            releaseLock(owner);
        };

        const syncFromTable = () => {
            syncScrollLeft("table", tableScroller, horizontalRail);
        };

        const syncFromRail = () => {
            syncScrollLeft("rail", horizontalRail, tableScroller);
        };

        tableScroller.addEventListener("scroll", syncFromTable, {passive: true});
        horizontalRail.addEventListener("scroll", syncFromRail, {passive: true});
        horizontalRail.scrollLeft = tableScroller.scrollLeft;

        return () => {
            candidateListScrollSyncLockRef.current = null;
            tableScroller.removeEventListener("scroll", syncFromTable);
            horizontalRail.removeEventListener("scroll", syncFromRail);
        };
    }, [candidateViewMode, candidateListScrollEl, candidateListHorizontalRailEl]);

    useEffect(() => {
        const tableScroller = auditListScrollEl;
        const horizontalRail = auditListHorizontalRailEl;

        if (!tableScroller || !horizontalRail) {
            return;
        }

        const releaseLock = (owner: "table" | "rail") => {
            requestAnimationFrame(() => {
                if (auditListScrollSyncLockRef.current === owner) {
                    auditListScrollSyncLockRef.current = null;
                }
            });
        };

        const handleTableWheel = (event: WheelEvent) => {
            if (!event.shiftKey) return;
            if (tableScroller.scrollWidth <= tableScroller.clientWidth) return;

            const delta = Math.abs(event.deltaX) > 0 ? event.deltaX : event.deltaY;
            if (!delta) return;

            event.preventDefault();
            event.stopPropagation();
            tableScroller.scrollLeft += delta;
        };

        const handleRailWheel = (event: WheelEvent) => {
            if (!event.shiftKey) return;
            if (horizontalRail.scrollWidth <= horizontalRail.clientWidth) return;

            const delta = Math.abs(event.deltaX) > 0 ? event.deltaX : event.deltaY;
            if (!delta) return;

            event.preventDefault();
            event.stopPropagation();
            horizontalRail.scrollLeft += delta;
        };

        const syncFromTable = () => {
            if (auditListScrollSyncLockRef.current === "rail") return;
            auditListScrollSyncLockRef.current = "table";
            horizontalRail.scrollLeft = tableScroller.scrollLeft;
            releaseLock("table");
        };

        const syncFromRail = () => {
            if (auditListScrollSyncLockRef.current === "table") return;
            auditListScrollSyncLockRef.current = "rail";
            tableScroller.scrollLeft = horizontalRail.scrollLeft;
            releaseLock("rail");
        };

        tableScroller.addEventListener("wheel", handleTableWheel, {
            passive: false,
            capture: true,
        });
        horizontalRail.addEventListener("wheel", handleRailWheel, {
            passive: false,
            capture: true,
        });

        tableScroller.addEventListener("scroll", syncFromTable, {passive: true});
        horizontalRail.addEventListener("scroll", syncFromRail, {passive: true});

        horizontalRail.scrollLeft = tableScroller.scrollLeft;

        return () => {
            tableScroller.removeEventListener("wheel", handleTableWheel, true);
            horizontalRail.removeEventListener("wheel", handleRailWheel, true);
            tableScroller.removeEventListener("scroll", syncFromTable);
            horizontalRail.removeEventListener("scroll", syncFromRail);
        };
    }, [auditListHorizontalRailEl, auditListScrollEl]);

    // ── 无限滚动：审计日志列表 ──
    useEffect(() => {
        const el = auditListScrollEl;
        if (!el) return;
        let ticking = false;
        const handleScroll = () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => {
                ticking = false;
                const { scrollTop, scrollHeight, clientHeight } = el;
                if (scrollHeight - scrollTop - clientHeight < 200) {
                    void loadMoreLogs();
                }
            });
        };
        el.addEventListener("scroll", handleScroll, { passive: true });
        return () => el.removeEventListener("scroll", handleScroll);
    }, [auditListScrollEl, allAiLogs.length, aiLogTotal, logsLoading]);

    useEffect(() => {
        function stopCandidateColumnResize() {
            if (!candidateListColumnResizeRef.current) {
                return;
            }
            candidateListColumnResizeRef.current = null;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        }

        function handleCandidateColumnResize(event: MouseEvent) {
            const current = candidateListColumnResizeRef.current;
            if (!current) {
                return;
            }
            const nextWidth = clampCandidateListColumnWidth(current.key, current.startWidth + event.clientX - current.startX);
            setCandidateListColumnWidths((prev) => (
                prev[current.key] === nextWidth
                    ? prev
                    : {
                        ...prev,
                        [current.key]: nextWidth,
                    }
            ));
        }

        window.addEventListener("mousemove", handleCandidateColumnResize);
        window.addEventListener("mouseup", stopCandidateColumnResize);
        return () => {
            window.removeEventListener("mousemove", handleCandidateColumnResize);
            window.removeEventListener("mouseup", stopCandidateColumnResize);
            stopCandidateColumnResize();
        };
    }, []);

    function beginCandidateColumnResize(key: CandidateListColumnKey, event: React.MouseEvent<HTMLButtonElement>) {
        event.preventDefault();
        event.stopPropagation();
        candidateListColumnResizeRef.current = {
            key,
            startX: event.clientX,
            startWidth: candidateListColumnWidths[key],
        };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
    }

    function resetCandidateColumnWidth(key: CandidateListColumnKey, event: React.MouseEvent<HTMLButtonElement>) {
        event.preventDefault();
        event.stopPropagation();
        setCandidateListColumnWidths((prev) => ({
            ...prev,
            [key]: candidateListColumnDefaultWidths[key],
        }));
    }

    async function applyCandidateMatchSortOrder(nextMatchSortOrder: "" | "asc" | "desc") {
        if (candidateMatchSortLoading || nextMatchSortOrder === candidateMatchSortOrderRef.current) {
            return;
        }
        const previousMatchSortOrder = candidateMatchSortOrderRef.current;
        const requestToken = candidateMatchSortRequestTokenRef.current + 1;
        candidateMatchSortRequestTokenRef.current = requestToken;
        candidateMatchSortOrderRef.current = nextMatchSortOrder;
        candidatePageIndexRef.current = 0;
        setCandidatePageIndex(0);
        setCandidateMatchSortLoading(true);
        setCandidateMatchSortOrder(nextMatchSortOrder);
        scrollCandidateListToTop();

        try {
            await loadCandidates({
                silent: true,
                force: true,
                useVisibleFilters: true,
                query: deferredCandidateQuery,
                matchSortOrder: nextMatchSortOrder,
                pageIndex: 0,
                pageSize: candidatePageSizeRef.current,
            });
        } catch (error) {
            if (!mountedRef.current || candidateMatchSortRequestTokenRef.current !== requestToken) {
                return;
            }
            candidateMatchSortOrderRef.current = previousMatchSortOrder;
            setCandidateMatchSortOrder(previousMatchSortOrder);
            candidateListContextKeyRef.current = buildCandidateListContextKey({
                useVisibleFilters: true,
                query: deferredCandidateQuery,
                matchSortOrder: previousMatchSortOrder,
                pageIndex: 0,
                pageSize: candidatePageSizeRef.current,
            });
            if (!isRecruitmentRequestAborted(error)) {
                toast.error(
                    isZh
                        ? `匹配度排序失败，已保留原列表：${formatActionError(error)}`
                        : `Failed to sort by match. Kept the previous list: ${formatActionError(error)}`,
                );
            }
        } finally {
            if (mountedRef.current && candidateMatchSortRequestTokenRef.current === requestToken) {
                setCandidateMatchSortLoading(false);
            }
        }
    }

    function renderCandidateListHeaderCell(key: CandidateListColumnKey, label: string) {
        const isMatchColumn = key === "match";
        const nextMatchSortOrder = (
            candidateMatchSortOrder === ""
                ? "desc"
                : candidateMatchSortOrder === "desc"
                    ? "asc"
                    : ""
        ) as "" | "asc" | "desc";
        return (
            <div
                role="columnheader"
                key={key}
                className="flex h-10 w-full min-w-0 items-center px-2 text-left font-medium whitespace-nowrap"
            >
                <div className="relative flex min-w-0 items-center gap-2">
                    {isMatchColumn ? (
                        <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-left transition hover:bg-slate-100 disabled:cursor-progress disabled:opacity-75 dark:hover:bg-slate-800"
                            onClick={() => void applyCandidateMatchSortOrder(nextMatchSortOrder)}
                            disabled={candidateMatchSortLoading}
                            aria-busy={candidateMatchSortLoading}
                            title={
                                candidateMatchSortLoading
                                    ? (isZh ? "正在按匹配度重新排序" : "Sorting by match")
                                    : candidateMatchSortOrder === ""
                                    ? (isZh ? "按匹配度降序排序" : "Sort by match descending")
                                    : candidateMatchSortOrder === "desc"
                                        ? (isZh ? "切换为匹配度升序" : "Switch to match ascending")
                                        : (isZh ? "取消匹配度排序" : "Clear match sorting")
                            }
                        >
                            <span className="truncate">{label}</span>
                            {candidateMatchSortLoading ? (
                                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-500"/>
                            ) : candidateMatchSortOrder === "desc" ? (
                                <ChevronDown className="h-3.5 w-3.5 shrink-0"/>
                            ) : candidateMatchSortOrder === "asc" ? (
                                <ChevronUp className="h-3.5 w-3.5 shrink-0"/>
                            ) : (
                                <div className="flex shrink-0 flex-col items-center justify-center text-slate-400">
                                    <ChevronUp className="-mb-1 h-3 w-3"/>
                                    <ChevronDown className="-mt-1 h-3 w-3"/>
                                </div>
                            )}
                        </button>
                    ) : (
                        <span className="truncate">{label}</span>
                    )}
                </div>
            </div>
        );
    }

    async function runDedupedRequest<T>(key: string, request: () => Promise<T>) {
        const inflight = requestInflightRef.current.get(key) as Promise<T> | undefined;
        if (inflight) {
            return inflight;
        }
        const pending = request().finally(() => {
            if (requestInflightRef.current.get(key) === pending) {
                requestInflightRef.current.delete(key);
            }
        });
        requestInflightRef.current.set(key, pending as Promise<unknown>);
        return pending;
    }

    async function loadMetadata() {
        try {
            const data = await (async () => {
                if (sharedRecruitmentMetadataCache) {
                    return sharedRecruitmentMetadataCache;
                }
                if (sharedRecruitmentMetadataPromise) {
                    return sharedRecruitmentMetadataPromise;
                }
                const pending = recruitmentApi<RecruitmentMetadata>("/metadata")
                    .then((result) => {
                        sharedRecruitmentMetadataCache = result;
                        return result;
                    })
                    .finally(() => {
                        sharedRecruitmentMetadataPromise = null;
                    });
                sharedRecruitmentMetadataPromise = pending;
                return pending;
            })();
            if (mountedRef.current) {
                setMetadata(data);
            }
            return data;
        } catch (error) {
            toast.error(recruitmentToast.loadFailed(recruitmentToastEntities.baseConfig, formatActionError(error)));
            throw error;
        }
    }

    async function loadOrganizationCatalog(): Promise<OrganizationCatalogLoadResult> {
        setOrganizationCatalogStatus("loading");
        try {
            const currentSession = getStoredScriptHubSession();
            const cacheKey = buildOrganizationScopeRequestKey(currentSession);
            const data = await (async () => {
                if (sharedOrganizationScopePromise?.cacheKey === cacheKey) {
                    return sharedOrganizationScopePromise.promise;
                }
                const pending = recruitmentApi<RecruitmentOrganizationScope>("/organization-scope")
                    .finally(() => {
                        if (sharedOrganizationScopePromise?.cacheKey === cacheKey) {
                            sharedOrganizationScopePromise = null;
                        }
                    });
                sharedOrganizationScopePromise = { cacheKey, promise: pending };
                return pending;
            })();
            if (mountedRef.current) {
                setOrganizationCatalog(data.organizations || []);
                setAuthorizedOrgCodes(
                    (data.visible_org_codes && data.visible_org_codes.length)
                        ? data.visible_org_codes.map(normalizeRecruitmentOrgCode)
                        : [normalizeRecruitmentOrgCode(data.primary_org_code || defaultOrgScope)],
                );
                setHasAllOrgScope(Boolean(data.has_all_orgs));
                setOrganizationPrimaryOrgScope(normalizeRecruitmentOrgCode(data.primary_org_code || defaultOrgScope));
            }
            return {authoritative: true, data};
        } catch (error) {
            const dataScope = String(sessionUser?.dataScope || "ORG_ONLY").toUpperCase();
            const fallbackOrgCodes = dataScope === "CUSTOM_ORGS" && sessionUser?.customOrgCodes?.length
                ? sessionUser.customOrgCodes.map(normalizeRecruitmentOrgCode)
                : [defaultOrgScope];
            if (mountedRef.current) {
                setOrganizationCatalog([]);
                setAuthorizedOrgCodes(fallbackOrgCodes);
                setHasAllOrgScope(dataScope === "ALL");
                setOrganizationPrimaryOrgScope(defaultOrgScope);
            }
            return {
                authoritative: false,
                data: {
                    primary_org_code: defaultOrgScope,
                    data_scope: dataScope,
                    has_all_orgs: dataScope === "ALL",
                    visible_org_codes: fallbackOrgCodes,
                    organizations: [],
                } satisfies RecruitmentOrganizationScope,
            };
        }
    }

    async function loadPositions(options?: { force?: boolean }) {
        const requestId = positionsLoadRequestIdRef.current + 1;
        positionsLoadRequestIdRef.current = requestId;
        positionsLoadStartedRef.current = true;
        setPositionsLoading(true);
        try {
            const data = options?.force
                ? await recruitmentApi<PositionSummary[]>("/positions")
                : await runDedupedRequest(
                    `positions:${recruitmentDataCacheKey}`,
                    () => recruitmentApi<PositionSummary[]>("/positions"),
                );
            if (!mountedRef.current || positionsLoadRequestIdRef.current !== requestId) {
                return data;
            }
            setAllPositions(data);
            setPositionListRequiresRefresh(false);
            positionsLoadedOnceRef.current = true;
            return data;
        } catch (error) {
            positionsLoadStartedRef.current = false;
            toast.error(recruitmentToast.loadFailed(recruitmentToastEntities.positions, formatActionError(error)));
            throw error;
        } finally {
            if (mountedRef.current && positionsLoadRequestIdRef.current === requestId) {
                setPositionsLoading(false);
            }
        }
    }

    async function loadPositionDetail(positionId: number) {
        const requestId = positionDetailLoadRequestIdRef.current + 1;
        positionDetailLoadRequestIdRef.current = requestId;
        setPositionDetailLoading(true);
        try {
            const data = await runDedupedRequest(
                `position-detail:${positionId}`,
                () => recruitmentApi<PositionDetail>(`/positions/${positionId}`),
            );
            if (!mountedRef.current || positionDetailLoadRequestIdRef.current !== requestId) {
                return data;
            }
            setPositionDetail(data);
            // 智能默认 Tab：仅首次加载时设置，后续刷新不重置
            if (defaultTabSetForPositionRef.current !== positionId) {
                defaultTabSetForPositionRef.current = positionId;
                setPositionWorkspaceView("config");
            }
            return data;
        } catch (error) {
            toast.error(recruitmentToast.loadFailed(recruitmentToastEntities.positionDetail, formatActionError(error)));
            return null;
        } finally {
            if (mountedRef.current && positionDetailLoadRequestIdRef.current === requestId) {
                setPositionDetailLoading(false);
            }
        }
    }

    function resolveScopedOrgCode(departmentScope?: string, orgScope?: string) {
        const normalizedDepartmentScope = String(departmentScope || "").trim();
        if (normalizedDepartmentScope && normalizedDepartmentScope !== ALL_COMPANY_DEPARTMENTS_VALUE) {
            return normalizeRecruitmentOrgCode(normalizedDepartmentScope);
        }
        const normalizedCompanyScope = String(orgScope || "").trim();
        if (normalizedCompanyScope) {
            return normalizeRecruitmentOrgCode(normalizedCompanyScope);
        }
        return "";
    }

    function abortCandidateListRequests() {
        candidateListLoadAbortControllerRef.current?.abort();
        candidateListLoadAbortControllerRef.current = null;
        Array.from(requestInflightRef.current.keys()).forEach((key) => {
            if (key.startsWith("candidates:first-page:")) {
                requestInflightRef.current.delete(key);
            }
        });
    }

    function buildCandidateListContextKey(options?: {
        departmentScope?: string;
        orgScope?: string;
        query?: string;
        positionFilter?: string[];
        statusFilter?: string[];
        sourceFilter?: string[];
        timeFilter?: string;
        matchFilter?: string;
        useVisibleFilters?: boolean;
        matchSortOrder?: "" | "asc" | "desc";
        pageIndex?: number;
        pageSize?: number;
    }) {
        return JSON.stringify({
            dataScope: recruitmentDataCacheKey,
            departmentScope: options?.departmentScope ?? selectedDepartmentScope,
            orgScope: options?.orgScope ?? selectedOrgScope,
            query: String(options?.query ?? deferredCandidateQuery).trim(),
            positionFilter: options?.positionFilter ?? candidatePositionFilter,
            statusFilter: options?.statusFilter ?? candidateStatusFilter,
            sourceFilter: options?.sourceFilter ?? candidateSourceFilter,
            timeFilter: options?.timeFilter ?? candidateTimeFilter,
            matchFilter: options?.matchFilter ?? candidateMatchFilter,
            useVisibleFilters: options?.useVisibleFilters ?? activePageRef.current === "candidates",
            matchSortOrder: options?.matchSortOrder ?? candidateMatchSortOrder,
            pageIndex: options?.pageIndex ?? candidatePageIndexRef.current,
            pageSize: options?.pageSize ?? candidatePageSizeRef.current,
        });
    }

    function buildCandidateListQueryString(options?: {
        departmentScope?: string;
        orgScope?: string;
        query?: string;
        positionFilter?: string[];
        statusFilter?: string[];
        sourceFilter?: string[];
        timeFilter?: string;
        matchFilter?: string;
        useVisibleFilters?: boolean;
        matchSortOrder?: "" | "asc" | "desc";
        pageIndex?: number;
        pageSize?: number;
        limit?: number;
        offset?: number;
    }) {
        const params = new URLSearchParams();
        const limit = options?.limit ?? options?.pageSize ?? candidatePageSizeRef.current;
        const pageIndex = options?.pageIndex ?? candidatePageIndexRef.current;
        params.set("limit", String(limit));
        params.set("offset", String(options?.offset ?? pageIndex * limit));
        const scopedOrgCode = resolveScopedOrgCode(options?.departmentScope ?? selectedDepartmentScope, options?.orgScope ?? selectedOrgScope);
        if (scopedOrgCode) {
            params.set("org_code", scopedOrgCode);
        }
        const useVisibleFilters = options?.useVisibleFilters ?? activePageRef.current === "candidates";
        if (useVisibleFilters) {
            const normalizedQuery = String(options?.query ?? deferredCandidateQuery).trim();
            const positionId = String((options?.positionFilter ?? candidatePositionFilter)[0] || "").trim();
            const status = (options?.statusFilter ?? candidateStatusFilter)
                .map((item) => String(item || "").trim())
                .filter(Boolean)
                .join(",");
            const source = (options?.sourceFilter ?? candidateSourceFilter)
                .map((item) => String(item || "").trim())
                .filter(Boolean)
                .join(",");
            const timeFilter = String(options?.timeFilter ?? candidateTimeFilter).trim();
            const matchFilter = String(options?.matchFilter ?? candidateMatchFilter).trim();
            const matchSortOrder = String(options?.matchSortOrder ?? candidateMatchSortOrder).trim().toLowerCase();
            if (normalizedQuery) {
                params.set("query", normalizedQuery);
            }
            if (positionId) {
                params.set("position_id", positionId);
            }
            if (status) {
                params.set("status", status);
            }
            if (source) {
                params.set("source", source);
            }
            if (timeFilter && timeFilter !== "all") {
                params.set("time_filter", timeFilter);
            }
            if (matchFilter === "80+") {
                params.set("match_min", "80");
            } else if (matchFilter === "60+") {
                params.set("match_min", "60");
            } else if (matchFilter === "40+") {
                params.set("match_min", "40");
            }
            if (matchSortOrder === "asc" || matchSortOrder === "desc") {
                params.set("sort_by", "match_percent");
                params.set("sort_order", matchSortOrder);
            }
        }
        return params.toString();
    }

    async function loadCandidates(options?: {
        silent?: boolean;
        force?: boolean;
        departmentScope?: string;
        orgScope?: string;
        query?: string;
        positionFilter?: string[];
        statusFilter?: string[];
        sourceFilter?: string[];
        timeFilter?: string;
        matchFilter?: string;
        useVisibleFilters?: boolean;
        matchSortOrder?: "" | "asc" | "desc";
        pageIndex?: number;
        pageSize?: number;
    }) {
        const requestId = candidatesLoadRequestIdRef.current + 1;
        candidatesLoadRequestIdRef.current = requestId;
        if (!options?.silent) {
            setCandidatesLoading(true);
        }
        try {
            const useVisibleFilters = options?.useVisibleFilters ?? activePageRef.current === "candidates";
            const normalizedQueryForScope = String(options?.query ?? deferredCandidateQuery).trim();
            const positionFilterForScope = options?.positionFilter ?? candidatePositionFilter;
            const statusFilterForScope = options?.statusFilter ?? candidateStatusFilter;
            const sourceFilterForScope = options?.sourceFilter ?? candidateSourceFilter;
            const timeFilterForScope = options?.timeFilter ?? candidateTimeFilter;
            const matchFilterForScope = options?.matchFilter ?? candidateMatchFilter;
            const shouldUpdateCandidateScopeTotal = !useVisibleFilters || (
                !normalizedQueryForScope
                && positionFilterForScope.length === 0
                && statusFilterForScope.length === 0
                && sourceFilterForScope.length === 0
                && timeFilterForScope === "all"
                && matchFilterForScope === "all"
            );
            const contextKey = buildCandidateListContextKey({
                departmentScope: options?.departmentScope,
                orgScope: options?.orgScope,
                query: options?.query,
                positionFilter: options?.positionFilter,
                statusFilter: options?.statusFilter,
                sourceFilter: options?.sourceFilter,
                timeFilter: options?.timeFilter,
                matchFilter: options?.matchFilter,
                useVisibleFilters,
                matchSortOrder: options?.matchSortOrder,
                pageIndex: options?.pageIndex,
                pageSize: options?.pageSize,
            });
            candidateListContextKeyRef.current = contextKey;
            abortCandidateListRequests();
            const controller = new AbortController();
            candidateListLoadAbortControllerRef.current = controller;
            const queryString = buildCandidateListQueryString({
                departmentScope: options?.departmentScope,
                orgScope: options?.orgScope,
                query: options?.query,
                positionFilter: options?.positionFilter,
                statusFilter: options?.statusFilter,
                sourceFilter: options?.sourceFilter,
                timeFilter: options?.timeFilter,
                matchFilter: options?.matchFilter,
                useVisibleFilters,
                matchSortOrder: options?.matchSortOrder,
                pageIndex: options?.pageIndex,
                pageSize: options?.pageSize,
            });
            const url = `/candidates?${queryString}`;
            const request = () => recruitmentApi<{items: CandidateSummary[]; total: number}>(url, {
                signal: controller.signal,
                timeoutMs: 45000,
            });
            const result = options?.force
                ? await request()
                : await runDedupedRequest(
                    `candidates:first-page:${recruitmentDataCacheKey}:${queryString}`,
                    request,
                );
            if (
                !mountedRef.current
                || candidatesLoadRequestIdRef.current !== requestId
                || candidateListContextKeyRef.current !== contextKey
            ) {
                return result?.items || [];
            }
            candidateListUsingVisibleFiltersRef.current = useVisibleFilters;
            const nextItems = deduplicateCandidates(result?.items || []);
            const nextTotal = result?.total || 0;
            applyCandidateListSnapshot(nextItems, nextTotal, { updateScopeTotal: shouldUpdateCandidateScopeTotal });
            if (useVisibleFilters) {
                candidateListPageCacheRef.current = {
                    contextKey,
                    items: nextItems,
                    total: nextTotal,
                    loadedAt: Date.now(),
                };
            } else {
                candidateListPreloadLoadedAtRef.current = Date.now();
            }
            setCandidatesInitialLoaded(true);
            return result?.items || [];
        } catch (error) {
            if (isRecruitmentRequestAborted(error)) {
                return [];
            }
            if (!options?.silent) {
                toast.error(recruitmentToast.loadFailed(recruitmentToastEntities.candidates, formatActionError(error)));
            }
            throw error;
        } finally {
            if (
                candidateListLoadAbortControllerRef.current
                && candidateListLoadAbortControllerRef.current.signal.aborted
            ) {
                candidateListLoadAbortControllerRef.current = null;
            } else if (mountedRef.current && candidatesLoadRequestIdRef.current === requestId) {
                candidateListLoadAbortControllerRef.current = null;
            }
            if (!options?.silent && mountedRef.current && candidatesLoadRequestIdRef.current === requestId) {
                setCandidatesLoading(false);
            }
        }
    }

    async function refreshActiveCandidateList(options?: { silent?: boolean }) {
        if (activePageRef.current !== "candidates") {
            return [];
        }
        const query = candidateListRefreshQueryRef.current;
        return loadCandidates({
            silent: options?.silent ?? true,
            force: true,
            useVisibleFilters: true,
            departmentScope: query.departmentScope,
            orgScope: query.orgScope,
            query: query.query,
            positionFilter: query.positionFilter,
            statusFilter: query.statusFilter,
            sourceFilter: query.sourceFilter,
            timeFilter: query.timeFilter,
            matchFilter: query.matchFilter,
            matchSortOrder: query.matchSortOrder,
            pageIndex: query.pageIndex,
            pageSize: query.pageSize,
        });
    }

    async function refreshActiveCandidateListAndStats(options?: { silent?: boolean }) {
        await Promise.all([
            refreshActiveCandidateList(options),
            refreshCandidateStats(),
        ]);
    }

    async function loadTalentPoolCandidates(options?: { departmentScope?: string; orgScope?: string; silent?: boolean; query?: Partial<TalentPoolQueryState>; append?: boolean }) {
        if (options?.append) {
            setTalentPoolLoadingMore(true);
        } else if (!options?.silent) {
            setTalentPoolLoading(true);
        }
        try {
            const scopedOrgCode = resolveScopedOrgCode(options?.departmentScope ?? selectedDepartmentScope, options?.orgScope ?? selectedOrgScope);
            const resolvedQuery: TalentPoolQueryState = {
                ...DEFAULT_TALENT_POOL_QUERY,
                ...talentPoolQueryRef.current,
                ...(options?.query || {}),
            };
            resolvedQuery.pageIndex = Math.max(0, Number(resolvedQuery.pageIndex || 0));
            resolvedQuery.pageSize = TALENT_POOL_PAGE_SIZE_OPTIONS.includes(resolvedQuery.pageSize)
                ? resolvedQuery.pageSize
                : TALENT_POOL_PAGE_SIZE;
            resolvedQuery.offset = resolvedQuery.pageIndex * resolvedQuery.pageSize;
            talentPoolQueryRef.current = resolvedQuery;
            const params = new URLSearchParams();
            if (scopedOrgCode) params.set("org_code", scopedOrgCode);
            params.set("paginated", "true");
            params.set("limit", String(resolvedQuery.pageSize));
            params.set("offset", String(resolvedQuery.offset));
            params.set("stat_filter", resolvedQuery.statFilter);
            if (resolvedQuery.searchQuery.trim()) params.set("query", resolvedQuery.searchQuery.trim());
            if (resolvedQuery.sourceFilter !== "all") params.set("source", resolvedQuery.sourceFilter);
            if (resolvedQuery.tagFilter !== "all") params.set("tag", resolvedQuery.tagFilter);
            params.set("sort_by", resolvedQuery.sortBy);
            const data = await recruitmentApi<TalentPoolListResponse | CandidateSummary[]>(`/candidates/talent-pool?${params.toString()}`, {
                timeoutMs: 45000,
            });
            if (mountedRef.current) {
                const response = Array.isArray(data)
                    ? { items: data, total: data.length, stats: null, available_tags: [] }
                    : data;
                const nextItems = response?.items || [];
                setAllTalentPoolCandidates((current) => (
                    options?.append
                        ? deduplicateCandidates([...current, ...nextItems])
                        : nextItems
                ));
                setTalentPoolTotal(response?.total || nextItems.length);
                if (response?.stats) {
                    setTalentPoolStats(response.stats);
                }
                setTalentPoolAvailableTags(response?.available_tags || []);
            }
            return Array.isArray(data) ? data : data?.items || [];
        } catch (error) {
            console.error("Failed to load talent pool candidates:", error);
            if (!options?.silent) {
                toast.error(isZh ? "加载人才库失败" : "Failed to load talent pool");
            }
            return [];
        } finally {
            if (options?.append && mountedRef.current) {
                setTalentPoolLoadingMore(false);
            } else if (!options?.silent && mountedRef.current) {
                setTalentPoolLoading(false);
            }
        }
    }

    async function loadCandidateDetail(
        candidateId: number,
        options?: {
            silent?: boolean;
            force?: boolean;
            includeDuplicates?: boolean;
            skipChatContextSave?: boolean;
            reviewAssignmentId?: number | null;
        },
    ) {
        const loadingGeneration = options?.silent
            ? null
            : ++candidateDetailLoadingGenerationRef.current;
        if (loadingGeneration !== null) {
            setCandidateDetailLoading(true);
        }
        try {
            const reviewAssignmentId = options?.reviewAssignmentId ?? (
                activePage === "review-workbench" && candidateDetailReviewContext?.candidateId === candidateId
                    ? candidateDetailReviewContext.assignmentId
                    : null
            );
            const isTalentPoolDetailRequest = activePage === "talent-pool" && talentPoolCandidateDetailOpen;
            const detailPath = reviewAssignmentId
                ? `/department-reviews/assignments/${reviewAssignmentId}/candidate`
                : isTalentPoolDetailRequest
                    ? `/candidates/talent-pool/${candidateId}`
                    : `/candidates/${candidateId}`;
            const request = async () => {
                const controller = new AbortController();
                candidateDetailRequestAbortControllersRef.current.add(controller);
                try {
                    return await recruitmentApi<CandidateDetail>(detailPath, {signal: controller.signal});
                } finally {
                    candidateDetailRequestAbortControllersRef.current.delete(controller);
                }
            };
            const data = options?.force
                ? await request()
                : await runDedupedRequest(
                    `candidate-detail:${detailPath}:${options?.silent ? "silent" : "full"}`,
                    request,
                );
            const recentCompletedAt = recentlyCompletedScreeningCandidatesRef.current.get(candidateId);
            const shouldSanitizeRecentTerminalScreening = Boolean(
                recentCompletedAt
                && Date.now() - recentCompletedAt < 15_000
                && (
                    isLiveTaskStatus(data?.candidate?.active_screening_task_status)
                    || data?.candidate?.display_status === "screening_running"
                ),
            );
            const normalizedData = shouldSanitizeRecentTerminalScreening
                ? {
                    ...data,
                    candidate: (sanitizeTerminalScreeningCandidateSnapshot(data.candidate, "success") || data.candidate) as CandidateSummary,
                }
                : data;
            if (!isLiveTaskStatus(normalizedData?.candidate?.active_screening_task_status)) {
                recentlyCompletedScreeningCandidatesRef.current.delete(candidateId);
            }
            const currentReviewAssignmentId = (
                activePageRef.current === "review-workbench"
                && candidateDetailReviewContextRef.current?.candidateId === candidateId
            )
                ? candidateDetailReviewContextRef.current.assignmentId
                : null;
            if (
                !mountedRef.current
                || selectedCandidateIdRef.current !== candidateId
                || currentReviewAssignmentId !== (reviewAssignmentId ?? null)
            ) {
                return normalizedData;
            }
            setCandidateDetail(normalizedData);
            if (canViewRecruitmentAssistant && !options?.skipChatContextSave && !reviewAssignmentId) {
                const nextPositionId = normalizedData.candidate.position_id ?? null;
                if (
                    normalizedData.candidate.id !== (chatContext.candidate_id ?? null)
                    || nextPositionId !== (chatContext.position_id ?? null)
                ) {
                    void saveChatContext(nextPositionId, chatContext.skill_ids, normalizedData.candidate.id, {quiet: true});
                }
            }
            if (options?.includeDuplicates) {
                void checkDuplicatesForCandidate(normalizedData);
            }
            return normalizedData;
        } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                return null;
            }
            const isStaleDetailRequest = selectedCandidateIdRef.current !== candidateId;
            const isRecentlyDeletedCandidate = recentlyDeletedCandidateIdsRef.current.has(candidateId);
            if (isStaleDetailRequest || isRecentlyDeletedCandidate) {
                return null;
            }
            if (!options?.silent) {
                toast.error(recruitmentToast.loadFailed(recruitmentToastEntities.candidateDetail, formatActionError(error)));
            }
            return null;
        } finally {
            if (
                loadingGeneration !== null
                && candidateDetailLoadingGenerationRef.current === loadingGeneration
                && mountedRef.current
            ) {
                setCandidateDetailLoading(false);
            }
        }
    }

    async function checkDuplicatesForCandidate(candidate: CandidateDetail | null) {
        const generation = ++duplicateCheckGenerationRef.current;
        const candidateId = candidate?.candidate.id;
        if (!candidate?.candidate) {
            setDuplicateCandidates([]);
            return;
        }
        const phone = candidate.candidate.phone?.trim();
        const email = candidate.candidate.email?.trim();
        if (!phone && !email) {
            setDuplicateCandidates([]);
            return;
        }
        try {
            const data = await recruitmentApi<Array<{id: number; candidate_code: string; name: string; phone: string | null; email: string | null; status: string}>>("/candidates/check-duplicates", {
                method: "POST",
                body: JSON.stringify({ phone, email, exclude_candidate_id: candidateId }),
            });
            if (mountedRef.current && generation === duplicateCheckGenerationRef.current && selectedCandidateIdRef.current === candidateId) {
                setDuplicateCandidates(data);
            }
        } catch {
            if (mountedRef.current && generation === duplicateCheckGenerationRef.current && selectedCandidateIdRef.current === candidateId) {
                setDuplicateCandidates([]);
            }
        }
    }

    async function loadLogs(options?: { silent?: boolean; departmentScope?: string; orgScope?: string }) {
        if (!options?.silent) {
            setLogsLoading(true);
        }
        try {
            const taskTypeParam = logTaskTypeFilter !== "all"
                ? `&task_type=${encodeURIComponent(logTaskTypeFilter)}`
                : "";
            const statusParam = logStatusFilter !== "all"
                ? `&status=${encodeURIComponent(logStatusFilter)}`
                : "";
            const scopedOrgCode = resolveScopedOrgCode(options?.departmentScope ?? selectedDepartmentScope, options?.orgScope ?? selectedOrgScope);
            const orgCodeParam = scopedOrgCode ? `&org_code=${encodeURIComponent(scopedOrgCode)}` : "";
            const dedupKey = `logs:${recruitmentDataCacheKey}:${options?.silent ? "silent" : "full"}:${logTaskTypeFilter}:${logStatusFilter}${scopedOrgCode ? `:${scopedOrgCode}` : ""}`;
            const data = await runDedupedRequest(
                dedupKey,
                () => recruitmentApi<{items: AITaskLog[]; total: number}>(
                    `/ai-task-logs?limit=20&offset=0${taskTypeParam}${statusParam}${orgCodeParam}`
                ),
            );
            if (mountedRef.current) {
                setAllAiLogs(uniqueAiTaskLogs(data?.items || []));
                setAiLogTotal(data?.total || 0);
            }
            return data?.items || [];
        } catch (error) {
            if (!options?.silent) {
                toast.error(
                    recruitmentToast.loadFailed(recruitmentToastEntities.aiTasks, formatActionError(error))
                );
            }
            throw error;
        } finally {
            if (!options?.silent) {
                setLogsLoading(false);
            }
        }
    }

    const loadingMoreLogsRef = useRef(false);
    async function loadMoreLogs() {
        if (logsLoading || loadingMoreLogsRef.current || allAiLogs.length >= aiLogTotal) return;
        loadingMoreLogsRef.current = true;
        try {
            const offset = allAiLogs.length;
            const taskTypeParam = logTaskTypeFilter !== "all"
                ? `&task_type=${encodeURIComponent(logTaskTypeFilter)}`
                : "";
            const statusParam = logStatusFilter !== "all"
                ? `&status=${encodeURIComponent(logStatusFilter)}`
                : "";
            const scopedOrgCode = resolveScopedOrgCode(selectedDepartmentScope, selectedOrgScope);
            const orgCodeParam = scopedOrgCode ? `&org_code=${encodeURIComponent(scopedOrgCode)}` : "";
            const data = await recruitmentApi<{items: AITaskLog[]; total: number}>(
                `/ai-task-logs?limit=20&offset=${offset}${taskTypeParam}${statusParam}${orgCodeParam}`
            );
            if (mountedRef.current) {
                setAllAiLogs(prev => uniqueAiTaskLogs([...prev, ...(data?.items || [])]));
                setAiLogTotal(data?.total || 0);
            }
        } catch (error) {
            console.error("Failed to load more logs:", error);
        } finally {
            loadingMoreLogsRef.current = false;
        }
    }

    async function loadLogDetail(taskId: number, options?: { silent?: boolean }) {
        if (!options?.silent) {
            setLogDetailLoading(true);
        }
        try {
            const data = await runDedupedRequest(
                `log-detail:${taskId}:${options?.silent ? "silent" : "full"}`,
                () => recruitmentApi<AITaskLog>(`/ai-task-logs/${taskId}`),
            );
            if (mountedRef.current && selectedLogIdRef.current === taskId) {
                setSelectedLogDetail(data);
            }
            return data;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (!options?.silent) {
                toast.error(recruitmentToast.loadFailed(recruitmentToastEntities.taskDetail, formatActionError(error)));
            }
            if (errorMessage.includes("404") || errorMessage.includes("Not Found")) {
                if (mountedRef.current && selectedLogIdRef.current === taskId) {
                    setSelectedLogId(null);
                    setSelectedLogDetail(null);
                }
            }
            return null;
        } finally {
            if (!options?.silent) {
                setLogDetailLoading(false);
            }
        }
    }

    async function loadSkills() {
        setSkillsLoading(true);
        try {
            const data = await runDedupedRequest("skills", () => recruitmentApi<RecruitmentSkill[]>("/skills"));
            if (mountedRef.current) {
                setAllSkills(data);
            }
            skillsLoadedOnceRef.current = true;
            return data;
        } catch (error) {
            toast.error(recruitmentToast.loadFailed(recruitmentToastEntities.skills, formatActionError(error)));
            throw error;
        } finally {
            setSkillsLoading(false);
        }
    }

    async function loadSkillSettingsPage(options?: {pageIndex?: number; silent?: boolean}) {
        const requestedPageIndex = Math.max(0, options?.pageIndex ?? skillSettingsPageIndex);
        const requestId = skillSettingsLoadRequestIdRef.current + 1;
        skillSettingsLoadRequestIdRef.current = requestId;
        skillSettingsLoadAbortControllerRef.current?.abort();
        const controller = new AbortController();
        skillSettingsLoadAbortControllerRef.current = controller;
        if (!options?.silent) {
            setSkillSettingsLoading(true);
        }
        try {
            const offset = requestedPageIndex * SETTINGS_LIST_PAGE_SIZE;
            const queryString = buildSettingsListQuery({
                limit: SETTINGS_LIST_PAGE_SIZE,
                offset,
                summary: true,
                query: skillSettingsQuery,
                taskType: skillSettingsTaskFilter,
                orgCodes: activeBusinessOrgCodes,
            });
            const response = await recruitmentApi<SettingsListResponse<RecruitmentSkillSummary>>(`/skills?${queryString}`, {
                signal: controller.signal,
            });
            const page = normalizeSettingsListResponse(response, SETTINGS_LIST_PAGE_SIZE, offset);
            if (!mountedRef.current || skillSettingsLoadRequestIdRef.current !== requestId) {
                return page;
            }
            const lastPageIndex = Math.max(0, Math.ceil(page.total / SETTINGS_LIST_PAGE_SIZE) - 1);
            if (requestedPageIndex > lastPageIndex) {
                setSkillSettingsPageIndex(lastPageIndex);
                return page;
            }
            setSkillSettingsRows(page.items.map((item) => ({
                ...item,
                content: item.content || "",
            })));
            setSkillSettingsTotal(page.total);
            return page;
        } catch (error) {
            if (isRecruitmentRequestAborted(error)) {
                return null;
            }
            if (!options?.silent) {
                toast.error(recruitmentToast.loadFailed(recruitmentToastEntities.skills, formatActionError(error)));
            }
            throw error;
        } finally {
            if (skillSettingsLoadAbortControllerRef.current === controller) {
                skillSettingsLoadAbortControllerRef.current = null;
            }
            if (skillSettingsLoadRequestIdRef.current === requestId) {
                setSkillSettingsLoading(false);
            }
        }
    }

    async function loadLLMConfigs(options?: {silent?: boolean}) {
        if (!canViewLLMConfig && !canManageLLMConfig) {
            return [];
        }
        const requestId = llmConfigsLoadRequestIdRef.current + 1;
        llmConfigsLoadRequestIdRef.current = requestId;
        llmConfigsLoadAbortControllerRef.current?.abort();
        const controller = new AbortController();
        llmConfigsLoadAbortControllerRef.current = controller;
        if (!options?.silent) {
            setModelsLoading(true);
        }
        try {
            const data = await recruitmentApi<RecruitmentLLMConfig[]>("/llm-configs", {signal: controller.signal});
            if (mountedRef.current && llmConfigsLoadRequestIdRef.current === requestId) {
                setAllLlmConfigs(data);
                llmConfigsLoadedOnceRef.current = true;
            }
            return data;
        } catch (error) {
            if (isRecruitmentRequestAborted(error)) {
                return [];
            }
            if (!options?.silent) {
                toast.error(recruitmentToast.loadFailed(recruitmentToastEntities.modelConfigs, formatActionError(error)));
            }
            throw error;
        } finally {
            if (llmConfigsLoadAbortControllerRef.current === controller) {
                llmConfigsLoadAbortControllerRef.current = null;
            }
            if (llmConfigsLoadRequestIdRef.current === requestId) {
                setModelsLoading(false);
            }
        }
    }

    async function loadChatContext() {
        try {
            const data = await runDedupedRequest("chat-context", () => recruitmentApi<ChatContext>("/chat/context"));
            if (mountedRef.current) {
                setChatContext(data);
            }
            return data;
        } catch (error) {
            toast.error(recruitmentToast.loadFailed(recruitmentToastEntities.assistantContext, formatActionError(error)));
            throw error;
        }
    }

    async function loadMailSenders(options?: {silent?: boolean; reportError?: boolean}) {
        if (!canViewMail && !canManageMailSenders) {
            return [];
        }
        const requestId = mailSendersLoadRequestIdRef.current + 1;
        mailSendersLoadRequestIdRef.current = requestId;
        mailSendersLoadAbortControllerRef.current?.abort();
        const controller = new AbortController();
        mailSendersLoadAbortControllerRef.current = controller;
        if (!options?.silent) {
            setMailSendersLoading(true);
        }
        try {
            const data = await recruitmentApi<RecruitmentMailSenderConfig[]>("/mail-senders", {signal: controller.signal});
            if (mountedRef.current && mailSendersLoadRequestIdRef.current === requestId) {
                setAllMailSenderConfigs(data);
                mailSendersLoadedOnceRef.current = true;
            }
            return data;
        } catch (error) {
            if (isRecruitmentRequestAborted(error)) {
                return [];
            }
            if (!options?.silent && options?.reportError !== false) {
                toast.error(recruitmentToast.loadFailed(recruitmentToastEntities.mailSettings, formatActionError(error)));
            }
            throw error;
        } finally {
            if (mailSendersLoadAbortControllerRef.current === controller) {
                mailSendersLoadAbortControllerRef.current = null;
            }
            if (mailSendersLoadRequestIdRef.current === requestId) {
                setMailSendersLoading(false);
            }
        }
    }

    async function loadMailRecipients(options?: {silent?: boolean; reportError?: boolean}) {
        if (!canViewMail && !canManageMailRecipients) {
            return [];
        }
        const requestId = mailRecipientsLoadRequestIdRef.current + 1;
        mailRecipientsLoadRequestIdRef.current = requestId;
        mailRecipientsLoadAbortControllerRef.current?.abort();
        const controller = new AbortController();
        mailRecipientsLoadAbortControllerRef.current = controller;
        if (!options?.silent) {
            setMailRecipientsLoading(true);
        }
        try {
            const data = await recruitmentApi<RecruitmentMailRecipient[]>("/mail-recipients", {signal: controller.signal});
            if (mountedRef.current && mailRecipientsLoadRequestIdRef.current === requestId) {
                setAllMailRecipients(data);
                mailRecipientsLoadedOnceRef.current = true;
            }
            return data;
        } catch (error) {
            if (isRecruitmentRequestAborted(error)) {
                return [];
            }
            if (!options?.silent && options?.reportError !== false) {
                toast.error(recruitmentToast.loadFailed(recruitmentToastEntities.mailSettings, formatActionError(error)));
            }
            throw error;
        } finally {
            if (mailRecipientsLoadAbortControllerRef.current === controller) {
                mailRecipientsLoadAbortControllerRef.current = null;
            }
            if (mailRecipientsLoadRequestIdRef.current === requestId) {
                setMailRecipientsLoading(false);
            }
        }
    }

    async function loadMailDispatches(options?: {pageIndex?: number; silent?: boolean; reportError?: boolean}) {
        if (!canViewMail) {
            return null;
        }
        const requestedPageIndex = Math.max(0, options?.pageIndex ?? resumeMailDispatchPageIndex);
        const requestId = mailDispatchesLoadRequestIdRef.current + 1;
        mailDispatchesLoadRequestIdRef.current = requestId;
        mailDispatchesLoadAbortControllerRef.current?.abort();
        const controller = new AbortController();
        mailDispatchesLoadAbortControllerRef.current = controller;
        if (!options?.silent) {
            setMailDispatchesLoading(true);
        }
        try {
            const offset = requestedPageIndex * SETTINGS_LIST_PAGE_SIZE;
            const queryString = buildSettingsListQuery({
                limit: SETTINGS_LIST_PAGE_SIZE,
                offset,
                summary: true,
                orgCodes: activeBusinessOrgCodes,
            });
            const response = await recruitmentApi<SettingsListResponse<RecruitmentResumeMailDispatchSummary>>(
                `/resume-mail-dispatches?${queryString}`,
                {signal: controller.signal},
            );
            const page = normalizeSettingsListResponse(response, SETTINGS_LIST_PAGE_SIZE, offset);
            if (!mountedRef.current || mailDispatchesLoadRequestIdRef.current !== requestId) {
                return page;
            }
            const lastPageIndex = Math.max(0, Math.ceil(page.total / SETTINGS_LIST_PAGE_SIZE) - 1);
            if (requestedPageIndex > lastPageIndex) {
                setResumeMailDispatchPageIndex(lastPageIndex);
                return page;
            }
            setMailDispatchSettingsRows(page.items);
            setResumeMailDispatchTotal(page.total);
            mailDispatchesLoadedOnceRef.current = true;
            return page;
        } catch (error) {
            if (isRecruitmentRequestAborted(error)) {
                return null;
            }
            if (!options?.silent && options?.reportError !== false) {
                toast.error(recruitmentToast.loadFailed(recruitmentToastEntities.mailSettings, formatActionError(error)));
            }
            throw error;
        } finally {
            if (mailDispatchesLoadAbortControllerRef.current === controller) {
                mailDispatchesLoadAbortControllerRef.current = null;
            }
            if (mailDispatchesLoadRequestIdRef.current === requestId) {
                setMailDispatchesLoading(false);
            }
        }
    }

    async function ensureResumeMailDispatchHistoryLoaded(options?: {force?: boolean}) {
        if (!canViewMail) {
            return [];
        }
        if (!options?.force && resumeMailDispatchHistoryLoadedOnceRef.current) {
            return allResumeMailDispatches;
        }
        try {
            const data = await runDedupedRequest(
                "resume-mail-dispatch-history",
                () => recruitmentApi<RecruitmentResumeMailDispatch[]>("/resume-mail-dispatches"),
            );
            if (mountedRef.current) {
                setAllResumeMailDispatches(data);
                resumeMailDispatchHistoryLoadedOnceRef.current = true;
            }
            return data;
        } catch (error) {
            toast.error(recruitmentToast.loadFailed(recruitmentToastEntities.resumeMail, formatActionError(error)));
            throw error;
        }
    }

    async function loadMailAutoConfig(options?: {silent?: boolean; reportError?: boolean}) {
        if (!canViewMail && !canManageMailRecipients) {
            return null;
        }
        const requestId = mailAutoConfigLoadRequestIdRef.current + 1;
        mailAutoConfigLoadRequestIdRef.current = requestId;
        mailAutoConfigLoadAbortControllerRef.current?.abort();
        const controller = new AbortController();
        mailAutoConfigLoadAbortControllerRef.current = controller;
        if (!options?.silent) {
            setMailAutoConfigLoading(true);
        }
        try {
            const data = await recruitmentApi<RecruitmentMailAutoPushGlobalConfig>("/mail-auto-config", {signal: controller.signal});
            if (mountedRef.current && mailAutoConfigLoadRequestIdRef.current === requestId) {
                setMailAutoPushGlobalConfig(data);
                mailAutoConfigLoadedOnceRef.current = true;
            }
            return data;
        } catch (error) {
            if (isRecruitmentRequestAborted(error)) {
                return null;
            }
            if (!options?.silent && options?.reportError !== false) {
                toast.error(recruitmentToast.loadFailed(recruitmentToastEntities.mailSettings, formatActionError(error)));
            }
            throw error;
        } finally {
            if (mailAutoConfigLoadAbortControllerRef.current === controller) {
                mailAutoConfigLoadAbortControllerRef.current = null;
            }
            if (mailAutoConfigLoadRequestIdRef.current === requestId) {
                setMailAutoConfigLoading(false);
            }
        }
    }

    async function loadMailSettings(options?: {silent?: boolean}) {
        const results = await Promise.allSettled([
            loadMailSenders({...options, reportError: false}),
            loadMailRecipients({...options, reportError: false}),
            loadMailDispatches({...options, reportError: false}),
            loadMailAutoConfig({...options, reportError: false}),
        ]);
        const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (failed) {
            if (!options?.silent) {
                toast.error(recruitmentToast.loadFailed(recruitmentToastEntities.mailSettings, formatActionError(failed.reason)));
            }
            throw failed.reason;
        }
    }

    async function ensureSkillsLoaded(options?: { force?: boolean }) {
        if (!options?.force && skillsLoadedOnceRef.current) {
            return allSkills;
        }
        const data = await loadSkills();
        skillsLoadedOnceRef.current = true;
        return data;
    }

    async function ensureMailSettingsLoaded(options?: { force?: boolean }) {
        const tasks: Promise<unknown>[] = [];
        const requestOptions = {reportError: false};
        if ((canViewMail || canManageMailSenders) && (options?.force || !mailSendersLoadedOnceRef.current)) {
            tasks.push(loadMailSenders(requestOptions));
        }
        if ((canViewMail || canManageMailRecipients) && (options?.force || !mailRecipientsLoadedOnceRef.current)) {
            tasks.push(loadMailRecipients(requestOptions));
        }
        if (canViewMail && (options?.force || !mailDispatchesLoadedOnceRef.current)) {
            tasks.push(loadMailDispatches(requestOptions));
        }
        if ((canViewMail || canManageMailRecipients) && (options?.force || !mailAutoConfigLoadedOnceRef.current)) {
            tasks.push(loadMailAutoConfig(requestOptions));
        }
        if (!tasks.length) {
            return;
        }
        const results = await Promise.allSettled(tasks);
        const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (failed) {
            toast.error(recruitmentToast.loadFailed(recruitmentToastEntities.mailSettings, formatActionError(failed.reason)));
            throw failed.reason;
        }
    }

    async function ensureResumeMailComposerDataLoaded() {
        const tasks: Promise<unknown>[] = [];
        const requestOptions = {reportError: false};
        if ((canViewMail || canManageMailSenders) && !mailSendersLoadedOnceRef.current) {
            tasks.push(loadMailSenders(requestOptions));
        }
        if ((canViewMail || canManageMailRecipients) && !mailRecipientsLoadedOnceRef.current) {
            tasks.push(loadMailRecipients(requestOptions));
        }
        if (!tasks.length) {
            return;
        }
        const results = await Promise.allSettled(tasks);
        const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (failed) {
            toast.error(recruitmentToast.loadFailed(recruitmentToastEntities.resumeMail, formatActionError(failed.reason)));
            throw failed.reason;
        }
    }

    async function ensureLLMConfigsLoaded(options?: { force?: boolean }) {
        if (!options?.force && llmConfigsLoadedOnceRef.current) {
            return allLlmConfigs;
        }
        return loadLLMConfigs();
    }

    async function saveMailAutoPushGlobalConfig(nextConfig: RecruitmentMailAutoPushGlobalConfig) {
        if (mailAutoPushConfigSaving) {
            return;
        }
        setMailAutoPushConfigSaving(true);
        try {
            const saved = await recruitmentApi<RecruitmentMailAutoPushGlobalConfig>("/mail-auto-config", {
                method: "PATCH",
                body: JSON.stringify({
                    global_default_recipient_ids: nextConfig.global_default_recipient_ids,
                    global_auto_push_enabled: nextConfig.global_auto_push_enabled,
                }),
            });
            setMailAutoPushGlobalConfig(saved);
            toast.success(recruitmentToast.saved(recruitmentToastEntities.globalAutoPushConfig));
        } catch (error) {
            toast.error(recruitmentToast.saveFailed(recruitmentToastEntities.globalAutoPushConfig, formatActionError(error)));
        } finally {
            setMailAutoPushConfigSaving(false);
        }
    }

    function resolveCandidatePipelineStatsScopeKey(departmentScope?: string, orgScope?: string, positionIdOverride?: string) {
        const query = candidateListRefreshQueryRef.current;
        const scopedOrgCode = resolveScopedOrgCode(
            departmentScope ?? query.departmentScope,
            orgScope ?? query.orgScope,
        );
        // 使用 ref 获取最新值，避免闭包中 state 是旧值的问题
        const activePositionId = String(positionIdOverride ?? query.positionFilter[0] ?? "").trim();
        return `${scopedOrgCode || ""}::${activePositionId}`;
    }

    function resolveCandidateStatsScopeKey(departmentScope?: string, orgScope?: string) {
        const query = candidateListRefreshQueryRef.current;
        const scopedOrgCode = resolveScopedOrgCode(
            departmentScope ?? query.departmentScope,
            orgScope ?? query.orgScope,
        );
        return scopedOrgCode || "";
    }

    async function refreshCandidatePipelineStats(departmentScope?: string, orgScope?: string, positionIdOverride?: string) {
        const requestId = candidatePipelineStatsLoadRequestIdRef.current + 1;
        candidatePipelineStatsLoadRequestIdRef.current = requestId;
        try {
            const query = candidateListRefreshQueryRef.current;
            const resolvedDepartmentScope = departmentScope ?? query.departmentScope;
            const resolvedOrgScope = orgScope ?? query.orgScope;
            const scopedOrgCode = resolveScopedOrgCode(resolvedDepartmentScope, resolvedOrgScope);
            const params = new URLSearchParams();
            if (scopedOrgCode) {
                params.set("org_code", scopedOrgCode);
            }
            // 使用 ref 获取最新值，避免闭包中 state 是旧值的问题
            const activePositionId = String(positionIdOverride ?? query.positionFilter[0] ?? "").trim();
            if (activePositionId) {
                params.set("position_id", activePositionId);
            }
            const queryString = params.toString();
            const stats = await runDedupedRequest(
                `candidate-pipeline-stats:${queryString || "all"}`,
                () => recruitmentApi<import("@/lib/recruitment-api").CandidateStatsData>(`/candidates/stats${queryString ? `?${queryString}` : ""}`),
            );
            const requestedScopeKey = resolveCandidatePipelineStatsScopeKey(
                resolvedDepartmentScope,
                resolvedOrgScope,
                activePositionId,
            );
            if (
                !mountedRef.current
                || candidatePipelineStatsLoadRequestIdRef.current !== requestId
                || resolveCandidatePipelineStatsScopeKey() !== requestedScopeKey
            ) {
                return;
            }
            setCandidatePipelineStatsData(stats);
            candidateConsistencyRunningStatsUntilRef.current = Number(stats?.status_counts?.screening_running || 0) > 0
                ? Date.now() + CANDIDATE_CONSISTENCY_STATS_CONFIDENCE_MS
                : 0;
            setCandidatePipelineStatsScopeKey(requestedScopeKey);
        } catch {}
    }

    refreshActiveCandidateListRef.current = refreshActiveCandidateList;
    refreshCandidatePipelineStatsRef.current = refreshCandidatePipelineStats;
    refreshCandidateStatsRef.current = refreshCandidateStats;
    loadCandidatePositionsRef.current = loadPositions;

    async function refreshCandidateStats(departmentScope?: string, orgScope?: string) {
        const requestId = candidateStatsLoadRequestIdRef.current + 1;
        candidateStatsLoadRequestIdRef.current = requestId;
        const query = candidateListRefreshQueryRef.current;
        const resolvedDepartmentScope = departmentScope ?? query.departmentScope;
        const resolvedOrgScope = orgScope ?? query.orgScope;
        const scopedOrgCode = resolveScopedOrgCode(resolvedDepartmentScope, resolvedOrgScope);
        const requestedScopeKey = resolveCandidateStatsScopeKey(resolvedDepartmentScope, resolvedOrgScope);
        const orgCodeParam = scopedOrgCode ? `?org_code=${encodeURIComponent(scopedOrgCode)}` : "";
        const isLatestScope = () => (
            mountedRef.current
            && candidateStatsLoadRequestIdRef.current === requestId
            && resolveCandidateStatsScopeKey() === requestedScopeKey
        );
        const refreshSummary = async () => {
            try {
                const stats = await runDedupedRequest(
                    `candidate-stats:${scopedOrgCode || "all"}`,
                    () => recruitmentApi<import("@/lib/recruitment-api").CandidateStatsData>(`/candidates/stats${orgCodeParam}`),
                );
                if (!isLatestScope()) {
                    return;
                }
                setCandidateStatsData(stats);
                setCandidateScopeTotal(Number(stats?.total || 0));
                if (activePageRef.current === "candidates") {
                    // 始终刷新 pipeline stats，从 ref 取最新岗位（避免闭包中 candidatePositionFilter 是旧值）
                    await refreshCandidatePipelineStats(resolvedDepartmentScope, resolvedOrgScope);
                }
            } catch {}
        };
        const refreshFunnel = async () => {
            try {
                const funnel = await runDedupedRequest(
                    `candidate-funnel:${scopedOrgCode || "all"}`,
                    () => recruitmentApi<import("@/lib/recruitment-api").RecruitmentFunnelData>(`/candidates/funnel${orgCodeParam}`),
                );
                if (!isLatestScope()) {
                    return;
                }
                setFunnelData(funnel);
            } catch {}
        };
        const refreshSources = async () => {
            try {
                const sources = await runDedupedRequest(
                    `candidate-source-stats:${scopedOrgCode || "all"}`,
                    () => recruitmentApi<import("@/lib/recruitment-api").SourceStatsData>(`/candidates/source-stats${orgCodeParam}`),
                );
                if (!isLatestScope()) {
                    return;
                }
                setSourceStatsData(sources);
            } catch {}
        };
        await Promise.allSettled([
            refreshSummary(),
            refreshFunnel(),
            refreshSources(),
        ]);
    }

    useEffect(() => {
        if (activePage !== "candidates") {
            return;
        }
        void refreshCandidatePipelineStats();
    }, [activePage, candidatePositionFilter, selectedDepartmentScope, selectedOrgScope]);

    async function refreshCoreData(options?: {
        includeMailSettings?: boolean;
        includePositions?: boolean;
        silent?: boolean;
        departmentScope?: string;
        orgScope?: string;
    }) {
        // 清除缓存，确保获取最新数据
        if (options?.includePositions !== false) {
            invalidatePositionsCache();
        }
        invalidateCandidatesCache();
        invalidateLogsCache();

        const deptScope = options?.departmentScope ?? selectedDepartmentScope;
        const companyScope = options?.orgScope ?? selectedOrgScope;

        // 直接调用 API，避免闭包中 selectedDepartmentScope 还是旧值的问题
        const candidatesPromise = loadCandidates({
            silent: true,
            force: true,
            departmentScope: deptScope,
            orgScope: companyScope,
            useVisibleFilters: activePage === "candidates",
        });

        const logsPromise = (async () => {
            const orgCodeParam = deptScope !== ALL_COMPANY_DEPARTMENTS_VALUE
                ? `org_code=${encodeURIComponent(deptScope)}`
                : companyScope
                    ? `org_code=${encodeURIComponent(companyScope)}`
                    : "";
            const url = orgCodeParam ? `/ai-task-logs?limit=20&offset=0&${orgCodeParam}` : "/ai-task-logs?limit=20&offset=0";
            const d = await recruitmentApi<{items: AITaskLog[]; total: number}>(url);
            setAllAiLogs(uniqueAiTaskLogs(d?.items || []));
            setAiLogTotal(d?.total || 0);
        })();

        const tasks: Promise<unknown>[] = [
            candidatesPromise,
            logsPromise,
            // 并行刷新漏斗/来源统计
            (async () => {
                const orgCodeParam = deptScope !== ALL_COMPANY_DEPARTMENTS_VALUE
                    ? `?org_code=${encodeURIComponent(deptScope)}`
                    : companyScope
                        ? `?org_code=${encodeURIComponent(companyScope)}`
                        : "";
                const stats = await recruitmentApi<import("@/lib/recruitment-api").CandidateStatsData>(`/candidates/stats${orgCodeParam}`);
                setCandidateStatsData(stats);
                setCandidateScopeTotal(Number(stats?.total || 0));
            })(),
            (async () => {
                const orgCodeParam = deptScope !== ALL_COMPANY_DEPARTMENTS_VALUE
                    ? `?org_code=${encodeURIComponent(deptScope)}`
                    : companyScope
                        ? `?org_code=${encodeURIComponent(companyScope)}`
                        : "";
                const f = await recruitmentApi<import("@/lib/recruitment-api").RecruitmentFunnelData>(`/candidates/funnel${orgCodeParam}`);
                setFunnelData(f);
            })(),
            (async () => {
                const orgCodeParam = deptScope !== ALL_COMPANY_DEPARTMENTS_VALUE
                    ? `?org_code=${encodeURIComponent(deptScope)}`
                    : companyScope
                        ? `?org_code=${encodeURIComponent(companyScope)}`
                        : "";
                const s = await recruitmentApi<import("@/lib/recruitment-api").SourceStatsData>(`/candidates/source-stats${orgCodeParam}`);
                setSourceStatsData(s);
            })(),
        ];
        if (options?.includePositions !== false) {
            tasks.unshift(loadPositions());
        }
        if (options?.includeMailSettings) {
            tasks.push(loadMailSettings());
        }
        await Promise.allSettled(tasks);

        // 静默刷新时不显示 toast
        if (!options?.silent) {
            toast.success(recruitmentToast.dataRefreshed);
        }
    }

    async function refreshLLMConfigsWithFeedback() {
        if (modelsLoading) {
            return;
        }
        try {
            await loadLLMConfigs();
            toast.success(recruitmentToast.refreshed(recruitmentToastEntities.modelConfigs));
        } catch {
            // loadLLMConfigs already reports the error toast
        }
    }

    async function refreshMailSettingsWithFeedback() {
        if (mailSettingsLoading) {
            return;
        }
        try {
            await loadMailSettings();
            toast.success(recruitmentToast.refreshed(recruitmentToastEntities.mailSettings));
        } catch {
            // loadMailSettings already reports the error toast
        }
    }

    async function refreshLogsWithFeedback() {
        if (logsLoading) {
            return;
        }
        try {
            await loadLogs();
            toast.success(recruitmentToast.refreshed(recruitmentToastEntities.taskLogs));
        } catch {
            // loadLogs already reports the error toast
        }
    }

    function openTaskLogDetail(logId?: number | null) {
        if (!logId) {
            return;
        }
        navigateToRecruitmentPage("audit");
        setSelectedLogId(logId);
    }

    function flushPendingLogUpdates() {
        const updates = pendingLogUpdatesRef.current;
        pendingLogUpdatesRef.current = [];
        logFlushRafRef.current = null;
        if (!updates.length) return;

        setCancellingTaskIds((current) => {
            let next = current;
            for (const log of updates) {
                if (log.status === "cancelling") {
                    if (!next.includes(log.id)) next = [...next, log.id];
                } else {
                    next = next.filter((item) => item !== log.id);
                }
            }
            return next;
        });

        setAllAiLogs((current) => {
            let changed = false;
            const next = [...current];
            for (const log of updates) {
                const index = next.findIndex((item) => item.id === log.id);
                if (index === -1) {
                    next.unshift(log);
                    changed = true;
                } else {
                    const existing = next[index];
                    if (existing.status !== log.status || existing.error_message !== log.error_message) {
                        next[index] = log;
                        changed = true;
                    }
                }
            }
            return changed ? next : current;
        });
    }

    function mergeAiTaskLog(log: AITaskLog) {
        pendingLogUpdatesRef.current.push(log);
        if (!logFlushRafRef.current) {
            logFlushRafRef.current = requestAnimationFrame(flushPendingLogUpdates);
        }
    }

    function stopTaskMonitor(taskId: number) {
        const timerId = taskMonitorTimersRef.current.get(taskId);
        if (timerId) {
            window.clearTimeout(timerId);
        }
        taskMonitorTimersRef.current.delete(taskId);
        taskMonitorTokensRef.current.delete(taskId);
    }

    function clearActiveScreeningTask(candidateId: number, taskId: number) {
        setActiveScreeningTaskMap((current) => {
            if (current[candidateId] !== taskId) {
                return current;
            }
            const next = {...current};
            delete next[candidateId];
            return next;
        });
        setActiveBatchScreeningTaskIds((current) => (
            current.includes(taskId)
                ? current.filter((item) => item !== taskId)
                : current
        ));
    }

    function clearScreeningTaskSnapshotsByTaskIds(taskIds: number[]) {
        if (!taskIds.length) {
            return;
        }
        const taskIdSet = new Set(taskIds);
        setAllCandidates((current) => {
            let changed = false;
            const next = current.map((candidate) => {
                const taskId = Number(candidate.active_screening_task_id || 0);
                if (!taskId || !taskIdSet.has(taskId)) {
                    return candidate;
                }
                const sanitized = sanitizeTerminalScreeningCandidateSnapshot(candidate, "cancelled");
                if (!sanitized) {
                    return candidate;
                }
                changed = true;
                return mergeCandidatePatch(candidate, sanitized);
            });
            return changed ? next : current;
        });
        if (
            candidateDetail?.candidate.active_screening_task_id
            && taskIdSet.has(candidateDetail.candidate.active_screening_task_id)
        ) {
            const sanitized = sanitizeTerminalScreeningCandidateSnapshot(candidateDetail.candidate, "cancelled");
            if (sanitized) {
                applyCandidateDetailSnapshot(sanitized);
            }
        }
    }

    function attachScreeningTaskMonitor(
        candidateId: number,
        taskId: number,
        options?: {
            batch?: boolean;
            suppressFinishToast?: boolean;
        },
    ) {
        setActiveScreeningTaskMap((current) => ({
            ...current,
            [candidateId]: taskId,
        }));
        if (options?.batch) {
            setActiveBatchScreeningTaskIds((current) => Array.from(new Set([...current, taskId])));
        }
        const queuedScreeningSnapshot: Partial<CandidateSummary> = {
            id: candidateId,
            active_screening_task_id: taskId,
            active_screening_task_type: "screening_flow",
            active_screening_task_status: "queued",
            active_screening_status: "queued",
            active_screening_stage: "queued",
            active_screening_auto_retry_scheduled: false,
            display_status_reason: "",
        };
        // Optimistic update: immediately set active_screening_task_status on the candidate
        // and let the list sync logic move it out of stale status tabs.
        syncRealtimeCandidateLists(queuedScreeningSnapshot, { insertIntoCandidateList: true });
        applyCandidateDetailSnapshot(queuedScreeningSnapshot);
        if (options?.batch) {
            // Batch tasks: skip startTaskMonitor polling, rely on SSE events
            // (task_completed / batch_summary) to drive UI updates instead of
            // N independent HTTP poll loops.
        }
    }

    useEffect(() => {
        const liveIds = new Set<number>();
        candidates.forEach((candidate) => {
            if (!candidate.active_screening_task_id || !candidate.active_screening_task_status || !isLiveTaskStatus(candidate.active_screening_task_status)) {
                return;
            }
            liveIds.add(candidate.id);
            if (taskMonitorTokensRef.current.has(candidate.active_screening_task_id)) {
                return;
            }
            if (activeScreeningTaskMap[candidate.id] === candidate.active_screening_task_id) {
                return;
            }
            attachScreeningTaskMonitor(candidate.id, candidate.active_screening_task_id, {
                batch: true,
                suppressFinishToast: true,
            });
        });
        // Clean up stale entries: candidates whose tasks are no longer live
        setActiveScreeningTaskMap((current) => {
            const staleIds = Object.keys(current)
                .map(Number)
                .filter((id) => !liveIds.has(id));
            if (staleIds.length === 0) return current;
            const next = { ...current };
            staleIds.forEach((id) => {
                const staleTaskId = next[id];
                delete next[id];
                if (staleTaskId) {
                    setActiveBatchScreeningTaskIds((batch) => batch.filter((taskId) => taskId !== staleTaskId));
                }
            });
            return next;
        });
    }, [candidates]);

    function updateChatMessage(messageId: string, updater: (message: ChatMessage) => ChatMessage) {
        setChatMessages((current) => current.map((message) => (
            message.id === messageId ? updater(message) : message
        )));
    }

    function isAssistantViewportNearBottom(viewport: HTMLDivElement, threshold = 96) {
        const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
        return distanceFromBottom <= threshold;
    }

    const scrollAssistantToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
        const viewport = assistantScrollAreaRef.current;
        if (!viewport) {
            return;
        }
        setAutoFollowStream(true);
        setIsUserScrolledUp(false);
        window.requestAnimationFrame(() => {
            viewport.scrollTo({
                top: viewport.scrollHeight,
                behavior,
            });
        });
    }, []);

    const handleAssistantScroll = useCallback(() => {
        const viewport = assistantScrollAreaRef.current;
        if (!viewport) {
            return;
        }
        const nearBottom = isAssistantViewportNearBottom(viewport);
        setAutoFollowStream((current) => (current === nearBottom ? current : nearBottom));
        setIsUserScrolledUp((current) => (current === !nearBottom ? current : !nearBottom));
    }, []);

    function extractChatReplyFromLog(log: AITaskLog) {
        const parsed = parseStructuredLogOutput(log.output_snapshot);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const reply = (parsed as Record<string, unknown>).reply;
            if (typeof reply === "string" && reply.trim()) {
                return reply.trim();
            }
        }
        if (typeof parsed === "string" && parsed.trim()) {
            return parsed.trim();
        }
        if (log.status === "cancelled") {
            return isZh ? "已停止生成。" : "Generation stopped.";
        }
        if (log.status === "failed") {
            return isZh ? `发送失败：${log.error_message || "未知错误"}` : `Request failed: ${log.error_message || "Unknown error"}`;
        }
        return log.output_summary || (isZh ? "已完成" : "Completed");
    }

    function extractSkillGeneratedTextValue(value: unknown): string {
        if (typeof value === "string") {
            return value.trim();
        }
        if (Array.isArray(value)) {
            return value.map(extractSkillGeneratedTextValue).filter(Boolean).join("").trim();
        }
        if (!value || typeof value !== "object") {
            return "";
        }
        const record = value as Record<string, unknown>;
        for (const key of ["markdown", "text", "content", "completion"]) {
            const extracted = extractSkillGeneratedTextValue(record[key]);
            if (extracted) {
                return extracted;
            }
        }
        if (typeof record.html === "string" && record.html.trim()) {
            return record.html
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<[^>]+>/g, "")
                .trim();
        }
        return "";
    }

    function extractSkillGeneratedContentFromLog(log: AITaskLog): string {
        const parsedSnapshot = parseStructuredLogOutput(log.output_snapshot);
        const snapshotRecord = parsedSnapshot && typeof parsedSnapshot === "object" && !Array.isArray(parsedSnapshot)
            ? parsedSnapshot as Record<string, unknown>
            : null;
        const snapshotContent = snapshotRecord && "content" in snapshotRecord
            ? snapshotRecord.content
            : parsedSnapshot;
        const snapshotText = extractSkillGeneratedTextValue(snapshotContent);
        if (snapshotText) {
            return snapshotText;
        }
        if (log.status === "success") {
            return extractSkillGeneratedTextValue(parseStructuredLogOutput(log.output_summary || ""));
        }
        return "";
    }

    async function recoverSkillGeneratedContentFromLog(taskId: number, signal?: AbortSignal): Promise<string | null> {
        for (let attempt = 0; attempt < 30; attempt += 1) {
            if (signal?.aborted) {
                return null;
            }
            if (attempt > 0) {
                await new Promise((resolve) => window.setTimeout(resolve, 2000));
                if (signal?.aborted) {
                    return null;
                }
            }
            const log = await recruitmentApi<AITaskLog>(`/ai-task-logs/${taskId}`);
            mergeAiTaskLog(log);
            if (selectedLogIdRef.current === taskId) {
                setSelectedLogDetail(log);
            }
            if (log.status === "success") {
                return extractSkillGeneratedContentFromLog(log) || null;
            }
            if (log.status === "failed") {
                throw new Error(log.error_message || (isZh ? "评估方案生成失败" : "Assessment plan generation failed"));
            }
            if (log.status === "cancelled") {
                return null;
            }
            if (isTerminalTaskStatus(log.status)) {
                return null;
            }
        }
        return null;
    }

    async function cancelTaskGeneration(taskId: number, taskLabel: string, options?: { silent?: boolean }) {
        if (cancellingTaskIds.includes(taskId)) {
            return null;
        }
        setCancellingTaskIds((current) => (current.includes(taskId) ? current : [...current, taskId]));
        try {
            const log = await recruitmentApi<AITaskLog>(`/ai-task-logs/${taskId}/cancel`, {
                method: "POST",
            });
            mergeAiTaskLog(log);
            if (selectedLogIdRef.current === taskId) {
                setSelectedLogDetail(log);
            }
            if (!options?.silent) {
                toast.success(
                    log.status === "cancelled"
                        ? recruitmentToast.stopped(taskLabel)
                        : recruitmentToast.stopRequested(taskLabel),
                );
            }
            return log;
        } catch (error) {
            setCancellingTaskIds((current) => current.filter((item) => item !== taskId));
            throw error;
        }
    }

    function startTaskMonitor(
        taskId: number,
        {
            onUpdate,
            onFinish,
        }: {
            onUpdate?: (log: AITaskLog) => void;
            onFinish?: (log: AITaskLog) => Promise<void> | void;
        },
    ) {
        stopTaskMonitor(taskId);
        let polling = false;
        let failureCount = 0;
        const token = Symbol(`task-monitor-${taskId}`);
        taskMonitorTokensRef.current.set(taskId, token);

        const scheduleNextPoll = (delay: number) => {
            if (!mountedRef.current || taskMonitorTokensRef.current.get(taskId) !== token) {
                return;
            }
            const timerId = window.setTimeout(() => {
                void poll();
            }, delay);
            taskMonitorTimersRef.current.set(taskId, timerId);
        };

        const poll = async () => {
            if (polling || !mountedRef.current || taskMonitorTokensRef.current.get(taskId) !== token) {
                return;
            }
            polling = true;
            try {
                const log = await recruitmentApi<AITaskLog>(`/ai-task-logs/${taskId}`);
                if (!mountedRef.current || taskMonitorTokensRef.current.get(taskId) !== token) {
                    return;
                }
                failureCount = 0;
                mergeAiTaskLog(log);
                if (selectedLogIdRef.current === taskId) {
                    setSelectedLogDetail(log);
                }
                onUpdate?.(log);
                if (isTerminalTaskStatus(log.status)) {
                    stopTaskMonitor(taskId);
                    await onFinish?.(log);
                    return;
                }
            } catch {
                failureCount = Math.min(failureCount + 1, 3);
            } finally {
                polling = false;
                if (mountedRef.current && taskMonitorTokensRef.current.get(taskId) === token) {
                    const activeCount = taskMonitorTimersRef.current.size;
                    const batchScale = activeCount > TASK_MONITOR_BATCH_SCALE_THRESHOLD
                        ? Math.min(3, 1 + Math.floor(activeCount / TASK_MONITOR_BATCH_SCALE_THRESHOLD))
                        : 1;
                    scheduleNextPoll(getPollingDelay(
                        pageVisibleRef.current,
                        failureCount,
                        TASK_MONITOR_VISIBLE_INTERVAL_MS * batchScale,
                        TASK_MONITOR_HIDDEN_INTERVAL_MS,
                        TASK_MONITOR_MAX_INTERVAL_MS,
                    ));
                }
            }
        };

        void poll();
    }

    function openAssistantMode(mode: AssistantDisplayMode) {
        if (!canViewRecruitmentAssistant) {
            return;
        }
        setAssistantContextExpanded(false);
        setAssistantQuickActionsExpanded(false);
        if (mode === "page") {
            setAssistantOpen(false);
            setAssistantDisplayMode("page");
            navigateToRecruitmentPage("assistant");
            return;
        }
        setAssistantDisplayMode(mode);
        setAssistantOpen(true);
    }

    function focusAssistantInput(moveCursorToEnd = false) {
        const input = assistantInputRef.current;
        if (!input) {
            return;
        }
        input.focus({preventScroll: true});
        if (moveCursorToEnd) {
            const length = input.value.length;
            input.setSelectionRange(length, length);
        }
    }

    function queueAssistantInputFocus(moveCursorToEnd = false) {
        window.requestAnimationFrame(() => {
            focusAssistantInput(moveCursorToEnd);
        });
    }

    function preventAssistantActionFocusLoss(event: React.MouseEvent<HTMLElement>) {
        event.preventDefault();
    }

    function applyAssistantPrompt(prompt: string, options?: { openMode?: AssistantDisplayMode }) {
        setChatInput(prompt);
        if (options?.openMode) {
            openAssistantMode(options.openMode);
        }
        queueAssistantInputFocus(true);
    }

    function shouldUseStreamingAssistant(
        message: string,
        clarificationResponse?: RecruitmentAssistantClarificationResponse | null,
    ) {
        return Boolean(clarificationResponse?.selections?.length || message.trim());
    }

    function getLatestAssistantQueryCursor() {
        for (let index = chatMessages.length - 1; index >= 0; index -= 1) {
            const cursor = chatMessages[index]?.queryPageInfo?.next_cursor;
            if (cursor) {
                return cursor;
            }
        }
        return null;
    }

    function buildStreamingAssistantRuntimeContext(message: string) {
        const currentChatContext = chatContextRef.current;
        const selectedPosition = selectedPositionIdRef.current
            ? positionMap.get(selectedPositionIdRef.current) || null
            : null;
        const selectedCandidate = selectedCandidateIdRef.current
            ? candidateMap.get(selectedCandidateIdRef.current) || null
            : null;
        const wantsCurrentPosition = /当前岗位|当前职位|本岗位|该岗位/.test(message);
        const wantsCurrentCandidate = /当前候选人|当前人选|这位候选人|这个候选人|面试题|初试题|复试题|出题|生成题/.test(message);
        const contextPositionId = currentChatContext.position_id
            || (wantsCurrentPosition ? selectedPositionIdRef.current : null)
            || null;
        const resolvedPosition = contextPositionId ? positionMap.get(contextPositionId) || null : null;

        return {
            position_id: contextPositionId,
            position_title: resolvedPosition?.title
                || currentChatContext.position_title
                || (wantsCurrentPosition ? selectedPosition?.title || null : null),
            candidate_id: currentChatContext.candidate_id
                || (wantsCurrentCandidate ? selectedCandidateIdRef.current : null)
                || null,
            skill_ids: currentChatContext.skill_ids,
        };
    }

    function extractPreparedResumeMail(
        payload: RecruitmentAssistantToolResultPayload,
    ): RecruitmentAssistantPreparedResumeMail | null {
        if (payload.name !== "prepare_resume_mail") {
            return null;
        }
        const payloadRecord = payload.result && typeof payload.result === "object"
            ? payload.result as Record<string, unknown>
            : null;
        const preparedMail = payloadRecord?.prepared_mail;
        if (!preparedMail || typeof preparedMail !== "object") {
            return null;
        }
        return preparedMail as RecruitmentAssistantPreparedResumeMail;
    }

    function openAssistantPreparedResumeMailDialog(
        messageId: string,
        preparedMail: RecruitmentAssistantPreparedResumeMail,
        mode: ResumeMailDialogMode = "send",
    ) {
        setAssistantMailActionState((current) => ({
            ...current,
            [messageId]: {
                status: current[messageId]?.status === "sent" ? "sent" : "idle",
                editing: true,
                error: current[messageId]?.error ?? null,
                dispatchId: current[messageId]?.dispatchId ?? null,
            },
        }));
        setResumeMailSourceAssistantMessageId(messageId);
        openResumeMailDialog(preparedMail.candidate_ids, {
            mode,
            senderConfigId: preparedMail.sender_config_id ? String(preparedMail.sender_config_id) : defaultMailSenderId,
            recipientIds: preparedMail.recipient_ids,
            extraRecipientEmails: preparedMail.recipients
                .filter((item) => item.source === "direct_email")
                .map((item) => item.email)
                .join(", "),
            subject: preparedMail.subject,
            bodyText: preparedMail.body_text,
        });
    }

    async function runStreamingAssistant(
        message: string,
        options?: {
            clarificationResponse?: RecruitmentAssistantClarificationResponse | null;
            appendUserMessage?: boolean;
        },
    ) {
        const trimmedMessage = message.trim();
        if (!trimmedMessage) {
            return;
        }

        if (options?.appendUserMessage !== false) {
            setChatMessages((current) => [
                ...current,
                {id: `u-${Date.now()}`, role: "user", content: trimmedMessage, createdAt: new Date().toISOString()},
            ]);
        }
        setChatInput("");
        setChatSending(true);
        setAssistantStreamStopping(false);
        setCurrentAssistantRunId(null);
        setAutoFollowStream(true);
        setIsUserScrolledUp(false);

        const shouldContinuePaging = /下一页|继续查看/.test(trimmedMessage);
        const isInterviewGenerationMessage = /(面试题|初试题|复试题|面试问题|出几道题|来一套题|出题|生成题)/.test(trimmedMessage);
        const selectedPosition = selectedPositionIdRef.current
            ? positionMap.get(selectedPositionIdRef.current) || null
            : null;
        const selectedCandidate = selectedCandidateIdRef.current
            ? candidateMap.get(selectedCandidateIdRef.current) || null
            : null;
        const requestContext = buildStreamingAssistantRuntimeContext(trimmedMessage);
        const frontendDebugBase = {
            selectedPosition: selectedPosition
                ? {
                    id: selectedPosition.id,
                    title: selectedPosition.title,
                    status: selectedPosition.status,
                }
                : null,
            selectedPositionId: selectedPositionIdRef.current,
            selectedCandidate: selectedCandidate
                ? {
                    id: selectedCandidate.id,
                    name: selectedCandidate.name,
                    position_id: selectedCandidate.position_id,
                    position_title: selectedCandidate.position_title,
                    status: selectedCandidate.status,
                }
                : null,
            selectedCandidateId: selectedCandidateIdRef.current,
            currentChatContext: chatContextRef.current,
            requestPayloadContext: requestContext,
        };
        const streamMetrics = {
            requestStartedAtMs: performance.now(),
            requestStartedAtIso: new Date().toISOString(),
            responseHeadersAtMs: null as number | null,
            firstReaderChunkAtMs: null as number | null,
            firstStateWriteAtMs: null as number | null,
            firstVisiblePaintAtMs: null as number | null,
            completedAtMs: null as number | null,
            responseContentType: null as string | null,
            readerChunks: [] as Array<{index: number; byteLength: number; receivedAtMs: number}>,
        };
        const buildFrontendDebugPayload = () => ({
            ...frontendDebugBase,
            streamMetrics: {
                ...streamMetrics,
                readerChunks: [...streamMetrics.readerChunks],
            },
        });
        const requestBody: RecruitmentAssistantRunRequest = {
            message: trimmedMessage,
            context: requestContext,
            clarification_response: options?.clarificationResponse || null,
            pagination: shouldContinuePaging
                ? {
                    cursor: getLatestAssistantQueryCursor(),
                    limit: DEFAULT_QUERY_CANDIDATES_LIMIT,
                }
                : undefined,
        };

        const abortController = new AbortController();
        assistantStreamAbortRef.current = abortController;
        const predictedModelConfig = isInterviewGenerationMessage ? interviewActiveLLMConfig : assistantActiveLLMConfig;
        let activeAssistantMessageId: string | null = null;

        console.info("[recruitment][assistant][stream][frontend]", {
            message: trimmedMessage,
            ...frontendDebugBase,
            streamMetrics: buildFrontendDebugPayload().streamMetrics,
        });

        try {
            const response = await authenticatedFetch("/api/recruitment/chat/runs", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "text/event-stream",
                },
                body: JSON.stringify(requestBody),
                signal: abortController.signal,
            });

            if (!response.ok || !response.body) {
                const errorText = await response.text().catch(() => "");
                throw new Error(errorText || "流式助手请求失败");
            }

            streamMetrics.responseHeadersAtMs = performance.now();
            streamMetrics.responseContentType = response.headers.get("content-type");
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let runCompleted = false;
            let awaitingClarification = false;
            let refreshInterviewCandidateId: number | null = null;
            const pendingToolResults: RecruitmentAssistantToolResultPayload[] = [];
            let readerChunkIndex = 0;
            let firstVisiblePaintScheduled = false;

            const ensureAssistantMessage = (messageId: string) => {
                activeAssistantMessageId = messageId;
                const pendingPreparedMail = pendingToolResults
                    .map((item) => extractPreparedResumeMail(item))
                    .find((item) => Boolean(item)) || null;
                setActiveChatMessageId((current) => (current === messageId ? current : messageId));
                setChatMessages((current) => (
                    current.some((item) => item.id === messageId)
                        ? current
                        : [
                            ...current,
                            {
                                id: messageId,
                                role: "assistant",
                                content: "",
                                createdAt: new Date().toISOString(),
                                streamStatus: "streaming",
                                sourceRunType: "stream",
                                frontendDebug: buildFrontendDebugPayload(),
                                modelProvider: predictedModelConfig?.resolved_provider || predictedModelConfig?.provider || null,
                                modelName: predictedModelConfig?.resolved_model_name || predictedModelConfig?.model_name || null,
                                toolResults: pendingToolResults.length ? [...pendingToolResults] : undefined,
                                mailConfirmationRequest: pendingPreparedMail,
                            },
                        ]
                ));
            };

            const syncFrontendDebug = (messageId: string) => {
                updateChatMessage(messageId, (chatMessage) => ({
                    ...chatMessage,
                    frontendDebug: buildFrontendDebugPayload(),
                }));
            };

            const applyEvent = (event: RecruitmentAssistantStreamEvent) => {
                switch (event.event) {
                    case "run.started": {
                        setCurrentAssistantRunId(event.run_id);
                        break;
                    }
                    case "message.started": {
                        const payload = event.payload as { message_id: string };
                        ensureAssistantMessage(payload.message_id);
                        break;
                    }
                    case "message.delta": {
                        const payload = event.payload as { message_id: string; delta: string };
                        ensureAssistantMessage(payload.message_id);
                        if (streamMetrics.firstStateWriteAtMs === null) {
                            streamMetrics.firstStateWriteAtMs = performance.now();
                        }
                        updateChatMessage(payload.message_id, (chatMessage) => ({
                            ...chatMessage,
                            content: `${chatMessage.content || ""}${payload.delta}`,
                            streamStatus: "streaming",
                            sourceRunType: "stream",
                            frontendDebug: buildFrontendDebugPayload(),
                        }));
                        if (!firstVisiblePaintScheduled) {
                            firstVisiblePaintScheduled = true;
                            requestAnimationFrame(() => {
                                streamMetrics.firstVisiblePaintAtMs = performance.now();
                                syncFrontendDebug(payload.message_id);
                            });
                        }
                        break;
                    }
                    case "message.completed": {
                        const payload = event.payload as RecruitmentAssistantMessageCompletedPayload;
                        ensureAssistantMessage(payload.message_id);
                        updateChatMessage(payload.message_id, (chatMessage) => ({
                            ...chatMessage,
                            content: payload.content,
                            queryPageInfo: payload.page as RecruitmentAssistantPageInfo | undefined,
                            streamStatus: "done",
                            sourceRunType: "stream",
                            frontendDebug: buildFrontendDebugPayload(),
                        }));
                        break;
                    }
                    case "tool.result": {
                        const payload = event.payload as RecruitmentAssistantToolResultPayload;
                        if (!activeAssistantMessageId) {
                            pendingToolResults.push(payload);
                            break;
                        }
                        const payloadRecord = payload.result && typeof payload.result === "object"
                            ? payload.result as Record<string, unknown>
                            : null;
                        const taskLog = payloadRecord?.task_log && typeof payloadRecord.task_log === "object"
                            ? payloadRecord.task_log as Record<string, unknown>
                            : null;
                        const candidateRecord = payloadRecord?.candidate && typeof payloadRecord.candidate === "object"
                            ? payloadRecord.candidate as Record<string, unknown>
                            : null;
                        const preparedMail = extractPreparedResumeMail(payload);
                        updateChatMessage(activeAssistantMessageId, (chatMessage) => ({
                            ...chatMessage,
                            toolResults: [...(chatMessage.toolResults || []), payload],
                            mailConfirmationRequest: preparedMail || chatMessage.mailConfirmationRequest || null,
                            logId: typeof taskLog?.id === "number" ? taskLog.id : chatMessage.logId,
                            memorySource: typeof taskLog?.memory_source === "string" ? taskLog.memory_source : chatMessage.memorySource,
                            modelProvider: typeof taskLog?.model_provider === "string" ? taskLog.model_provider : chatMessage.modelProvider,
                            modelName: typeof taskLog?.model_name === "string" ? taskLog.model_name : chatMessage.modelName,
                            usedSkills: Array.isArray(taskLog?.related_skill_snapshots)
                                ? taskLog.related_skill_snapshots as RecruitmentSkill[]
                                : chatMessage.usedSkills,
                            usedFallback: typeof taskLog?.status === "string"
                                ? (taskLog.status === "fallback")
                                : chatMessage.usedFallback,
                            fallbackError: typeof taskLog?.error_message === "string"
                                ? taskLog.error_message
                                : chatMessage.fallbackError,
                            frontendDebug: buildFrontendDebugPayload(),
                        }));
                        if (payload.name === "generate_interview_questions" && typeof candidateRecord?.id === "number") {
                            refreshInterviewCandidateId = candidateRecord.id;
                        }
                        break;
                    }
                    case "clarification.required": {
                        const payload = event.payload as RecruitmentAssistantClarificationRequest;
                        awaitingClarification = true;
                        if (!activeAssistantMessageId) {
                            const fallbackMessageId = `a-${Date.now()}`;
                            ensureAssistantMessage(fallbackMessageId);
                        }
                        updateChatMessage(activeAssistantMessageId || `a-${Date.now()}`, (chatMessage) => ({
                            ...chatMessage,
                            clarificationRequest: payload,
                            streamStatus: "done",
                            sourceRunType: "stream",
                            frontendDebug: buildFrontendDebugPayload(),
                        }));
                        break;
                    }
                    case "run.completed": {
                        streamMetrics.completedAtMs = performance.now();
                        setCurrentAssistantRunId(null);
                        setAssistantStreamStopping(false);
                        if (activeAssistantMessageId) {
                            syncFrontendDebug(activeAssistantMessageId);
                        }
                        runCompleted = true;
                        break;
                    }
                    case "run.error": {
                        const payload = event.payload as { message: string };
                        const nextMessageId = activeAssistantMessageId || `e-${Date.now()}`;
                        ensureAssistantMessage(nextMessageId);
                        updateChatMessage(nextMessageId, (chatMessage) => ({
                            ...chatMessage,
                            content: isZh ? `发送失败：${payload.message}` : `Request failed: ${payload.message}`,
                            streamStatus: "error",
                            sourceRunType: "stream",
                            frontendDebug: buildFrontendDebugPayload(),
                        }));
                        toast.error(recruitmentToast.sendFailed("发送", payload.message));
                        setCurrentAssistantRunId(null);
                        setAssistantStreamStopping(false);
                        runCompleted = true;
                        break;
                    }
                    default:
                        break;
                }
            };

            while (true) {
                const {done, value} = await reader.read();
                if (done) {
                    break;
                }
                const chunkReceivedAtMs = performance.now();
                if (streamMetrics.firstReaderChunkAtMs === null) {
                    streamMetrics.firstReaderChunkAtMs = chunkReceivedAtMs;
                }
                if (streamMetrics.readerChunks.length < 20) {
                    streamMetrics.readerChunks.push({
                        index: readerChunkIndex += 1,
                        byteLength: value.byteLength,
                        receivedAtMs: chunkReceivedAtMs,
                    });
                }
                buffer += decoder.decode(value, {stream: true});

                let separatorIndex = buffer.indexOf("\n\n");
                while (separatorIndex !== -1) {
                    const rawEvent = buffer.slice(0, separatorIndex);
                    buffer = buffer.slice(separatorIndex + 2);
                    separatorIndex = buffer.indexOf("\n\n");

                    const lines = rawEvent.split("\n");
                    const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() as RecruitmentAssistantStreamEventType | undefined;
                    const dataLines = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
                    if (!eventName || !dataLines) {
                        continue;
                    }
                    try {
                        applyEvent(JSON.parse(dataLines) as RecruitmentAssistantStreamEvent);
                    } catch {
                        // Ignore malformed chunks and continue reading the stream.
                    }
                }
            }

            if (!runCompleted && !awaitingClarification && activeAssistantMessageId) {
                streamMetrics.completedAtMs = performance.now();
                updateChatMessage(activeAssistantMessageId, (chatMessage) => ({
                    ...chatMessage,
                    streamStatus: "done",
                    sourceRunType: "stream",
                    frontendDebug: buildFrontendDebugPayload(),
                }));
            }
            if (refreshInterviewCandidateId !== null) {
                await Promise.all([
                    loadLogs({silent: true}),
                    refreshCandidateStats(),
                    selectedCandidateIdRef.current === refreshInterviewCandidateId
                        ? loadCandidateDetail(refreshInterviewCandidateId, {silent: true})
                        : Promise.resolve(null),
                ]);
            }
        } catch (error) {
            const wasAborted = abortController.signal.aborted
                || (error instanceof DOMException && error.name === "AbortError")
                || (error instanceof Error && /abort/i.test(`${error.name}:${error.message}`));
            if (!wasAborted) {
                throw error;
            }
            if (activeAssistantMessageId) {
                updateChatMessage(activeAssistantMessageId, (chatMessage) => ({
                    ...chatMessage,
                    streamStatus: "done",
                    sourceRunType: "stream",
                    frontendDebug: buildFrontendDebugPayload(),
                }));
            }
            if (mountedRef.current) {
                toast.success(recruitmentToast.assistantGenerationStopped);
            }
        } finally {
            assistantStreamAbortRef.current = null;
            setCurrentAssistantRunId(null);
            setAssistantStreamStopping(false);
            setActiveChatMessageId((current) => (current === activeAssistantMessageId ? null : current));
            setChatSending(false);
        }
    }

    async function submitAssistantClarification(
        originalMessage: string,
        clarificationRequest: RecruitmentAssistantClarificationRequest,
        option: RecruitmentAssistantClarificationOption,
    ) {
        await runStreamingAssistant(originalMessage, {
            clarificationResponse: {
                selections: [
                    {
                        clarification_id: clarificationRequest.clarification_id,
                        entity_type: clarificationRequest.entity_type,
                        selected_id: option.id,
                    },
                ],
            },
            appendUserMessage: false,
        });
    }

    async function copyPublishJDText() {
        if (!currentPublishText.trim()) {
            toast.error(recruitmentToast.noPublishText);
            return;
        }
        try {
            await writeTextToClipboard(currentPublishText);
            toast.success(recruitmentToast.copied("发布文案"));
        } catch (error) {
            toast.error(recruitmentToast.copyFailed(error instanceof Error ? error.message : recruitmentToast.unknownError));
        }
    }

    async function copyBossJsonForCurrentPosition() {
        const currentPosition = positionDetail?.position || (selectedPositionId ? positionMap.get(selectedPositionId) : null);
        if (!currentPosition) {
            const message = "无法复制：未选择岗位";
            toast.error(message);
            return;
        }

        const result = buildBossJsonCopyPayload([currentPosition]);
        if (!result.ok) {
            toast.error(result.message);
            return;
        }

        try {
            await writeTextToClipboard(JSON.stringify(result.payload, null, 2));
            toast.success("BOSS 岗位 JSON 已复制");
        } catch (error) {
            const message = recruitmentToast.copyFailed(error instanceof Error ? error.message : recruitmentToast.unknownError);
            toast.error(message);
        }
    }

    // 加载候选人列表数据（点击候选人 Tab 时调用，支持服务端搜索）
    async function loadPositionCandidates(positionId: number, query?: string, status?: string) {
        const requestId = ++positionCandidatesLoadRequestIdRef.current;
        setPositionCandidatesLoading(true);
        try {
            const queryParam = query ? `&query=${encodeURIComponent(query)}` : "";
            const statusParam = status ? `&status=${encodeURIComponent(status)}` : "";
            const data = await recruitmentApi<{items: CandidateSummary[]; total: number}>(
                `/candidates?position_id=${positionId}&limit=${POSITION_CANDIDATE_PAGE_SIZE}&offset=0&compact=1${queryParam}${statusParam}`
            );
            if (mountedRef.current && positionCandidatesLoadRequestIdRef.current === requestId) {
                setPositionCandidatesData(data?.items || []);
                setPositionCandidatesTotal(data?.total || 0);
                setPositionCandidatesInitialLoaded(true);
            }
        } catch {
            if (
                mountedRef.current
                && positionCandidatesLoadRequestIdRef.current === requestId
                && positionDetail
                && !query
                && !status
            ) {
                setPositionCandidatesData((positionDetail.candidates || []).slice(0, POSITION_CANDIDATE_PAGE_SIZE));
                setPositionCandidatesTotal(positionDetail.position.candidate_count || positionDetail.candidates?.length || 0);
                setPositionCandidatesInitialLoaded(true);
            }
        } finally {
            if (mountedRef.current && positionCandidatesLoadRequestIdRef.current === requestId) {
                setPositionCandidatesLoading(false);
            }
        }
    }

    async function loadMorePositionCandidates(positionId: number) {
        if (positionCandidatesLoading || loadingMorePositionCandidatesRef.current || positionCandidatesData.length >= positionCandidatesTotal) return;
        loadingMorePositionCandidatesRef.current = true;
        setIsLoadingMorePositionCandidates(true);
        const currentRequestId = positionCandidatesLoadRequestIdRef.current;
        try {
            const queryParam = positionCandidateSearch ? `&query=${encodeURIComponent(positionCandidateSearch)}` : "";
            const statusParam = positionCandidateStatusFilter !== "__all__"
                ? `&status=${encodeURIComponent(positionCandidateStatusFilter)}`
                : "";
            const data = await recruitmentApi<{items: CandidateSummary[]; total: number}>(
                `/candidates?position_id=${positionId}&limit=${POSITION_CANDIDATE_PAGE_SIZE}&offset=${positionCandidatesData.length}&compact=1${queryParam}${statusParam}`
            );
            if (mountedRef.current && positionCandidatesLoadRequestIdRef.current === currentRequestId) {
                setPositionCandidatesData(prev => [...prev, ...(data?.items || [])]);
                setPositionCandidatesTotal(data?.total || positionCandidatesTotal);
            }
        } catch {
            // ignore
        } finally {
            loadingMorePositionCandidatesRef.current = false;
            if (mountedRef.current) {
                setIsLoadingMorePositionCandidates(false);
            }
        }
    }

    const handlePositionCandidateSelect = useCallback((candidateId: number) => {
        candidatePageTargetCandidateIdRef.current = candidateId;
        setCandidateDetailReviewContext(null);
        setSelectedCandidateId(candidateId);
        navigateToRecruitmentPage("candidates");
    }, []);

    const handleTalentPoolCandidateSelect = useCallback((candidateId: number) => {
        setCandidateDetailReviewContext(null);
        setTalentPoolDetailAssignOpen(false);
        setTalentPoolDetailAssignPositionId("");
        setTalentPoolDetailReidentifyConfirmOpen(false);
        setTalentPoolDetailAction(null);
        setSelectedCandidateId(candidateId);
        selectedCandidateIdRef.current = candidateId;
        setTalentPoolCandidateDetailOpen(true);
    }, []);

    const handlePositionCandidateSearchChange = useCallback((v: string) => {
        setPositionCandidateSearch(v);
    }, []);

    const handlePositionQueryChange = useCallback((v: string) => {
        setPositionQuery(v);
    }, []);

    function closeTalentPoolCandidateDetail() {
        setTalentPoolCandidateDetailOpen(false);
        setTalentPoolDetailAssignOpen(false);
        setTalentPoolDetailAssignPositionId("");
        setTalentPoolDetailReidentifyConfirmOpen(false);
        setTalentPoolDetailAction(null);
        setCandidateDetailReviewContext(null);
    }

    async function reidentifyTalentPoolCandidates(candidateIds: number[]) {
        const uniqueIds = Array.from(new Set(candidateIds.filter((candidateId) => Number.isFinite(candidateId))));
        if (!uniqueIds.length) {
            return {matched_count: 0, total_candidates: 0, message: ""};
        }
        const result = await triggerAIPositionMatch(uniqueIds);
        if ((result.total_candidates || 0) > 0) {
            uniqueIds.forEach((candidateId) => {
                const snapshot: Partial<CandidateSummary> = {id: candidateId, status: "matching"};
                syncRealtimeCandidateLists(snapshot);
                applyCandidateDetailSnapshot(snapshot);
            });
            void loadTalentPoolCandidates({silent: true});
        }
        return result;
    }

    async function cancelTalentPoolCandidateMatch(candidateId: number) {
        try {
            const result = await recruitmentApi<{
                cancelled?: boolean;
                status?: string;
                message?: string;
                candidate_snapshot?: Partial<CandidateSummary> | null;
            }>(`/candidates/${candidateId}/cancel-match`, {method: "POST"});
            const snapshot = result?.candidate_snapshot || {id: candidateId, status: result?.status || "unmatched"};
            syncRealtimeCandidateLists(snapshot);
            applyCandidateDetailSnapshot(snapshot);
            void loadTalentPoolCandidates({silent: true});
            return true;
        } catch (error) {
            console.warn("Failed to cancel match, refreshing talent pool state:", error);
            await loadTalentPoolCandidates({silent: true});
            try {
                await loadCandidateDetail(candidateId, {silent: true, force: true, skipChatContextSave: true});
            } catch {
                // 刷新详情失败时保留当前抽屉数据，列表状态仍以服务端为准。
            }
            toast.info(isZh ? "匹配状态已更新" : "Match status updated");
            return false;
        }
    }

    async function runTalentPoolDetailReidentify() {
        const candidateId = candidateDetail?.candidate.id;
        if (!candidateId || !canManageCandidate || talentPoolDetailAction) {
            return;
        }
        setTalentPoolDetailAction("reidentify");
        try {
            const result = await reidentifyTalentPoolCandidates([candidateId]);
            if ((result.total_candidates || 0) > 0) {
                const candidateName = candidateDetail?.candidate
                    ? resolveCandidateIdentity(candidateDetail.candidate).displayName
                    : (isZh ? "候选人" : "candidate");
                toast.success(isZh ? `已重新触发 AI 岗位识别：${candidateName}` : `AI position matching restarted for ${candidateName}`);
                closeTalentPoolCandidateDetail();
            } else {
                toast.info(result.message || (isZh ? "当前人才无需重新识别" : "This talent does not need re-identification"));
            }
        } catch (error) {
            toast.error(isZh ? `重新识别失败：${formatActionError(error)}` : `Failed to re-identify: ${formatActionError(error)}`);
        } finally {
            setTalentPoolDetailAction(null);
        }
    }

    function requestTalentPoolDetailReidentify() {
        const candidate = candidateDetail?.candidate;
        if (!candidate || !canManageCandidate || resolveTalentPoolDisplayStatus(candidate) === "matching") {
            return;
        }
        const reason = String(candidate.talent_pool_reason || "").trim().toLowerCase();
        if (reason !== "unmatched_by_ai" && reason !== "ai_error") {
            setTalentPoolDetailReidentifyConfirmOpen(true);
            return;
        }
        void runTalentPoolDetailReidentify();
    }

    async function runTalentPoolDetailCancelMatch() {
        const candidateId = candidateDetail?.candidate.id;
        if (!candidateId || !canManageCandidate || talentPoolDetailAction) {
            return;
        }
        setTalentPoolDetailAction("cancel-match");
        const cancelled = await cancelTalentPoolCandidateMatch(candidateId);
        if (cancelled) {
            toast.success(isZh ? "已停止 AI 岗位识别" : "AI position matching stopped");
        }
        setTalentPoolDetailAction(null);
    }

    function openTalentPoolDetailAssignment() {
        const candidate = candidateDetail?.candidate;
        if (!candidate || !canManageCandidate || resolveTalentPoolDisplayStatus(candidate) === "matching") {
            return;
        }
        setTalentPoolDetailAssignPositionId(candidate.ai_match_position_id ? String(candidate.ai_match_position_id) : "");
        setTalentPoolDetailAssignOpen(true);
    }

    async function submitTalentPoolDetailAssignment() {
        const candidateId = candidateDetail?.candidate.id;
        const positionId = Number(talentPoolDetailAssignPositionId);
        if (!candidateId || !Number.isFinite(positionId) || positionId <= 0 || !canManageCandidate || talentPoolDetailAssigning) {
            return;
        }
        setTalentPoolDetailAssigning(true);
        try {
            await batchBindPosition([candidateId], positionId, {skipSelectedDetailRefresh: true});
            setTalentPoolDetailAssignOpen(false);
            setTalentPoolCandidateDetailOpen(false);
            setTalentPoolDetailAssignPositionId("");
            setSelectedCandidateId(null);
            selectedCandidateIdRef.current = null;
            setCandidateDetail(null);
        } catch {
            // batchBindPosition 已展示服务端错误；保留弹窗供用户重试。
        } finally {
            setTalentPoolDetailAssigning(false);
        }
    }

    function renderTalentPoolCandidateDrawerContent() {
        if (
            candidateDetailLoading
            || (selectedCandidateId && candidateDetail?.candidate.id !== selectedCandidateId)
        ) {
            return (
                <div className="flex h-full items-center justify-center gap-2 text-[12px] text-[#86888F]">
                    <Loader2 className="h-4 w-4 animate-spin text-[#1E3BFA]"/>
                    {isZh ? "正在加载人才详情…" : "Loading talent details…"}
                </div>
            );
        }
        if (!candidateDetail) {
            return (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
                    <FileText className="h-7 w-7 text-[#B0B2B8]"/>
                    <p className="text-[13px] font-medium text-[#33353D]">{isZh ? "暂无人才详情" : "Talent details are unavailable"}</p>
                    <p className="text-[12px] text-[#86888F]">{isZh ? "请关闭后重新选择人才" : "Close the drawer and select the talent again"}</p>
                </div>
            );
        }

        const c = candidateDetail.candidate;
        const identity = resolveCandidateIdentity(c);
        const displayStatus = resolveTalentPoolDisplayStatus(c);
        const reason = String(c.talent_pool_reason || "").trim().toLowerCase();
        const sourceStage = (() => {
            if (displayStatus === "matching") return isZh ? "AI 岗位识别中" : "AI position matching";
            if (reason === "unmatched_by_ai") return isZh ? "AI 未识别岗位" : "AI unmatched";
            if (reason === "ai_error") return isZh ? "AI 识别异常" : "AI error";
            if (reason === "auto_archived") return isZh ? "初筛完成后入库" : "Archived after screening";
            if (reason === "evidence_review_required") return isZh ? "证据待人工复核" : "Evidence review required";
            if (reason === "moved_by_hr") {
                return c.talent_pool_source_status
                    ? labelForCandidateStatus(c.talent_pool_source_status)
                    : (isZh ? "手动归入人才库" : "Moved to talent pool");
            }
            return isZh ? "历史人才库数据" : "Legacy talent pool record";
        })();
        const badge = (() => {
            if (displayStatus === "matching") {
                return {label: isZh ? "识别中" : "Matching", background: "rgba(46,156,255,0.10)", color: "#2E9CFF"};
            }
            if (reason === "unmatched_by_ai" || reason === "ai_error") {
                return {label: isZh ? "待处理" : "Pending", background: "rgba(255,171,36,0.12)", color: "#D48806"};
            }
            if (c.ai_match_position_id && c.ai_match_position_title) {
                return {label: isZh ? "AI 识别" : "AI Match", background: "var(--ats-brand-tint)", color: "var(--ats-primary)"};
            }
            return {label: isZh ? "人才库中" : "In Talent Pool", background: "rgba(12,201,145,0.10)", color: "#0A9C71"};
        })();
        const enteredAt = c.talent_pool_moved_at || c.created_at || c.updated_at || null;
        const profileMeta = [c.years_of_experience, c.education, c.city].filter(Boolean).join(" · ") || (isZh ? "资料待完善" : "Profile incomplete");
        const avatarColors = ["var(--ats-primary)", "#2E9CFF", "#0CC991", "#7B61FF", "#FFAB24", "#F53F3F"];
        const avatarColor = avatarColors[Math.abs(c.id) % avatarColors.length];
        const tags = Array.isArray(c.tags) ? c.tags.filter(Boolean) : [];
        const sanitizedAiReason = sanitizeCandidateFacingErrorText(c.ai_match_reason || "", {
            context: resolveCandidateFacingErrorContext("ai_position_match"),
            language,
        });
        const confidence = c.ai_match_confidence == null
            ? null
            : Math.round(c.ai_match_confidence <= 1 ? c.ai_match_confidence * 100 : c.ai_match_confidence);
        const aiSummary = (() => {
            if (displayStatus === "matching") {
                return isZh ? "AI 正在识别该人才与当前开放岗位的匹配关系，结果会实时更新。" : "AI is matching this talent against current open positions. Results update in real time.";
            }
            if (reason === "ai_error") {
                return sanitizedAiReason || (isZh ? "AI 解析或岗位识别过程出现异常，建议重新识别或手动分配岗位。" : "AI parsing or position matching failed. Re-identify or assign a position manually.");
            }
            if (reason === "unmatched_by_ai") {
                return sanitizedAiReason || (isZh ? "未在当前开放岗位中找到合适匹配，可重新识别或手动分配岗位。" : "No suitable open position was found. Re-identify or assign one manually.");
            }
            if (c.ai_match_position_title) {
                const confidenceText = confidence == null ? "" : (isZh ? `，匹配置信度 ${confidence}%` : ` with ${confidence}% confidence`);
                return (isZh ? `AI 识别该人才与「${c.ai_match_position_title}」匹配度较高${confidenceText}。` : `AI identified a strong match with “${c.ai_match_position_title}”${confidenceText}.`) + (sanitizedAiReason ? ` ${sanitizedAiReason}` : "");
            }
            return isZh ? "该人才已进入人才库，可结合来源阶段和简历信息继续分配岗位或重新识别。" : "This talent is in the pool and can be assigned or re-identified using the source stage and resume details.";
        })();
        const sourceLabels: Record<string, string> = isZh ? {
            manual_upload: "手动上传",
            boss_zhipin: "Boss直聘",
            liepin: "猎聘",
            headhunter: "猎头推荐",
            other: "其他渠道",
        } : {
            manual_upload: "Manual upload",
            boss_zhipin: "Boss Zhipin",
            liepin: "Liepin",
            headhunter: "Headhunter",
            other: "Other",
        };
        const basicFields = [
            {label: isZh ? "工作年限" : "Experience", value: c.years_of_experience},
            {label: isZh ? "学历" : "Education", value: c.education},
            {label: isZh ? "所在城市" : "Current City", value: c.city},
            {label: isZh ? "来源阶段" : "Source Stage", value: sourceStage},
            {label: isZh ? "手机" : "Phone", value: c.phone},
            {label: isZh ? "邮箱" : "Email", value: c.email},
            {label: isZh ? "当前公司" : "Company", value: c.current_company},
            {label: isZh ? "期望城市" : "Expected City", value: c.expected_city},
            {label: isZh ? "年龄" : "Age", value: c.age != null ? String(c.age) : null},
            {label: isZh ? "人才编号" : "Talent ID", value: c.candidate_code},
            {label: isZh ? "简历来源" : "Resume Source", value: sourceLabels[c.source || ""] || c.source_detail || c.source},
            {label: isZh ? "识别岗位" : "Matched Position", value: c.ai_match_position_title || c.screened_position_title},
        ];
        const resumeFiles = candidateDetail.resume_files || [];
        const currentResume = resumeFiles.find((file) => file.id === c.latest_resume_file_id) || resumeFiles[0] || null;
        const resumeSummary = candidateDetail.parse_result?.summary || c.note_summary || c.notes || (isZh ? "暂无简历摘要，打开原始简历可查看完整内容。" : "No resume summary is available. Open the original resume for full details.");
        const score = candidateDetail.score;
        const statusHistory = candidateDetail.status_history || [];
        const hasMoreDetails = Boolean(score || resumeFiles.length > 1 || statusHistory.length);
        const actionPending = talentPoolDetailAction !== null || talentPoolDetailAssigning;

        return (
            <div className="flex h-full min-h-0 min-w-0 w-full max-w-full flex-col overflow-hidden bg-white font-[Inter,'PingFang_SC','Microsoft_YaHei',sans-serif] text-[#0E1114]">
                <div className="flex shrink-0 items-start justify-between border-b border-[#F2F3F5] px-7 py-5">
                    <div className="flex min-w-0 flex-1 items-center gap-3.5">
                        <CandidateAvatar identity={identity} className="h-[46px] w-[46px] text-[15px] font-medium text-white" style={{backgroundColor: avatarColor}}/>
                        <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2.5">
                                <h2 className="truncate text-[18px] font-semibold leading-6 text-[#0E1114]">{identity.displayName}</h2>
                                <span className="inline-flex h-[22px] shrink-0 items-center rounded-[4px] px-2 text-[12px]" style={{backgroundColor: badge.background, color: badge.color}}>{badge.label}</span>
                            </div>
                            <p className="mt-1 truncate text-[12px] text-[#86888F]">{profileMeta} · {isZh ? "入库" : "Added"} {enteredAt ? formatDateTime(enteredAt) : "—"}</p>
                        </div>
                    </div>
                    <button type="button" aria-label={isZh ? "关闭人才详情" : "Close talent details"} className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-[#86888F] hover:bg-[#F7F8FA] hover:text-[#33353D]" onClick={closeTalentPoolCandidateDetail} disabled={actionPending}>
                        <X className="h-4 w-4"/>
                    </button>
                </div>

                <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-[22px] overflow-x-hidden overflow-y-auto px-7 py-6">
                    <section className="flex min-w-0 flex-col gap-2.5 rounded-[10px] bg-[#F7F8FA] px-[18px] py-4">
                        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-[#0E1114]">
                            <Sparkles className="h-3.5 w-3.5 text-[#1E3BFA]"/>
                            {isZh ? "AI 识别结果" : "AI Recognition"}
                        </h3>
                        <p className="min-w-0 [overflow-wrap:anywhere] text-[12px] leading-[1.7] text-[#33353D]">{aiSummary}</p>
                        {c.ai_potential_position ? (
                            <p className="min-w-0 [overflow-wrap:anywhere] text-[12px] leading-[1.7] text-[#33353D]">
                                <span className="font-medium text-[#0A9C71]">{isZh ? "转岗潜力" : "Potential move"}：{c.ai_potential_position}</span>
                                {c.ai_potential_reason ? ` · ${c.ai_potential_reason}` : ""}
                            </p>
                        ) : null}
                        {tags.length ? (
                            <div className="flex flex-wrap gap-2">
                                {tags.map((tag) => <span key={tag} className="inline-flex h-[22px] items-center rounded-[4px] bg-[rgba(30,59,250,0.06)] px-2 text-[11px] text-[#1E3BFA]">{tag}</span>)}
                            </div>
                        ) : null}
                    </section>

                    <section className="flex flex-col gap-3">
                        <h3 className="text-[14px] font-semibold text-[#0E1114]">{isZh ? "基本信息" : "Basic Information"}</h3>
                        <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2.5 text-[12px]">
                            {basicFields.map((field) => (
                                <div key={field.label} className="flex min-w-0 gap-2.5">
                                    <span className="w-16 shrink-0 text-[#B0B2B8]">{field.label}</span>
                                    <span className="min-w-0 [overflow-wrap:anywhere] text-[#0F1014]">{field.value || "—"}</span>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-4">
                            <h3 className="text-[14px] font-semibold text-[#0E1114]">{isZh ? "简历摘要" : "Resume Summary"}</h3>
                            {currentResume && canViewRecruitmentDashboard ? (
                                <button type="button" className="shrink-0 text-[12px] text-[#0F23D9] hover:text-[#1E3BFA]" onClick={() => void openResumeFile(currentResume, false)}>{isZh ? "查看原始简历" : "View Original Resume"}</button>
                            ) : currentResume ? (
                                <span className="shrink-0 text-[11px] text-[#B0B2B8]">{isZh ? "无原始简历查看权限" : "No permission to view original"}</span>
                            ) : null}
                        </div>
                        <div className="rounded-[10px] border border-[#EBEEF5] p-4 text-[12px] leading-[1.9] text-[#33353D]">
                            <p className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{resumeSummary}</p>
                            {currentResume ? (
                                <div className="mt-3 flex items-center gap-2 border-t border-[#F2F3F5] pt-3 text-[11px] text-[#86888F]">
                                    <FileText className="h-3.5 w-3.5 shrink-0 text-[#F53F3F]"/>
                                    <span className="min-w-0 flex-1 truncate">{currentResume.original_name}</span>
                                    <span className="shrink-0">{currentResume.parse_status}</span>
                                </div>
                            ) : null}
                        </div>
                    </section>

                    {hasMoreDetails ? (
                        <details className="group rounded-[10px] border border-[#EBEEF5] bg-white">
                            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13px] font-medium text-[#33353D] hover:bg-[#F8F8F9]">
                                <span>{isZh ? "更多人才资料" : "More Talent Details"}</span>
                                <ChevronDown className="h-3.5 w-3.5 text-[#86888F] transition-transform group-open:rotate-180"/>
                            </summary>
                            <div className="space-y-4 border-t border-[#F2F3F5] px-4 py-4">
                                {score ? (
                                    <div className="space-y-2.5">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[12px] font-semibold text-[#0E1114]">{isZh ? "AI 评估" : "AI Assessment"}</span>
                                            <span className="text-[12px] font-semibold tabular-nums text-[#1E3BFA]">{score.total_score ?? "—"}/{score.total_score_scale ?? "—"}</span>
                                        </div>
                                        {score.recommendation ? <p className="text-[12px] leading-5 text-[#33353D]">{score.recommendation}</p> : null}
                                        {score.advantages?.length ? <p className="text-[11px] leading-5 text-[#0A9C71]">{isZh ? "优势" : "Strengths"}：{score.advantages.join("；")}</p> : null}
                                        {score.concerns?.length ? <p className="text-[11px] leading-5 text-[#D48806]">{isZh ? "风险" : "Risks"}：{score.concerns.join("；")}</p> : null}
                                        {score.dimensions?.length ? (
                                            <div className="grid grid-cols-2 gap-2">
                                                {score.dimensions.map((dimension, index) => (
                                                    <div key={`${dimension.label || "dimension"}-${index}`} className="rounded-[6px] bg-[#F7F8FA] px-3 py-2 text-[11px]">
                                                        <div className="flex items-center justify-between gap-2 text-[#33353D]"><span className="truncate">{dimension.label || (isZh ? `维度 ${index + 1}` : `Dimension ${index + 1}`)}</span><span className="shrink-0 tabular-nums text-[#1E3BFA]">{dimension.score ?? "—"}/{dimension.max_score ?? "—"}</span></div>
                                                        {dimension.reason ? <p className="mt-1 line-clamp-2 leading-[18px] text-[#86888F]" title={dimension.reason}>{dimension.reason}</p> : null}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}
                                {resumeFiles.length > 1 ? (
                                    <div className="space-y-2">
                                        <span className="text-[12px] font-semibold text-[#0E1114]">{isZh ? "全部简历文件" : "All Resume Files"}</span>
                                        {resumeFiles.map((resumeFile) => (
                                            <button key={resumeFile.id} type="button" disabled={!canViewRecruitmentDashboard} className="flex w-full items-center gap-2 rounded-[6px] border border-[#F2F3F5] px-3 py-2 text-left text-[11px] hover:bg-[#F8F8F9] disabled:cursor-default" onClick={() => void openResumeFile(resumeFile, false)}>
                                                <FileText className="h-3.5 w-3.5 shrink-0 text-[#F53F3F]"/>
                                                <span className="min-w-0 flex-1 truncate text-[#33353D]">{resumeFile.original_name}</span>
                                                <span className="shrink-0 text-[#86888F]">{resumeFile.parse_status}</span>
                                            </button>
                                        ))}
                                    </div>
                                ) : null}
                                {statusHistory.length ? (
                                    <div className="space-y-2">
                                        <span className="text-[12px] font-semibold text-[#0E1114]">{isZh ? "状态记录" : "Status History"}</span>
                                        {statusHistory.slice(0, 8).map((item) => (
                                            <div key={item.id} className="grid grid-cols-[118px_1fr] gap-3 text-[11px] leading-[18px]">
                                                <span className="tabular-nums text-[#B0B2B8]">{item.created_at ? formatDateTime(item.created_at) : "—"}</span>
                                                <span className="min-w-0 text-[#33353D]">{item.from_status ? labelForCandidateStatus(item.from_status) : "—"} → {labelForCandidateStatus(item.to_status)}{item.reason ? ` · ${item.reason}` : ""}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        </details>
                    ) : null}
                </div>

                <div className="flex h-[68px] min-w-0 shrink-0 items-center gap-3 border-t border-[#F2F3F5] px-7">
                    <span className="min-w-0 flex-1 truncate text-[12px] text-[#86888F]">{displayStatus === "matching" ? (isZh ? "AI 正在识别岗位，结果会实时更新" : "AI matching is in progress and updates in real time") : (isZh ? "分配岗位后候选人将进入对应岗位的招聘流程" : "After assignment, this talent enters the position recruitment flow")}</span>
                    {canManageCandidate && displayStatus === "matching" ? (
                        <button type="button" className="inline-flex h-9 shrink-0 items-center rounded-[6px] border border-[rgba(245,63,63,0.32)] px-[18px] text-[13px] text-[#F53F3F] hover:bg-[rgba(245,63,63,0.05)] disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void runTalentPoolDetailCancelMatch()} disabled={actionPending}>
                            {talentPoolDetailAction === "cancel-match" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin"/> : <Square className="mr-1.5 h-3.5 w-3.5"/>}
                            {isZh ? "停止匹配" : "Stop Matching"}
                        </button>
                    ) : canManageCandidate ? (
                        <>
                            <button type="button" className="inline-flex h-9 shrink-0 items-center rounded-[6px] border border-[#E6E7EB] px-[18px] text-[13px] text-[#33353D] hover:border-[#1E3BFA]/40 hover:text-[#1E3BFA] disabled:cursor-not-allowed disabled:opacity-50" onClick={requestTalentPoolDetailReidentify} disabled={actionPending}>
                                {talentPoolDetailAction === "reidentify" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin"/> : <RotateCcw className="mr-1.5 h-3.5 w-3.5"/>}
                                {isZh ? "重新识别" : "Re-identify"}
                            </button>
                            <button type="button" className="inline-flex h-9 shrink-0 items-center rounded-[6px] bg-[#1E3BFA] px-5 text-[13px] text-white hover:bg-[#0F23D9] disabled:cursor-not-allowed disabled:opacity-50" onClick={openTalentPoolDetailAssignment} disabled={actionPending}>
                                {isZh ? "分配岗位" : "Assign Position"}
                            </button>
                        </>
                    ) : null}
                </div>
            </div>
        );
    }

    function openCreatePosition() {
        setPositionDialogMode("create");
        const nextForm: PositionFormState = {
            ...emptyPositionForm(),
            orgCode: showOrganizationFields ? "" : activeCreateOrgCode,
        };
        setPositionForm(nextForm);
        positionFormInitialSnapshotRef.current = JSON.stringify(nextForm);
        setPositionSkillSearch("");
        setPositionSkillSectionExpanded(DEFAULT_POSITION_SKILL_SECTION_EXPANDED_STATE);
        setPositionFormErrors({});
        setPositionFormSubmitError(null);
        setPositionDialogOpen(true);
        navigateToRecruitmentPage("positions");
    }

    function openEditPosition(detailOverride?: PositionDetail | null) {
        const activePositionDetail = detailOverride || positionDetail;
        if (!activePositionDetail?.position) {
            return;
        }
        const bossFields = resolveBossFieldsFromPosition(activePositionDetail.position);
        setPositionDialogMode("edit");
        const nextForm: PositionFormState = {
            orgCode: normalizeRecruitmentOrgCode(activePositionDetail.position.org_code),
            title: activePositionDetail.position.title,
            department: activePositionDetail.position.department || "",
            location: activePositionDetail.position.location || "",
            employmentType: activePositionDetail.position.employment_type || "社招全职",
            jobType: bossFields.jobType,
            jobTypePath: bossFields.jobTypePath,
            experience: bossFields.experience,
            education: bossFields.education,
            salaryMinK: bossFields.salaryMinK,
            salaryMaxK: bossFields.salaryMaxK,
            salaryMonths: bossFields.salaryMonths,
            salaryRange: activePositionDetail.position.salary_range || "",
            headcount: String(activePositionDetail.position.headcount || 1),
            keyRequirements: activePositionDetail.position.key_requirements || "",
            bonusPoints: activePositionDetail.position.bonus_points || "",
            summary: activePositionDetail.position.summary || "",
            status: activePositionDetail.position.status || "draft",
            tagsText: bossFields.tagsText,
            autoPublish: bossFields.autoPublish,
            autoScreenOnUpload: Boolean(activePositionDetail.position.auto_screen_on_upload),
            autoAdvanceOnScreening: activePositionDetail.position.auto_advance_on_screening ?? true,
            autoMailEnabled: Boolean(activePositionDetail.position.auto_mail_enabled),
            autoMailUseGlobalRecipients: Boolean(activePositionDetail.position.auto_mail_use_global_recipients),
            autoMailUsePositionRecipients: Boolean(activePositionDetail.position.auto_mail_use_position_recipients),
            autoMailPositionRecipientIds: activePositionDetail.position.auto_mail_position_recipient_ids || [],
            autoMailAllowedCandidateStatuses: activePositionDetail.position.auto_mail_allowed_candidate_statuses || ["screening_passed"],
            autoMailTemplateId: activePositionDetail.position.auto_mail_template_id || "",
            autoMailDedupMode: activePositionDetail.position.auto_mail_dedup_mode || "once_per_candidate_per_status",
            autoMailCcRecipientIds: activePositionDetail.position.auto_mail_cc_recipient_ids || [],
            autoMailBccRecipientIds: activePositionDetail.position.auto_mail_bcc_recipient_ids || [],
            jdSkillIds: (activePositionDetail.position.jd_skill_ids || []).slice(0, 1),
            screeningSkillIds: (activePositionDetail.position.screening_skill_ids || []).slice(0, 1),
            interviewSkillIds: (activePositionDetail.position.interview_skill_ids || []).slice(0, 1),
        };
        setPositionForm(nextForm);
        positionFormInitialSnapshotRef.current = JSON.stringify(nextForm);
        setPositionSkillSearch("");
        setPositionSkillSectionExpanded(DEFAULT_POSITION_SKILL_SECTION_EXPANDED_STATE);
        setPositionFormErrors({});
        setPositionFormSubmitError(null);
        setPositionDialogOpen(true);
        navigateToRecruitmentPage("positions");
    }

    function updatePositionFormField<K extends keyof PositionFormState>(field: K, value: PositionFormState[K]) {
        setPositionForm((current) => ({
            ...current,
            [field]: value,
        }));
        setPositionFormSubmitError(null);
        if (field in positionFormErrors) {
            setPositionFormErrors((current) => {
                const errorKey = field as keyof PositionFormErrors;
                if (!current[errorKey]) return current;
                const next = {...current};
                delete next[errorKey];
                return next;
            });
        }
    }

    function clearPositionFormErrors(keys: Array<keyof PositionFormErrors>) {
        setPositionFormErrors((current) => {
            let changed = false;
            const next = {...current};
            keys.forEach((key) => {
                if (next[key]) {
                    delete next[key];
                    changed = true;
                }
            });
            return changed ? next : current;
        });
    }

    function applyBossJobSelection(item: BossJobFlatItem, options?: { syncTitle?: boolean }) {
        setPositionForm((current) => ({
            ...current,
            title: options?.syncTitle === false ? current.title : item.third,
            jobType: item.third,
            jobTypePath: item.path,
        }));
        setPositionFormSubmitError(null);
        clearPositionFormErrors(["title", "jobType", "jobTypePath"]);
    }

    function updateBossSalaryMinK(value: string) {
        const nextMinK = Number(value);
        setPositionForm((current) => {
            const normalizedMinK = Number.isFinite(nextMinK) ? nextMinK : null;
            const allowedMaxOptions = getBossSalaryMaxKOptions(normalizedMinK);
            const currentMaxK = Number(current.salaryMaxK);
            const nextMaxK = Number.isFinite(currentMaxK) && allowedMaxOptions.includes(currentMaxK)
                ? current.salaryMaxK
                : (allowedMaxOptions[0] ?? null);
            return {
                ...current,
                salaryMinK: normalizedMinK,
                salaryMaxK: nextMaxK,
            };
        });
        setPositionFormSubmitError(null);
        clearPositionFormErrors(["salaryMinK", "salaryMaxK"]);
    }

    function updateBossSalaryMaxK(value: string) {
        const nextMaxK = Number(value);
        updatePositionFormField("salaryMaxK", Number.isFinite(nextMaxK) ? nextMaxK : null);
        clearPositionFormErrors(["salaryMaxK"]);
    }

    function appendJobDescriptionSection(title: string) {
        const current = positionForm.keyRequirements.trimEnd();
        const nextText = current.includes(`${title}：`)
            ? current
            : `${current ? `${current}\n\n` : ""}${title}：\n1. `;
        updatePositionFormField("keyRequirements", nextText.slice(0, 5000));
    }

    function closePositionFormPage() {
        setPositionDialogOpen(false);
        setPositionFormCloseConfirmOpen(false);
        setPositionFormErrors({});
        setPositionFormSubmitError(null);
        setPositionSubmitting(false);
        positionFormInitialSnapshotRef.current = null;
        clearPositionFormLocationHash();
    }

    // 关闭前脏数据保护：有未保存修改时先弹确认，防止误点关闭丢失长文本输入
    function requestClosePositionFormPage() {
        const snapshot = positionFormInitialSnapshotRef.current;
        const isDirty = snapshot !== null && JSON.stringify(positionForm) !== snapshot;
        if (isDirty && !positionSubmitting) {
            setPositionFormCloseConfirmOpen(true);
            return;
        }
        closePositionFormPage();
    }

    function updatePositionSkillBinding(
        field: PositionSkillBindingField,
        nextIds: number[],
        options?: { expandSection?: boolean },
    ) {
        const dedupedIds = Array.from(new Set(nextIds)).slice(-1);
        setPositionForm((current) => ({
            ...current,
            [field]: dedupedIds,
            autoScreenOnUpload: field === "screeningSkillIds"
                ? (dedupedIds.length > 0 ? (current.autoScreenOnUpload || current.screeningSkillIds.length === 0) : false)
                : current.autoScreenOnUpload,
        }));
        if (options?.expandSection) {
            setPositionSkillSectionExpanded((current) => ({
                ...current,
                [field]: true,
            }));
        }
        setPositionFormSubmitError(null);
    }

    function updatePositionAssessmentDraftBinding(field: PositionSkillBindingField, nextIds: number[]) {
        const dedupedIds = Array.from(new Set(nextIds)).slice(-1);
        setPositionAssessmentDraft((current) => ({
            ...current,
            [field]: dedupedIds,
        }));
    }

    function closePositionActionMenus() {
        setPositionCardActionMenuOpen(false);
    }

    function renderPositionActionMenuContent() {
        return (
            <>
                <button
                    type="button"
                    className="flex w-full items-start gap-3 rounded-[6px] px-3 py-2.5 text-left transition hover:bg-[#F7F8FA] dark:hover:bg-slate-900"
                    onClick={() => {
                        closePositionActionMenus();
                        openPositionJDConfigDialog();
                    }}
                >
                    <Sparkles className="mt-0.5 h-4 w-4 text-slate-500"/>
	                        <span>
	                            <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{isZh ? "JD 配置" : "JD Config"}</span>
	                            <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{isZh ? "生成、编辑和保存当前职位 JD" : "Generate, edit, and save the current JD"}</span>
	                        </span>
                </button>
                <button
                    type="button"
                    className="flex w-full items-start gap-3 rounded-[6px] px-3 py-2.5 text-left transition hover:bg-[#F7F8FA] dark:hover:bg-slate-900"
                    onClick={() => {
                        closePositionActionMenus();
                        openPositionAssessmentDialog();
                    }}
                >
                    <ClipboardCheck className="mt-0.5 h-4 w-4 text-slate-500"/>
                    <span>
                        <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{isZh ? "评估方案配置" : "Assessment Plans"}</span>
                        <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{isZh ? "维护 JD、初筛和面试题方案" : "Manage JD, screening, and interview plans"}</span>
                    </span>
                </button>
                <button
                    type="button"
                    className="flex w-full items-start gap-3 rounded-[6px] px-3 py-2.5 text-left transition hover:bg-[#F7F8FA] dark:hover:bg-slate-900"
                    onClick={() => {
                        closePositionActionMenus();
                        openEditPosition();
                    }}
                >
                    <FilePlus2 className="mt-0.5 h-4 w-4 text-slate-500"/>
	                        <span>
	                            <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{isZh ? "编辑招聘需求" : "Edit Request"}</span>
                            <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{isZh ? "修改招聘需求与职位信息" : "Edit request and position information"}</span>
                        </span>
                </button>
                <button
                    type="button"
                    className="flex w-full items-start gap-3 rounded-[6px] px-3 py-2.5 text-left transition hover:bg-[#F7F8FA] dark:hover:bg-slate-900"
                    onClick={() => {
                        closePositionActionMenus();
                        void copyBossJsonForCurrentPosition();
                    }}
                >
                    <ClipboardCheck className="mt-0.5 h-4 w-4 text-slate-500"/>
                    <span>
                        <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{isZh ? "复制 BOSS 职位数据" : "Copy BOSS Position Data"}</span>
                        <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{isZh ? "复制当前岗位的 BOSS 导入数据" : "Copy BOSS import data for this position"}</span>
                    </span>
                </button>
                <div className="my-1 h-px bg-slate-100 dark:bg-slate-800"/>
                <button
                    type="button"
                    className="flex w-full items-start gap-3 rounded-[6px] px-3 py-2.5 text-left text-rose-600 transition hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/25"
                    onClick={() => {
                        closePositionActionMenus();
                        setPositionDeleteConfirmOpen(true);
                    }}
                >
                    <Trash2 className="mt-0.5 h-4 w-4"/>
	                        <span>
	                            <span className="block text-sm font-semibold">{isZh ? "删除需求" : "Delete Request"}</span>
	                            <span className="mt-0.5 block text-xs text-rose-500/80 dark:text-rose-300/80">{isZh ? "需要二次确认，候选人和日志保留" : "Requires confirmation; candidates and logs stay"}</span>
	                        </span>
                </button>
            </>
        );
    }

    function openPositionJDConfigDialog() {
        if (!positionDetail?.position) {
            return;
        }
        setPositionJDConfigOpen(true);
    }

    function openPositionAssessmentDialog() {
        if (!positionDetail?.position) {
            return;
        }
        void ensureSkillsLoaded();
        setPositionAssessmentDraft({
            jdSkillIds: (positionDetail.position.jd_skill_ids || []).slice(0, 1),
            screeningSkillIds: (positionDetail.position.screening_skill_ids || []).slice(0, 1),
            interviewSkillIds: (positionDetail.position.interview_skill_ids || []).slice(0, 1),
        });
        setPositionAssessmentSaving(false);
        setPositionAssessmentDialogOpen(true);
    }

    async function submitPositionAssessmentBindings() {
        if (!selectedPositionId) {
            return;
        }
        setPositionAssessmentSaving(true);
        try {
            await recruitmentApi<PositionSummary>(`/positions/${selectedPositionId}`, {
                method: "PATCH",
                body: JSON.stringify({
                    jd_skill_ids: positionAssessmentDraft.jdSkillIds,
                    screening_skill_ids: positionAssessmentDraft.screeningSkillIds,
                    interview_skill_ids: positionAssessmentDraft.interviewSkillIds,
                }),
            });
            toast.success(isZh ? "评估方案已绑定到当前岗位" : "Assessment plans bound to the current position");
            setPositionAssessmentDialogOpen(false);
            await refreshSkillBindingViews([selectedPositionId]);
        } catch (error) {
            toast.error(recruitmentToast.saveFailed(isZh ? "评估方案配置" : "Assessment plans", formatActionError(error)));
        } finally {
            setPositionAssessmentSaving(false);
        }
    }

    async function refreshSkillBindingViews(affectedPositionIds: Array<number | null | undefined>) {
        const normalizedIds = Array.from(
            new Set(
                affectedPositionIds
                    .map((value) => Number(value || 0))
                    .filter((value) => Number.isFinite(value) && value > 0),
            ),
        );
        const tasks: Promise<unknown>[] = [];
        if (normalizedIds.length) {
            tasks.push(loadPositions());
        }
        if (selectedPositionId && normalizedIds.includes(selectedPositionId)) {
            tasks.push(loadPositionDetail(selectedPositionId));
        }
        await Promise.all(tasks);
    }

    function upsertSkillInLocalState(skill: RecruitmentSkill) {
        setAllSkills((current) => [
            skill,
            ...current.filter((item) => item.id !== skill.id),
        ]);
        if (activePageRef.current !== "settings-skills") {
            return;
        }
        const normalizedQuery = skillSettingsQuery.trim().toLowerCase();
        const matchesTask = skillSettingsTaskFilter === "all" || skill.task_types?.includes(skillSettingsTaskFilter);
        const matchesQuery = !normalizedQuery || [
            skill.name,
            skill.description,
            skill.bound_position_title,
            ...(skill.tags || []),
        ].filter(Boolean).join(" ").toLowerCase().includes(normalizedQuery);
        const settingsRow: RecruitmentSkillSettingsRow = {
            ...skill,
            content_preview: shortText(skill.content, 150),
            dimension_count: skill.task_types?.includes("screening")
                ? (parseSkillContent(skill.content).dimensions?.length || 0)
                : undefined,
        };
        const existsOnCurrentPage = skillSettingsRows.some((item) => item.id === skill.id);
        if (!matchesTask || !matchesQuery) {
            setSkillSettingsRows((current) => current.filter((item) => item.id !== skill.id));
            if (existsOnCurrentPage) {
                setSkillSettingsTotal((total) => Math.max(0, total - 1));
            }
            return;
        }
        if (existsOnCurrentPage) {
            setSkillSettingsRows((current) => current.map((item) => item.id === skill.id ? settingsRow : item));
            return;
        }
        if (skillSettingsPageIndex === 0) {
            setSkillSettingsRows((current) => [settingsRow, ...current].slice(0, SETTINGS_LIST_PAGE_SIZE));
            setSkillSettingsTotal((total) => total + 1);
        }
    }

    function reconcileSkillSettingsAfterMutation() {
        if (activePageRef.current !== "settings-skills") {
            return;
        }
        setSkillSettingsPageIndex(0);
        void loadSkillSettingsPage({pageIndex: 0, silent: true}).catch(() => undefined);
    }

    function updateSkillFormField<K extends keyof SkillFormState>(field: K, value: SkillFormState[K]) {
        setSkillForm((current) => ({
            ...current,
            [field]: value,
        }));
        setSkillFormSubmitError(null);
        setSkillFormErrors((current) => {
            if (!current[field as keyof SkillFormErrors]) {
                return current;
            }
            const next = {...current};
            delete next[field as keyof SkillFormErrors];
            return next;
        });
    }

    function findExistingLLMConfigKey(configKey: string) {
        const normalized = configKey.trim().toLowerCase();
        if (!normalized) {
            return null;
        }
        return allLlmConfigs.find((item) => (
            item.id !== llmEditingId
            && item.config_key.trim().toLowerCase() === normalized
        )) || null;
    }

    function updateLLMFormField<K extends keyof LLMFormState>(field: K, value: LLMFormState[K]) {
        setLlmForm((current) => ({
            ...current,
            [field]: value,
        }));
        setLlmFormSubmitError(null);
        setLlmFormErrors((current) => {
            const next = {...current};
            let changed = false;
            if (field === "configKey" && next.configKey) {
                delete next.configKey;
                changed = true;
            }
            if (field === "taskType" && next.taskType) {
                delete next.taskType;
                changed = true;
            }
            if (field === "provider" && next.provider) {
                delete next.provider;
                changed = true;
            }
            if (field === "modelName" && next.modelName) {
                delete next.modelName;
                changed = true;
            }
            if (field === "maxConcurrent" && next.maxConcurrent) {
                delete next.maxConcurrent;
                changed = true;
            }
            if (field === "maxQps" && next.maxQps) {
                delete next.maxQps;
                changed = true;
            }
            if (field === "priority" && next.priority) {
                delete next.priority;
                changed = true;
            }
            if (field === "extraConfigText" && next.extraConfigText) {
                delete next.extraConfigText;
                changed = true;
            }
            return changed ? next : current;
        });
    }

    function validateSkillForm(form: SkillFormState): SkillFormErrors {
        const errors: SkillFormErrors = {};
        const name = form.name.trim();
        const content = form.content.trim();
        const sortOrder = form.sortOrder.trim();
        const sortOrderValue = Number(sortOrder);

        if (!name) {
            errors.name = recruitmentUiText.skillNameRequired;
        } else if (name.length > 120) {
            errors.name = recruitmentUiText.skillNameTooLong;
        }

        if (!content) {
            errors.content = recruitmentUiText.skillContentRequired;
        }

        if (sortOrder && (!/^\d+$/.test(sortOrder) || !Number.isInteger(sortOrderValue) || sortOrderValue < 0 || sortOrderValue > 9999)) {
            errors.sortOrder = recruitmentUiText.skillSortOrderInvalid;
        }

        return errors;
    }

    function validateLLMForm(form: LLMFormState): LLMFormErrors {
        const errors: LLMFormErrors = {};
        const configKey = form.configKey.trim();
        const taskType = form.taskType.trim();
        const provider = form.provider.trim();
        const modelName = form.modelName.trim();
        const maxConcurrent = form.maxConcurrent.trim();
        const maxQps = form.maxQps.trim();
        const priority = form.priority.trim();

        if (!configKey) {
            errors.configKey = recruitmentUiText.llmConfigKeyRequired;
        } else if (configKey.length > 120) {
            errors.configKey = recruitmentUiText.llmConfigKeyTooLong;
        } else if (findExistingLLMConfigKey(configKey)) {
            errors.configKey = recruitmentUiText.llmConfigKeyDuplicate(configKey);
        }

        if (!taskType) {
            errors.taskType = recruitmentUiText.llmTaskTypeRequired;
        } else if (taskType.length > 80) {
            errors.taskType = recruitmentUiText.llmTaskTypeTooLong;
        }

        if (!provider) {
            errors.provider = recruitmentUiText.llmProviderRequired;
        } else if (provider.length > 80) {
            errors.provider = recruitmentUiText.llmProviderTooLong;
        }

        if (!modelName) {
            errors.modelName = recruitmentUiText.llmModelNameRequired;
        } else if (modelName.length > 120) {
            errors.modelName = recruitmentUiText.llmModelNameTooLong;
        }

        if (!/^\d+$/.test(maxConcurrent) || Number(maxConcurrent) < 1 || Number(maxConcurrent) > 100) {
            errors.maxConcurrent = recruitmentUiText.llmMaxConcurrentInvalid;
        }

        if (!/^\d+$/.test(maxQps) || Number(maxQps) < 0 || Number(maxQps) > 1000) {
            errors.maxQps = recruitmentUiText.llmMaxQpsInvalid;
        }

        if (priority && (!/^\d+$/.test(priority) || Number(priority) < 0 || Number(priority) > 999)) {
            errors.priority = recruitmentUiText.llmPriorityInvalid;
        }

        const extraConfigText = form.extraConfigText.trim();
        if (extraConfigText) {
            try {
                const parsed = JSON.parse(extraConfigText);
                if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
                    errors.extraConfigText = recruitmentUiText.llmExtraConfigObjectOnly;
                }
            } catch {
                errors.extraConfigText = recruitmentUiText.llmExtraConfigInvalidJson;
            }
        }

        return errors;
    }

    function resolveSkillSubmitError(error: unknown) {
        const message = formatActionError(error).trim();
        if (/body\.name\b/i.test(message)) {
            return {fieldErrors: {name: recruitmentUiText.skillNameRequired} as SkillFormErrors, submitError: null};
        }
        if (/body\.content\b/i.test(message)) {
            return {fieldErrors: {content: recruitmentUiText.skillContentRequired} as SkillFormErrors, submitError: null};
        }
        return {fieldErrors: null, submitError: message};
    }

    function resolveLLMSubmitError(error: unknown) {
        const message = formatActionError(error).trim();
        const duplicateConfigKey = findExistingLLMConfigKey(llmForm.configKey.trim())?.config_key || llmForm.configKey.trim();
        if (
            /llm config key already exists/i.test(message)
            || /config key already exists/i.test(message)
            || /duplicate entry/i.test(message)
            || /unique constraint/i.test(message)
        ) {
            return {
                fieldErrors: {configKey: recruitmentUiText.llmConfigKeyDuplicate(duplicateConfigKey || llmForm.configKey.trim())} as LLMFormErrors,
                submitError: null,
            };
        }
        if (/body\.config_key\b/i.test(message)) {
            return {fieldErrors: {configKey: recruitmentUiText.llmConfigKeyRequired} as LLMFormErrors, submitError: null};
        }
        if (/body\.task_type\b/i.test(message)) {
            return {fieldErrors: {taskType: recruitmentUiText.llmTaskTypeRequired} as LLMFormErrors, submitError: null};
        }
        if (/body\.provider\b/i.test(message)) {
            return {fieldErrors: {provider: recruitmentUiText.llmProviderRequired} as LLMFormErrors, submitError: null};
        }
        if (/body\.model_name\b/i.test(message)) {
            return {fieldErrors: {modelName: recruitmentUiText.llmModelNameRequired} as LLMFormErrors, submitError: null};
        }
        if (/body\.max_concurrent\b/i.test(message)) {
            return {fieldErrors: {maxConcurrent: recruitmentUiText.llmMaxConcurrentInvalid} as LLMFormErrors, submitError: null};
        }
        if (/body\.max_qps\b/i.test(message)) {
            return {fieldErrors: {maxQps: recruitmentUiText.llmMaxQpsInvalid} as LLMFormErrors, submitError: null};
        }
        return {fieldErrors: null, submitError: message};
    }

    function validatePositionForm(form: PositionFormState): PositionFormErrors {
        const errors: PositionFormErrors = {};
        const title = form.title.trim();
        const headcountText = form.headcount.trim();
        const headcountValue = Number(headcountText || "0");
        const orgCode = normalizeRecruitmentOrgCode(form.orgCode);
        const jobTypePath = normalizeBossJobPath(form.jobTypePath);

        if (positionDialogMode === "create") {
            if (!form.orgCode.trim()) {
                errors.orgCode = recruitmentUiText.chooseTargetOrganization;
            } else if (!organizationSelectOptions.some((option) => option.value === orgCode)) {
                errors.orgCode = isZh ? "请选择可用组织" : "Choose an available organization";
            }
        }

        if (!title) {
            errors.title = isZh ? "请输入职位名称" : "Please enter the position name";
        } else if (title.length > 200) {
            errors.title = isZh ? "职位名称不能超过 200 个字符" : "Position name cannot exceed 200 characters";
        }

        if (!form.employmentType.trim()) {
            errors.employmentType = isZh ? "请选择招聘类型" : "Please choose the recruit type";
        } else if (!BOSS_RECRUIT_TYPES.includes(form.employmentType as typeof BOSS_RECRUIT_TYPES[number])) {
            errors.employmentType = isZh ? "招聘类型不在固定选项中" : "Recruit type is not an allowed option";
        }

        if (!form.keyRequirements.trim()) {
            errors.keyRequirements = isZh ? "请填写职位描述" : "Please enter the job description";
        }

        if (!form.jobType.trim()) {
            errors.jobType = isZh ? "请选择职位类型" : "Please choose the job type";
        } else if (!bossJobTypeSet.has(form.jobType.trim())) {
            errors.jobType = isZh ? "职位类型必须来自职位库" : "Job type must be selected from the catalog";
        }

        if (!jobTypePath.length) {
            errors.jobTypePath = isZh ? "请选择完整职位类型路径" : "Please choose a complete job type path";
        } else if (!bossJobPathSet.has(jobTypePath.join(" / "))) {
            errors.jobTypePath = isZh ? "职位类型路径必须来自职位库" : "Job type path must be selected from the catalog";
        }

        if (!BOSS_EXPERIENCE_OPTIONS.includes(form.experience as typeof BOSS_EXPERIENCE_OPTIONS[number])) {
            errors.experience = isZh ? "请选择有效经验要求" : "Please choose a valid experience option";
        }

        if (!BOSS_EDUCATION_OPTIONS.includes(form.education as typeof BOSS_EDUCATION_OPTIONS[number])) {
            errors.education = isZh ? "请选择有效学历要求" : "Please choose a valid education option";
        }

        if (!Number.isFinite(form.salaryMinK)) {
            errors.salaryMinK = isZh ? "请选择最低月薪" : "Please choose the minimum monthly salary";
        } else if (!BOSS_SALARY_K_OPTIONS.includes(Number(form.salaryMinK))) {
            errors.salaryMinK = isZh ? "最低月薪必须在 1k-250k 范围内" : "Minimum salary must be between 1k and 250k";
        }

        if (!Number.isFinite(form.salaryMaxK)) {
            errors.salaryMaxK = isZh ? "请选择最高月薪" : "Please choose the maximum monthly salary";
        }

        if (Number.isFinite(form.salaryMinK) && Number.isFinite(form.salaryMaxK) && !getBossSalaryMaxKOptions(form.salaryMinK).includes(Number(form.salaryMaxK))) {
            errors.salaryMaxK = isZh ? "最高月薪必须在最低月薪后的可选范围内" : "Maximum salary must be in the allowed range after minimum salary";
        }

        if (!BOSS_SALARY_MONTH_OPTIONS.includes(form.salaryMonths as typeof BOSS_SALARY_MONTH_OPTIONS[number])) {
            errors.salaryMonths = isZh ? "请选择有效薪资月数" : "Please choose a valid salary month option";
        }

        if (!form.location.trim()) {
            errors.location = isZh ? "请选择或填写工作地址" : "Please enter the work address";
        }

        if (!headcountText) {
            errors.headcount = isZh ? "请输入招聘人数" : "Please enter the required headcount";
        } else if (!/^\d+$/.test(headcountText)) {
            errors.headcount = isZh ? "招聘人数只能填写正整数" : "Headcount must be a positive integer";
        } else if (!Number.isInteger(headcountValue) || headcountValue < 1 || headcountValue > 999) {
            errors.headcount = isZh ? "招聘人数需在 1 到 999 之间" : "Headcount must be between 1 and 999";
        }

        return errors;
    }

    async function submitPosition() {
        const nextErrors = validatePositionForm(positionForm);
        if (Object.keys(nextErrors).length) {
            setPositionFormErrors(nextErrors);
            setPositionFormSubmitError(null);
            requestAnimationFrame(() => {
                if (nextErrors.title) {
                    positionTitleInputRef.current?.focus();
                    return;
                }
                if (nextErrors.headcount) {
                    positionHeadcountInputRef.current?.focus();
                    return;
                }
                // 其余字段报错时，把第一条错误提示滚动到视野中央，避免长表单里用户看不到红字
                document.querySelector("[data-recruitment-field-error]")?.scrollIntoView({behavior: "smooth", block: "center"});
            });
            return;
        }

        setPositionFormSubmitError(null);
        setPositionSubmitting(true);

        const bossSalary = {
            minK: positionForm.salaryMinK,
            maxK: positionForm.salaryMaxK,
            months: positionForm.salaryMonths,
        };
        const bossMeta = buildBossPositionMeta(positionForm);
        const visibleTags = splitTags(positionForm.tagsText);

        const payload = {
            ...(positionDialogMode === "create" ? {org_code: normalizeRecruitmentOrgCode(positionForm.orgCode)} : {}),
            title: positionForm.title.trim(),
            department: positionForm.department.trim() || null,
            location: positionForm.location.trim() || null,
            employment_type: positionForm.employmentType.trim() || null,
            salary_range: formatBossSalaryRange(bossSalary) || positionForm.salaryRange.trim() || null,
            headcount: Number(positionForm.headcount || "1"),
            key_requirements: positionForm.keyRequirements.trim() || null,
            bonus_points: positionForm.bonusPoints.trim() || null,
            summary: positionForm.summary.trim() || null,
            status: positionForm.status,
            tags: mergeBossMetaTag(visibleTags, bossMeta),
            auto_screen_on_upload: positionForm.autoScreenOnUpload,
            auto_advance_on_screening: positionForm.autoAdvanceOnScreening,
            auto_mail_enabled: positionForm.autoMailEnabled,
            auto_mail_use_global_recipients: positionForm.autoMailUseGlobalRecipients,
            auto_mail_use_position_recipients: positionForm.autoMailUsePositionRecipients,
            auto_mail_position_recipient_ids: positionForm.autoMailPositionRecipientIds,
            auto_mail_allowed_candidate_statuses: positionForm.autoMailAllowedCandidateStatuses,
            auto_mail_template_id: positionForm.autoMailTemplateId.trim() || null,
            auto_mail_dedup_mode: positionForm.autoMailDedupMode,
            auto_mail_cc_recipient_ids: positionForm.autoMailCcRecipientIds,
            auto_mail_bcc_recipient_ids: positionForm.autoMailBccRecipientIds,
            jd_skill_ids: positionForm.jdSkillIds,
            screening_skill_ids: positionForm.screeningSkillIds,
            interview_skill_ids: positionForm.interviewSkillIds,
        };

        let targetPositionId = selectedPositionId;
        try {
            if (positionDialogMode === "create") {
                const created = await recruitmentApi<PositionSummary>("/positions", {
                    method: "POST",
                    body: JSON.stringify(payload),
                });
                targetPositionId = created.id;
                toast.success(recruitmentToast.created(recruitmentToastEntities.position));
            } else if (selectedPositionId) {
                await recruitmentApi<PositionSummary>(`/positions/${selectedPositionId}`, {
                    method: "PATCH",
                    body: JSON.stringify(payload),
                });
                toast.success(recruitmentToast.updated(recruitmentToastEntities.position));
            }
        } catch (error) {
            setPositionFormSubmitError(recruitmentToast.saveFailed(recruitmentToastEntities.position, error instanceof Error ? error.message : recruitmentToast.unknownError));
            setPositionSubmitting(false);
            return;
        }

        // 保存后的目标始终是列表。阻断旧快照，强制使用 mutation 完成后的新请求。
        invalidatePositionsCache();
        requestInflightRef.current.delete(`positions:${recruitmentDataCacheKey}`);
        if (targetPositionId) {
            requestInflightRef.current.delete(`position-detail:${targetPositionId}`);
        }
        positionDetailLoadRequestIdRef.current += 1;
        selectedPositionIdRef.current = null;
        setSelectedPositionId(null);
        setPositionDetail(null);
        setPositionDetailLoading(false);
        setPositionDetailViewOpen(false);
        setPositionListRequiresRefresh(true);
        setPositionDialogOpen(false);
        navigateToRecruitmentPage("positions");

        try {
            await loadPositions({force: true});
        } catch {
            // loadPositions 已展示错误；继续阻断旧列表，等待用户重试刷新。
        } finally {
            setPositionSubmitting(false);
            void refreshCoreData({includePositions: false, silent: true});
        }
    }

    async function deletePosition() {
        if (!selectedPositionId || !positionDetail?.position) {
            return;
        }
        setPositionDeleting(true);
        try {
            await recruitmentApi(`/positions/${selectedPositionId}`, {method: "DELETE"});
            toast.success(recruitmentToast.deleted(recruitmentToastEntities.position));
            setPositionDeleteConfirmOpen(false);
            setPositionDetail(null);
            setSelectedPositionId(null);
            setPositionDetailViewOpen(false);
            try {
                await Promise.all([loadPositions(), loadCandidates(), loadLogs()]);
            } catch (refreshError) {
                toast.error(recruitmentToast.deletedButRefreshFailed(recruitmentToastEntities.position, formatActionError(refreshError)));
            }
        } catch (error) {
            toast.error(recruitmentToast.deleteFailed(recruitmentToastEntities.position, formatActionError(error)));
        } finally {
            setPositionDeleting(false);
        }
    }

    function resetJDDraftToCurrentVersion() {
        setJdDraft({
            title: currentJDVersion?.title || `${positionDetail?.position.title || (isZh ? "岗位" : "Position")} JD`,
            jdMarkdown: currentJDVersion?.jd_markdown || "",
            notes: currentJDVersion?.notes || "",
            autoActivate: true,
        });
        setJdGeneratedDraftUnsaved(false);
        setJdUnsavedCloseConfirmOpen(false);
        setJdUnsavedExitIntent(null);
        setJdStreamingContent("");
        setJdGenerationError("");
    }

    function completeJDExit(intent: JDUnsavedExitIntent) {
        if (intent === "close-dialog") {
            setPositionJDConfigOpen(false);
            return;
        }
        if (intent === "back-list") {
            setPositionDetailViewOpen(false);
            return;
        }
        setPositionWorkspaceView(intent.replace("switch-", "") as "candidates" | "config" | "versions");
    }

    function requestJDExit(intent: JDUnsavedExitIntent) {
        if (hasUnsavedJDDraft) {
            setJdUnsavedExitIntent(intent);
            setJdUnsavedCloseConfirmOpen(true);
            return;
        }
        completeJDExit(intent);
    }

    function requestClosePositionJDConfigDialog() {
        requestJDExit("close-dialog");
    }

    function discardGeneratedJDDraftAndClose() {
        const intent = jdUnsavedExitIntent || "close-dialog";
        resetJDDraftToCurrentVersion();
        completeJDExit(intent);
    }

    async function generateJD() {
        if (!selectedPositionId) {
            return;
        }
        const positionId = selectedPositionId;
        if (isJDGenerating || jdGenerationInFlightRef.current) {
            return;
        }
        const abortController = new AbortController();
        jdAbortControllerRef.current = abortController;
        jdActiveTaskIdRef.current = null;
        jdGenerationInFlightRef.current = true;
        setJdGenerationStatus("running");
        setJdGenerationError("");
        setJdStreamingContent("");
        try {
            const response = await authenticatedFetch(`/api/recruitment/positions/${positionId}/generate-jd/stream`, {
                method: "POST",
                headers: {"Content-Type": "application/json", Accept: "text/event-stream"},
                body: JSON.stringify({
                    extra_prompt: jdExtraPrompt.trim() || null,
                    auto_activate: jdDraft.autoActivate,
                }),
                signal: abortController.signal,
            });
            if (!response.body) throw new Error("No response body");
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let fullContent = "";
            let completedData: Record<string, unknown> | null = null;
            let errorData: Record<string, unknown> | null = null;
            let cancelledData: Record<string, unknown> | null = null;
            while (true) {
                const {done, value} = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, {stream: true});
                let sep = buffer.indexOf("\n\n");
                while (sep !== -1) {
                    const rawEvent = buffer.slice(0, sep);
                    buffer = buffer.slice(sep + 2);
                    sep = buffer.indexOf("\n\n");
                    const eventMatch = rawEvent.match(/^event: (.+)$/m);
                    const eventType = eventMatch ? eventMatch[1].trim() : "message";
                    const dataMatch = rawEvent.match(/data: (.+)/);
                    if (dataMatch) {
                        try {
                            const data = JSON.parse(dataMatch[1]);
                            if (eventType === "task_created") {
                                jdActiveTaskIdRef.current = data.task_id;
                            } else if (eventType === "completed") {
                                completedData = data;
                            } else if (eventType === "cancelled") {
                                cancelledData = data;
                            } else if (eventType === "error") {
                                errorData = data;
                            } else if (data.delta) {
                                fullContent += data.delta;
                                setJdStreamingContent(fullContent);
                            }
                        } catch { /* ignore malformed */ }
                    }
                }
            }
            if (!mountedRef.current) return;
            if (cancelledData) {
                setJdGenerationStatus("idle");
                setJdStreamingContent("");
                return;
            }
            if (errorData) {
                throw new Error(String(errorData.message || (isZh ? "JD 生成失败" : "JD generation failed")));
            }
            const generatedMarkdown = typeof completedData?.markdown === "string" && completedData.markdown.trim()
                ? completedData.markdown.trim()
                : fullContent.trim();
            setJdDraft((current) => ({
                ...current,
                title: current.title.trim() || `${positionDetail?.position.title || (isZh ? "岗位" : "Position")} JD`,
                jdMarkdown: generatedMarkdown,
                notes: jdExtraPrompt.trim() || current.notes,
            }));
            setJdExtraPrompt("");
            setJdStreamingContent("");
            setJdViewMode("publish");
            setJdGeneratedDraftUnsaved(Boolean(generatedMarkdown));
            setJdGenerationStatus("idle");
            void loadLogs({silent: true});
            if (completedData?.used_fallback) {
                toast.warning(recruitmentToast.generatedWithFallback("岗位 JD"));
            } else {
                toast.success(isZh ? "JD 草稿已生成，确认后请点击保存新版本" : "JD draft generated. Save it as a new version when ready.");
            }
        } catch (error) {
            if (!mountedRef.current) return;
            if (abortController.signal.aborted) {
                setJdGenerationStatus("idle");
                setJdStreamingContent("");
                return;
            }
            setJdGenerationStatus("failed");
            setJdGenerationError(error instanceof Error ? error.message : recruitmentToast.unknownError);
            toast.error(recruitmentToast.createFailed("JD 生成", error instanceof Error ? error.message : recruitmentToast.unknownError));
        } finally {
            jdGenerationInFlightRef.current = false;
            jdAbortControllerRef.current = null;
            jdActiveTaskIdRef.current = null;
        }
    }

    async function stopJDGeneration() {
        jdAbortControllerRef.current?.abort();
        const taskId = jdActiveTaskIdRef.current;
        if (taskId) {
            try {
                await cancelTaskGeneration(taskId, isZh ? "JD 生成" : "JD generation", {silent: true});
            } catch { /* ignore */ }
        }
    }

    async function saveJDVersion() {
        if (!selectedPositionId || jdVersionSaving) {
            return;
        }
        setJdVersionSaving(true);
        try {
            await recruitmentApi<JDVersion>(`/positions/${selectedPositionId}/jd-versions`, {
                method: "POST",
                body: JSON.stringify({
                    title: jdDraft.title.trim(),
                    jd_markdown: jdDraft.jdMarkdown,
                    jd_html: null,
                    publish_text: currentPublishText,
                    notes: jdDraft.notes.trim() || null,
                    auto_activate: jdDraft.autoActivate,
                }),
            });
            toast.success(recruitmentToast.newJdVersionSaved);
            setJdGeneratedDraftUnsaved(false);
            setJdUnsavedCloseConfirmOpen(false);
            await Promise.all([loadPositionDetail(selectedPositionId), loadPositions()]);
            setJdViewMode("publish");
        } catch (error) {
            toast.error(recruitmentToast.saveFailed("JD", error instanceof Error ? error.message : recruitmentToast.unknownError));
        } finally {
            setJdVersionSaving(false);
        }
    }

    async function activateJDVersion(versionId: number) {
        if (!selectedPositionId || jdVersionActivating) {
            return;
        }
        setJdVersionActivating(true);
        try {
            await recruitmentApi<JDVersion>(`/positions/${selectedPositionId}/jd-versions/${versionId}/activate`, {
                method: "POST",
            });
            toast.success(recruitmentToast.jdVersionSwitched);
            await Promise.all([loadPositionDetail(selectedPositionId), loadPositions()]);
        } catch (error) {
            toast.error(recruitmentToast.updateFailed("JD 版本", error instanceof Error ? error.message : recruitmentToast.unknownError));
        } finally {
            setJdVersionActivating(false);
        }
    }

    async function submitPublishTask() {
        if (!selectedPositionId || publishSubmitting) {
            return;
        }
        setPublishSubmitting(true);
        try {
            await recruitmentApi("/publish-tasks", {
                method: "POST",
                body: JSON.stringify({
                    position_id: selectedPositionId,
                    target_platform: publishPlatform,
                    mode: "mock",
                }),
            });
            toast.success(recruitmentToast.created(recruitmentToastEntities.publishTask));
            setPublishDialogOpen(false);
            await Promise.all([loadPositionDetail(selectedPositionId), loadLogs()]);
        } catch (error) {
            toast.error(recruitmentToast.createFailed(recruitmentToastEntities.publishTask, formatActionError(error)));
        } finally {
            setPublishSubmitting(false);
        }
    }

    const BATCH_SIZE = 50;
    const CONCURRENCY = 4;

    async function uploadResumes() {
        if (resumeUploadInFlightRef.current) return;
        if (!resumeUploadFileList?.length) {
            setResumeUploadError(recruitmentToast.noResumeSelected);
            return;
        }
        // 指定岗位模式需要选择岗位
        if (resumeUploadMode === "position" && !resumeUploadPositionId) {
            setResumeUploadError(isZh ? "请选择目标岗位" : "Please select a target position");
            return;
        }
        // 暂不选择和智能匹配模式需要组织归属
        if ((resumeUploadMode === "none" || resumeUploadMode === "smart") && !resumeUploadOrgCode.trim()) {
            setResumeUploadError(recruitmentUiText.chooseTargetOrganization);
            return;
        }

        const files = resumeUploadFileList;
        const retainedResults = resumeUploadResults.filter((item) => item.status !== "failed");
        const uploadContext = uploadContextRef.current;
        const uploadAuthHeaders = getScriptHubAuthHeaderRecord();
        const total = files.length;

        // 根据模式构建请求参数
        let positionId: string | null = null;
        let orgCode: string | null = null;

        if (resumeUploadMode === "position") {
            positionId = resumeUploadPositionId || null;
        } else if (resumeUploadMode === "none") {
            orgCode = resumeUploadOrgCode;
        } else if (resumeUploadMode === "smart") {
            orgCode = resumeUploadOrgCode;
        }

        const query = buildQuery({
            position_id: positionId,
            org_code: orgCode,
            city: resumeUploadCitySource === "manual" ? (resumeUploadCity || null) : null,
            city_source: resumeUploadCitySource,
            match_mode: resumeUploadMode === "smart" ? "smart" : (resumeUploadMode === "none" ? "none" : undefined),
            source: resumeUploadSource,
            duplicate_strategy: resumeUploadDuplicateStrategy,
        });

        resumeUploadInFlightRef.current = true;
        setUploadingResume(true);
        setResumeUploadError(null);
        setUploadProgress(0);
        setUploadCompletedCount(0);
        abortControllerRef.current = new AbortController();

        let uploadedCount = retainedResults.filter((item) => item.status === "uploaded").length;
        let skippedDuplicateCount = retainedResults.filter((item) => item.status === "skipped_duplicate").length;
        let autoScreenQueued = 0, autoScreenSkipped = 0, autoScreenFailed = 0;
        let aiMatchTotal = 0;
        const allItems: ResumeUploadResponse["items"] = [];
        let completedFiles = 0;
        const activeBatchProgressFiles = new Map<number, number>();

        // 使用 XMLHttpRequest 获取真实的上传进度（字节级）
        function uploadBatchWithProgress(formData: FormData, signal: AbortSignal, currentBatchIndex: number, currentBatchSize: number): Promise<ResumeUploadResponse> {
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                const authHeaders = uploadAuthHeaders;

                // 关联 AbortController
                const onAbort = () => xhr.abort();
                signal.addEventListener("abort", onAbort, { once: true });

                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable && e.total > 0 && total > 0) {
                        // 计算全局进度：已完成文件 + 所有并发批次的字节级进度。
                        const batchProgress = e.loaded / e.total; // 0~1
                        activeBatchProgressFiles.set(currentBatchIndex, batchProgress * currentBatchSize);
                        const activeProgressFiles = Array.from(activeBatchProgressFiles.values()).reduce((sum, value) => sum + value, 0);
                        const globalCompleted = completedFiles + activeProgressFiles;
                        const pct = Math.max(1, Math.min(99, Math.round(globalCompleted / total * 100)));
                        setUploadProgress(pct);
                    }
                };

                xhr.onload = () => {
                    signal.removeEventListener("abort", onAbort);
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try {
                            const json = JSON.parse(xhr.responseText);
                            if (json.success === false && !Array.isArray(json.data?.file_results)) {
                                reject(new Error(json.message || json.error || "Request failed"));
                            } else {
                                resolve(json.data ?? json);
                            }
                        } catch {
                            reject(new Error("Invalid JSON response"));
                        }
                    } else if (xhr.status === 401 || xhr.status === 403) {
                        reject(new Error(isZh ? "登录已过期，请刷新页面后重试" : "Session expired, please refresh the page"));
                    } else {
                        try {
                            const json = JSON.parse(xhr.responseText);
                            reject(new Error(json.detail || json.message || `HTTP ${xhr.status}`));
                        } catch {
                            reject(new Error(`HTTP ${xhr.status}`));
                        }
                    }
                };

                xhr.onerror = () => {
                    signal.removeEventListener("abort", onAbort);
                    reject(new Error(isZh ? "网络错误，请检查网络连接" : "Network error"));
                };

                xhr.onabort = () => {
                    signal.removeEventListener("abort", onAbort);
                    reject(new DOMException("Aborted", "AbortError"));
                };

                xhr.open("POST", `/api/recruitment/candidates/upload-resumes${query}`);
                for (const [key, value] of Object.entries(authHeaders)) {
                    xhr.setRequestHeader(key, value);
                }
                if (signal.aborted || uploadContextRef.current !== uploadContext) {
                    abortControllerRef.current?.abort();
                    reject(new DOMException("Aborted", "AbortError"));
                    signal.removeEventListener("abort", onAbort);
                    return;
                }
                xhr.send(formData);
            });
        }

        try {
            const uploadController = abortControllerRef.current;
            const outcome = await runResumeUploadBatches({
                files, signal: uploadController.signal, batchSize: BATCH_SIZE, concurrency: CONCURRENCY,
                sendBatch: async (batch, index) => {
                    const formData = new FormData();
                    batch.forEach((file) => formData.append("files", file));
                    try {
                        return await uploadBatchWithProgress(formData, uploadController.signal, index, batch.length);
                    } finally {
                        activeBatchProgressFiles.delete(index);
                    }
                },
                onSettled: (count) => {
                    completedFiles = count;
                    setUploadCompletedCount(count);
                    setUploadProgress(Math.min(99, Math.round(count / total * 100)));
                },
            });
            if (!mountedRef.current) return;
            const combinedResults = [...retainedResults, ...outcome.results];
            setResumeUploadResults(combinedResults);
            for (const uploaded of outcome.responses) {
                uploadedCount += uploaded.uploaded_count;
                skippedDuplicateCount += uploaded.skipped_duplicate_count ?? uploaded.items.filter((item) => item.skipped_duplicate).length;
                autoScreenQueued += uploaded.auto_screen_queued_count;
                autoScreenSkipped += uploaded.auto_screen_skipped_existing_live_task_count;
                autoScreenFailed += uploaded.auto_screen_failed_count;
                aiMatchTotal += uploaded.ai_match_result?.total_candidates || 0;
                allItems.push(...uploaded.items);
            }
            const failedResults = outcome.results.filter((item) => item.status === "failed");
            const unknownResults = combinedResults.filter((item) => item.status === "unknown");
            const retryIndices = new Set(failedResults.filter((item) => item.retryable).map((item) => item.file_index));
            if (uploadContextRef.current !== uploadContext) {
                setResumeUploadFileList(null);
                setResumeUploadError(uploadRecoveryText.contextChanged);
                return;
            }
            allItems.forEach((item) => {
                if (item.auto_screen_task_id && item.auto_screen_task_status && isLiveTaskStatus(item.auto_screen_task_status)) {
                    attachScreeningTaskMonitor(item.id, item.auto_screen_task_id, {
                        batch: true,
                        suppressFinishToast: true,
                    });
                }
            });
            if (failedResults.length || unknownResults.length) {
                const summary = uploadRecoveryText.summary
                    .replace("{uploaded}", String(uploadedCount)).replace("{skipped}", String(skippedDuplicateCount))
                    .replace("{failed}", String(failedResults.length)).replace("{unknown}", String(unknownResults.length));
                setResumeUploadFileList(files.filter((_file, index) => retryIndices.has(index)));
                setResumeUploadError(summary + (unknownResults.length ? ` ${uploadRecoveryText.unknownHint}` : ""));
                toast.warning(summary);
                void refreshCoreData({silent: true});
                return;
            }
            if (outcome.responses.some((response) => response.auto_screen_dispatch_pending)) {
                toast.warning(uploadRecoveryText.dispatchPending);
            }
            setUploadProgress(100);
            const aiMatchMsg = aiMatchTotal > 0
                ? (isZh ? `，AI 岗位匹配进行中（${aiMatchTotal} 份），结果将实时更新` : `, AI position matching in progress (${aiMatchTotal}), results will update in real-time`)
                : "";
            const screenMsg = autoScreenQueued > 0 || autoScreenSkipped > 0 || autoScreenFailed > 0
                ? (isZh
                    ? `，自动初筛已入队 ${autoScreenQueued} 份，已跳过 ${autoScreenSkipped} 份${autoScreenFailed > 0 ? `，失败 ${autoScreenFailed} 份` : ""}`
                    : `. Auto-screen queued ${autoScreenQueued}, skipped ${autoScreenSkipped}${autoScreenFailed > 0 ? `, failed ${autoScreenFailed}` : ""}`)
                : "";
            const duplicateMsg = skippedDuplicateCount > 0
                ? (isZh ? `，已跳过重复 ${skippedDuplicateCount} 份` : `, skipped ${skippedDuplicateCount} duplicate(s)`)
                : "";
            if (uploadedCount === 0 && skippedDuplicateCount > 0) {
                toast.warning(
                    isZh
                        ? `已跳过 ${skippedDuplicateCount} 份重复简历，未创建新候选人。`
                        : `${skippedDuplicateCount} duplicate resume(s) skipped; no new candidates created.`,
                );
            } else {
                toast.success(
                    isZh
                        ? `已上传 ${uploadedCount} 份简历${duplicateMsg}${aiMatchMsg}${screenMsg}。`
                        : `${uploadedCount} resume(s) uploaded${duplicateMsg}${aiMatchMsg}${screenMsg}.`,
                );
            }
            setResumeUploadOpen(false);
            setResumeUploadError(null);
            setResumeUploadFileList(null);
            setResumeUploadCity("");
            setResumeUploadCitySource("auto");
            setResumeUploadMode("smart");
            setResumeUploadSource("manual");
            setResumeUploadDuplicateStrategy("skip");
            setShowAdvancedOptions(false);
            setIsDraggingFile(false);
            // Optimistic update: immediately add uploaded items to candidate list
            // 排除 matching/unmatched 状态的候选人（智能匹配模式下未识别的候选人在人才库中显示）
            if (allItems.length > 0) {
                const optimisticItems = allItems
                    .filter((item) => !["matching", "unmatched"].includes(item.status))
                    .map((item) =>
                        item.auto_screen_queued
                            ? {
                                ...item,
                                display_status: "screening_running",
                                active_screening_task_status: "queued",
                            }
                            : item,
                    );
                if (optimisticItems.length > 0) {
                    setAllCandidates((prev) => deduplicateCandidates([...optimisticItems, ...prev]));
                    setCandidateTotal((prev) => prev + optimisticItems.filter((item) => !item.skipped_duplicate && !item.overwritten).length);
                }
            }
            const shouldFocusMatchingTalentPool = resumeUploadMode === "smart" && (
                aiMatchTotal > 0
                || allItems.some((item) => String(item.status || "").trim().toLowerCase() === "matching")
            );
            // 智能匹配模式跳人才库，指定岗位模式跳候选人列表
            if (resumeUploadMode === "smart" && canViewTalentPool) {
                if (shouldFocusMatchingTalentPool) {
                    setTalentPoolPreferredStatFilter("matching");
                }
                navigateToRecruitmentPage("talent-pool");
                if (activePage === "talent-pool") {
                    void loadTalentPoolCandidates(shouldFocusMatchingTalentPool
                        ? { silent: true, query: { ...talentPoolQueryRef.current, statFilter: "matching", pageIndex: 0 } }
                        : { silent: true });
                }
            } else {
                navigateToRecruitmentPage("candidates");
                void refreshCoreData();
            }
        } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                toast.warning(recruitmentToast.uploadCancelled);
            } else {
                setResumeUploadError(recruitmentToast.createFailed(recruitmentToastEntities.resume, formatActionError(error)));
            }
        } finally {
            setUploadingResume(false);
            setUploadProgress(0);
            setUploadCompletedCount(0);
            abortControllerRef.current = null;
            resumeUploadInFlightRef.current = false;
        }
    }

    async function exportCandidates(
        candidateIds: number[],
        options?: { includeResumes?: boolean; fields?: string[] },
    ) {
        if (!candidateIds.length) {
            toast.error(recruitmentToast.selectCandidatesToExport);
            return;
        }
        if (exporting) {
            return;
        }
        const includeResumes = options?.includeResumes ?? true;
        const fields = options?.fields ?? [];
        setExporting(true);
        const exportToastId = toast.loading(recruitmentToast.exporting);
        try {
            const response = await authenticatedFetch("/api/recruitment/candidates/export", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    candidate_ids: candidateIds,
                    include_resumes: includeResumes,
                    fields,
                }),
                cache: "no-store",
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText);
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `candidates_export_${new Date().toISOString().slice(0, 10)}.zip`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
            toast.success(recruitmentToast.exported(candidateIds.length), {id: exportToastId});
        } catch (error) {
            toast.error(recruitmentToast.exportFailed(error instanceof Error ? error.message : recruitmentToast.unknownError), {id: exportToastId});
        } finally {
            setExporting(false);
        }
    }

    const selectResumeUploadFiles = React.useCallback((files: FileList | null) => {
        if (!files?.length) {
            setResumeUploadFileList(null);
            return;
        }
        const unsupportedFile = Array.from(files).find((file) => {
            const fileName = file.name.trim().toLowerCase();
            return !fileName.endsWith(".pdf") && !fileName.endsWith(".docx");
        });
        if (unsupportedFile) {
            setResumeUploadFileList(null);
            setResumeUploadError(isZh
                ? `不支持文件「${unsupportedFile.name}」，简历仅支持 PDF 和 DOCX 格式。`
                : `Unsupported file "${unsupportedFile.name}". Resumes must be PDF or DOCX files.`);
            if (fileInputRef.current) fileInputRef.current.value = "";
            return;
        }
        setResumeUploadError(null);
        setResumeUploadFileList(files ? Array.from(files) : null);
        setResumeUploadResults([]);
    }, [isZh]);

    const handleResumeFileChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        selectResumeUploadFiles(event.target.files);
    }, [selectResumeUploadFiles]);

    const resetResumeUploadDraft = React.useCallback(() => {
        setResumeUploadResults([]);
        setResumeUploadFileList(null);
        setResumeUploadMode("smart");
        setResumeUploadPositionId("");
        setResumeUploadOrgCode(currentResumeUploadDefaultOrgCode);
        setResumeUploadCity("");
        setResumeUploadCitySource("auto");
        setResumeUploadSource("manual");
        setResumeUploadDuplicateStrategy("skip");
        setShowAdvancedOptions(false);
        setIsDraggingFile(false);
        setUploadProgress(0);
        setUploadCompletedCount(0);
        setResumeUploadError(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
    }, [currentResumeUploadDefaultOrgCode]);

    const resumeUploadDialogBody = React.useMemo(() => {
        const uploadFiles = resumeUploadFileList ? Array.from(resumeUploadFileList) : [];
        const uploadModeOptions: Array<{
            value: typeof resumeUploadMode;
            label: string;
            description: string;
        }> = [
            {
                value: "smart",
                label: isZh ? "AI 智能匹配" : "AI Smart Match",
                description: isZh
                    ? "自动识别每份简历最匹配的岗位（推荐）"
                    : "Automatically identify the best position for each resume (recommended)",
            },
            {
                value: "position",
                label: isZh ? "指定岗位" : "Assign Position",
                description: isZh ? "手动选择简历归属的岗位" : "Manually select the position for these resumes",
            },
            {
                value: "none",
                label: isZh ? "暂不选择岗位" : "No Position Yet",
                description: isZh ? "简历仅归入组织，后续手动分配" : "Add resumes to the organization for later assignment",
            },
        ];
        const sourceOptions: Array<{value: typeof resumeUploadSource; label: string}> = [
            {value: "manual", label: isZh ? "手动上传" : "Manual Upload"},
            {value: "boss", label: isZh ? "Boss直聘" : "Boss Zhipin"},
            {value: "liepin", label: isZh ? "猎聘" : "Liepin"},
            {value: "headhunter", label: isZh ? "猎头推荐" : "Headhunter"},
            {value: "other", label: isZh ? "其他渠道" : "Other"},
        ];
        const duplicateOptions: Array<{value: typeof resumeUploadDuplicateStrategy; label: string}> = [
            {value: "skip", label: isZh ? "跳过重复简历" : "Skip Duplicates"},
            {value: "overwrite", label: isZh ? "覆盖已有记录" : "Overwrite Existing"},
        ];
        const uploadInputClass = "h-[34px] rounded-[4px] border-[#E6E7EB] bg-white px-3 text-[12px] text-[#0F1014] shadow-none placeholder:text-[#B0B2B8] focus-visible:border-[#1E3BFA] focus-visible:ring-2 focus-visible:ring-[#1E3BFA]/15 md:text-[12px] dark:border-[#E6E7EB] dark:bg-white dark:text-[#0F1014] dark:placeholder:text-[#B0B2B8]";
        const optionButtonClass = "h-[26px] rounded-[4px] border px-2.5 text-[12px] font-normal shadow-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3BFA]/15 disabled:cursor-not-allowed disabled:opacity-50";
        const formatUploadFileSize = (size: number) => {
            if (size >= 1024 * 1024) {
                return `${(size / (1024 * 1024)).toFixed(1)} MB`;
            }
            return `${Math.max(1, Math.round(size / 1024))} KB`;
        };

        const sourceAndDuplicateControls = (
            <>
                <div className="space-y-2">
                    <p className="text-[12px] leading-4 text-[#33353D] dark:text-[#33353D]">
                        {isZh ? "简历来源" : "Resume Source"}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {sourceOptions.map((option) => {
                            const selected = resumeUploadSource === option.value;
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    className={cn(
                                        optionButtonClass,
                                        selected
                                            ? "border-[#1E3BFA] bg-[rgba(30,59,250,0.05)] text-[#1E3BFA] dark:border-[#1E3BFA] dark:bg-[rgba(30,59,250,0.05)] dark:text-[#1E3BFA]"
                                            : "border-[#E6E7EB] bg-white text-[#33353D] hover:border-[#1E3BFA] hover:bg-[rgba(30,59,250,0.02)] dark:border-[#E6E7EB] dark:bg-white dark:text-[#33353D] dark:hover:border-[#1E3BFA] dark:hover:bg-[rgba(30,59,250,0.02)]",
                                    )}
                                    disabled={uploadingResume}
                                    onClick={() => setResumeUploadSource(option.value)}
                                >
                                    {option.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
                <div className="space-y-2">
                    <p className="text-[12px] leading-4 text-[#33353D] dark:text-[#33353D]">
                        {isZh ? "重复处理" : "Duplicate Handling"}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {duplicateOptions.map((option) => {
                            const selected = resumeUploadDuplicateStrategy === option.value;
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    className={cn(
                                        optionButtonClass,
                                        selected
                                            ? "border-[#1E3BFA] bg-[rgba(30,59,250,0.05)] text-[#1E3BFA] dark:border-[#1E3BFA] dark:bg-[rgba(30,59,250,0.05)] dark:text-[#1E3BFA]"
                                            : "border-[#E6E7EB] bg-white text-[#33353D] hover:border-[#1E3BFA] hover:bg-[rgba(30,59,250,0.02)] dark:border-[#E6E7EB] dark:bg-white dark:text-[#33353D] dark:hover:border-[#1E3BFA] dark:hover:bg-[rgba(30,59,250,0.02)]",
                                    )}
                                    disabled={uploadingResume}
                                    onClick={() => setResumeUploadDuplicateStrategy(option.value)}
                                >
                                    {option.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </>
        );

        const cityControls = (
            <div className="space-y-2">
                <p className="text-[12px] leading-4 text-[#33353D] dark:text-[#33353D]">{recruitmentUiText.city}</p>
                <div className="flex flex-wrap gap-2">
                    {([
                        {value: "manual" as const, label: recruitmentUiText.manualCityEntry},
                        {value: "auto" as const, label: recruitmentUiText.autoDetectCity},
                    ] as const).map((option) => {
                        const selected = resumeUploadCitySource === option.value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                className={cn(
                                    optionButtonClass,
                                    selected
                                        ? "border-[#1E3BFA] bg-[rgba(30,59,250,0.05)] text-[#1E3BFA] dark:border-[#1E3BFA] dark:bg-[rgba(30,59,250,0.05)] dark:text-[#1E3BFA]"
                                        : "border-[#E6E7EB] bg-white text-[#33353D] hover:border-[#1E3BFA] hover:bg-[rgba(30,59,250,0.02)] dark:border-[#E6E7EB] dark:bg-white dark:text-[#33353D] dark:hover:border-[#1E3BFA] dark:hover:bg-[rgba(30,59,250,0.02)]",
                                )}
                                disabled={uploadingResume}
                                onClick={() => setResumeUploadCitySource(option.value)}
                            >
                                {option.label}
                            </button>
                        );
                    })}
                </div>
                {resumeUploadCitySource === "manual" ? (
                    <div className="space-y-2">
                        <Input
                            list="city-options"
                            className={uploadInputClass}
                            placeholder={recruitmentUiText.cityPlaceholder}
                            value={resumeUploadCity}
                            disabled={uploadingResume}
                            onChange={(event) => setResumeUploadCity(event.target.value)}
                        />
                        <datalist id="city-options">
                            {POPULAR_CITIES.map((city) => (
                                <option key={city} value={city}/>
                            ))}
                        </datalist>
                        <div className="flex flex-wrap gap-1.5">
                            {POPULAR_CITIES.slice(0, 8).map((city) => {
                                const selected = resumeUploadCity === city;
                                return (
                                    <button
                                        key={city}
                                        type="button"
                                        className={cn(
                                            optionButtonClass,
                                            selected
                                                ? "border-[#1E3BFA] bg-[rgba(30,59,250,0.05)] text-[#1E3BFA] dark:border-[#1E3BFA] dark:bg-[rgba(30,59,250,0.05)] dark:text-[#1E3BFA]"
                                                : "border-[#E6E7EB] bg-white text-[#33353D] hover:border-[#1E3BFA] hover:bg-[rgba(30,59,250,0.02)] dark:border-[#E6E7EB] dark:bg-white dark:text-[#33353D] dark:hover:border-[#1E3BFA] dark:hover:bg-[rgba(30,59,250,0.02)]",
                                        )}
                                        disabled={uploadingResume}
                                        onClick={() => setResumeUploadCity(city)}
                                    >
                                        {city}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <p className="text-[11px] leading-[18px] text-[#86888F] dark:text-[#86888F]">
                        {recruitmentUiText.cityAutoHint}
                    </p>
                )}
            </div>
        );

        return (
            <DialogContent showCloseButton={!uploadingResume} className="flex min-w-0 max-h-[88vh] flex-col gap-0 overflow-hidden rounded-[8px] border-[#EBEEF5] bg-white p-0 text-[#0E1114] shadow-[0_8px_24px_rgba(14,17,20,0.16)] sm:max-w-[600px] dark:border-[#EBEEF5] dark:bg-white dark:text-[#0E1114] [&_[data-slot=dialog-close]]:right-6 [&_[data-slot=dialog-close]]:top-[18px] [&_[data-slot=dialog-close]]:rounded-[4px] [&_[data-slot=dialog-close]]:text-[#86888F] [&_[data-slot=dialog-close]]:opacity-100 [&_[data-slot=dialog-close][data-state=open]]:bg-transparent [&_[data-slot=dialog-close][data-state=open]]:text-[#86888F] [&_[data-slot=dialog-close]]:hover:bg-[#F7F8FA] [&_[data-slot=dialog-close]]:hover:text-[#0E1114]">
                <DialogHeader className="shrink-0 gap-1 border-b border-[#F2F3F5] px-6 pb-[14px] pr-14 pt-[18px] text-left">
                    <DialogTitle className="text-[16px] font-semibold leading-5 text-[#0E1114] dark:text-[#0E1114]">
                        {recruitmentUiText.uploadResumeTitle}
                    </DialogTitle>
                    <DialogDescription className="text-[12px] leading-5 text-[#86888F] dark:text-[#86888F]">
                        {recruitmentUiText.resumeUploadDescription}
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full [&_[data-slot=scroll-area-viewport]>div]:!min-w-0 [&_[data-slot=scroll-area-viewport]>div]:!max-w-full">
                    <div className="w-full min-w-0 max-w-full space-y-4 overflow-x-hidden px-6 py-5">
                        <div className="space-y-2">
                            <p className="text-[12px] leading-4 text-[#33353D] dark:text-[#33353D]">
                                {isZh ? "上传模式" : "Upload Mode"}
                            </p>
                            <div className="space-y-2" role="radiogroup" aria-label={isZh ? "上传模式" : "Upload Mode"}>
                                {uploadModeOptions.map((option) => {
                                    const selected = resumeUploadMode === option.value;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            role="radio"
                                            aria-checked={selected}
                                            className={cn(
                                                "flex w-full items-start gap-3 rounded-[8px] border px-3.5 py-3 text-left shadow-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3BFA]/15 disabled:cursor-not-allowed disabled:opacity-60",
                                                selected
                                                    ? "border-[#1E3BFA] bg-[rgba(30,59,250,0.03)] dark:border-[#1E3BFA] dark:bg-[rgba(30,59,250,0.03)]"
                                                    : "border-[#EBEEF5] bg-white hover:border-[#1E3BFA] hover:bg-[rgba(30,59,250,0.02)] dark:border-[#EBEEF5] dark:bg-white dark:hover:border-[#1E3BFA] dark:hover:bg-[rgba(30,59,250,0.02)]",
                                            )}
                                            disabled={uploadingResume}
                                            onClick={() => {
                                                setResumeUploadMode(option.value);
                                                setResumeUploadError(null);
                                            }}
                                        >
                                            <span
                                                className={cn(
                                                    "mt-px flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[8px] border bg-white dark:bg-white",
                                                    selected ? "border-[#1E3BFA] dark:border-[#1E3BFA]" : "border-[#D6D8DD] dark:border-[#D6D8DD]",
                                                )}
                                                aria-hidden="true"
                                            >
                                                {selected ? <span className="h-[7px] w-[7px] rounded-[4px] bg-[#1E3BFA]"/> : null}
                                            </span>
                                            <span className="min-w-0">
                                                <span className="block text-[13px] font-medium leading-[18px] text-[#0E1114] dark:text-[#0E1114]">{option.label}</span>
                                                <span className="mt-0.5 block text-[11px] leading-[18px] text-[#86888F] dark:text-[#86888F]">{option.description}</span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {resumeUploadMode === "smart" ? (
                            <div className="rounded-[6px] bg-[rgba(30,59,250,0.05)] px-3 py-2.5 text-[12px] leading-5 text-[#33353D] dark:bg-[rgba(30,59,250,0.05)] dark:text-[#33353D]">
                                {isZh
                                    ? "系统将分析每份简历内容，自动匹配到最合适的岗位；无法匹配的简历将归入人才库，可稍后手动分配。"
                                    : "The system will analyze each resume and match it to the best-fitting position. Unmatched resumes will be added to the talent pool for later assignment."}
                            </div>
                        ) : null}

                        {resumeUploadMode === "position" ? (
                            <div className="space-y-1.5">
                                <p className="text-[12px] leading-4 text-[#33353D] dark:text-[#33353D]">{recruitmentUiText.linkPosition}</p>
                                <NativeSelect
                                    className={uploadInputClass}
                                    value={resumeUploadPositionId}
                                    onChange={(event) => setResumeUploadPositionId(event.target.value)}
                                    disabled={positionsLoading || uploadingResume}
                                >
                                    <option value="">{positionsLoading ? recruitmentUiText.loading : isZh ? "请选择岗位" : "Select position"}</option>
                                    {positions.map((position) => (
                                        <option key={position.id} value={position.id}>{position.title}</option>
                                    ))}
                                </NativeSelect>
                            </div>
                        ) : null}

                        {(resumeUploadMode === "smart" || resumeUploadMode === "none") && showOrganizationFields && organizationSelectOptions.length > 1 ? (
                            <div className="space-y-1.5">
                                <p className="text-[12px] leading-4 text-[#33353D] dark:text-[#33353D]">{recruitmentUiText.targetOrganization}</p>
                                <NativeSelect
                                    className={uploadInputClass}
                                    value={resumeUploadOrgCode}
                                    onChange={(event) => setResumeUploadOrgCode(event.target.value)}
                                    disabled={uploadingResume}
                                >
                                    <option value="">{recruitmentUiText.chooseTargetOrganization}</option>
                                    {organizationSelectOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </NativeSelect>
                            </div>
                        ) : null}

                        {resumeUploadMode === "smart" ? (
                            <div className="space-y-2.5">
                                <button
                                    type="button"
                                    className="flex items-center gap-1 text-[12px] leading-4 text-[#33353D] transition-colors hover:text-[#1E3BFA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3BFA]/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#33353D] dark:hover:text-[#1E3BFA]"
                                    disabled={uploadingResume}
                                    onClick={() => setShowAdvancedOptions((value) => !value)}
                                >
                                    {isZh ? "高级选项" : "Advanced Options"}
                                    <ChevronDown className={cn("h-3 w-3 text-[#86888F] transition-transform", showAdvancedOptions && "rotate-180")}/>
                                </button>
                                {showAdvancedOptions ? (
                                    <div className="space-y-3.5 rounded-[6px] bg-[#F7F8FA] px-4 py-3.5 dark:bg-[#F7F8FA]">
                                        {sourceAndDuplicateControls}
                                        {cityControls}
                                    </div>
                                ) : null}
                            </div>
                        ) : (
                            <div className="space-y-3.5">
                                {sourceAndDuplicateControls}
                                {cityControls}
                            </div>
                        )}

                        <label
                            className={cn(
                                "flex min-h-[116px] w-full flex-col items-center justify-center gap-2 rounded-[8px] border border-dashed px-4 py-6 text-center transition-colors",
                                uploadingResume || uploadFiles.length > 0 ? "cursor-default" : "cursor-pointer",
                                isDraggingFile
                                    ? "border-[#1E3BFA] bg-[rgba(30,59,250,0.03)] dark:border-[#1E3BFA] dark:bg-[rgba(30,59,250,0.03)]"
                                    : "border-[#D6D8DD] bg-white hover:border-[#1E3BFA] hover:bg-[rgba(30,59,250,0.02)] dark:border-[#D6D8DD] dark:bg-white dark:hover:border-[#1E3BFA] dark:hover:bg-[rgba(30,59,250,0.02)]",
                            )}
                            aria-disabled={uploadingResume || uploadFiles.length > 0}
                            onClick={(event) => {
                                if (uploadingResume || uploadFiles.length > 0) {
                                    event.preventDefault();
                                }
                            }}
                            onDragOver={(event) => {
                                event.preventDefault();
                                if (!uploadingResume) setIsDraggingFile(true);
                            }}
                            onDragLeave={() => setIsDraggingFile(false)}
                            onDrop={(event) => {
                                event.preventDefault();
                                setIsDraggingFile(false);
                                if (uploadingResume) return;
                                selectResumeUploadFiles(event.dataTransfer.files);
                            }}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                accept=".pdf,.docx"
                                className="sr-only"
                                disabled={uploadingResume}
                                onChange={handleResumeFileChange}
                            />
                            <Upload className="h-[26px] w-[26px] text-[#B0B2B8] dark:text-[#B0B2B8]" strokeWidth={1.6}/>
                            <span className="text-[13px] leading-[18px] text-[#33353D] dark:text-[#33353D]">
                                {uploadFiles.length > 0
                                    ? recruitmentUiText.filesSelected(uploadFiles.length)
                                    : isZh ? "点击选择或拖拽文件到此处" : "Click to select or drag files here"}
                            </span>
                            <span className="text-[11px] leading-[18px] text-[#B0B2B8] dark:text-[#B0B2B8]">
                                {isZh ? "支持批量选择 PDF / DOCX 文件" : "Batch selection supports PDF / DOCX files"}
                            </span>
                        </label>

                        {uploadFiles.length > 0 ? (
                            <div className="min-w-0 space-y-2">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-[12px] text-[#33353D] dark:text-[#33353D]">
                                        {recruitmentUiText.filesSelected(uploadFiles.length)}
                                    </p>
                                    <button
                                        type="button"
                                        className="rounded-[4px] px-1.5 py-1 text-[11px] text-[#86888F] transition-colors hover:bg-[#F7F8FA] hover:text-[#1E3BFA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3BFA]/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#86888F] dark:hover:bg-[#F7F8FA] dark:hover:text-[#1E3BFA]"
                                        disabled={uploadingResume}
                                        onClick={() => {
                                            setResumeUploadFileList(null);
                                            setResumeUploadError(null);
                                            if (fileInputRef.current) fileInputRef.current.value = "";
                                        }}
                                    >
                                        {isZh ? "清空并重新选择" : "Clear and reselect"}
                                    </button>
                                </div>
                                <div className="space-y-2">
                                    {uploadFiles.map((file, index) => {
                                        const progressLabel = uploadingResume
                                            ? (isZh ? "上传中" : "Uploading")
                                            : (isZh ? "待上传" : "Pending");
                                        return (
                                            <div key={`${file.name}-${file.lastModified}-${index}`} className="flex w-full min-w-0 max-w-full items-center gap-2.5 overflow-hidden rounded-[6px] border border-[#EBEEF5] bg-white px-3.5 py-2.5 dark:border-[#EBEEF5] dark:bg-white">
                                                <FileText className="h-[15px] w-[15px] shrink-0 text-[#86888F] dark:text-[#86888F]" strokeWidth={1.8}/>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                                                            <span title={file.name} className="block min-w-0 flex-1 truncate text-[12px] leading-4 text-[#0F1014] dark:text-[#0F1014]">{file.name}</span>
                                                            <span className="shrink-0 text-[10px] text-[#B0B2B8] dark:text-[#B0B2B8]">{formatUploadFileSize(file.size)}</span>
                                                        </div>
                                                        <span className={cn(
                                                            "shrink-0 text-[11px] leading-4",
                                                            uploadingResume
                                                                ? "text-[#1E3BFA] dark:text-[#1E3BFA]"
                                                                : "text-[#B0B2B8] dark:text-[#B0B2B8]",
                                                        )}>
                                                            {progressLabel}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : null}

                        {resumeUploadResults.length > 0 ? (
                            <ul className="space-y-2 text-xs" aria-label={uploadRecoveryText.resultsTitle}>
                                {resumeUploadResults.map((result, index) => (
                                    <li key={`${result.file_name}-${index}`} className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                                        <span className="min-w-0 truncate" title={result.file_name}>{result.file_name}</span>
                                        <span className="shrink-0 text-muted-foreground">
                                            {result.error_code === "upload_not_started" ? uploadRecoveryText.notStarted : uploadRecoveryText[result.status]}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        ) : null}

                        {resumeUploadError ? (
                            <div className="rounded-[6px] bg-[rgba(245,63,63,0.08)] px-3 py-2.5 text-[12px] leading-5 text-[#F53F3F] dark:bg-[rgba(245,63,63,0.08)] dark:text-[#F53F3F]" role="alert">
                                {resumeUploadError}
                            </div>
                        ) : null}
                    </div>
                </ScrollArea>

                <DialogFooter className="shrink-0 flex-col items-stretch justify-between gap-3 border-t border-[#F2F3F5] px-6 py-3 sm:min-h-16 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 sm:flex-1">
                        {uploadingResume ? (
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between gap-3 text-[11px] text-[#86888F] dark:text-[#86888F]">
                                    <span className="truncate">{uploadRecoveryText.processing.replace("{completed}", String(uploadCompletedCount)).replace("{total}", String(uploadFiles.length))}</span>
                                    <span className="shrink-0 tabular-nums text-[#1E3BFA] dark:text-[#1E3BFA]">{uploadProgress}%</span>
                                </div>
                                <div className="h-1 overflow-hidden rounded-[4px] bg-[#F2F3F5] dark:bg-[#F2F3F5]">
                                    <div
                                        className="h-full rounded-[4px] bg-[#1E3BFA] transition-[width] duration-200 dark:bg-[#1E3BFA]"
                                        style={{width: `${uploadProgress}%`}}
                                    />
                                </div>
                            </div>
                        ) : (
                            <span className="text-[11px] leading-[18px] text-[#B0B2B8] dark:text-[#B0B2B8]">
                                {isZh ? "每批最多处理 50 份，大批量将自动分批" : "Up to 50 resumes per batch; larger sets are split automatically"}
                            </span>
                        )}
                    </div>
                    <div className="flex shrink-0 items-center justify-end gap-3">
                        <Button
                            variant="outline"
                            className="h-[34px] rounded-[6px] border-[#E6E7EB] bg-white px-[18px] text-[13px] font-normal text-[#33353D] shadow-none hover:border-[#D6D8DD] hover:bg-[#F8F8F9] hover:text-[#33353D] dark:border-[#E6E7EB] dark:bg-white dark:text-[#33353D] dark:shadow-none dark:hover:border-[#D6D8DD] dark:hover:bg-[#F8F8F9] dark:hover:text-[#33353D]"
                            onClick={() => {
                                if (uploadingResume) {
                                    abortControllerRef.current?.abort();
                                    return;
                                }
                                resetResumeUploadDraft();
                                setResumeUploadOpen(false);
                            }}
                        >
                            {uploadingResume ? recruitmentUiText.cancelUpload : recruitmentUiText.cancelButton}
                        </Button>
                        <Button
                            className="h-[34px] rounded-[6px] bg-[#1E3BFA] px-[18px] text-[13px] font-normal text-white shadow-none hover:bg-[#0F23D9] focus-visible:border-[#1E3BFA] focus-visible:ring-[#1E3BFA]/20 dark:bg-[#1E3BFA] dark:text-white dark:shadow-none dark:hover:bg-[#0F23D9]"
                            onClick={() => void uploadResumes()}
                            disabled={uploadingResume || !uploadFiles.length}
                        >
                            {uploadingResume ? (
                                <>
                                    <Loader2 className="h-3.5 w-3.5 animate-spin"/>
                                    {recruitmentUiText.uploading}
                                </>
                            ) : resumeUploadResults.length ? uploadRecoveryText.retryFailed : recruitmentUiText.startUpload}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        );
    }, [recruitmentUiText, uploadRecoveryText, resumeUploadResults, positionsLoading, positions, resumeUploadPositionId, showOrganizationFields, organizationSelectOptions, resumeUploadOrgCode, resumeUploadCitySource, resumeUploadCity, resumeUploadFileList, resumeUploadError, uploadingResume, uploadCompletedCount, uploadProgress, resumeUploadMode, resumeUploadSource, resumeUploadDuplicateStrategy, isZh, showAdvancedOptions, isDraggingFile, resetResumeUploadDraft, selectResumeUploadFiles]);

    function openResumeUploadDialog(positionId?: number | null) {
        const targetPositionId = typeof positionId === "number" && Number.isFinite(positionId) ? positionId : null;
        if (targetPositionId) {
            setResumeUploadMode("position");
            setResumeUploadPositionId(String(targetPositionId));
            setResumeUploadOrgCode(normalizeRecruitmentOrgCode(positionMap.get(targetPositionId)?.org_code || activeCreateOrgCode));
        } else {
            setResumeUploadMode("smart");
            setResumeUploadPositionId("");
            setResumeUploadOrgCode(currentResumeUploadDefaultOrgCode);
        }
        setResumeUploadOpen(true);
    }

    async function saveCandidate() {
        if (!selectedCandidateId || candidateSaving) {
            return;
        }
        setCandidateSaving(true);
        try {
            const originalPositionId = candidateDetail?.candidate.position_id ?? null;
            const nextPositionId = candidateEditor.positionId ? Number(candidateEditor.positionId) : null;
            const payload: Record<string, unknown> = {
                name: candidateEditor.name.trim(),
                phone: candidateEditor.phone.trim() || null,
                email: candidateEditor.email.trim() || null,
                current_company: candidateEditor.currentCompany.trim() || null,
                years_of_experience: candidateEditor.yearsOfExperience.trim() || null,
                education: candidateEditor.education.trim() || null,
                age: (() => { const v = Number(candidateEditor.age.trim()); return v && !isNaN(v) ? v : null; })(),
                city: candidateEditor.city.trim() || null,
                expected_city: candidateEditor.expectedCity.trim() || null,
                notes: candidateEditor.notes.trim() || null,
                tags: splitTags(candidateEditor.tagsText),
                manual_override_score: candidateEditor.manualOverrideScore.trim()
                    ? Number(candidateEditor.manualOverrideScore)
                    : null,
                manual_override_reason: candidateEditor.manualOverrideReason.trim() || null,
                hr_feedback: candidateEditor.hrFeedback || null,
                hr_feedback_reason: candidateEditor.hrFeedbackReason.trim() || null,
                owner_id: candidateEditor.ownerId.trim() || null,
            };
            if (nextPositionId !== originalPositionId) {
                payload.position_id = nextPositionId;
            }
            await recruitmentApi(`/candidates/${selectedCandidateId}`, {
                method: "PATCH",
                body: JSON.stringify(payload),
            });
            toast.success(recruitmentToast.updated(recruitmentToastEntities.candidate));
            checkedDuplicateCandidateIdRef.current = null;
            await Promise.all([loadCandidateDetail(selectedCandidateId, {includeDuplicates: true}), loadCandidates(), refreshCandidateStats()]);
        } catch (error) {
            toast.error(recruitmentToast.saveFailed(recruitmentToastEntities.candidate, formatActionError(error)));
        } finally {
            setCandidateSaving(false);
        }
    }

    async function updateCandidateStatus(nextStatus: string) {
        if (!selectedCandidateId || !candidateDetail) {
            return;
        }
        setPendingStatus(null);
        try {
            await recruitmentApi(`/candidates/${selectedCandidateId}/status`, {
                method: "POST",
                body: JSON.stringify({
                    status: nextStatus,
                    reason: statusUpdateReason.trim() || null,
                }),
            });
            toast.success(recruitmentToast.updated(recruitmentToastEntities.candidate));
            setStatusUpdateReason("");
            const shouldRefreshTalentPool = nextStatus === "talent_pool"
                || candidateDetail.candidate.status === "talent_pool"
                || Boolean(candidateDetail.candidate.talent_pool_reason);
            await Promise.all([
                loadCandidateDetail(selectedCandidateId),
                loadCandidates(),
                refreshCandidateStats(),
                shouldRefreshTalentPool ? loadTalentPoolCandidates() : Promise.resolve(),
            ]);
        } catch (error) {
            toast.error(recruitmentToast.updateFailed(recruitmentToastEntities.candidate, formatActionError(error)));
        }
    }

    async function triggerScreening(targetCandidateIds?: number[]) {
        const isBatchRequest = Array.isArray(targetCandidateIds);
        if (isBatchRequest && isBatchScreeningRunning) {
            if (isBatchScreeningCancelling) {
                return;
            }
            setBatchScreeningStopSubmitting(true);
            try {
                const scopedOrgCode = resolveScopedOrgCode(selectedDepartmentScope, selectedOrgScope);
                const response = await recruitmentApi<RecruitmentVisibleScreeningCancelResponse>("/candidates/screen/visible/cancel", {
                    method: "POST",
                    body: JSON.stringify({
                        org_code: scopedOrgCode || null,
                    }),
                });
                const stoppedTaskIds = Array.from(new Set(response.task_ids || []));
                if (stoppedTaskIds.length) {
                    stoppedTaskIds.forEach((taskId) => stopTaskMonitor(taskId));
                    clearScreeningTaskSnapshotsByTaskIds(stoppedTaskIds);
                    setActiveBatchScreeningTaskIds((current) => current.filter((taskId) => !stoppedTaskIds.includes(taskId)));
                    setActiveScreeningTaskMap((current) => {
                        const next = {...current};
                        Object.entries(next).forEach(([candidateId, taskId]) => {
                            if (stoppedTaskIds.includes(taskId)) {
                                delete next[Number(candidateId)];
                            }
                        });
                        return next;
                    });
                    toast.success(recruitmentUiText.stopBatchScreeningCompleted(response.cancelled_count || stoppedTaskIds.length));
                    void Promise.all([
                        loadCandidates({silent: true, force: true}),
                        refreshCandidateStats(),
                    ]).catch(() => {});
                } else {
                    toast.success(recruitmentUiText.noBatchScreeningToStop);
                    void refreshCandidateStats();
                }
            } catch (error) {
                toast.error(recruitmentToast.stopFailed(recruitmentUiText.batchScreening, formatActionError(error)));
            } finally {
                setBatchScreeningStopSubmitting(false);
            }
            return;
        }
        if (!isBatchRequest && selectedCandidateScreeningTaskId) {
            if (isSelectedCandidateScreeningCancelling) {
                return;
            }
            try {
                const log = await cancelTaskGeneration(selectedCandidateScreeningTaskId, recruitmentUiText.screening);
                if (log?.status === "cancelled") {
                    stopTaskMonitor(selectedCandidateScreeningTaskId);
                    setActiveScreeningTaskMap((current) => {
                        const next = {...current};
                        if (selectedCandidateId && next[selectedCandidateId] === selectedCandidateScreeningTaskId) {
                            delete next[selectedCandidateId];
                        }
                        return next;
                    });
                }
            } catch (error) {
                toast.error(recruitmentToast.stopFailed(recruitmentUiText.screening, formatActionError(error)));
            }
            return;
        }
        if (screeningLaunchInFlightRef.current) {
            return;
        }
        const candidateIds = Array.from(new Set(
            (targetCandidateIds?.length ? targetCandidateIds : (selectedCandidateId ? [selectedCandidateId] : []))
                .filter(Boolean),
        ));
        if (!candidateIds.length) {
            toast.error(recruitmentUiText.noScreeningTarget);
            return;
        }
        screeningLaunchInFlightRef.current = true;
        setScreeningSubmitting(true);
        try {
            if (isBatchRequest) {
                const response = await recruitmentApi<RecruitmentTaskBatchStartResponse>("/candidates/screen/batch-start", {
                    method: "POST",
                    body: JSON.stringify({
                        candidate_ids: candidateIds,
                        skill_ids: [],
                        use_candidate_memory: true,
                        use_position_skills: true,
                    }),
                });
                // 只对真正新入队或仍在运行的任务挂载 monitor，已完成的复用任务不挂载
                response.tasks.forEach((task) => {
                    if (!task.related_candidate_id || !task.task_id) return;
                    if (task.status && isLiveTaskStatus(task.status)) {
                        attachScreeningTaskMonitor(task.related_candidate_id, task.task_id, {
                            batch: true,
                            suppressFinishToast: true,
                        });
                    }
                });
                const reusedResultCount = Number(response.duplicated_count || 0);
                if (response.queued_count || response.skipped_existing_live_task_count || reusedResultCount) {
                    removeCandidateIdsFromSelection(
                        response.tasks
                            .map((task) => Number(task.related_candidate_id || 0))
                            .filter((candidateId) => Number.isFinite(candidateId) && candidateId > 0),
                    );
                    toast.success(
                        recruitmentToast.screeningQueued(
                            response.queued_count,
                            response.skipped_existing_live_task_count,
                            response.failed_count || 0,
                            reusedResultCount,
                        ),
                    );
                    void refreshActiveCandidateListAndStats({ silent: true }).catch(() => {});
                } else {
                    toast.error(recruitmentUiText.noScreeningQueued);
                }
            } else {
                const candidateId = candidateIds[0];
                const task = await recruitmentApi<RecruitmentTaskStartResponse>(`/candidates/${candidateId}/screen/start`, {
                    method: "POST",
                    body: JSON.stringify({
                        skill_ids: [],
                        use_candidate_memory: true,
                        use_position_skills: true,
                    }),
                });
                if (task.status && isLiveTaskStatus(task.status)) {
                    // 新入队或仍在运行的任务：挂载 monitor 轮询
                    attachScreeningTaskMonitor(candidateId, task.task_id, {
                        suppressFinishToast: false,
                    });
                    toast.success(task.reused_existing_task ? recruitmentToast.screeningTaskReused : recruitmentUiText.queueJoined);
                    void refreshActiveCandidateListAndStats({ silent: true }).catch(() => {});
                } else {
                    // 已完成的复用任务：不挂载 monitor，直接提示已完成
                    toast.success(recruitmentToast.screeningCompleted(false));
                    void refreshActiveCandidateListAndStats({ silent: true }).catch(() => {});
                }
            }
        } catch (error) {
            toast.error(recruitmentToast.screeningStartFailed(formatActionError(error)));
        } finally {
            screeningLaunchInFlightRef.current = false;
            setScreeningSubmitting(false);
        }
    }

    async function triggerFreshScreening(targetCandidateIds?: number[]) {
        const candidateIds = Array.from(new Set(
            (targetCandidateIds?.length ? targetCandidateIds : (selectedCandidateId ? [selectedCandidateId] : []))
                .filter(Boolean),
        ));
        if (!candidateIds.length) {
            toast.error(recruitmentUiText.noScreeningTarget);
            return;
        }
        setScreeningSubmitting(true);
        try {
            if (candidateIds.length > 1) {
                const response = await recruitmentApi<RecruitmentTaskBatchStartResponse>("/candidates/screen/batch-start", {
                    method: "POST",
                    timeoutMs: 45000,
                    body: JSON.stringify({
                        candidate_ids: candidateIds,
                        skill_ids: [],
                        use_candidate_memory: false,
                        use_position_skills: true,
                        allow_reuse_parse: false,
                        allow_score_only_rerun: false,
                    }),
                });
                response.tasks.forEach((task) => {
                    if (!task.related_candidate_id || !task.task_id) return;
                    if (task.status && isLiveTaskStatus(task.status)) {
                        attachScreeningTaskMonitor(task.related_candidate_id, task.task_id, {
                            batch: true,
                            suppressFinishToast: true,
                        });
                    }
                });
                toast.success(
                    isZh
                        ? `已按当前岗位最新规则发起 ${response.queued_count || 0} 位候选人的初筛`
                        : `Queued screening for ${response.queued_count || 0} candidate(s).`,
                );
                removeCandidateIdsFromSelection(candidateIds);
                void refreshActiveCandidateListAndStats({ silent: true }).catch(() => {});
                return;
            }

            const candidateId = candidateIds[0];
            const task = await recruitmentApi<RecruitmentTaskStartResponse>(`/candidates/${candidateId}/screen/start`, {
                method: "POST",
                timeoutMs: 45000,
                body: JSON.stringify({
                    skill_ids: [],
                    use_candidate_memory: false,
                    use_position_skills: true,
                    allow_reuse_parse: false,
                    allow_score_only_rerun: false,
                }),
            });
            if (task.status && isLiveTaskStatus(task.status)) {
                attachScreeningTaskMonitor(candidateId, task.task_id, {
                    suppressFinishToast: false,
                });
            }
            toast.success(isZh ? "已按当前岗位最新规则发起初筛" : "Screening queued.");
            removeCandidateIdsFromSelection([candidateId]);
            void refreshActiveCandidateListAndStats({ silent: true }).catch(() => {});
        } catch (error) {
            toast.error(recruitmentToast.screeningStartFailed(formatActionError(error)));
        } finally {
            setScreeningSubmitting(false);
        }
    }

    async function generateInterviewQuestions() {
        if (!selectedCandidateId) {
            return;
        }
        const candidateId = selectedCandidateId;
        if (currentCandidateInterviewTaskId) {
            if (isCurrentInterviewTaskCancelling) {
                return;
            }
            try {
                const log = await cancelTaskGeneration(currentCandidateInterviewTaskId, isZh ? "面试题生成" : "interview question generation");
                if (log?.status === "cancelled") {
                    stopTaskMonitor(currentCandidateInterviewTaskId);
                    setActiveInterviewTaskId((current) => (current === currentCandidateInterviewTaskId ? null : current));
                    setActiveInterviewCandidateId((current) => (current === candidateId ? null : current));
                }
            } catch (error) {
                toast.error(recruitmentToast.stopFailed("面试题生成", formatActionError(error)));
            }
            return;
        }
        if (interviewGenerating) {
            return;
        }
        const manualSkillIds = interviewSkillSelectionDirty ? selectedInterviewSkillIds : [];
        let started = false;
        setInterviewGenerating(true);
        try {
            const task = await recruitmentApi<RecruitmentTaskStartResponse>(`/candidates/${candidateId}/interview-questions/start`, {
                method: "POST",
                body: JSON.stringify({
                    round_name: interviewRoundName.trim() || localizedInitialInterviewRoundName,
                    custom_requirements: interviewCustomRequirements.trim() || null,
                    skill_ids: manualSkillIds,
                    use_candidate_memory: !interviewSkillSelectionDirty,
                    use_position_skills: !interviewSkillSelectionDirty,
                }),
            });
            started = true;
            setActiveInterviewTaskId(task.task_id);
            setActiveInterviewCandidateId(candidateId);
            await loadLogs({silent: true});
            startTaskMonitor(task.task_id, {
                onFinish: async (log) => {
                    if (!mountedRef.current) {
                        return;
                    }
                    setActiveInterviewTaskId((current) => (current === task.task_id ? null : current));
                    setActiveInterviewCandidateId((current) => (current === candidateId ? null : current));
                    await Promise.all([
                        loadLogs({silent: true}),
                        selectedCandidateIdRef.current === candidateId
                            ? loadCandidateDetail(candidateId, {silent: true})
                            : Promise.resolve(null),
                    ]);
                    if (log.status === "success" || log.status === "fallback") {
                        toast.success(recruitmentToast.generated("面试题", log.status === "fallback"));
                        return;
                    }
                    if (log.status === "cancelled") {
                        toast.success(recruitmentToast.stopped("面试题生成"));
                        return;
                    }
                    toast.error(recruitmentToast.interviewQuestionGenerationFailed(log.error_message || recruitmentToast.unknownError));
                },
            });
            toast.success(recruitmentToast.interviewQuestionGenerationStarted);
        } catch (error) {
            toast.error(recruitmentToast.interviewQuestionGenerationFailed(error instanceof Error ? error.message : recruitmentToast.unknownError));
        } finally {
            if (!started) {
                setInterviewGenerating(false);
            }
        }
    }

    async function sendChatMessage() {
        if (canStopCurrentRun) {
            if (activeChatTaskId) {
                if (isCurrentChatTaskCancelling) {
                    return;
                }
                try {
                    const log = await cancelTaskGeneration(activeChatTaskId, isZh ? "AI 助手" : "AI Assistant");
                    if (log?.status === "cancelled") {
                        stopTaskMonitor(activeChatTaskId);
                        if (activeChatMessageId) {
                            updateChatMessage(activeChatMessageId, (message) => ({
                                ...message,
                                pending: false,
                                taskId: null,
                                logId: log.id,
                            }));
                        }
                        setActiveChatTaskId((current) => (current === activeChatTaskId ? null : current));
                        setActiveChatMessageId((current) => (current === activeChatMessageId ? null : current));
                    }
                } catch (error) {
                    toast.error(recruitmentToast.stopFailed("助手生成", formatActionError(error)));
                }
                return;
            }
            if (assistantStreamStopping) {
                return;
            }
            setAssistantStreamStopping(true);
            assistantStreamAbortRef.current?.abort();
            return;
        }
        if (chatSending) {
            return;
        }
        const message = chatInput.trim();
        if (!message) {
            return;
        }
        setAutoFollowStream(true);
        setIsUserScrolledUp(false);
        if (shouldUseStreamingAssistant(message)) {
            await runStreamingAssistant(message);
            return;
        }
        const userMessageId = `u-${Date.now()}`;
        setChatMessages((current) => [
            ...current,
            {id: userMessageId, role: "user", content: message, createdAt: new Date().toISOString()},
        ]);
        setChatInput("");
        setChatSending(true);
        let startedAsyncTask = false;
        try {
            const response = await recruitmentApi<ChatResponse>("/chat/start", {
                method: "POST",
                body: JSON.stringify({
                    message,
                    context: {
                        position_id: chatContext.position_id,
                        candidate_id: chatContext.candidate_id,
                        skill_ids: chatContext.skill_ids,
                    },
                }),
            });
            setChatContext(response.context);
            if (!response.pending || !response.task_id) {
                setChatMessages((current) => [
                    ...current,
                    {
                        id: `a-${Date.now()}`,
                        role: "assistant",
                        content: response.reply,
                        createdAt: new Date().toISOString(),
                        actions: response.actions,
                        logId: response.log_id ?? undefined,
                        memorySource: response.memory_source,
                        modelProvider: response.model_provider,
                        modelName: response.model_name,
                        usedSkillIds: response.used_skill_ids,
                        usedSkills: response.used_skills,
                        usedFallback: response.used_fallback,
                        fallbackError: response.fallback_error,
                    },
                ]);
                if (response.used_fallback) {
                    toast.error(recruitmentToast.screeningFallback(response.fallback_error || recruitmentToast.noReason));
                }
                await Promise.all([loadLogs({silent: true})]);
                return;
            }
            const pendingMessageId = `a-${Date.now()}`;
            startedAsyncTask = true;
            setActiveChatTaskId(response.task_id);
            setActiveChatMessageId(pendingMessageId);
            setChatMessages((current) => [
                ...current,
                {
                    id: pendingMessageId,
                    role: "assistant",
                    content: isZh ? "助手正在思考..." : "Assistant is thinking...",
                    createdAt: new Date().toISOString(),
                    pending: true,
                    taskId: response.task_id,
                    logId: response.log_id ?? undefined,
                    memorySource: response.memory_source,
                    modelProvider: response.model_provider,
                    modelName: response.model_name,
                },
            ]);
            await loadLogs({silent: true});
            startTaskMonitor(response.task_id, {
                onUpdate: (log) => {
                    if (log.status === "cancelling") {
                        updateChatMessage(pendingMessageId, (chatMessage) => ({
                            ...chatMessage,
                            content: isZh ? "正在停止生成..." : "Stopping generation...",
                        }));
                    }
                },
                onFinish: async (log) => {
                    if (!mountedRef.current) {
                        return;
                    }
                    const usedSkills = resolveLogSkillSnapshots(log, skillMap);
                    const reply = extractChatReplyFromLog(log);
                    updateChatMessage(pendingMessageId, (chatMessage) => ({
                        ...chatMessage,
                        content: reply,
                        pending: false,
                        taskId: null,
                        logId: log.id,
                        memorySource: log.memory_source,
                        modelProvider: log.model_provider,
                        modelName: log.model_name,
                        usedSkillIds: log.related_skill_ids,
                        usedSkills,
                        usedFallback: log.status === "fallback",
                        fallbackError: log.error_message,
                    }));
                    setActiveChatTaskId((current) => (current === response.task_id ? null : current));
                    setActiveChatMessageId((current) => (current === pendingMessageId ? null : current));
                    await Promise.all([loadLogs({silent: true})]);
                    if (log.status === "fallback") {
                        toast.error(recruitmentToast.screeningFallback(log.error_message || recruitmentToast.noReason));
                    } else if (log.status === "failed") {
                        toast.error(recruitmentToast.sendFailed("发送", log.error_message || recruitmentToast.unknownError));
                    } else if (log.status === "cancelled") {
                        toast.success(recruitmentToast.assistantGenerationStopped);
                    }
                },
            });
        } catch (error) {
            setChatMessages((current) => [
                ...current,
                {
                    id: `e-${Date.now()}`,
                    role: "assistant",
                    content: recruitmentToast.sendFailed("发送", error instanceof Error ? error.message : recruitmentToast.unknownError),
                    createdAt: new Date().toISOString(),
                },
            ]);
        } finally {
            if (!startedAsyncTask) {
                setChatSending(false);
            }
        }
    }

    async function saveChatContext(
        nextPositionId: number | null,
        nextSkillIds: number[],
        nextCandidateId: number | null = null,
        options?: { quiet?: boolean },
    ) {
        const previousContext = chatContext;
        const optimisticContext = buildOptimisticChatContext(
            nextPositionId,
            nextSkillIds,
            nextCandidateId,
            previousContext,
        );
        chatContextRef.current = optimisticContext;
        setChatContext(optimisticContext);
        try {
            const response = await recruitmentApi<ChatContext>("/chat/context", {
                method: "POST",
                body: JSON.stringify({
                    position_id: nextPositionId,
                    candidate_id: nextCandidateId,
                    skill_ids: nextSkillIds,
                }),
            });
            chatContextRef.current = response;
            setChatContext(response);
            if (options?.quiet) {
                return;
            }
            toast.success(recruitmentToast.contextUpdated);
        } catch (error) {
            chatContextRef.current = previousContext;
            setChatContext(previousContext);
            if (options?.quiet) {
                return;
            }
            toast.error(recruitmentToast.contextUpdateFailed(error instanceof Error ? error.message : recruitmentToast.unknownError));
        }
    }

    function toggleSkillInAssistant(skillId: number) {
        if (!enabledSkillMap.has(skillId)) {
            return;
        }
        const nextSkillIds = assistantContextSkillIds.includes(skillId)
            ? assistantContextSkillIds.filter((item) => item !== skillId)
            : [...assistantContextSkillIds, skillId];
        void saveChatContext(chatContext.position_id || null, nextSkillIds, chatContext.candidate_id || null);
        queueAssistantInputFocus();
    }

    function toggleCandidateSelection(candidateId: number, nextChecked?: boolean) {
        setSelectedCandidateIds((current) => toggleIdInList(current, candidateId, nextChecked));
    }

    function toggleInterviewSkillSelection(skillId: number) {
        setSelectedInterviewSkillIds((current) => {
            const next = current.includes(skillId)
                ? current.filter((item) => item !== skillId)
                : [...current, skillId];
            setInterviewSkillSelectionDirty(next.length > 0);
            return next;
        });
    }

    function openMailSenderEditor(sender?: RecruitmentMailSenderConfig) {
        void ensureMailSettingsLoaded();
        if (sender) {
            setMailSenderEditingId(sender.id);
            setMailSenderForm({
                name: sender.name,
                fromName: sender.from_name || "",
                fromEmail: sender.from_email,
                smtpHost: sender.smtp_host,
                smtpPort: String(sender.smtp_port),
                username: sender.username,
                password: "",
                useSsl: sender.use_ssl,
                useStarttls: sender.use_starttls,
                isDefault: sender.is_default,
                isEnabled: sender.is_enabled,
            });
        } else {
            setMailSenderEditingId(null);
            setMailSenderForm(emptyMailSenderForm());
        }
        setMailSenderDialogOpen(true);
    }

    function applyMailSenderPreset(presetKey: MailSenderPresetKey) {
        const preset = mailSenderPresets.find((item) => item.key === presetKey);
        if (!preset) {
            return;
        }
        setMailSenderForm((current) => ({
            ...current,
            smtpHost: preset.smtpHost,
            smtpPort: preset.smtpPort,
            useSsl: preset.useSsl,
            useStarttls: preset.useStarttls,
        }));
    }

    async function submitMailSender() {
        if (mailSenderSaving) {
            return;
        }
        setMailSenderSaving(true);
        try {
            const inferredPreset = inferMailSenderPreset(mailSenderForm.fromEmail || mailSenderForm.username);
            const smtpHost = mailSenderForm.smtpHost.trim() || inferredPreset?.smtpHost || "";
            const smtpPort = Number(mailSenderForm.smtpPort || inferredPreset?.smtpPort || "465");
            const useSsl = mailSenderForm.smtpHost.trim() ? mailSenderForm.useSsl : (inferredPreset?.useSsl ?? mailSenderForm.useSsl);
            const useStarttls = mailSenderForm.smtpHost.trim() ? mailSenderForm.useStarttls : (inferredPreset?.useStarttls ?? mailSenderForm.useStarttls);
            if (!smtpHost) {
                toast.error(recruitmentToast.smtpHostRequired);
                return;
            }
            const payload = {
                name: mailSenderForm.name.trim(),
                from_name: mailSenderForm.fromName.trim() || null,
                from_email: mailSenderForm.fromEmail.trim(),
                smtp_host: smtpHost,
                smtp_port: smtpPort,
                username: mailSenderForm.username.trim(),
                password: mailSenderForm.password.trim() || null,
                use_ssl: useSsl,
                use_starttls: useStarttls,
                is_default: mailSenderForm.isDefault,
                is_enabled: mailSenderForm.isEnabled,
            };
            if (mailSenderEditingId) {
                await recruitmentApi(`/mail-senders/${mailSenderEditingId}`, {
                    method: "PATCH",
                    body: JSON.stringify(payload),
                });
                toast.success(recruitmentToast.updated(recruitmentToastEntities.mailSender));
            } else {
                await recruitmentApi(`/mail-senders`, {
                    method: "POST",
                    body: JSON.stringify(payload),
                });
                toast.success(recruitmentToast.created(recruitmentToastEntities.mailSender));
            }
            setMailSenderDialogOpen(false);
            try {
                await loadMailSenders();
            } catch (refreshError) {
                toast.error(recruitmentToast.savedButRefreshFailed(recruitmentToastEntities.mailSender, formatActionError(refreshError)));
            }
        } catch (error) {
            toast.error(recruitmentToast.saveFailed(recruitmentToastEntities.mailSender, formatActionError(error)));
        } finally {
            setMailSenderSaving(false);
        }
    }

    async function deleteMailSender(senderId: number) {
        const actionKey = `mail-sender-${senderId}`;
        setDeleteActionKey(actionKey);
        try {
            await recruitmentApi(`/mail-senders/${senderId}`, {method: "DELETE"});
            setMailSenderDeleteTarget(null);
            toast.success(recruitmentToast.deleted(recruitmentToastEntities.mailSender));
            await loadMailSenders();
        } catch (error) {
            toast.error(recruitmentToast.deleteFailed(recruitmentToastEntities.mailSender, error instanceof Error ? error.message : recruitmentToast.unknownError));
        } finally {
            setDeleteActionKey((current) => (current === actionKey ? null : current));
        }
    }

    function openMailRecipientEditor(recipient?: RecruitmentMailRecipient) {
        void ensureMailSettingsLoaded();
        if (recipient) {
            setMailRecipientEditingId(recipient.id);
            setMailRecipientForm({
                name: recipient.name,
                email: recipient.email,
                department: recipient.department || "",
                roleTitle: recipient.role_title || "",
                tagsText: joinTags(recipient.tags),
                notes: recipient.notes || "",
                isEnabled: recipient.is_enabled,
            });
        } else {
            setMailRecipientEditingId(null);
            setMailRecipientForm(emptyMailRecipientForm());
        }
        setMailRecipientDialogOpen(true);
    }

    async function submitMailRecipient() {
        if (mailRecipientSaving) {
            return;
        }
        setMailRecipientSaving(true);
        try {
            const payload = {
                name: mailRecipientForm.name.trim(),
                email: mailRecipientForm.email.trim(),
                department: mailRecipientForm.department.trim() || null,
                role_title: mailRecipientForm.roleTitle.trim() || null,
                tags: splitTags(mailRecipientForm.tagsText),
                notes: mailRecipientForm.notes.trim() || null,
                is_enabled: mailRecipientForm.isEnabled,
            };
            if (mailRecipientEditingId) {
                await recruitmentApi(`/mail-recipients/${mailRecipientEditingId}`, {
                    method: "PATCH",
                    body: JSON.stringify(payload),
                });
                toast.success(recruitmentToast.updated(recruitmentToastEntities.mailRecipient));
            } else {
                await recruitmentApi(`/mail-recipients`, {
                    method: "POST",
                    body: JSON.stringify(payload),
                });
                toast.success(recruitmentToast.created(recruitmentToastEntities.mailRecipient));
            }
            setMailRecipientDialogOpen(false);
            await loadMailRecipients();
        } catch (error) {
            toast.error(recruitmentToast.saveFailed(recruitmentToastEntities.mailRecipient, error instanceof Error ? error.message : recruitmentToast.unknownError));
        } finally {
            setMailRecipientSaving(false);
        }
    }

    async function deleteMailRecipient(recipientId: number) {
        const actionKey = `mail-recipient-${recipientId}`;
        setDeleteActionKey(actionKey);
        try {
            await recruitmentApi(`/mail-recipients/${recipientId}`, {method: "DELETE"});
            setMailRecipientDeleteTarget(null);
            setMailAutoPushGlobalConfig((current) => ({
                ...current,
                global_default_recipient_ids: current.global_default_recipient_ids.filter((id) => id !== recipientId),
            }));
            toast.success(recruitmentToast.deleted(recruitmentToastEntities.mailRecipient));
            await loadMailRecipients();
        } catch (error) {
            toast.error(recruitmentToast.deleteFailed(recruitmentToastEntities.mailRecipient, error instanceof Error ? error.message : recruitmentToast.unknownError));
        } finally {
            setDeleteActionKey((current) => (current === actionKey ? null : current));
        }
    }

    function openResumeMailDialog(
        candidateIds?: number[],
        overrides?: Partial<ResumeMailFormState> & { mode?: ResumeMailDialogMode; sourceDispatchId?: number | null },
    ) {
        const nextCandidateIds = Array.from(new Set(
            (candidateIds?.length
                ? candidateIds
                : (selectedCandidateIds.length ? selectedCandidateIds : (selectedCandidateId ? [selectedCandidateId] : [])))
                .filter(Boolean),
        ));
        if (!nextCandidateIds.length) {
            toast.error(recruitmentToast.noResumeMailCandidates);
            return;
        }
        void ensureResumeMailComposerDataLoaded().catch(() => undefined);
        void ensureResumeMailDispatchHistoryLoaded().catch(() => undefined);
        setResumeMailDialogMode(overrides?.mode || "send");
        setResumeMailSourceDispatchId(overrides?.sourceDispatchId ?? null);
        setResumeMailForm({
            candidateIds: nextCandidateIds,
            senderConfigId: overrides?.senderConfigId ?? defaultMailSenderId,
            recipientIds: overrides?.recipientIds || [],
            extraRecipientEmails: overrides?.extraRecipientEmails || "",
            subject: overrides?.subject || "",
            bodyText: overrides?.bodyText || "",
        });
        setResumeMailDialogOpen(true);
    }

    async function loadResumeMailDispatchDetail(dispatchId: number) {
        const requestId = mailDispatchDetailLoadRequestIdRef.current + 1;
        mailDispatchDetailLoadRequestIdRef.current = requestId;
        mailDispatchDetailLoadAbortControllerRef.current?.abort();
        const controller = new AbortController();
        mailDispatchDetailLoadAbortControllerRef.current = controller;
        setMailDispatchDetailLoadingId(dispatchId);
        try {
            const detail = await recruitmentApi<RecruitmentResumeMailDispatch>(`/resume-mail-dispatches/${dispatchId}`, {
                signal: controller.signal,
            });
            if (!mountedRef.current || mailDispatchDetailLoadRequestIdRef.current !== requestId) {
                return null;
            }
            return detail;
        } catch (error) {
            if (!isRecruitmentRequestAborted(error)) {
                toast.error(recruitmentToast.loadFailed(recruitmentToastEntities.resumeMail, formatActionError(error)));
            }
            return null;
        } finally {
            if (mailDispatchDetailLoadAbortControllerRef.current === controller) {
                mailDispatchDetailLoadAbortControllerRef.current = null;
            }
            if (mailDispatchDetailLoadRequestIdRef.current === requestId) {
                setMailDispatchDetailLoadingId(null);
            }
        }
    }

    async function openResumeMailReplayDialog(dispatch: RecruitmentResumeMailDispatch) {
        const detail = await loadResumeMailDispatchDetail(dispatch.id);
        if (!detail) {
            return;
        }
        openResumeMailDialog(detail.candidate_ids, {
            mode: "resend",
            sourceDispatchId: detail.id,
            senderConfigId: detail.sender_config_id ? String(detail.sender_config_id) : defaultMailSenderId,
            recipientIds: detail.recipient_ids,
            extraRecipientEmails: detail.recipient_emails.join(", "),
            subject: detail.subject || "",
            bodyText: detail.body_text || "",
        });
    }

    async function sendResumeMailRequest(
        payload: {
            sender_config_id: number | null;
            candidate_ids: number[];
            recipient_ids: number[];
            recipient_emails: string[];
            subject: string | null;
            body_text: string | null;
        },
        options?: { successMessage?: string; closeDialog?: boolean },
    ) {
        try {
            const dispatch = await recruitmentApi<RecruitmentResumeMailDispatch>(`/resume-mail-dispatches/send`, {
                method: "POST",
                body: JSON.stringify(payload),
            });
            if (resumeMailDispatchHistoryLoadedOnceRef.current) {
                setAllResumeMailDispatches((current) => [dispatch, ...current.filter((item) => item.id !== dispatch.id)]);
            }
            toast.success(options?.successMessage || recruitmentToast.sent(recruitmentToastEntities.resumeMail));
            if (options?.closeDialog !== false) {
                setResumeMailDialogOpen(false);
            }
            setResumeMailDispatchPageIndex(0);
            if (activePageRef.current === "settings-mail" && canViewMail) {
                try {
                    await loadMailDispatches({pageIndex: 0});
                } catch (refreshError) {
                    toast.error(recruitmentToast.savedButRefreshFailed(recruitmentToastEntities.resumeMail, formatActionError(refreshError)));
                }
            }
            return dispatch;
        } catch (error) {
            const errorMessage = recruitmentToast.sendFailed(recruitmentToastEntities.resumeMail, formatActionError(error));
            throw new Error(errorMessage); // 重新抛出以便调用方处理
        }
    }

    async function confirmAssistantPreparedResumeMail(messageId: string, preparedMail: RecruitmentAssistantPreparedResumeMail) {
        if (!preparedMail.can_confirm) {
            setResumeMailError(preparedMail.blocking_reason || recruitmentToast.mailPreviewBlocked);
            return;
        }
        setResumeMailSourceAssistantMessageId(null);
        setAssistantMailActionState((current) => ({
            ...current,
            [messageId]: {
                status: "sending",
                editing: false,
                error: null,
                dispatchId: current[messageId]?.dispatchId ?? null,
            },
        }));
        try {
            const dispatch = await sendResumeMailRequest(
                {
                    sender_config_id: preparedMail.sender_config_id,
                    candidate_ids: preparedMail.candidate_ids,
                    recipient_ids: preparedMail.recipient_ids,
                    recipient_emails: preparedMail.recipients
                        .filter((item) => item.source === "direct_email")
                        .map((item) => item.email),
                    subject: preparedMail.subject.trim() || null,
                    body_text: preparedMail.body_text.trim() || null,
                },
                {successMessage: "简历邮件已发送", closeDialog: false},
            );
            if (!dispatch) {
                throw new Error("邮件发送失败");
            }
            setAssistantMailActionState((current) => ({
                ...current,
                [messageId]: {
                    status: "sent",
                    editing: false,
                    error: null,
                    dispatchId: dispatch.id,
                },
            }));
            setChatMessages((current) => [
                ...current,
                {
                    id: `a-mail-sent-${Date.now()}`,
                    role: "assistant",
                    content: recruitmentUiText.mailSentMessage(dispatch.id, dispatch.recipient_emails, dispatch.attachment_count, false),
                    createdAt: new Date().toISOString(),
                    sourceRunType: "stream",
                },
            ]);
        } catch (error) {
            const message = formatActionError(error);
            setAssistantMailActionState((current) => ({
                ...current,
                [messageId]: {
                    status: "error",
                    editing: false,
                    error: message,
                    dispatchId: current[messageId]?.dispatchId ?? null,
                },
            }));
        }
    }

    async function submitResumeMail() {
        if (!resumeMailForm.candidateIds.length) {
            setResumeMailError(recruitmentToast.noResumeMailCandidates);
            return;
        }
        const extraEmails = parseEmailList(resumeMailForm.extraRecipientEmails);
        if (!resumeMailForm.recipientIds.length && !extraEmails.length) {
            setResumeMailError(recruitmentToast.noRecipientsSelected);
            return;
        }
        setResumeMailSubmitting(true);
        setResumeMailError(null); // 清除之前的错误
        try {
            const sourceAssistantMessageId = resumeMailSourceAssistantMessageId;
            if (sourceAssistantMessageId) {
                setAssistantMailActionState((current) => ({
                    ...current,
                    [sourceAssistantMessageId]: {
                        status: "sending",
                        editing: false,
                        error: null,
                        dispatchId: current[sourceAssistantMessageId]?.dispatchId ?? null,
                    },
                }));
            }
            const dispatch = await sendResumeMailRequest(
                {
                    sender_config_id: resumeMailForm.senderConfigId ? Number(resumeMailForm.senderConfigId) : null,
                    candidate_ids: resumeMailForm.candidateIds,
                    recipient_ids: resumeMailForm.recipientIds,
                    recipient_emails: extraEmails,
                    subject: resumeMailForm.subject.trim() || null,
                    body_text: resumeMailForm.bodyText.trim() || null,
                },
                {successMessage: resumeMailDialogMode === "resend" ? "简历邮件已再次发送" : "简历邮件已发送"},
            );
            if (sourceAssistantMessageId) {
                setAssistantMailActionState((current) => ({
                    ...current,
                    [sourceAssistantMessageId]: dispatch ? {
                        status: "sent",
                        editing: false,
                        error: null,
                        dispatchId: dispatch.id,
                    } : {
                        status: "error",
                        editing: false,
                        error: "邮件发送失败",
                        dispatchId: current[sourceAssistantMessageId]?.dispatchId ?? null,
                    },
                }));
                if (dispatch) {
                    setChatMessages((current) => [
                        ...current,
                        {
                            id: `a-mail-dialog-sent-${Date.now()}`,
                            role: "assistant",
                            content: recruitmentUiText.mailSentMessage(dispatch.id, dispatch.recipient_emails, dispatch.attachment_count, resumeMailDialogMode === "resend"),
                            createdAt: new Date().toISOString(),
                            sourceRunType: "stream",
                        },
                    ]);
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (resumeMailDialogOpen) {
                setResumeMailError(errorMessage);
            }
        } finally {
            setResumeMailSubmitting(false);
            setResumeMailSourceAssistantMessageId(null);
        }
    }

    async function retryResumeMailDispatch(dispatch: RecruitmentResumeMailDispatch) {
        const actionKey = `mail-dispatch-${dispatch.id}`;
        setMailDispatchActionKey(actionKey);
        try {
            const detail = await loadResumeMailDispatchDetail(dispatch.id);
            if (!detail) {
                return;
            }
            await sendResumeMailRequest(
                {
                    sender_config_id: detail.sender_config_id ? Number(detail.sender_config_id) : null,
                    candidate_ids: detail.candidate_ids,
                    recipient_ids: detail.recipient_ids,
                    recipient_emails: detail.recipient_emails,
                    subject: detail.subject?.trim() || null,
                    body_text: detail.body_text?.trim() || null,
                },
                {successMessage: "失败记录已重试发送", closeDialog: false},
            );
        } finally {
            setMailDispatchActionKey((current) => (current === actionKey ? null : current));
        }
    }

    const resolveResumeFileDownloadPath = useCallback((file: ResumeFile) => {
        const reviewAssignmentId = (
            activePage === "review-workbench"
            && candidateDetailReviewContext?.candidateId === file.candidate_id
        ) ? candidateDetailReviewContext.assignmentId : null;
        return reviewAssignmentId
            ? `/api/recruitment/department-reviews/assignments/${reviewAssignmentId}/resume-files/${file.id}/download`
            : `/api/recruitment/resume-files/${file.id}/download`;
    }, [activePage, candidateDetailReviewContext?.assignmentId, candidateDetailReviewContext?.candidateId]);

    async function openResumeFile(file: ResumeFile, download = false) {
        const previewWindow = !download ? window.open("about:blank", "_blank") : null;
        if (previewWindow) {
            previewWindow.opener = null;
            previewWindow.document.title = file.original_name || "Resume";
            previewWindow.document.body.innerHTML = `<p style="font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#475569;padding:24px;">Loading resume...</p>`;
        }
        try {
            const response = await authenticatedFetch(resolveResumeFileDownloadPath(file), {
                method: "GET",
                cache: "no-store"
            });
            if (!response.ok) {
                throw new Error(await response.text());
            }
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            if (download) {
                const anchor = document.createElement("a");
                anchor.href = objectUrl;
                anchor.download = extractFileNameFromDisposition(response.headers.get("content-disposition"), file.original_name);
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
            } else {
                if (previewWindow && !previewWindow.closed) {
                    previewWindow.location.href = objectUrl;
                } else {
                    window.open(objectUrl, "_blank", "noopener,noreferrer");
                }
            }
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        } catch (error) {
            if (previewWindow && !previewWindow.closed) {
                previewWindow.close();
            }
            toast.error(recruitmentToast.resumeOpenedFailed(error instanceof Error ? error.message : recruitmentToast.unknownError));
        }
    }

    function requestDeleteResumeFile(file: ResumeFile) {
        setResumeDeleteTarget(file);
    }

    function requestDeleteCandidate(candidate: CandidateSummary) {
        setCandidateDeleteError(null);
        setCandidateDeleteTarget(candidate);
    }

    async function deleteCandidate() {
        if (!candidateDeleteTarget || candidateDeleting) {
            return;
        }
        const deletedCandidateId = candidateDeleteTarget.id;
        setCandidateDeleteError(null);
        setCandidateDeleting(true);
        try {
            await recruitmentApi(`/candidates/${deletedCandidateId}`, {
                method: "DELETE",
            });
            markCandidatesDeleted([deletedCandidateId]);
            removeDeletedCandidatesFromLocalState([deletedCandidateId]);
            setCandidateDeleteTarget(null);
            if (selectedCandidateIdRef.current === deletedCandidateId) {
                setSelectedCandidateId(null);
                selectedCandidateIdRef.current = null;
                checkedDuplicateCandidateIdRef.current = null;
                setCandidateDetail(null);
                setDuplicateCandidates([]);
                setInterviewSchedules([]);
                setOffers([]);
                setFollowUps([]);
            } else {
                setCandidateDetail(null);
            }
            toast.success(recruitmentToast.candidateDeleted);
            await Promise.allSettled([
                loadCandidates({silent: true, force: true}),
                loadPositions({force: true}),
                selectedPositionIdRef.current ? loadPositionDetail(selectedPositionIdRef.current) : Promise.resolve(),
                refreshCandidateStats(),
            ]);
            void loadLogs({silent: true});
            if ((chatContextRef.current.candidate_id ?? null) === deletedCandidateId) {
                void saveChatContext(chatContextRef.current.position_id ?? null, chatContextRef.current.skill_ids, null, {quiet: true});
            }
        } catch (error) {
            setCandidateDeleteError(formatActionError(error) || (isZh ? "删除候选人失败，请稍后重试" : "Failed to delete the candidate. Please try again later."));
        } finally {
            setCandidateDeleting(false);
        }
    }

    function requestBatchDelete(candidateIds: number[]) {
        setBatchDeleteError(null);
        setBatchDeleteTargetIds(candidateIds);
    }

    async function batchDeleteCandidates() {
        if (!batchDeleteTargetIds || batchDeleting) {
            return;
        }
        setBatchDeleteError(null);
        setBatchDeleting(true);
        const deletedIds = batchDeleteTargetIds;
        try {
            const result = await recruitmentApi<{ deleted_count: number; skipped: { candidate_id: number; reason: string }[] }>("/candidates/batch-delete", {
                method: "POST",
                body: JSON.stringify({ candidate_ids: deletedIds }),
            });
            const deletedCount = result.deleted_count ?? 0;
            const skipped = result.skipped ?? [];
            const skippedIds = new Set(skipped.map((item) => item.candidate_id));
            const actuallyDeletedIds = deletedIds.filter((id) => !skippedIds.has(id));
            markCandidatesDeleted(actuallyDeletedIds);
            removeDeletedCandidatesFromLocalState(actuallyDeletedIds);
            setBatchDeleteTargetIds(null);
            if (actuallyDeletedIds.includes(selectedCandidateIdRef.current ?? -1)) {
                setSelectedCandidateId(null);
                selectedCandidateIdRef.current = null;
                checkedDuplicateCandidateIdRef.current = null;
                setCandidateDetail(null);
                setDuplicateCandidates([]);
                setInterviewSchedules([]);
                setOffers([]);
                setFollowUps([]);
            }
            if (skipped.length > 0) {
                const names = skipped.map((s) => `ID:${s.candidate_id}`).join(", ");
                toast.warning(
                    recruitmentToast.candidatesDeletedWithSkipped(deletedCount, skipped.length, names)
                );
            } else {
                toast.success(recruitmentToast.candidatesDeleted(deletedCount));
            }
            await Promise.allSettled([
                loadCandidates({silent: true, force: true}),
                loadPositions({force: true}),
                selectedPositionIdRef.current ? loadPositionDetail(selectedPositionIdRef.current) : Promise.resolve(),
                refreshCandidateStats(),
            ]);
            void loadLogs({silent: true});
        } catch (error) {
            setBatchDeleteError(formatActionError(error) || (isZh ? "批量删除候选人失败，请稍后重试" : "Failed to batch delete candidates. Please try again later."));
        } finally {
            setBatchDeleting(false);
        }
    }

    async function batchBindPosition(
        candidateIds: number[],
        positionId: number | null,
        options?: {skipSelectedDetailRefresh?: boolean},
    ) {
        if (!candidateIds.length) {
            return;
        }
        try {
            const result = await recruitmentApi<{ updated_count: number }>(
                `/candidates/batch-assign-position?update_status=true`,
                {
                    method: "POST",
                    body: JSON.stringify({ candidate_ids: candidateIds, position_id: positionId }),
                }
            );
            toast.success(
                recruitmentToast.positionUpdated(result.updated_count)
            );
            removeCandidateIdsFromSelection(candidateIds);
            await Promise.all([loadCandidates(), refreshCandidateStats(), loadTalentPoolCandidates()]);
            if (!options?.skipSelectedDetailRefresh && selectedCandidateId && candidateIds.includes(selectedCandidateId)) {
                await loadCandidateDetail(selectedCandidateId);
            }
        } catch (error) {
            toast.error(
                isZh
                    ? `批量更新岗位失败：${formatActionError(error)}`
                    : `Failed to batch update position: ${formatActionError(error)}`
            );
            throw error;
        }
    }

    async function batchUpdateStatus(candidateIds: number[], status: string, reason: string) {
        if (!candidateIds.length || !status) {
            return;
        }
        try {
            const result = await recruitmentApi<{ updated_count: number }>("/candidates/batch-update-status", {
                method: "POST",
                body: JSON.stringify({ candidate_ids: candidateIds, status, reason: reason || undefined }),
            });
            toast.success(recruitmentToast.batchStatusUpdated(result.updated_count));
            removeCandidateIdsFromSelection(candidateIds);
            await Promise.all([
                loadCandidates(),
                refreshCandidateStats(),
                status === "talent_pool" ? loadTalentPoolCandidates() : Promise.resolve(),
            ]);
            if (selectedCandidateId && candidateIds.includes(selectedCandidateId)) {
                await loadCandidateDetail(selectedCandidateId);
            }
        } catch (error) {
            toast.error(recruitmentToast.batchStatusUpdateFailed(formatActionError(error)));
        }
    }

    async function deleteResumeFile() {
        if (!resumeDeleteTarget || resumeDeleting) {
            return;
        }
        setResumeDeleting(true);
        try {
            const result = await recruitmentApi<{
                candidate_id: number;
                deleted_resume_file_id: number;
                remaining_resume_count: number;
                latest_resume_file_id?: number | null;
                latest_parse_result_id?: number | null;
                latest_score_id?: number | null;
            }>(`/resume-files/${resumeDeleteTarget.id}`, {
                method: "DELETE",
            });
            toast.success(
                result.remaining_resume_count > 0
                    ? recruitmentToast.resumeDeletedWithSwitch
                    : recruitmentToast.resumeDeleted
            );
            setResumeDeleteTarget(null);
            await Promise.all([
                loadCandidates({silent: true}),
                loadLogs({silent: true}),
                selectedCandidateIdRef.current === result.candidate_id
                    ? loadCandidateDetail(result.candidate_id, {silent: true})
                    : Promise.resolve(null),
            ]);
        } catch (error) {
            toast.error(recruitmentToast.resumeDeleteFailed(formatActionError(error)));
        } finally {
            setResumeDeleting(false);
        }
    }

    async function downloadInterviewQuestion(questionId: number) {
        try {
            const response = await authenticatedFetch(`/api/recruitment/interview-questions/${questionId}/download`, {
                method: "GET",
                cache: "no-store",
            });
            if (!response.ok) {
                throw new Error(await response.text());
            }
            const blob = await response.blob();
            const downloadUrl = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = downloadUrl;
            anchor.download = extractFileNameFromDisposition(
                response.headers.get("content-disposition"),
                `interview-question-${questionId}.html`,
            );
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(downloadUrl);
            toast.success(recruitmentToast.interviewQuestionDownloadStarted);
        } catch (error) {
            toast.error(recruitmentToast.interviewQuestionDownloadFailed(error instanceof Error ? error.message : recruitmentToast.unknownError));
        }
    }

    async function loadInterviewSchedules(candidateId: number) {
        try {
            const data = await recruitmentApi<InterviewSchedule[]>(`/candidates/${candidateId}/interview-schedules`);
            if (mountedRef.current) {
                setInterviewSchedules(data);
            }
        } catch {
            if (mountedRef.current) {
                setInterviewSchedules([]);
            }
        }
    }

    async function loadDepartmentReviews(candidateId: number, options?: {reviewAssignmentId?: number | null}) {
        try {
            const reviewAssignmentId = options?.reviewAssignmentId ?? null;
            const data = await recruitmentApi<DepartmentReviewBatch[]>(
                reviewAssignmentId
                    ? `/department-reviews/assignments/${reviewAssignmentId}/history`
                    : `/candidates/${candidateId}/department-reviews`,
            );
            if (mountedRef.current) {
                setDepartmentReviews(data || []);
            }
        } catch {
            if (mountedRef.current) {
                setDepartmentReviews([]);
            }
        }
    }

    async function createDepartmentReview(payload: {
        candidate_id: number;
        reviewers: Array<{user_code: string; name?: string}>;
        visible_sections?: string[];
        cc_user_codes?: string[];
        message?: string;
        due_at?: string | null;
        replace_existing?: boolean;
    }) {
        const data = await recruitmentApi<{batch: DepartmentReviewBatch; candidate: CandidateSummary}>("/department-reviews", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        toast.success(isZh ? "已提交部门评审" : "Review submitted");
        await Promise.allSettled([
            loadDepartmentReviews(payload.candidate_id),
            loadCandidateDetail(payload.candidate_id, {silent: true, force: true}),
            loadCandidates({silent: true, force: true}),
            refreshCandidateStats(),
            loadDepartmentReviewTasks({silent: true}),
        ]);
        return data;
    }

    async function loadDepartmentReviewTasks(options?: {silent?: boolean}) {
        if (!options?.silent) {
            setDepartmentReviewLoading(true);
            setDepartmentReviewLoadError(null);
            setDepartmentReviewTasks([]);
        }
        try {
            const query = departmentReviewFilter ? `?status=${encodeURIComponent(departmentReviewFilter)}` : "";
            const data = await recruitmentApi<DepartmentReviewTaskList>(`/department-reviews/my-tasks${query}`);
            if (mountedRef.current) {
                setDepartmentReviewTasks(data?.items || []);
                setDepartmentReviewCounts(data?.counts || {pending: 0, deferred: 0, completed: 0, todo: 0});
                setDepartmentReviewLoadError(null);
            }
        } catch (error) {
            if (mountedRef.current) {
                if (!options?.silent) {
                    setDepartmentReviewTasks([]);
                    setDepartmentReviewCounts({pending: 0, deferred: 0, completed: 0, todo: 0});
                }
                setDepartmentReviewLoadError(formatActionError(error));
            }
            if (!options?.silent) {
                toast.error(isZh ? `加载评审任务失败：${formatActionError(error)}` : `Failed to load reviews: ${formatActionError(error)}`);
            }
        } finally {
            if (!options?.silent && mountedRef.current) {
                setDepartmentReviewLoading(false);
            }
        }
    }

    async function decideDepartmentReviewTask(assignmentId: number, status: "passed" | "rejected" | "deferred", comment: string) {
        await recruitmentApi(`/department-reviews/assignments/${assignmentId}/decision`, {
            method: "POST",
            body: JSON.stringify({status, comment: comment.trim() || null}),
        });
        toast.success(isZh ? "评审结果已提交" : "Review decision submitted");
        setCandidateDetailReviewContext((current) => (
            current?.assignmentId === assignmentId
                ? {...current, status, comment: comment.trim() || null}
                : current
        ));
        await Promise.allSettled([
            loadDepartmentReviewTasks({silent: true}),
            loadCandidates({silent: true, force: true}),
            refreshCandidateStats(),
            selectedCandidateIdRef.current ? loadCandidateDetail(selectedCandidateIdRef.current, {silent: true, force: true}) : Promise.resolve(),
            selectedCandidateIdRef.current ? loadDepartmentReviews(selectedCandidateIdRef.current, {
                reviewAssignmentId: candidateDetailReviewContextRef.current?.assignmentId ?? null,
            }) : Promise.resolve(),
        ]);
    }

    function buildInterviewAvailabilityRange() {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);
        return {start, end};
    }

    async function loadMyInterviewAvailability(options?: {silent?: boolean}) {
        if (!options?.silent) {
            setMyInterviewAvailabilityLoading(true);
        }
        try {
            const {start, end} = buildInterviewAvailabilityRange();
            const params = new URLSearchParams({
                start_at: start.toISOString(),
                end_at: end.toISOString(),
            });
            const data = await recruitmentApi<{items: InterviewAvailabilitySlot[]}>(`/interview-availability/my?${params.toString()}`);
            if (mountedRef.current) {
                setMyInterviewAvailabilitySlots(data?.items || []);
            }
        } catch (error) {
            if (mountedRef.current) {
                setMyInterviewAvailabilitySlots([]);
            }
            if (!options?.silent) {
                toast.error(isZh ? `加载可面试时间失败：${formatActionError(error)}` : `Failed to load availability: ${formatActionError(error)}`);
            }
        } finally {
            if (!options?.silent && mountedRef.current) {
                setMyInterviewAvailabilityLoading(false);
            }
        }
    }

    async function saveMyInterviewAvailability(slots: Array<{start_at: string; end_at: string; status?: "available" | "unavailable"; notes?: string}>) {
        setMyInterviewAvailabilitySaving(true);
        try {
            const {start, end} = buildInterviewAvailabilityRange();
            const data = await recruitmentApi<{items: InterviewAvailabilitySlot[]}>("/interview-availability/my", {
                method: "PUT",
                body: JSON.stringify({
                    slots,
                    range_start: start.toISOString(),
                    range_end: end.toISOString(),
                }),
            });
            if (mountedRef.current) {
                setMyInterviewAvailabilitySlots(data?.items || []);
            }
        } finally {
            if (mountedRef.current) {
                setMyInterviewAvailabilitySaving(false);
            }
        }
    }

    async function loadMyInterviewTasks(options?: {silent?: boolean}) {
        if (!options?.silent) {
            setInterviewWorkbenchLoading(true);
        }
        try {
            const query = interviewWorkbenchFilter ? `?status=${encodeURIComponent(interviewWorkbenchFilter)}` : "";
            const endpoint = canManageInterview ? "/interviews" : "/interviews/my";
            const data = await recruitmentApi<InterviewTaskList>(`${endpoint}${query}`);
            if (mountedRef.current) {
                setInterviewWorkbenchTasks(data?.items || []);
                setInterviewWorkbenchCounts(data?.counts || {todo: 0, today: 0, completed: 0, cancelled: 0});
            }
        } catch (error) {
            if (mountedRef.current) {
                setInterviewWorkbenchTasks([]);
            }
            if (!options?.silent) {
                toast.error(isZh ? `加载面试任务失败：${formatActionError(error)}` : `Failed to load interviews: ${formatActionError(error)}`);
            }
        } finally {
            if (!options?.silent && mountedRef.current) {
                setInterviewWorkbenchLoading(false);
            }
        }
    }

    async function loadMyInterviewCalendarTasks(options?: {silent?: boolean}) {
        if (!canActInterview) {
            if (mountedRef.current) {
                setMyInterviewCalendarTasks([]);
            }
            return;
        }
        try {
            const data = await recruitmentApi<InterviewTaskList>("/interviews/my?status=todo");
            if (mountedRef.current) {
                setMyInterviewCalendarTasks(data?.items || []);
            }
        } catch (error) {
            if (mountedRef.current) {
                setMyInterviewCalendarTasks([]);
            }
            if (!options?.silent) {
                toast.error(isZh ? `加载我的面试日历失败：${formatActionError(error)}` : `Failed to load my interview calendar: ${formatActionError(error)}`);
            }
        }
    }

    async function submitInterviewResult(
        scheduleId: number,
        resultStatus: "passed" | "next_round" | "hold" | "rejected" | "no_show",
        comment: string,
        options?: {next_round_name?: string | null},
    ) {
        await recruitmentApi(`/interview-schedules/${scheduleId}/result`, {
            method: "POST",
            body: JSON.stringify({
                result_status: resultStatus,
                result_comment: comment.trim() || null,
                next_round_name: resultStatus === "next_round" ? options?.next_round_name || undefined : undefined,
            }),
        });
        toast.success(isZh ? "面试结果已提交" : "Interview result submitted");
        await Promise.allSettled([
            loadMyInterviewTasks({silent: true}),
            loadMyInterviewCalendarTasks({silent: true}),
            loadMyInterviewAvailability({silent: true}),
            loadCandidates({silent: true, force: true}),
            refreshCandidateStats(),
            selectedCandidateIdRef.current ? loadInterviewSchedules(selectedCandidateIdRef.current) : Promise.resolve(),
            selectedCandidateIdRef.current ? loadCandidateDetail(selectedCandidateIdRef.current, {silent: true, force: true}) : Promise.resolve(),
        ]);
    }

    async function createInterviewSchedule(payload: {
        candidate_id: number;
        subject?: string;
        round_name?: string;
        round_index?: number;
        interview_method?: string;
        interviewer_user_code?: string;
        interviewer_name?: string;
        scheduled_at?: string;
        duration_minutes?: number;
        location?: string;
        meeting_room?: string;
        video_tool?: string;
        meeting_link?: string;
        contact_phone?: string;
        notes?: string;
        visible_sections?: string[];
        availability_slot_id?: number;
        department_review_assignment_id?: number;
    }) {
        const data = await recruitmentApi<InterviewSchedule>("/interview-schedules", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        toast.success(recruitmentToast.interviewScheduleCreated);
        await Promise.allSettled([
            loadMyInterviewTasks({silent: true}),
            loadMyInterviewCalendarTasks({silent: true}),
            loadMyInterviewAvailability({silent: true}),
            loadCandidates({silent: true, force: true}),
            refreshCandidateStats(),
        ]);
        if (selectedCandidateId) {
            await loadInterviewSchedules(selectedCandidateId);
        }
        return data;
    }

    async function updateInterviewSchedule(scheduleId: number, payload: {
        subject?: string;
        round_name?: string;
        round_index?: number;
        interview_method?: string;
        interviewer_user_code?: string;
        interviewer_name?: string;
        scheduled_at?: string;
        duration_minutes?: number;
        location?: string;
        meeting_room?: string;
        video_tool?: string;
        meeting_link?: string;
        contact_phone?: string;
        notes?: string;
        visible_sections?: string[];
        availability_slot_id?: number;
    }) {
        const data = await recruitmentApi<InterviewSchedule>(`/interview-schedules/${scheduleId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });
        toast.success(isZh ? "面试已更新" : "Interview updated");
        await Promise.allSettled([
            loadMyInterviewTasks({silent: true}),
            loadMyInterviewCalendarTasks({silent: true}),
            loadMyInterviewAvailability({silent: true}),
            loadCandidates({silent: true, force: true}),
            refreshCandidateStats(),
        ]);
        if (selectedCandidateId) {
            await loadInterviewSchedules(selectedCandidateId);
        }
        return data;
    }

    async function deleteInterviewSchedule(scheduleId: number) {
        await recruitmentApi(`/interview-schedules/${scheduleId}`, {method: "DELETE"});
        toast.success(recruitmentToast.interviewScheduleDeleted);
        await Promise.allSettled([
            loadMyInterviewTasks({silent: true}),
            loadMyInterviewCalendarTasks({silent: true}),
            loadMyInterviewAvailability({silent: true}),
            loadCandidates({silent: true, force: true}),
            refreshCandidateStats(),
        ]);
        if (selectedCandidateId) {
            await loadInterviewSchedules(selectedCandidateId);
        }
    }

    async function loadFollowUps(candidateId: number) {
        try {
            const data = await recruitmentApi<FollowUp[]>(`/candidates/${candidateId}/follow-ups`);
            if (mountedRef.current) {
                setFollowUps(data);
            }
        } catch {
            if (mountedRef.current) {
                setFollowUps([]);
            }
        }
    }

    async function createFollowUp(candidateId: number, content: string, followUpType: string = "note") {
        const data = await recruitmentApi<FollowUp>("/follow-ups", {
            method: "POST",
            body: JSON.stringify({candidate_id: candidateId, content, follow_up_type: followUpType}),
        });
        toast.success(recruitmentToast.followUpAdded);
        if (selectedCandidateId) {
            await loadFollowUps(selectedCandidateId);
        }
        return data;
    }

    async function deleteFollowUp(followUpId: number) {
        await recruitmentApi(`/follow-ups/${followUpId}`, {method: "DELETE"});
        toast.success(recruitmentToast.followUpDeleted);
        if (selectedCandidateId) {
            await loadFollowUps(selectedCandidateId);
        }
    }

    function resetSkillDialogTransientState() {
        setSkillFormErrors({});
        setSkillFormSubmitError(null);
        setSkillSubmitting(false);
        setSkillDialogMode("structured");
        setSkillBoundPositionId("");
        setSkillExtraConditions("");
        skillAbortControllerRef.current?.abort();
        skillAbortControllerRef.current = null;
        skillActiveTaskIdRef.current = null;
        setSkillAutoBindCategory(null);
        setSkillAutoBindDestination("positionForm");
        setSkillGeneratedDraftUnsaved(false);
        setSkillUnsavedCloseConfirmOpen(false);
    }

    function requestCloseSkillDialog() {
        if (skillGeneratedDraftUnsaved && !skillSubmitting) {
            setSkillUnsavedCloseConfirmOpen(true);
            return;
        }
        setSkillDialogOpen(false);
        resetSkillDialogTransientState();
    }

    function discardGeneratedSkillDraftAndClose() {
        setSkillDialogOpen(false);
        resetSkillDialogTransientState();
    }

    async function loadOffers(candidateId: number) {
        try {
            const data = await recruitmentApi<RecruitmentOffer[]>(`/candidates/${candidateId}/offers`);
            if (mountedRef.current) {
                setOffers(data);
            }
        } catch {
            if (mountedRef.current) {
                setOffers([]);
            }
        }
    }

    async function createOffer(payload: {
        candidate_id: number;
        offer_title?: string;
        salary?: string;
        department?: string;
        entry_date?: string;
        offer_content?: string;
        notes?: string;
    }) {
        const data = await recruitmentApi<RecruitmentOffer>("/offers", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        toast.success(recruitmentToast.offerCreated);
        if (selectedCandidateId) {
            await loadOffers(selectedCandidateId);
        }
        return data;
    }

    async function updateOffer(offerId: number, payload: Record<string, unknown>) {
        const data = await recruitmentApi<RecruitmentOffer>(`/offers/${offerId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });
        toast.success(recruitmentToast.offerUpdated);
        if (selectedCandidateId) {
            await loadOffers(selectedCandidateId);
        }
        return data;
    }

    async function deleteOffer(offerId: number) {
        await recruitmentApi(`/offers/${offerId}`, {method: "DELETE"});
        toast.success(recruitmentToast.offerDeleted);
        if (selectedCandidateId) {
            await loadOffers(selectedCandidateId);
        }
    }

    function applySkillEditorState(skill?: RecruitmentSkill) {
        if (skill) {
            const taskTypes = (skill.task_types || []) as SkillTaskKind[];
            const isBasicMode = taskTypes.length > 0 && !taskTypes.includes("screening");
            const contentParts = skill.content.split(/\n{2,}附加条件[:：]\s*\n?/);
            const basicContent = contentParts[0] || "";
            const extraConditions = contentParts.slice(1).join("\n\n").trim();
            setSkillEditingId(skill.id);
            setSkillForm({
                name: skill.name,
                description: skill.description || "",
                content: isBasicMode ? basicContent : skill.content,
                tagsText: joinTags(skill.tags),
                taskTypes,
                sortOrder: String(skill.sort_order ?? 99),
                isEnabled: skill.is_enabled,
            });
            if (isBasicMode) {
                setSkillEditorData(emptyScreeningSkillForm());
            } else {
                const parsed = parseSkillContent(skill.content);
                setSkillEditorData({
                    roleName: parsed.roleName || "",
                    roleBackground: parsed.roleBackground || "",
                    hardRules: parsed.hardRules || "",
                    dimensions: parsed.dimensions || [],
                    judgmentRules: parsed.judgmentRules || "",
                    name: skill.name,
                    description: skill.description || "",
                    tagsText: joinTags(skill.tags),
                    taskTypes,
                    sortOrder: String(skill.sort_order ?? 99),
                    isEnabled: skill.is_enabled,
                });
            }
            setSkillDialogMode(isBasicMode ? "basic" : "structured");
            setSkillExtraConditions(extraConditions);
            setSkillBoundPositionId(skill.bound_position_id ? String(skill.bound_position_id) : "");
            setSkillEditorPositionId(skill.bound_position_id ?? null);
        } else {
            setSkillEditingId(null);
            setSkillForm(emptySkillForm());
            setSkillEditorData(emptyScreeningSkillForm());
            setSkillDialogMode("structured");
            setSkillExtraConditions("");
            setSkillBoundPositionId("");
            setSkillEditorPositionId(null);
        }
        setSkillEditorDefaultTab("structured");
        setSkillAutoBindCategory(null);
        setSkillAutoBindDestination("positionForm");
        setSkillFormErrors({});
        setSkillFormSubmitError(null);
        setSkillGeneratedDraftUnsaved(false);
        setSkillUnsavedCloseConfirmOpen(false);
        setSkillDialogOpen(true);
    }

    async function openSkillEditor(skill?: RecruitmentSkill) {
        if (!skill) {
            applySkillEditorState();
            return;
        }
        const requestId = skillDetailLoadRequestIdRef.current + 1;
        skillDetailLoadRequestIdRef.current = requestId;
        skillDetailLoadAbortControllerRef.current?.abort();
        const controller = new AbortController();
        skillDetailLoadAbortControllerRef.current = controller;
        setSkillDetailLoadingId(skill.id);
        try {
            const detail = await recruitmentApi<RecruitmentSkill>(`/skills/${skill.id}`, {signal: controller.signal});
            if (!mountedRef.current || skillDetailLoadRequestIdRef.current !== requestId) {
                return;
            }
            applySkillEditorState(detail);
        } catch (error) {
            if (!isRecruitmentRequestAborted(error)) {
                toast.error(recruitmentToast.loadFailed(recruitmentToastEntities.skills, formatActionError(error)));
            }
        } finally {
            if (skillDetailLoadAbortControllerRef.current === controller) {
                skillDetailLoadAbortControllerRef.current = null;
            }
            if (skillDetailLoadRequestIdRef.current === requestId) {
                setSkillDetailLoadingId(null);
            }
        }
    }

    function openSkillEditorByTaskKind(taskKind: SkillTaskKind) {
        const nextSkillForm = emptySkillForm();
        nextSkillForm.taskTypes = [taskKind];
        const nextEditorData = emptyScreeningSkillForm();
        nextEditorData.taskTypes = [taskKind];
        setSkillEditingId(null);
        setSkillForm(nextSkillForm);
        setSkillEditorData(nextEditorData);
        setSkillDialogMode(taskKind === "screening" ? "structured" : "basic");
        setSkillEditorDefaultTab(taskKind === "screening" ? "structured" : "advanced");
        setSkillEditorPositionId(null);
        setSkillAutoBindCategory(null);
        setSkillAutoBindDestination("positionForm");
        setSkillBoundPositionId("");
        setSkillExtraConditions("");
        setSkillFormErrors({});
        setSkillFormSubmitError(null);
        setSkillGeneratedDraftUnsaved(false);
        setSkillUnsavedCloseConfirmOpen(false);
        setSkillDialogOpen(true);
    }

    function openSkillEditorWithAI(boundPositionId: number | null = null) {
        const nextSkillForm = emptySkillForm();
        nextSkillForm.taskTypes = ["screening"];
        const nextEditorData = emptyScreeningSkillForm();
        nextEditorData.taskTypes = ["screening"];
        setSkillEditingId(null);
        setSkillForm(nextSkillForm);
        setSkillEditorData(nextEditorData);
        setSkillDialogMode("structured");
        setSkillEditorDefaultTab("ai");
        setSkillEditorPositionId(boundPositionId);
        setSkillAutoBindCategory(null);
        setSkillAutoBindDestination("positionForm");
        setSkillBoundPositionId(boundPositionId ? String(boundPositionId) : "");
        setSkillExtraConditions("");
        setSkillFormErrors({});
        setSkillFormSubmitError(null);
        setSkillGeneratedDraftUnsaved(false);
        setSkillUnsavedCloseConfirmOpen(false);
        setSkillDialogOpen(true);
    }

    function openSkillEditorForPosition(taskKind: SkillTaskKind, bindCategory: "jdSkillIds" | "screeningSkillIds" | "interviewSkillIds") {
        void ensureSkillsLoaded();
        const roleName = positionForm.title.trim();
        const bindingPositionId = positionDialogMode === "edit" ? selectedPositionId : null;
        const empty = emptyScreeningSkillForm();
        empty.taskTypes = [taskKind];
        if (roleName) {
            empty.roleName = roleName;
            empty.name = taskKind === "jd" ? `${roleName} JD 分析方案` : taskKind === "screening" ? `${roleName}初筛评分评估方案` : `${roleName}面试题评估方案`;
        }
        setSkillEditingId(null);
        const skillFormState = emptySkillForm();
        skillFormState.taskTypes = [taskKind];
        if (roleName) {
            skillFormState.name = empty.name;
        }
        setSkillForm(skillFormState);
        setSkillEditorData(empty);
        setSkillDialogMode(taskKind === "screening" ? "structured" : "basic");
        setSkillEditorDefaultTab(taskKind === "screening" ? "ai" : "advanced");
        setSkillEditorPositionId(bindingPositionId);
        setSkillAutoBindCategory(bindCategory);
        setSkillAutoBindDestination("positionForm");
        setSkillBoundPositionId(bindingPositionId ? String(bindingPositionId) : "");
        setSkillExtraConditions("");
        setSkillFormErrors({});
        setSkillFormSubmitError(null);
        setSkillGeneratedDraftUnsaved(false);
        setSkillUnsavedCloseConfirmOpen(false);
        setSkillDialogOpen(true);
    }

    function openSkillEditorForAssessmentConfig(taskKind: SkillTaskKind, bindCategory: PositionSkillBindingField) {
        void ensureSkillsLoaded();
        const roleName = positionDetail?.position.title?.trim() || "";
        const empty = emptyScreeningSkillForm();
        empty.taskTypes = [taskKind];
        if (roleName) {
            empty.roleName = roleName;
            empty.name = taskKind === "jd" ? `${roleName} JD 分析方案` : taskKind === "screening" ? `${roleName}初筛评分评估方案` : `${roleName}面试题评估方案`;
        }
        const skillFormState = emptySkillForm();
        skillFormState.taskTypes = [taskKind];
        if (roleName) {
            skillFormState.name = empty.name;
        }
        setSkillEditingId(null);
        setSkillForm(skillFormState);
        setSkillEditorData(empty);
        setSkillDialogMode(taskKind === "screening" ? "structured" : "basic");
        setSkillEditorDefaultTab(taskKind === "screening" ? "ai" : "advanced");
        setSkillEditorPositionId(selectedPositionId);
        setSkillAutoBindCategory(bindCategory);
        setSkillAutoBindDestination("assessmentDraft");
        setSkillBoundPositionId("");
        setSkillExtraConditions("");
        setSkillFormErrors({});
        setSkillFormSubmitError(null);
        setSkillGeneratedDraftUnsaved(false);
        setSkillUnsavedCloseConfirmOpen(false);
        setSkillDialogOpen(true);
    }

    async function submitStructuredSkill(data: ScreeningSkillFormData) {
        if (skillSubmitting) return;
        if (!data.name.trim()) {
            setSkillFormSubmitError("请输入评估方案名称");
            return;
        }
        if (!data.taskTypes.length) {
            setSkillFormSubmitError("请选择适用场景");
            return;
        }
        setSkillFormSubmitError(null);
        setSkillSubmitting(true);
        const previousBoundPositionId = skillEditingId ? (skillMap.get(skillEditingId)?.bound_position_id || null) : null;
        const nextBoundPositionId = skillBoundPositionId ? Number(skillBoundPositionId) : null;
        try {
            const content = generateSkillContent(data);
            const payload = {
                name: data.name.trim(),
                description: data.description.trim() || null,
                content: content.trim(),
                tags: splitTags(data.tagsText),
                task_types: data.taskTypes,
                bound_position_id: skillBoundPositionId ? Number(skillBoundPositionId) : null,
                sort_order: Number(data.sortOrder || "99"),
                is_enabled: data.isEnabled,
            };
            if (skillEditingId) {
                const updatedSkill = await recruitmentApi<RecruitmentSkill>(`/skills/${skillEditingId}`, {
                    method: "PATCH",
                    body: JSON.stringify(payload),
                });
                upsertSkillInLocalState(updatedSkill);
                toast.success(recruitmentToast.updated(recruitmentToastEntities.skill));
            } else {
                const result = await recruitmentApi<RecruitmentSkill>("/skills", {
                    method: "POST",
                    body: JSON.stringify(payload),
                });
                upsertSkillInLocalState(result);
                const newSkillId = result?.id;
                if (newSkillId && skillAutoBindCategory) {
                    if (skillAutoBindDestination === "assessmentDraft") {
                        updatePositionAssessmentDraftBinding(skillAutoBindCategory, [newSkillId]);
                    } else {
                        updatePositionSkillBinding(skillAutoBindCategory, [newSkillId], {expandSection: true});
                    }
                }
                toast.success(recruitmentToast.created(recruitmentToastEntities.skill));
            }
            reconcileSkillSettingsAfterMutation();
            setSkillAutoBindCategory(null);
            setSkillAutoBindDestination("positionForm");
            setSkillGeneratedDraftUnsaved(false);
            setSkillUnsavedCloseConfirmOpen(false);
            setSkillDialogOpen(false);
            await refreshSkillBindingViews([previousBoundPositionId, nextBoundPositionId]);
        } catch (error) {
            const resolved = resolveSkillSubmitError(error);
            setSkillFormSubmitError(resolved.submitError);
        }
        setSkillSubmitting(false);
    }

    async function generateSkillWithAI(
        roleName: string,
        extraRequirements: string,
        positionJd: string | null,
        onDelta?: (delta: string) => void,
    ): Promise<{ content: string; completed: boolean }> {
        const abortController = new AbortController();
        skillAbortControllerRef.current = abortController;
        skillActiveTaskIdRef.current = null;
        setSkillGenerating(true);
        let fullContent = "";
        let completed = false;
        let cancelled = false;
        let streamErrorMessage: string | null = null;
        try {
            const response = await authenticatedFetch("/api/recruitment/skills/generate-content", {
                method: "POST",
                headers: {"Content-Type": "application/json", Accept: "text/event-stream"},
                body: JSON.stringify({role_name: roleName, extra_requirements: extraRequirements || null, position_jd: positionJd || null}),
                signal: abortController.signal,
            });
            if (!response.body) throw new Error("No response body");
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            while (true) {
                const {done, value} = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, {stream: true});
                let sep = buffer.indexOf("\n\n");
                while (sep !== -1) {
                    const rawEvent = buffer.slice(0, sep);
                    buffer = buffer.slice(sep + 2);
                    sep = buffer.indexOf("\n\n");
                    const eventMatch = rawEvent.match(/^event: (.+)$/m);
                    const eventType = eventMatch ? eventMatch[1].trim() : "message";
                    const dataMatch = rawEvent.match(/data: (.+)/);
                    if (dataMatch) {
                        try {
                            const data = JSON.parse(dataMatch[1]);
                            if (eventType === "task_created") {
                                skillActiveTaskIdRef.current = data.task_id;
                            } else if (eventType === "completed") {
                                completed = true;
                                if (typeof data.content === "string") {
                                    fullContent = data.content;
                                }
                            } else if (eventType === "cancelled") {
                                cancelled = true;
                                break;
                            } else if (eventType === "error") {
                                streamErrorMessage = typeof data.message === "string"
                                    ? data.message
                                    : (isZh ? "评估方案生成失败" : "Assessment plan generation failed");
                                break;
                            } else if (data.delta) {
                                fullContent += data.delta;
                                onDelta?.(data.delta);
                            }
                        } catch { /* ignore malformed */ }
                    }
                }
            }
            if (streamErrorMessage) {
                throw new Error(streamErrorMessage);
            }
        } catch (error) {
            if (!abortController.signal.aborted) {
                const taskId = skillActiveTaskIdRef.current;
                let displayError: unknown = error;
                if (taskId) {
                    try {
                        const recoveredContent = await recoverSkillGeneratedContentFromLog(taskId, abortController.signal);
                        if (recoveredContent) {
                            return {content: recoveredContent, completed: true};
                        }
                    } catch (recoverError) {
                        displayError = recoverError;
                    }
                }
                if (!abortController.signal.aborted) {
                    toast.error(formatActionError(displayError));
                }
            }
            return {content: fullContent, completed: false};
        } finally {
            setSkillGenerating(false);
            skillAbortControllerRef.current = null;
            skillActiveTaskIdRef.current = null;
        }
        return {content: fullContent, completed: completed && !cancelled};
    }

    async function stopSkillGeneration() {
        skillAbortControllerRef.current?.abort();
        const taskId = skillActiveTaskIdRef.current;
        if (taskId) {
            try {
                await cancelTaskGeneration(taskId, isZh ? "评估方案生成" : "Assessment plan generation", {silent: true});
            } catch { /* ignore */ }
        }
    }

    async function submitSkill() {
        if (skillSubmitting) {
            return;
        }
        const nextErrors = validateSkillForm(skillForm);
        if (Object.keys(nextErrors).length) {
            setSkillFormErrors(nextErrors);
            setSkillFormSubmitError(null);
            requestAnimationFrame(() => {
                if (nextErrors.name) {
                    skillNameInputRef.current?.focus();
                    return;
                }
                if (nextErrors.content) {
                    skillContentInputRef.current?.focus();
                }
            });
            return;
        }
        setSkillFormErrors({});
        setSkillFormSubmitError(null);
        setSkillSubmitting(true);
        const previousBoundPositionId = skillEditingId ? (skillMap.get(skillEditingId)?.bound_position_id || null) : null;
        const nextBoundPositionId = skillBoundPositionId ? Number(skillBoundPositionId) : null;
        try {
            const finalContent = skillExtraConditions.trim()
                ? `${skillForm.content.trim()}\n\n附加条件：\n${skillExtraConditions.trim()}`
                : skillForm.content.trim();
            const payload = {
                name: skillForm.name.trim(),
                description: skillExtraConditions.trim() || skillForm.description.trim() || null,
                content: finalContent,
                tags: splitTags(skillForm.tagsText),
                task_types: skillForm.taskTypes,
                bound_position_id: skillBoundPositionId ? Number(skillBoundPositionId) : null,
                sort_order: Number(skillForm.sortOrder || "99"),
                is_enabled: skillForm.isEnabled,
            };
            if (skillEditingId) {
                const updatedSkill = await recruitmentApi<RecruitmentSkill>(`/skills/${skillEditingId}`, {
                    method: "PATCH",
                    body: JSON.stringify(payload),
                });
                upsertSkillInLocalState(updatedSkill);
                toast.success(recruitmentToast.updated(recruitmentToastEntities.skill));
            } else {
                const result = await recruitmentApi<RecruitmentSkill>(`/skills`, {
                    method: "POST",
                    body: JSON.stringify(payload),
                });
                upsertSkillInLocalState(result);
                const newSkillId = result?.id;
                if (newSkillId && skillAutoBindCategory) {
                    if (skillAutoBindDestination === "assessmentDraft") {
                        updatePositionAssessmentDraftBinding(skillAutoBindCategory, [newSkillId]);
                    } else {
                        updatePositionSkillBinding(skillAutoBindCategory, [newSkillId], {expandSection: true});
                    }
                }
                toast.success(recruitmentToast.created(recruitmentToastEntities.skill));
            }
            reconcileSkillSettingsAfterMutation();
            setSkillAutoBindCategory(null);
            setSkillAutoBindDestination("positionForm");
            setSkillGeneratedDraftUnsaved(false);
            setSkillUnsavedCloseConfirmOpen(false);
            setSkillDialogOpen(false);
            await refreshSkillBindingViews([previousBoundPositionId, nextBoundPositionId]);
        } catch (error) {
            const resolved = resolveSkillSubmitError(error);
            if (resolved.fieldErrors) {
                setSkillFormErrors(resolved.fieldErrors);
                requestAnimationFrame(() => {
                    if (resolved.fieldErrors?.name) {
                        skillNameInputRef.current?.focus();
                        return;
                    }
                    if (resolved.fieldErrors?.content) {
                        skillContentInputRef.current?.focus();
                    }
                });
            }
            setSkillFormSubmitError(resolved.submitError);
        }
        setSkillSubmitting(false);
    }

    async function deleteSkill(skillId: number) {
        const actionKey = `skill-${skillId}`;
        setDeleteActionKey(actionKey);
        try {
            await recruitmentApi(`/skills/${skillId}`, {method: "DELETE"});
            setSkillDeleteTarget(null);
            const existedOnCurrentPage = skillSettingsRows.some((item) => item.id === skillId);
            setAllSkills((current) => current.filter((item) => item.id !== skillId));
            setSkillSettingsRows((current) => current.filter((item) => item.id !== skillId));
            if (existedOnCurrentPage) {
                setSkillSettingsTotal((total) => Math.max(0, total - 1));
            }
            toast.success(recruitmentToast.deleted(recruitmentToastEntities.skill));
            void loadSkillSettingsPage({pageIndex: skillSettingsPageIndex, silent: true}).catch(() => undefined);
        } catch (error) {
            toast.error(recruitmentToast.deleteFailed(recruitmentToastEntities.skill, formatActionError(error)));
        } finally {
            setDeleteActionKey((current) => (current === actionKey ? null : current));
        }
    }

    async function toggleSkill(skillId: number, enabled: boolean) {
        try {
            const updatedSkill = await recruitmentApi<RecruitmentSkill>(`/skills/${skillId}/toggle${buildQuery({enabled})}`, {method: "POST"});
            upsertSkillInLocalState(updatedSkill);
            reconcileSkillSettingsAfterMutation();
            toast.success(enabled ? recruitmentToast.skillEnabled : recruitmentToast.skillDisabled);
        } catch (error) {
            toast.error(recruitmentToast.saveFailed(recruitmentToastEntities.skill, formatActionError(error)));
        }
    }

    function openLLMEditor(config?: RecruitmentLLMConfig) {
        void ensureLLMConfigsLoaded();
        if (config) {
            setLlmEditingId(config.id);
            setLlmForm({
                configKey: config.config_key,
                taskType: config.task_type,
                provider: config.provider,
                modelName: config.model_name,
                baseUrl: config.base_url || "",
                apiKeyEnv: config.api_key_env || "",
                apiKeyValue: "",
                maxConcurrent: String(config.max_concurrent ?? 4),
                maxQps: String(config.max_qps ?? 10),
                priority: String(config.priority ?? 99),
                isActive: config.is_active,
                extraConfigText: JSON.stringify(config.extra_config || {}, null, 2),
            });
        } else {
            setLlmEditingId(null);
            setLlmForm(emptyLLMForm());
        }
        setLlmFormErrors({});
        setLlmFormSubmitError(null);
        setLlmDialogOpen(true);
    }

    function copyLLMEditor(config: RecruitmentLLMConfig) {
        void ensureLLMConfigsLoaded();
        setLlmEditingId(null);
        setLlmForm({
            configKey: `${config.config_key}-copy`,
            taskType: config.task_type,
            provider: config.provider,
            modelName: config.model_name,
            baseUrl: config.base_url || "",
            apiKeyEnv: config.api_key_env || "",
            apiKeyValue: "",
            maxConcurrent: String(config.max_concurrent ?? 4),
            maxQps: String(config.max_qps ?? 10),
            priority: String(config.priority ?? 99),
            isActive: config.is_active,
            extraConfigText: JSON.stringify(config.extra_config || {}, null, 2),
        });
        setLlmFormErrors({});
        setLlmFormSubmitError(null);
        setLlmDialogOpen(true);
    }

    async function submitLLMConfig() {
        if (llmSubmitting) {
            return;
        }
        const nextErrors = validateLLMForm(llmForm);
        if (Object.keys(nextErrors).length) {
            setLlmFormErrors(nextErrors);
            setLlmFormSubmitError(null);
            requestAnimationFrame(() => {
                if (nextErrors.configKey) {
                    llmConfigKeyInputRef.current?.focus();
                    return;
                }
                if (nextErrors.taskType) {
                    llmTaskTypeInputRef.current?.focus();
                    return;
                }
                if (nextErrors.modelName) {
                    llmModelNameInputRef.current?.focus();
                    return;
                }
                if (nextErrors.maxConcurrent || nextErrors.maxQps) {
                    return;
                }
                if (nextErrors.extraConfigText) {
                    llmExtraConfigInputRef.current?.focus();
                }
            });
            return;
        }
        setLlmFormErrors({});
        setLlmFormSubmitError(null);
        setLlmSubmitting(true);
        try {
            const payload = {
                config_key: llmForm.configKey.trim(),
                task_type: llmForm.taskType.trim(),
                provider: llmForm.provider.trim(),
                model_name: llmForm.modelName.trim(),
                base_url: llmForm.baseUrl.trim() || null,
                api_key_env: llmForm.apiKeyEnv.trim() || null,
                api_key_value: llmForm.apiKeyValue.trim() || null,
                max_concurrent: Number(llmForm.maxConcurrent || "4"),
                max_qps: Number(llmForm.maxQps || "10"),
                priority: Number(llmForm.priority || "99"),
                is_active: llmForm.isActive,
                extra_config: llmForm.extraConfigText.trim() ? JSON.parse(llmForm.extraConfigText) : {},
            };
            if (llmEditingId) {
                await recruitmentApi(`/llm-configs/${llmEditingId}`, {
                    method: "PATCH",
                    body: JSON.stringify(payload),
                });
                toast.success(recruitmentToast.updated(recruitmentToastEntities.modelConfig));
            } else {
                await recruitmentApi(`/llm-configs`, {
                    method: "POST",
                    body: JSON.stringify(payload),
                });
                toast.success(recruitmentToast.created(recruitmentToastEntities.modelConfig));
            }
            setLlmDialogOpen(false);
            await loadLLMConfigs();
        } catch (error) {
            const resolved = resolveLLMSubmitError(error);
            if (resolved.fieldErrors) {
                setLlmFormErrors(resolved.fieldErrors);
                requestAnimationFrame(() => {
                    if (resolved.fieldErrors?.configKey) {
                        llmConfigKeyInputRef.current?.focus();
                        return;
                    }
                    if (resolved.fieldErrors?.taskType) {
                        llmTaskTypeInputRef.current?.focus();
                        return;
                    }
                    if (resolved.fieldErrors?.modelName) {
                        llmModelNameInputRef.current?.focus();
                        return;
                    }
                    if (resolved.fieldErrors?.maxConcurrent || resolved.fieldErrors?.maxQps) {
                        return;
                    }
                    if (resolved.fieldErrors?.extraConfigText) {
                        llmExtraConfigInputRef.current?.focus();
                    }
                });
            }
            setLlmFormSubmitError(resolved.submitError);
        }
        setLlmSubmitting(false);
    }

    async function deleteLLMConfig(configId: number) {
        const actionKey = `llm-${configId}`;
        setDeleteActionKey(actionKey);
        try {
            await recruitmentApi(`/llm-configs/${configId}`, {method: "DELETE"});
            setLlmDeleteTarget(null);
            toast.success(recruitmentToast.deleted(recruitmentToastEntities.modelConfig));
            try {
                await loadLLMConfigs();
            } catch (refreshError) {
                toast.error(recruitmentToast.deletedButRefreshFailed(recruitmentToastEntities.modelConfig, formatActionError(refreshError)));
            }
        } catch (error) {
            toast.error(recruitmentToast.deleteFailed(recruitmentToastEntities.modelConfig, formatActionError(error)));
        } finally {
            setDeleteActionKey((current) => (current === actionKey ? null : current));
        }
    }

    async function setPreferredLLMConfig(targetConfig: RecruitmentLLMConfig) {
        const sameTaskConfigs = llmConfigs
            .filter((item) => item.task_type === targetConfig.task_type)
            .sort((left, right) => {
                if (left.id === targetConfig.id) return -1;
                if (right.id === targetConfig.id) return 1;
                if (left.priority !== right.priority) return left.priority - right.priority;
                return left.id - right.id;
            });
        try {
            for (let index = 0; index < sameTaskConfigs.length; index += 1) {
                const item = sameTaskConfigs[index];
                await recruitmentApi(`/llm-configs/${item.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                        config_key: item.config_key,
                        task_type: item.task_type,
                        provider: item.provider,
                        model_name: item.model_name,
                        base_url: item.base_url || null,
                        api_key_env: item.api_key_env || null,
                        api_key_value: null,
                        extra_config: item.extra_config || {},
                        is_active: item.id === targetConfig.id ? true : item.is_active,
                        priority: index,
                    }),
                });
            }
            toast.success(recruitmentUiText.currentModelSwitched(targetConfig.task_type, targetConfig.model_name));
            await loadLLMConfigs();
        } catch (error) {
            toast.error(recruitmentToast.saveFailed(recruitmentToastEntities.currentModel, formatActionError(error)));
        }
    }

    function renderAssistantConsole(mode: AssistantDisplayMode = "page") {
        const isPage = mode === "page";
        const isFullscreen = mode === "fullscreen";
        const isWorkspace = mode === "workspace";
        const suggestionPrompts = [
            isZh ? "生成当前岗位 JD" : "Generate a JD for the current position",
            isZh ? "查看当前岗位候选人" : "Show candidates for the current position",
            isZh ? "重新对当前候选人初筛，硬性要求加强硬件测试" : "Re-screen the current candidate with stronger hardware testing requirements",
            isZh ? "给当前候选人生成面试题" : "Generate interview questions for the current candidate",
            isZh ? "说明这次对话用了哪些评估方案" : "Explain which assessment plans this conversation used",
            isZh ? "当前使用什么模型" : "Which model is being used now",
        ];
        const workspaceSuggestionPrompts = [
            isZh ? "帮我生成 IoT 测试工程师 JD" : "Generate an IoT Test Engineer JD",
            isZh ? "查看当前岗位候选人列表" : "Show candidates for the current position",
            isZh ? "重新对当前候选人初筛，硬性要求加强硬件测试经验" : "Re-screen the current candidate with stronger hardware testing requirements",
            isZh ? "给当前候选人生成初试题，重点考察硬件联调" : "Generate first-round interview questions focused on hardware integration",
            isZh ? "说明这次对话用了哪些评估方案和模型" : "Explain which assessment plans and model this conversation used",
        ];
        const quickActionPrompts = isWorkspace ? workspaceSuggestionPrompts : suggestionPrompts;
        const collapsedQuickActionPrompts = quickActionPrompts.slice(0, Math.min(3, quickActionPrompts.length));
        const visibleQuickActionPrompts = assistantQuickActionsExpanded ? quickActionPrompts : collapsedQuickActionPrompts;
        const hasMoreQuickActions = quickActionPrompts.length > collapsedQuickActionPrompts.length;
        const summaryChips = [
            {key: "position", label: shortText(chatContext.position_title || recruitmentUiText.unspecifiedPosition, 18), dotClassName: "bg-violet-500"},
            {key: "candidate", label: shortText(chatContextCandidateLabel, 18), dotClassName: "bg-amber-500"},
            {key: "skills", label: `${chatContext.skills?.length || 0} ${isZh ? "评估方案" : "Plans"}`, dotClassName: "bg-emerald-500"},
            {key: "model", label: shortText(assistantActiveLLMConfig?.resolved_model_name || assistantActiveLLMConfig?.model_name || recruitmentUiText.modelUnrecognized, 18), dotClassName: "bg-violet-500"},
        ];
        const assistantContextPanel = (
                <div className="flex h-full min-h-0 flex-col space-y-5">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{recruitmentUiText.assistantContextShort}</p>
                            <p className="mt-1 hidden text-xs leading-5 text-slate-500 dark:text-slate-400 2xl:block">
                                {isZh ? "按需展开岗位、评估方案和模型配置，不再长期挤压主聊天区。" : "Expand position, assessment plan, and model settings only when needed so the main chat area stays clear."}
                            </p>
                        </div>
                    <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 rounded-full"
                        onMouseDown={preventAssistantActionFocusLoss}
                        onClick={() => {
                            setAssistantContextExpanded(false);
                            queueAssistantInputFocus();
                        }}
                    >
                        <ChevronUp className="h-4 w-4"/>
                    </Button>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-3 py-3 dark:border-slate-800 dark:bg-slate-900/60">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{recruitmentUiText.currentPosition}</p>
                        <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{chatContext.position_title || recruitmentUiText.unspecifiedPosition}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-3 py-3 dark:border-slate-800 dark:bg-slate-900/60">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{recruitmentUiText.activeSkills}</p>
                        <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{recruitmentUiText.skillCount(assistantContextSkills.length)}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-3 py-3 dark:border-slate-800 dark:bg-slate-900/60">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{recruitmentUiText.currentModel}</p>
                        <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{assistantActiveLLMConfig?.resolved_model_name || assistantActiveLLMConfig?.model_name || recruitmentUiText.modelUnrecognized}</p>
                    </div>
                </div>

                <Field label={recruitmentUiText.currentPosition}>
                    <NativeSelect
                        value={chatContext.position_id ? String(chatContext.position_id) : "none"}
                        onChange={(event) => {
                            const nextPositionId = event.target.value === "none" ? null : Number(event.target.value);
                            void saveChatContext(nextPositionId, chatContext.skill_ids);
                            queueAssistantInputFocus();
                        }}
                    >
                        <option value="none">{recruitmentUiText.unspecifiedPosition}</option>
                        {positions.map((position) => (
                            <option key={position.id} value={position.id}>
                                {position.title}
                            </option>
                        ))}
                    </NativeSelect>
                </Field>

                <Field label={recruitmentUiText.activeSkills}>
                    <div className="flex flex-wrap gap-2">
                        {enabledSkills.map((skill) => (
                            <button
                                key={skill.id}
                                type="button"
                                onMouseDown={preventAssistantActionFocusLoss}
                                onClick={() => toggleSkillInAssistant(skill.id)}
                                className={cn(
                                    "rounded-full border px-3 py-2 text-xs font-medium transition",
                                    assistantContextSkillIds.includes(skill.id)
                                        ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300",
                                )}
                            >
                                {skill.name}
                            </button>
                        ))}
                    </div>
                </Field>

                <Field label={recruitmentUiText.currentModel}>
                    <NativeSelect
                        value={assistantActiveLLMConfig ? String(assistantActiveLLMConfig.id) : "none"}
                        onChange={(event) => {
                            const nextConfig = assistantModelSwitchOptions.find((item) => String(item.id) === event.target.value);
                            if (nextConfig) {
                                void setPreferredLLMConfig(nextConfig);
                            }
                            queueAssistantInputFocus();
                        }}
                        disabled={assistantModelSwitchOptions.length <= 1}
                    >
                        {!assistantModelSwitchOptions.length ? <option value="none">{recruitmentUiText.noSwitchableModel}</option> : null}
                        {assistantModelSwitchOptions.map((config) => (
                            <option key={config.id} value={config.id}>
                                {labelForProvider(config.resolved_provider || config.provider)} / {config.resolved_model_name || config.model_name}
                            </option>
                        ))}
                    </NativeSelect>
                    <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                        {isZh ? "先为同一任务类型添加多个已启用模型，这里就能像 GPT / Claude 一样直接切换当前使用项。" : "Enable multiple models for the same task type first, then switch between them here like GPT or Claude."}
                    </p>
                </Field>
            </div>
        );

        if (isWorkspace) {
            return (
                <div className="flex h-full min-h-0 flex-col">
                    <div className="border-b border-slate-200/80 px-4 py-3 dark:border-slate-800">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="flex items-center gap-2">
                                    <Bot className="h-4 w-4 text-violet-600"/>
                                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{recruitmentUiText.assistantLabel}</p>
                                </div>
                                <p className="mt-1 hidden text-xs text-slate-500 dark:text-slate-400 2xl:block">
                                    {recruitmentUiText.assistantWorkspaceHint}
                                </p>
                            </div>
                            <Button size="sm" variant="outline" onClick={() => openAssistantMode("drawer")}>
                                {recruitmentUiText.open}
                            </Button>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {summaryChips.map((chip) => (
                                <button
                                    key={chip.key}
                                    type="button"
                                    onMouseDown={preventAssistantActionFocusLoss}
                                    onClick={() => openAssistantMode("drawer")}
                                    className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                                >
                                    <span className={cn("h-2 w-2 rounded-full", chip.dotClassName)}/>
                                    <span>{chip.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 [scrollbar-gutter:stable]">
                        <div className="space-y-4">
                            <div className="flex flex-wrap gap-2">
                                {visibleQuickActionPrompts.map((prompt) => (
                                    <button
                                        key={prompt}
                                        type="button"
                                        onMouseDown={preventAssistantActionFocusLoss}
                                        onClick={() => applyAssistantPrompt(prompt, {openMode: "drawer"})}
                                        className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-slate-100"
                                    >
                                        {prompt}
                                    </button>
                                ))}
                                {hasMoreQuickActions ? (
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onMouseDown={preventAssistantActionFocusLoss}
                                        onClick={() => setAssistantQuickActionsExpanded((current) => !current)}
                                    >
                                        {assistantQuickActionsExpanded ? recruitmentUiText.collapse : recruitmentUiText.more}
                                        {assistantQuickActionsExpanded ? <ChevronUp className="h-4 w-4"/> : <ChevronDown className="h-4 w-4"/>}
                                    </Button>
                                ) : null}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Button size="sm" onClick={() => openAssistantMode("drawer")}>
                                    <Bot className="h-4 w-4"/>
                                    {recruitmentUiText.openFullAssistant}
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                        setAssistantContextExpanded(true);
                                        openAssistantMode("drawer");
                                    }}
                                >
                                    {recruitmentUiText.assistantContextShort}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div className="flex h-full min-h-0 flex-col">
                <div className="border-b border-slate-200/80 px-4 py-2.5 dark:border-slate-800 sm:px-5">
                        <div className="flex items-center gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                            <div className="flex shrink-0 items-center gap-2">
                                <Bot className="h-4 w-4 text-violet-600"/>
                                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{recruitmentUiText.assistantLabel}</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                            <Button variant={isPage ? "default" : "ghost"} size="sm" className="h-7 rounded-full px-2.5 text-xs"
                                    onClick={() => openAssistantMode("page")}>
                                {isZh ? "页内" : "In Page"}
                            </Button>
                            <Button variant={mode === "drawer" ? "default" : "ghost"} size="sm" className="h-7 rounded-full px-2.5 text-xs"
                                    onClick={() => openAssistantMode("drawer")}>
                                {isZh ? "浮层" : "Drawer"}
                            </Button>
                            <Button variant={isFullscreen ? "default" : "ghost"} size="sm" className="h-7 rounded-full px-2.5 text-xs"
                                    onClick={() => openAssistantMode("fullscreen")}>
                                {isZh ? "全屏" : "Fullscreen"}
                            </Button>
                        </div>
                        <div className="flex min-w-max items-center gap-2">
                            {summaryChips.map((chip) => (
                                <button
                                    key={chip.key}
                                    type="button"
                                    onMouseDown={preventAssistantActionFocusLoss}
                                    onClick={() => setAssistantContextExpanded(true)}
                                    className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-200/80 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                                >
                                    <span className={cn("h-2 w-2 rounded-full", chip.dotClassName)}/>
                                    <span>{chip.label}</span>
                                </button>
                            ))}
                        </div>
                        <Button
                            size="sm"
                            variant={assistantContextExpanded ? "default" : "outline"}
                            className="h-7 shrink-0 rounded-full px-2.5 text-xs"
                            onMouseDown={preventAssistantActionFocusLoss}
                            onClick={() => setAssistantContextExpanded((current) => !current)}
                        >
                            {recruitmentUiText.assistantContextShort}
                            {assistantContextExpanded ? <ChevronUp className="h-4 w-4"/> : <ChevronDown className="h-4 w-4"/>}
                        </Button>
                    </div>
                </div>

                <div className="relative min-h-0 flex-1">
                    <div
                        className={cn(
                            "grid h-full min-h-0",
                            assistantContextExpanded
                                ? (isFullscreen
                                    ? "grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_360px]"
                                    : "grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px]")
                                : "grid-cols-1",
                        )}
                    >
                        <div className="flex min-h-0 flex-col">
                            <div className="relative min-h-0 flex-1">
                                <div
                                    ref={assistantScrollAreaRef}
                                    onScroll={handleAssistantScroll}
                                    className="min-h-0 h-full flex-1 overflow-y-auto [scrollbar-gutter:stable]"
                                >
                                    <div className="space-y-4 px-4 py-4 sm:px-5 sm:py-5">
                                        {chatMessages.map((message) => (
                                            <div
                                                key={message.id}
                                                className={cn(
                                                    "max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-7 shadow-sm",
                                                    message.role === "assistant"
                                                        ? "border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                                                        : "ml-auto bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900",
                                                )}
                                            >
                                                <p className="whitespace-pre-wrap">{message.content}</p>
                                                {message.actions?.length ? (
                                                    <div className="mt-3 flex flex-wrap gap-2">
                                                        {message.actions.map((action) => (
                                                            <Badge key={action} variant="outline" className="rounded-full">
                                                                {action}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                ) : null}
                                                {message.clarificationRequest?.options?.length ? (
                                                    <div className="mt-3 flex flex-wrap gap-2">
                                                        {message.clarificationRequest.options.map((option) => (
                                                            <Button
                                                                key={`${message.id}-${option.id}`}
                                                                size="sm"
                                                                variant="outline"
                                                                onMouseDown={preventAssistantActionFocusLoss}
                                                                onClick={() => void submitAssistantClarification(
                                                                    message.clarificationRequest?.original_message || message.content,
                                                                    message.clarificationRequest!,
                                                                    option,
                                                                )}
                                                            >
                                                                {option.label}
                                                            </Button>
                                                        ))}
                                                    </div>
                                                ) : null}
                                                {message.mailConfirmationRequest ? (
                                                    <div className="mt-3 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-4 text-xs leading-6 text-slate-600 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-300">
                                                        <div className="space-y-3">
                                                            <div>
                                                                <p className="font-medium text-slate-900 dark:text-slate-100">{isZh ? "邮件发送预览" : "Email Preview"}</p>
                                                                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                                                    {isZh ? "先确认发送，再真正触发邮件发送。" : "Confirm first, then actually send the email."}
                                                                </p>
                                                            </div>
                                                            <div className="space-y-1">
                                                                <p><span className="font-medium text-slate-900 dark:text-slate-100">{isZh ? "候选人：" : "Candidates: "}</span>{message.mailConfirmationRequest.candidates.map((item) => item.name).join(isZh ? "、" : ", ")}</p>
                                                                <p><span className="font-medium text-slate-900 dark:text-slate-100">{isZh ? "发件箱：" : "Sender: "}</span>{message.mailConfirmationRequest.sender ? `${message.mailConfirmationRequest.sender.name} <${message.mailConfirmationRequest.sender.from_email}>` : (isZh ? "未配置" : "Not configured")}</p>
                                                                <p><span className="font-medium text-slate-900 dark:text-slate-100">{isZh ? "收件人：" : "Recipients: "}</span>{message.mailConfirmationRequest.recipients.map((item) => item.name ? `${item.name} <${item.email}>` : item.email).join(isZh ? "、" : ", ")}</p>
                                                                <p><span className="font-medium text-slate-900 dark:text-slate-100">{isZh ? "附件：" : "Attachments: "}</span>{isZh ? `${message.mailConfirmationRequest.attachment_count} 份简历` : `${message.mailConfirmationRequest.attachment_count} resume file(s)`}</p>
                                                            </div>
                                                            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-3 py-3 dark:border-slate-800 dark:bg-slate-900/60">
                                                                <p className="font-medium text-slate-900 dark:text-slate-100">{isZh ? "邮件主题" : "Email Subject"}</p>
                                                                <p className="mt-1 whitespace-pre-wrap break-words">{message.mailConfirmationRequest.subject}</p>
                                                            </div>
                                                            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-3 py-3 dark:border-slate-800 dark:bg-slate-900/60">
                                                                <p className="font-medium text-slate-900 dark:text-slate-100">{isZh ? "邮件正文" : "Email Body"}</p>
                                                                <p className="mt-1 whitespace-pre-wrap break-words">{message.mailConfirmationRequest.body_text}</p>
                                                            </div>
                                                            {message.mailConfirmationRequest.blocking_reason ? (
                                                                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                                                                    {message.mailConfirmationRequest.blocking_reason}
                                                                </div>
                                                            ) : null}
                                                            {assistantMailActionState[message.id]?.status === "error" && assistantMailActionState[message.id]?.error ? (
                                                                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-3 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
                                                                    {assistantMailActionState[message.id]?.error}
                                                                </div>
                                                            ) : null}
                                                            {assistantMailActionState[message.id]?.editing ? (
                                                                <div className="rounded-2xl border border-violet-200 bg-violet-50 px-3 py-3 text-violet-700 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-200">
                                                                    {isZh ? "已进入编辑。你可以在弹窗里修改收件人、标题和正文后再发送。" : "Editing mode is open. You can adjust recipients, subject, and body in the dialog before sending."}
                                                                </div>
                                                            ) : null}
                                                            {assistantMailActionState[message.id]?.status === "sent" ? (
                                                                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                                                                    {isZh
                                                                        ? `已发送成功${assistantMailActionState[message.id]?.dispatchId ? `，发送记录 #${assistantMailActionState[message.id]?.dispatchId}` : ""}。`
                                                                        : `Sent successfully${assistantMailActionState[message.id]?.dispatchId ? `, dispatch #${assistantMailActionState[message.id]?.dispatchId}` : ""}.`}
                                                                </div>
                                                            ) : null}
                                                            <div className="flex flex-wrap gap-2">
                                                                <Button
                                                                    size="sm"
                                                                    onMouseDown={preventAssistantActionFocusLoss}
                                                                    onClick={() => void confirmAssistantPreparedResumeMail(message.id, message.mailConfirmationRequest!)}
                                                                    disabled={!message.mailConfirmationRequest.can_confirm || assistantMailActionState[message.id]?.status === "sending" || assistantMailActionState[message.id]?.status === "sent"}
                                                                >
                                                                    {assistantMailActionState[message.id]?.status === "sending" ? <Loader2 className="h-4 w-4 animate-spin"/> : <Send className="h-4 w-4"/>}
                                                                    {assistantMailActionState[message.id]?.status === "sent" ? (isZh ? "已发送" : "Sent") : assistantMailActionState[message.id]?.status === "sending" ? (isZh ? "发送中..." : "Sending...") : (isZh ? "确认发送" : "Confirm Send")}
                                                                </Button>
                                                                {assistantMailActionState[message.id]?.status === "sent" ? (
                                                                    <Button
                                                                        size="sm"
                                                                        variant="outline"
                                                                        onMouseDown={preventAssistantActionFocusLoss}
                                                                        onClick={() => openAssistantPreparedResumeMailDialog(message.id, message.mailConfirmationRequest!, "resend")}
                                                                    >
                                                                        <Send className="h-4 w-4"/>
                                                                        {isZh ? "再次发送" : "Send Again"}
                                                                    </Button>
                                                                ) : (
                                                                    <Button
                                                                        size="sm"
                                                                        variant="outline"
                                                                        onMouseDown={preventAssistantActionFocusLoss}
                                                                        onClick={() => openAssistantPreparedResumeMailDialog(message.id, message.mailConfirmationRequest!)}
                                                                        disabled={assistantMailActionState[message.id]?.status === "sending"}
                                                                    >
                                                                        <ExternalLink className="h-4 w-4"/>
                                                                        {isZh ? "编辑后发送" : "Edit Before Sending"}
                                                                    </Button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : null}
                                                <p className="mt-2 text-[11px] opacity-70">{formatDateTime(message.createdAt)}</p>
                                            </div>
                                        ))}
                                        {chatSending ? (
                                            <div className="flex items-center gap-2 text-sm text-slate-500">
                                                <Loader2 className="h-4 w-4 animate-spin"/>
                                                {isZh ? "助手正在思考..." : "Assistant is thinking..."}
                                            </div>
                                        ) : null}
                                        <div ref={assistantScrollAnchorRef}/>
                                    </div>
                                </div>
                                {showScrollToBottomButton ? (
                                    <div className="pointer-events-none absolute bottom-4 right-4 z-10">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="pointer-events-auto rounded-full border-slate-200/80 bg-white/95 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-950/90"
                                            onMouseDown={preventAssistantActionFocusLoss}
                                            onClick={() => scrollAssistantToBottom("smooth")}
                                        >
                                            <ChevronDown className="h-4 w-4"/>
                                            {isZh ? "回到底部" : "Back to Bottom"}
                                        </Button>
                                    </div>
                                ) : null}
                            </div>

                            <div className="shrink-0 border-t border-slate-200/80 px-4 py-4 dark:border-slate-800 sm:px-5 sm:py-5">
                                <div className="mb-3 flex flex-wrap gap-2">
                                    {visibleQuickActionPrompts.map((prompt) => (
                                        <button
                                            key={prompt}
                                            type="button"
                                            onMouseDown={preventAssistantActionFocusLoss}
                                            onClick={() => applyAssistantPrompt(prompt, {openMode: "drawer"})}
                                            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-slate-100"
                                        >
                                            {prompt}
                                        </button>
                                    ))}
                                    {hasMoreQuickActions ? (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="rounded-full"
                                            onMouseDown={preventAssistantActionFocusLoss}
                                            onClick={() => setAssistantQuickActionsExpanded((current) => !current)}
                                        >
                                            {assistantQuickActionsExpanded ? recruitmentUiText.collapse : recruitmentUiText.more}
                                            {assistantQuickActionsExpanded ? <ChevronUp className="h-4 w-4"/> : <ChevronDown className="h-4 w-4"/>}
                                        </Button>
                                    ) : null}
                                </div>
                                <Textarea
                                    ref={assistantInputRef}
                                    autoFocus={assistantOpen || activePage === "assistant"}
                                    value={chatInput}
                                    onChange={(event) => setChatInput(event.target.value)}
                                    onKeyDown={(event) => {
                                        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                                            event.preventDefault();
                                            void sendChatMessage();
                                        }
                                    }}
                                    rows={isFullscreen ? 7 : isPage ? 4 : 5}
                                    placeholder={isZh ? "例如：重新对当前候选人初筛，硬性要求加强硬件测试经验；或说明这次用了哪些评估方案" : "For example: re-screen the current candidate with stronger hardware-testing requirements, or explain which assessment plans were used this time"}
                                />
                                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                                    <p className="hidden text-xs text-slate-500 dark:text-slate-400 2xl:block">
                                        {isZh ? "助手会自动携带当前岗位与启用评估方案上下文，适合连续执行筛选、生成和查询操作。按 Ctrl/Cmd + Enter 可直接发送。" : "The assistant automatically carries the current position and enabled assessment plan context, which works well for screening, generation, and lookup flows. Press Ctrl/Cmd + Enter to send."}
                                    </p>
                                    <Button
                                        onClick={() => void sendChatMessage()}
                                        variant={canStopCurrentRun ? "outline" : "default"}
                                        disabled={isCurrentRunStopping || (!canStopCurrentRun && !chatInput.trim())}
                                    >
                                        {canStopCurrentRun ? <Square className="h-4 w-4"/> : <Send className="h-4 w-4"/>}
                                        {isCurrentRunStopping ? (isZh ? "停止中..." : "Stopping...") : canStopCurrentRun ? (isZh ? "停止生成" : "Stop") : (isZh ? "发送" : "Send")}
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {assistantContextExpanded ? (
                            <div
                                className={cn(
                                    "hidden min-h-0 overflow-y-auto border-l border-slate-200/80 px-4 py-4 dark:border-slate-800 sm:px-5 sm:py-5",
                                    isFullscreen ? "2xl:block" : "xl:block",
                                )}
                            >
                                {assistantContextPanel}
                            </div>
                        ) : null}
                    </div>

                    {assistantContextExpanded ? (
                        <div
                            className={cn(
                                "absolute inset-y-0 right-0 z-20 w-full max-w-[320px] overflow-y-auto border-l border-slate-200/80 bg-white/95 px-4 py-4 shadow-[-16px_0_40px_-24px_rgba(15,23,42,0.4)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 sm:px-5 sm:py-5",
                                isFullscreen ? "2xl:hidden max-w-[360px]" : "xl:hidden",
                            )}
                        >
                            {assistantContextPanel}
                        </div>
                    ) : null}
                </div>
            </div>
        );
    }

    function renderAssistantSuspendedState() {
        const modeLabel = assistantDisplayMode === "fullscreen" ? (isZh ? "全屏模式" : "fullscreen mode") : (isZh ? "宽抽屉模式" : "wide drawer mode");
        return (
            <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 px-8 py-10 text-center">
                <div
                    className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    <Bot className="h-6 w-6"/>
                </div>
                <div className="space-y-2">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{isZh ? `助手已在${modeLabel}打开` : `Assistant is already open in ${modeLabel}`}</h3>
                    <p className="max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">
                        {isZh ? "为避免背景页面和弹层同时绑定同一份输入内容，这里已暂停背景助手面板显示。当前会话内容和输入草稿仍保留在前台助手中。" : "To avoid binding the same input state in both the background page and the overlay, the background assistant panel is suspended here. Your current conversation and draft are still preserved in the foreground assistant."}
                    </p>
                </div>
                <div className="flex flex-wrap justify-center gap-3">
                    <Button onClick={() => openAssistantMode("page")}>{isZh ? "切回页内模式" : "Switch to In-Page Mode"}</Button>
                    <Button variant="outline" onClick={() => setAssistantOpen(false)}>{isZh ? "关闭弹层" : "Close Drawer"}</Button>
                </div>
            </div>
        );
    }

    function renderWorkspacePage() {
        return (
            <WorkspacePage
                dashboard={scopedDashboard}
                positions={positions}
                todayNewResumes={todayNewResumes}
                stats={stats}
                recentCandidates={recentCandidates}
                funnelData={effectiveFunnelData}
                sourceStatsData={effectiveSourceStatsData}
                userName={sessionUser?.name || sessionUser?.id || null}
                organizationControl={renderWorkspaceOrganizationControl()}
                canManagePosition={canManagePosition}
                canManageCandidate={canManageCandidate}
                canViewAudit={canViewLog}
                canViewAssistant={canViewRecruitmentAssistant}
                onBack={canGoBack ? handleSmartBack : undefined}
                onOpenAssistant={() => openAssistantMode("drawer")}
                setActivePage={setActivePage}
                setCandidateQuery={setCandidateQueryWithTransition}
                setCandidateStatusFilter={setCandidateStatusFilterWithTransition}
                setSelectedCandidateId={setSelectedCandidateId}
                openCreatePosition={openCreatePosition}
                onRefresh={async () => {
                    await refreshCoreData();
                    toast.success(recruitmentToast.refreshed(recruitmentToastEntities.workspace));
                }}
                setResumeUploadOpen={setResumeUploadOpen}
            />
        );
    }

    // Memoize filtered + sorted candidates for position detail view
    const positionFilteredSortedCandidates = useMemo(() => {
        const filtered = positionCandidatesData.filter((c) =>
            positionCandidateStatusFilter === "__all__" || resolveCandidateDisplayStatus(c) === positionCandidateStatusFilter
        );
        return [...filtered].sort((a, b) => {
            const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
            const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
            return tb - ta;
        });
    }, [positionCandidatesData, positionCandidateStatusFilter]);

    function renderPositionFormPage() {
        const maxSalaryOptions = getBossSalaryMaxKOptions(positionForm.salaryMinK);

        return (
            <div className="flex h-full min-h-0 flex-col bg-[#FBFBFC] dark:bg-slate-950">
                <div className="flex h-14 shrink-0 items-center border-b border-[#F2F3F5] bg-white px-5 dark:border-slate-800 dark:bg-slate-950 md:px-8">
                    <div className="flex min-w-0 items-center gap-3">
                        <button
                            type="button"
                            aria-label={positionDialogMode === "edit"
                                ? (isZh ? "返回当前岗位" : "Return to current position")
                                : (isZh ? "返回岗位列表" : "Return to position list")}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-[#E6E7EB] text-[#86888F] transition hover:border-[#1E3BFA] hover:bg-[#1E3BFA]/5 hover:text-[#1E3BFA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3BFA]/25 dark:border-slate-700"
                            onClick={requestClosePositionFormPage}
                        >
                            <ArrowLeft className="h-4 w-4"/>
                        </button>
                        <div className="min-w-0">
                            <h1 className="truncate text-[16px] font-semibold text-[#0E1114] dark:text-slate-50">
                                {positionDialogMode === "create" ? (isZh ? "新建岗位" : "New Position") : (isZh ? "编辑岗位" : "Edit Position")}
                            </h1>
                            <p className="truncate text-[11px] text-[#86888F]">{recruitmentUiText.positionBasicsDialogHint}</p>
                        </div>
                    </div>
                </div>
                <ScrollArea className="min-h-0 flex-1 bg-[#FBFBFC] dark:bg-slate-950">
                    <div className="mx-auto grid w-full max-w-[1080px] items-start gap-6 px-5 pb-10 pt-[22px] md:px-8 lg:grid-cols-[minmax(0,1fr)_200px]">
                        <div className="min-w-0 space-y-4">
                            <RecruitmentFormSection
                                id="position-form-basic"
                                index={1}
                                title={isZh ? "职位基本信息" : "Basic Position Info"}
                            >
                                <div className="space-y-[18px]">
                                    {positionDialogMode === "create" && showOrganizationFields && organizationSelectOptions.length > 1 ? (
                                        <RecruitmentFieldRow
                                            label={recruitmentUiText.targetOrganization}
                                            error={positionFormErrors.orgCode}
                                            hint={showOrganizationFields ? recruitmentUiText.allVisibleCreateHint : null}
                                            required
                                        >
                                            <NativeSelect
                                                className={cn(recruitmentFormInputClass, recruitmentFormControlClass)}
                                                value={positionForm.orgCode}
                                                onChange={(event) => updatePositionFormField("orgCode", event.target.value)}
                                            >
                                                <option value="">{recruitmentUiText.chooseTargetOrganization}</option>
                                                {organizationSelectOptions.map((option) => (
                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                ))}
                                            </NativeSelect>
                                        </RecruitmentFieldRow>
                                    ) : null}

                                    <div className="grid gap-[18px] md:grid-cols-2 md:gap-x-5">
                                        <RecruitmentFieldRow label={isZh ? "公司" : "Company"}>
                                            <div className="flex h-9 items-center text-[12px] leading-[20px] text-[#86888F] dark:text-slate-300">
                                                {getOrganizationLabel(positionForm.orgCode || activeCreateOrgCode)}
                                            </div>
                                        </RecruitmentFieldRow>

                                        <RecruitmentFieldRow label={isZh ? "部门" : "Department"}>
                                            <Input
                                                className={recruitmentFormInputClass}
                                                value={positionForm.department}
                                                maxLength={80}
                                                onChange={(event) => updatePositionFormField("department", event.target.value.slice(0, 80))}
                                                placeholder={isZh ? "请输入部门" : "Enter department"}
                                            />
                                        </RecruitmentFieldRow>
                                    </div>

                                    <RecruitmentFieldRow label={isZh ? "招聘类型" : "Recruit Type"} error={positionFormErrors.employmentType} required>
                                        <RecruitmentSegmentedGroup
                                            className={cn(recruitmentFormControlClass, "flex-nowrap max-[540px]:flex-wrap")}
                                            buttonClassName="min-w-[110px] whitespace-nowrap"
                                            value={positionForm.employmentType}
                                            onChange={(value) => updatePositionFormField("employmentType", value)}
                                            options={BOSS_RECRUIT_TYPES.map((value) => ({value, label: value}))}
                                        />
                                    </RecruitmentFieldRow>

                                    <RecruitmentFieldRow label={isZh ? "职位名称" : "Job Name"} error={positionFormErrors.title} required>
                                        <BossJobNameCascader
                                            inputRef={positionTitleInputRef}
                                            className={recruitmentFormControlClass}
                                            value={positionForm.title}
                                            onChange={(value) => updatePositionFormField("title", value)}
                                            onSelect={(item) => applyBossJobSelection(item)}
                                            placeholder={isZh ? "请填写职位名称，如“销售专员”" : "Enter a job name"}
                                            error={positionFormErrors.title}
                                        />
                                    </RecruitmentFieldRow>

                                    <RecruitmentFieldRow label={isZh ? "职位描述" : "Job Description"} error={positionFormErrors.keyRequirements} required>
                                        <RecruitmentTextareaMeter value={positionForm.keyRequirements} maxLength={5000} showCounter={false}>
                                            <div className="flex flex-wrap items-center gap-2 px-[12px] py-[10px] text-[11px] leading-[18px] text-[#8793a3]">
                                                <span>{isZh ? "可选标题" : "Optional headings"}</span>
                                                {["岗位职责", "任职要求", "岗位福利"].map((item) => (
                                                    <button
                                                        key={item}
                                                        type="button"
                                                        className="rounded-[4px] bg-[#F7F8FA] px-3 py-1 text-[11px] text-[#33353D] transition hover:bg-[#1E3BFA]/5 hover:text-[#1E3BFA]"
                                                        onClick={() => appendJobDescriptionSection(item)}
                                                    >
                                                        {item}
                                                    </button>
                                                ))}
                                            </div>
                                            <Textarea
                                                className={cn(recruitmentFormTextareaClass, "h-[150px] min-h-[150px] rounded-none border-t border-[#F2F3F5]")}
                                                value={positionForm.keyRequirements}
                                                maxLength={5000}
                                                onChange={(event) => updatePositionFormField("keyRequirements", event.target.value.slice(0, 5000))}
                                                rows={7}
                                                placeholder={isZh ? "请描述岗位职责、任职要求与福利待遇。这段内容会作为 JD 生成与 AI 初筛评估的依据。" : "Describe responsibilities, requirements, and benefits. This content feeds JD generation and AI screening."}
                                            />
                                        </RecruitmentTextareaMeter>
                                    </RecruitmentFieldRow>

                                    <RecruitmentFieldRow label={isZh ? "职位类型" : "Job Type"} error={positionFormErrors.jobType || positionFormErrors.jobTypePath} required>
                                        <BossJobTypeSelector
                                            className="w-full max-w-[320px]"
                                            value={positionForm.jobType}
                                            onSelect={(item) => applyBossJobSelection(item, {syncTitle: false})}
                                            placeholder={isZh ? "选择职位类型" : "Select job type"}
                                            error={positionFormErrors.jobType || positionFormErrors.jobTypePath}
                                        />
                                    </RecruitmentFieldRow>
                                </div>
                            </RecruitmentFormSection>

                            <RecruitmentFormSection
                                id="position-form-requirements"
                                index={2}
                                title={isZh ? "职位要求" : "Position Requirements"}
                            >
                                <div className="space-y-[18px]">
                                    <div className="grid gap-[18px] md:grid-cols-2 md:gap-x-5">
                                        <RecruitmentFieldRow label={isZh ? "经验" : "Experience"} error={positionFormErrors.experience} required>
                                            <NativeSelect
                                                className={recruitmentFormInputClass}
                                                value={positionForm.experience}
                                                onChange={(event) => updatePositionFormField("experience", event.target.value)}
                                            >
                                                {BOSS_EXPERIENCE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                                            </NativeSelect>
                                        </RecruitmentFieldRow>

                                        <RecruitmentFieldRow label={isZh ? "学历" : "Education"} error={positionFormErrors.education} required>
                                            <NativeSelect
                                                className={recruitmentFormInputClass}
                                                value={positionForm.education}
                                                onChange={(event) => updatePositionFormField("education", event.target.value)}
                                            >
                                                {BOSS_EDUCATION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                                            </NativeSelect>
                                        </RecruitmentFieldRow>
                                    </div>

                                    <RecruitmentFieldRow label={isZh ? "薪资范围" : "Salary"} error={positionFormErrors.salaryMinK || positionFormErrors.salaryMaxK || positionFormErrors.salaryMonths} required>
                                        <div className="flex flex-wrap items-center gap-3">
                                            <NativeSelect
                                                className={cn(
                                                    recruitmentFormInputClass,
                                                    recruitmentFormShortControlClass,
                                                    positionForm.salaryMinK == null && "text-[#c2cad4]",
                                                )}
                                                value={positionForm.salaryMinK == null ? "" : String(positionForm.salaryMinK)}
                                                onChange={(event) => updateBossSalaryMinK(event.target.value)}
                                            >
                                                <option value="" disabled hidden>{isZh ? "最低月薪" : "Minimum"}</option>
                                                {BOSS_SALARY_K_OPTIONS.map((value) => <option className="text-[#303846]" key={value} value={value}>{value}k</option>)}
                                            </NativeSelect>
                                            <span className="text-[#86888F]">-</span>
                                            <NativeSelect
                                                className={cn(
                                                    recruitmentFormInputClass,
                                                    recruitmentFormShortControlClass,
                                                    positionForm.salaryMaxK == null && "text-[#c2cad4]",
                                                )}
                                                value={positionForm.salaryMaxK == null ? "" : String(positionForm.salaryMaxK)}
                                                onChange={(event) => updateBossSalaryMaxK(event.target.value)}
                                            >
                                                <option value="" disabled hidden>{isZh ? "最高月薪" : "Maximum"}</option>
                                                {maxSalaryOptions.map((value) => <option className="text-[#303846]" key={value} value={value}>{value}k</option>)}
                                            </NativeSelect>
                                            <NativeSelect
                                                className={cn(recruitmentFormInputClass, recruitmentFormShortControlClass)}
                                                value={positionForm.salaryMonths}
                                                onChange={(event) => updatePositionFormField("salaryMonths", event.target.value)}
                                            >
                                                {BOSS_SALARY_MONTH_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                                            </NativeSelect>
                                        </div>
                                        <p className="mt-[6px] text-[11px] leading-[18px] text-[#1E3BFA] dark:text-blue-300">ⓘ 1k=1千元 10k=1万元</p>
                                    </RecruitmentFieldRow>

                                    <RecruitmentFieldRow label={isZh ? "职位关键词" : "Keywords"}>
                                        <Input
                                            className={cn(recruitmentFormInputClass, recruitmentFormControlClass)}
                                            value={positionForm.tagsText}
                                            maxLength={240}
                                            onChange={(event) => updatePositionFormField("tagsText", event.target.value.slice(0, 240))}
                                            placeholder={isZh ? "请输入关键词，多个用逗号分隔" : "Enter keywords, separated by commas"}
                                        />
                                    </RecruitmentFieldRow>

                                    <div className="grid gap-[18px] md:grid-cols-[minmax(0,1fr)_160px] md:gap-x-5">
                                        <RecruitmentFieldRow label={isZh ? "工作地址" : "Work Address"} error={positionFormErrors.location} required>
                                            <Input
                                                className={recruitmentFormInputClass}
                                                value={positionForm.location}
                                                maxLength={120}
                                                onChange={(event) => updatePositionFormField("location", event.target.value.slice(0, 120))}
                                                placeholder={isZh ? "请输入工作地址" : "Enter work address"}
                                            />
                                            <p className="mt-[6px] text-[11px] leading-[18px] text-[#86888F] dark:text-slate-500">{isZh ? "请填写真实办公地址，将用于面试安排与候选人沟通。" : "Enter the real office address; it is used for interview scheduling and candidate communication."}</p>
                                        </RecruitmentFieldRow>

                                        <RecruitmentFieldRow label={isZh ? "招聘人数" : "Headcount"} error={positionFormErrors.headcount} required>
                                            <Input
                                                ref={positionHeadcountInputRef}
                                                className={recruitmentFormInputClass}
                                                type="text"
                                                inputMode="numeric"
                                                value={positionForm.headcount}
                                                onChange={(event) => updatePositionFormField("headcount", event.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                                                placeholder="1 - 999"
                                            />
                                        </RecruitmentFieldRow>
                                    </div>

                                    <RecruitmentFieldRow label={isZh ? "补充信息" : "Supplement"}>
                                        <div className="grid max-w-[520px] gap-[10px]">
                                            <Textarea
                                                className={cn(recruitmentFormTextareaClass, "min-h-[70px] rounded-[6px] border border-[#E6E7EB] bg-white")}
                                                value={positionForm.bonusPoints}
                                                maxLength={2000}
                                                onChange={(event) => updatePositionFormField("bonusPoints", event.target.value.slice(0, 2000))}
                                                placeholder={isZh ? "加分项、行业背景、软性偏好等" : "Bonus points, industry background, soft preferences"}
                                            />
                                            <Textarea
                                                className={cn(recruitmentFormTextareaClass, "min-h-[70px] rounded-[6px] border border-[#E6E7EB] bg-white")}
                                                value={positionForm.summary}
                                                maxLength={4000}
                                                onChange={(event) => updatePositionFormField("summary", event.target.value.slice(0, 4000))}
                                                placeholder={isZh ? "岗位背景、团队目标或招聘策略" : "Role background, team goals, or recruiting strategy"}
                                            />
                                        </div>
                                    </RecruitmentFieldRow>
                                </div>
                            </RecruitmentFormSection>

                            <RecruitmentFormSection
                                id="position-form-screening"
                                index={3}
                                title={isZh ? "职位设置" : "Position Settings"}
                            >
                                <RecruitmentFieldRow label={isZh ? "岗位状态" : "Status"}>
                                    <RecruitmentSegmentedGroup
                                        className={recruitmentFormControlClass}
                                        value={positionForm.status}
                                        onChange={(value) => updatePositionFormField("status", value)}
                                        options={Object.entries(positionStatusLabels).map(([value, label]) => ({value, label}))}
                                    />
                                </RecruitmentFieldRow>

                                <RecruitmentFieldRow label={recruitmentUiText.screeningConfig}>
                                    <div className="space-y-[14px] rounded-[8px] bg-[#F7F8FA] p-4 dark:bg-slate-900/60">
                                        <RecruitmentToggleRow
                                            checked={positionForm.autoScreenOnUpload}
                                            disabled={positionForm.screeningSkillIds.length === 0}
                                            title={recruitmentUiText.uploadResumeAutoScreenHint}
                                            onChange={(checked) => {
                                                if (positionForm.screeningSkillIds.length === 0) {
                                                    return;
                                                }
                                                updatePositionFormField("autoScreenOnUpload", checked);
                                            }}
                                        />
                                        {positionForm.screeningSkillIds.length === 0 && (
                                            <p className="pl-11 text-[11px] leading-[18px] text-[#D48806] dark:text-amber-400">
                                                {recruitmentUiText.uploadResumeAutoScreenHintNoSkill}
                                            </p>
                                        )}
                                        <RecruitmentToggleRow
                                            checked={positionForm.autoAdvanceOnScreening}
                                            title={recruitmentUiText.autoAdvanceOnScreeningLabel}
                                            onChange={(checked) => updatePositionFormField("autoAdvanceOnScreening", checked)}
                                        />
                                        <div className="rounded-[8px] border border-[#EBEEF5] bg-white p-4 dark:border-slate-700 dark:bg-slate-950/60">
                                            <RecruitmentToggleRow
                                                checked={positionForm.autoMailEnabled}
                                                title={recruitmentUiText.autoMailPushTitle}
                                                description={recruitmentUiText.autoMailPushDescription}
                                                onChange={(checked) => updatePositionFormField("autoMailEnabled", checked)}
                                            />
                                            <div className={cn("mt-4 grid gap-4 lg:grid-cols-2", !positionForm.autoMailEnabled && "pointer-events-none opacity-40")}>
                                                <RecruitmentToggleRow
                                                    checked={positionForm.autoMailUsePositionRecipients}
                                                    title={recruitmentUiText.positionSpecificRecipient}
                                                    onChange={(checked) => updatePositionFormField("autoMailUsePositionRecipients", checked)}
                                                />
                                                <RecruitmentToggleRow
                                                    checked={positionForm.autoMailUseGlobalRecipients}
                                                    title={recruitmentUiText.globalDefaultRecipient}
                                                    description={recruitmentUiText.globalDefaultRecipientHint}
                                                    onChange={(checked) => updatePositionFormField("autoMailUseGlobalRecipients", checked)}
                                                />
                                            </div>
                                            <div className={cn("mt-4 space-y-4", !positionForm.autoMailEnabled && "pointer-events-none opacity-40")}>
                                                <div className="space-y-2">
                                                    <p className="text-[12px] font-medium leading-[18px] text-[#33353D] dark:text-slate-300">{recruitmentUiText.positionSpecificRecipients}</p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {enabledMailRecipients.length ? enabledMailRecipients.map((recipient) => (
                                                            <TogglePillButton
                                                                key={`auto-mail-to-page-${recipient.id}`}
                                                                active={positionForm.autoMailPositionRecipientIds.includes(recipient.id)}
                                                                onClick={() => updatePositionFormField("autoMailPositionRecipientIds", toggleIdInList(positionForm.autoMailPositionRecipientIds, recipient.id))}
                                                            >
                                                                {recipient.name}
                                                            </TogglePillButton>
                                                        )) : <p className="text-[11px] text-[#86888F] dark:text-slate-400">{recruitmentUiText.noRecipientsInMailCenter}</p>}
                                                    </div>
                                                </div>
                                                <div className="grid gap-4 xl:grid-cols-2">
                                                    <div className="space-y-2">
                                                        <p className="text-[12px] font-medium leading-[18px] text-[#33353D] dark:text-slate-300">{recruitmentUiText.ccRecipients}</p>
                                                        <div className="flex flex-wrap gap-2">
                                                            {enabledMailRecipients.length ? enabledMailRecipients.map((recipient) => (
                                                                <TogglePillButton
                                                                    key={`auto-mail-cc-page-${recipient.id}`}
                                                                    active={positionForm.autoMailCcRecipientIds.includes(recipient.id)}
                                                                    onClick={() => updatePositionFormField("autoMailCcRecipientIds", toggleIdInList(positionForm.autoMailCcRecipientIds, recipient.id))}
                                                                >
                                                                    {recipient.name}
                                                                </TogglePillButton>
                                                            )) : <p className="text-[11px] text-[#86888F] dark:text-slate-400">{recruitmentUiText.noCCRecipients}</p>}
                                                        </div>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <p className="text-[12px] font-medium leading-[18px] text-[#33353D] dark:text-slate-300">{recruitmentUiText.bccRecipients}</p>
                                                        <div className="flex flex-wrap gap-2">
                                                            {enabledMailRecipients.length ? enabledMailRecipients.map((recipient) => (
                                                                <TogglePillButton
                                                                    key={`auto-mail-bcc-page-${recipient.id}`}
                                                                    active={positionForm.autoMailBccRecipientIds.includes(recipient.id)}
                                                                    onClick={() => updatePositionFormField("autoMailBccRecipientIds", toggleIdInList(positionForm.autoMailBccRecipientIds, recipient.id))}
                                                                >
                                                                    {recipient.name}
                                                                </TogglePillButton>
                                                            )) : <p className="text-[11px] text-[#86888F] dark:text-slate-400">{recruitmentUiText.noBCCRecipients}</p>}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <p className="text-[12px] font-medium leading-[18px] text-[#33353D] dark:text-slate-300">{recruitmentUiText.allowedAutoMailStatuses}</p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {(metadata?.candidate_statuses || []).map((option) => (
                                                            <TogglePillButton
                                                                key={`auto-mail-status-page-${option.value}`}
                                                                active={positionForm.autoMailAllowedCandidateStatuses.includes(option.value)}
                                                                onClick={() => updatePositionFormField(
                                                                    "autoMailAllowedCandidateStatuses",
                                                                    positionForm.autoMailAllowedCandidateStatuses.includes(option.value)
                                                                        ? positionForm.autoMailAllowedCandidateStatuses.filter((item) => item !== option.value)
                                                                        : [...positionForm.autoMailAllowedCandidateStatuses, option.value],
                                                                )}
                                                            >
                                                                {localizeCandidateStatusValue(option.value, option.label)}
                                                            </TogglePillButton>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="grid gap-4 lg:grid-cols-2">
                                                    {/* 邮件模板功能落地前,预留模板ID 字段暂不对用户展示;字段值仍随表单读写,历史数据不受影响 */}
                                                    <Field label={recruitmentUiText.dedupMode}>
                                                        <NativeSelect
                                                            className={cn(recruitmentFormInputClass, recruitmentFormControlClass)}
                                                            value={positionForm.autoMailDedupMode}
                                                            onChange={(event) => updatePositionFormField("autoMailDedupMode", event.target.value)}
                                                        >
                                                            <option value="once_per_candidate_per_status">{recruitmentUiText.dedupOncePerCandidatePerStatus}</option>
                                                            <option value="once_per_candidate">{recruitmentUiText.dedupOncePerCandidate}</option>
                                                            <option value="allow_repeat">{recruitmentUiText.allowRepeatSending}</option>
                                                        </NativeSelect>
                                                    </Field>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="space-y-3">
                                            <div className="rounded-[8px] bg-[#F7F8FA] px-4 py-[14px] dark:bg-slate-900/50">
                                                <p className="text-[12px] font-semibold leading-[18px] text-[#0E1114] dark:text-slate-100">{recruitmentUiText.skillsAutomation}</p>
                                                <p className="mt-1 text-[11px] leading-[18px] text-[#86888F] dark:text-slate-400">{recruitmentUiText.autoMailSkillBindingHint}</p>
                                            </div>
                                            {([
                                                ["jdSkillIds", positionSkillFieldConfig.jdSkillIds],
                                                ["screeningSkillIds", positionSkillFieldConfig.screeningSkillIds],
                                                ["interviewSkillIds", positionSkillFieldConfig.interviewSkillIds],
                                            ] as const).map(([formKey, config]) => {
                                                const skillChoices = positionSkillChoicesByField[formKey];
                                                const isExpanded = positionSkillSectionExpanded[formKey];
                                                const hasSelected = (positionForm[formKey] as number[]).length > 0;
                                                return (
                                                    <div key={formKey} className="rounded-[8px] border border-[#EBEEF5] bg-white px-4 py-[14px] dark:border-slate-800 dark:bg-slate-950/50">
                                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                                            <div className="space-y-1">
                                                                <p className="text-[12px] font-medium leading-[18px] text-[#0E1114] dark:text-slate-100">{config.label}</p>
                                                                <p className="text-[11px] leading-[18px] text-[#86888F] dark:text-slate-400">
                                                                    {hasSelected
                                                                        ? `${config.selectedPrefix}${selectedPositionSkillText[formKey]}`
                                                                        : (isZh ? "当前未绑定，系统将自动使用该类型的内置通用基座。" : "No plan selected. The system will fall back to the built-in base for this task.")}
                                                                </p>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                {canManageSkill ? (
                                                                    <Button
                                                                        type="button"
                                                                        variant="outline"
                                                                        size="sm"
                                                                        title={isZh ? `新建${config.label}` : `Create ${config.label}`}
                                                                        onClick={() => openSkillEditorForPosition(config.taskKind, formKey)}
                                                                    >
                                                                        <Plus className="h-4 w-4"/>
                                                                    </Button>
                                                                ) : null}
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    className="gap-1"
                                                                    onClick={() => setPositionSkillSectionExpanded((current) => ({
                                                                        ...current,
                                                                        [formKey]: !current[formKey],
                                                                    }))}
                                                                >
                                                                    {isExpanded ? <ChevronUp className="h-4 w-4"/> : <ChevronDown className="h-4 w-4"/>}
                                                                    {isExpanded ? (isZh ? "收起" : "Collapse") : (isZh ? "展开选择" : "Choose")}
                                                                </Button>
                                                            </div>
                                                        </div>
                                                        {isExpanded ? (
                                                            <div className="mt-4 space-y-3">
                                                                <div className="max-w-md">
                                                                    <Input
                                                                        className={cn(recruitmentFormInputClass, recruitmentFormControlClass)}
                                                                        value={positionSkillSearch}
                                                                        placeholder={config.placeholder}
                                                                        onChange={(event) => setPositionSkillSearch(event.target.value)}
                                                                    />
                                                                </div>
                                                                <div className="flex flex-wrap gap-2">
                                                                    {skillChoices.length ? skillChoices.map((skill: RecruitmentSkill) => (
                                                                        <TogglePillButton
                                                                            key={`${formKey}-${skill.id}`}
                                                                            active={(positionForm[formKey] as number[]).includes(skill.id)}
                                                                            onClick={() => updatePositionSkillBinding(formKey, toggleSingleSkillId(positionForm[formKey] as number[], skill.id), {expandSection: true})}
                                                                        >
                                                                            {skill.name}
                                                                        </TogglePillButton>
                                                                    )) : (
                                                                        <p className="text-xs text-slate-400">{recruitmentUiText.noSkillsAvailable}</p>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </RecruitmentFieldRow>
                            </RecruitmentFormSection>

                            <div className="flex items-center justify-center gap-3 pb-8 pt-1">
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="h-[34px] min-w-[80px] rounded-[6px] border-[#E6E7EB] bg-white text-[12px] font-normal text-[#33353D] shadow-none hover:border-[#1E3BFA]/40 hover:bg-[#F7F8FA] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                                    onClick={requestClosePositionFormPage}
                                >
                                    {recruitmentUiText.cancelButton}
                                </Button>
                                <Button
                                    type="button"
                                    className="h-[34px] min-w-[86px] rounded-[6px] bg-[#1E3BFA] px-6 text-[12px] font-medium text-white shadow-none hover:bg-[#0F23D9]"
                                    disabled={positionSubmitting}
                                    onClick={() => void submitPosition()}
                                >
                                    {positionSubmitting
                                        ? recruitmentUiText.savingPosition
                                        : (isZh ? "保存" : "Save")}
                                </Button>
                            </div>

                            {positionFormSubmitError ? (
                                <p className="pb-8 text-center text-[12px] leading-[18px] text-[#e11d48]" role="alert">
                                    {positionFormSubmitError}
                                </p>
                            ) : null}
                        </div>
                        <div className="hidden lg:block">
                            <RecruitmentFormAnchorRail
                                title={isZh ? "快速跳转" : "Quick navigation"}
                                items={[
                                    {href: "#position-form-basic", label: isZh ? "职位信息" : "Basic Info"},
                                    {href: "#position-form-requirements", label: isZh ? "职位要求" : "Requirements"},
                                    {href: "#position-form-screening", label: isZh ? "职位设置" : "Settings"},
                                ]}
                            />
                        </div>
                    </div>
                </ScrollArea>
            </div>
        );
    }

    function renderPositionsPage() {
        const listPage = (
            <PositionsListPage
                    positions={positions}
                    visiblePositions={visiblePositions}
                    loading={positionsLoading}
                    blockStaleData={positionListRequiresRefresh}
                    query={positionQuery}
                    statusFilter={positionStatusFilter}
                    statusLabels={positionStatusLabels}
                    isZh={isZh}
                    showOrganizationColumn={showOrganizationColumn}
                    getOrganizationLabel={getOrganizationLabel}
                    organizationControl={renderWorkspaceOrganizationControl()}
                    canManageCandidate={canManageCandidate}
                    onQueryChange={handlePositionQueryChange}
                    onStatusFilterChange={setPositionStatusFilter}
                    onCreate={openCreatePosition}
                    onUpload={() => openResumeUploadDialog(null)}
                    onRefresh={async () => {
                        try {
                            await loadPositions({force: true});
                            toast.success(recruitmentToast.refreshed(recruitmentToastEntities.positions));
                        } catch {
                            // loadPositions 已展示错误，保留当前阻断状态等待再次重试。
                        }
                    }}
                    onOpenPosition={(positionId) => {
                        const needsDetail = positionDetail?.position.id !== positionId;
                        if (needsDetail) {
                            setPositionDetail(null);
                            setPositionDetailLoading(true);
                        }
                        // 同一 ID 上次加载失败时 selectedPositionId 不会变化，需要显式重试。
                        if (needsDetail && selectedPositionId === positionId) {
                            void loadPositionDetail(positionId);
                        }
                        setSelectedPositionId(positionId);
                        setPositionDetailViewOpen(true);
                    }}
                    onOpenJD={async (positionId) => {
                        setSelectedPositionId(positionId);
                        const detail = positionDetail?.position.id === positionId
                            ? positionDetail
                            : await loadPositionDetail(positionId);
                        if (detail?.position) {
                            setPositionJDConfigOpen(true);
                        }
                    }}
                    onEdit={async (positionId) => {
                        setSelectedPositionId(positionId);
                        const detail = positionDetail?.position.id === positionId
                            ? positionDetail
                            : await loadPositionDetail(positionId);
                        openEditPosition(detail);
                    }}
                    onViewCandidates={(positionId) => {
                        setCandidatePositionFilter([String(positionId)]);
                        navigateToRecruitmentPage("candidates");
                    }}
            />
        );

        return (
            <>
                <div className={cn("h-full min-h-0", positionDetailViewOpen && "hidden")}>{listPage}</div>
                {positionDetailViewOpen ? (
                    <div
                        className="flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-slate-950"
                    >
                <div className="hidden">
                    <div className={cn("position-panel-header", positionListCollapsed && "collapsed")}>
                        {positionListCollapsed ? (
                            <div className="flex items-center justify-center py-1">
                                <BriefcaseBusiness className="h-4 w-4 text-slate-400 dark:text-slate-500"/>
                            </div>
                        ) : (
                            <div>
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <span className="position-panel-title shrink-0">{isZh ? "招聘需求" : "Hiring Requests"}</span>
                                        <Select value={positionStatusFilter} onValueChange={setPositionStatusFilter}>
                                            <SelectTrigger className="h-8 w-[92px] rounded-md border-[var(--tr-border)] bg-white px-2.5 text-xs font-medium text-[var(--tr-ink-muted)] shadow-none hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300 dark:hover:border-slate-700">
                                                <SelectValue placeholder={isZh ? "全部" : "All"}/>
                                            </SelectTrigger>
                                            <SelectContent align="start" className="min-w-[112px]">
                                                <SelectItem value="all">{isZh ? "全部" : "All"}</SelectItem>
                                                {Object.entries(positionStatusLabels).map(([value, label]) => (
                                                    <SelectItem key={value} value={value}>{label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="position-panel-count">({visiblePositions.length}/{positions.length})</span>
                                    </div>
                                </div>
                                <div className="mt-3 flex gap-2">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-9 flex-1 rounded-md border-rose-200 bg-white text-xs font-semibold text-[var(--tr-red)] shadow-none hover:border-rose-300 hover:bg-rose-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:border-slate-700 dark:hover:bg-slate-900/70"
                                        onClick={openCreatePosition}
                                    >
                                        <Plus className="mr-1 h-4 w-4"/>
                                        {isZh ? "新增招聘需求" : "Add Hiring Request"}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-9 rounded-md border-[var(--tr-border)] bg-white px-2 text-xs text-[var(--tr-ink)] shadow-none hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:border-slate-700 dark:hover:bg-slate-900/70"
                                        disabled={positionsLoading}
                                        onClick={async () => {
                                            await loadPositions();
                                            toast.success(recruitmentToast.refreshed(recruitmentToastEntities.positions));
                                        }}
                                    >
                                        {positionsLoading ? <Loader2 className="h-4 w-4 animate-spin"/> : <RotateCcw className="h-4 w-4"/>}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>

                    {!positionListCollapsed ? (
                        <div className="flex-shrink-0 px-4 pb-3">
                            <PositionQuerySearchInput
                                initialValue={positionQuery}
                                onChange={handlePositionQueryChange}
                                placeholder={isZh ? "搜索需求、职位、部门、地点" : "Search requests, positions, departments, locations"}
                                inputClassName="h-9 rounded-md border-[var(--tr-border)] bg-white text-xs shadow-none placeholder:text-slate-400 focus-visible:ring-2 dark:border-slate-800 dark:bg-slate-950/60 dark:placeholder:text-slate-500"
                            />
                        </div>
                    ) : null}
                    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-1 [scrollbar-gutter:stable] [scrollbar-width:auto] [scrollbar-color:rgba(148,163,184,0.75)_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[scrollbar-color:rgba(71,85,105,0.9)_transparent] dark:[&::-webkit-scrollbar-thumb]:bg-slate-700">
                        <div className={cn(positionListCollapsed ? "space-y-2" : "space-y-2.5")}>
                            {positionsLoading ? (
                                <LoadingCard label={isZh ? "正在加载招聘需求" : "Loading hiring requests"}/>
                            ) : visiblePositions.length ? visiblePositions.map((position) => {
                                const isSelected = selectedPositionId === position.id;
                                return (
                                    <div key={position.id} className="relative">
                                    <button
                                        type="button"
                                        onClick={() => setSelectedPositionId(position.id)}
                                        className={cn(
                                            "group relative w-full rounded-md border px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 dark:focus-visible:ring-slate-500/50",
                                            isSelected
                                                ? "border-rose-200 bg-rose-50/60 shadow-none dark:border-slate-700 dark:bg-slate-900/90"
                                                : "border-[var(--tr-border-soft)] bg-white hover:border-rose-200 hover:bg-rose-50/30 dark:border-slate-800 dark:bg-slate-950/45 dark:hover:border-slate-700 dark:hover:bg-slate-900/60",
                                            isSelected && !positionListCollapsed && "pb-5 pr-8",
                                            positionListCollapsed && "flex items-center justify-center px-0 py-2.5 border-transparent bg-transparent hover:bg-slate-100/80 dark:hover:bg-slate-800/60",
                                            positionListCollapsed && isSelected && "border-transparent bg-slate-100 dark:bg-slate-900",
                                        )}
                                    >
                                        {isSelected && !positionListCollapsed ? <span className="absolute inset-y-3 left-0 w-0.5 rounded-r-full bg-[var(--tr-red)] dark:bg-slate-100"/> : null}
                                        {positionListCollapsed ? (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <div className="flex items-center justify-center">
                                                        <span className={cn(
                                                            "h-2.5 w-2.5 rounded-full",
                                                            isSelected
                                                                ? "bg-slate-900 dark:bg-slate-100"
                                                                : "bg-slate-300 dark:bg-slate-600"
                                                        )}/>
                                                    </div>
                                                </TooltipTrigger>
                                                <TooltipContent side="right">
                                                    <p className="text-xs font-medium">{position.title}</p>
                                                    <p className="text-[11px] opacity-70">{labelForPositionStatus(position.status)}</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        ) : (
                                            <div className="min-w-0 space-y-2">
                                                <div className="flex min-w-0 items-start justify-between gap-2">
                                                    <p className="line-clamp-2 min-w-0 text-[15px] font-semibold leading-5 tracking-normal text-[var(--tr-ink)] dark:text-slate-50">{position.title}</p>
                                                    <Badge className={cn("shrink-0 rounded-full border px-2 py-0 text-[12px] font-medium leading-5", statusBadgeClass("position", position.status))}>
                                                        {labelForPositionStatus(position.status)}
                                                    </Badge>
                                                </div>
                                                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-5 text-slate-500 dark:text-slate-400">
                                                    {showOrganizationColumn ? (
                                                        <span className="max-w-[180px] truncate rounded-md bg-slate-100/70 px-1.5 font-medium text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
                                                            {getOrganizationLabel(position.org_code)}
                                                        </span>
                                                    ) : null}
                                                        <span className="font-medium text-slate-500 dark:text-slate-400">
                                                            {isZh ? `需求 ${position.headcount} 人` : `Need ${position.headcount}`}
                                                        </span>
                                                        <span className="font-medium text-slate-500 dark:text-slate-400">
                                                            {isZh ? `候选人 ${position.candidate_count}` : `Candidates ${position.candidate_count}`}
                                                        </span>
                                                </div>
                                                <p
                                                    className="truncate text-[12px] leading-5 text-slate-400 dark:text-slate-500"
                                                    title={`${position.department || (isZh ? "未设置部门" : "No department")} · ${position.location || (isZh ? "未设置地点" : "No location")}`}
                                                >
                                                    {position.department || (isZh ? "未设置部门" : "No department")} · {position.location || (isZh ? "未设置地点" : "No location")}
                                                </p>
                                            </div>
                                        )}
                                    </button>
                                    {isSelected && !positionListCollapsed ? (
                                        <Popover open={positionCardActionMenuOpen} onOpenChange={(open) => {
                                            setPositionCardActionMenuOpen(open);
                                        }}>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <PopoverTrigger asChild>
                                                        <button
                                                            type="button"
                                                            className={cn(
                                                                "absolute bottom-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-transparent bg-transparent text-slate-400/70 opacity-60 transition hover:border-slate-200/80 hover:bg-white/75 hover:text-slate-700 hover:opacity-100 dark:text-slate-500 dark:hover:border-slate-700 dark:hover:bg-slate-950/70 dark:hover:text-slate-200",
                                                                positionCardActionMenuOpen && "border-slate-200/80 bg-white/80 text-slate-700 opacity-100 dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-200",
                                                            )}
                                                            aria-label={isZh ? "当前需求操作" : "Current request actions"}
                                                            onClick={(event) => {
                                                                event.preventDefault();
                                                                event.stopPropagation();
                                                                setPositionCardActionMenuOpen((current) => !current);
                                                            }}
                                                        >
                                                            <Settings2 className="h-3.5 w-3.5"/>
                                                        </button>
                                                    </PopoverTrigger>
                                                </TooltipTrigger>
                                                <TooltipContent side="right">
                                                    <p>{isZh ? "当前需求操作" : "Current request actions"}</p>
                                                </TooltipContent>
                                            </Tooltip>
                                            <PopoverContent
                                                side="right"
                                                align="end"
                                                sideOffset={8}
                                                collisionPadding={12}
                                                className="w-72 rounded-2xl border-slate-200/80 bg-white/95 p-2 shadow-xl shadow-slate-900/10 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95"
                                            >
                                                {renderPositionActionMenuContent()}
                                            </PopoverContent>
                                        </Popover>
                                    ) : null}
                                    </div>
                                );
                            }) : (
                                <EmptyState title={isZh ? "暂无招聘需求" : "No Hiring Requests Yet"} description={isZh ? "先新建招聘需求，再完善职位信息、生成 JD 并进入招聘流程。" : "Create a hiring request first, then complete position details, generate a JD, and enter the recruiting workflow."}/>
                            )}
                            {positionListCollapsed && (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            className="flex w-full items-center justify-center py-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                                            onClick={openCreatePosition}
                                        >
                                            <Plus className="h-4 w-4"/>
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="right">
                                        <p className="text-sm">{isZh ? "新增招聘需求" : "Add Hiring Request"}</p>
                                    </TooltipContent>
                                </Tooltip>
                            )}
                        </div>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setPositionListCollapsed((current) => !current)}
                        className="absolute right-0 top-1/2 z-20 h-10 w-5 -translate-y-1/2 translate-x-1/2 rounded-full border-slate-200/80 bg-white/95 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/95"
                        title={positionListCollapsed ? (isZh ? "展开招聘需求列表" : "Expand hiring request list") : (isZh ? "收起招聘需求列表" : "Collapse hiring request list")}
                    >
                        {positionListCollapsed ? <ChevronRight className="h-3.5 w-3.5"/> : <ChevronLeft className="h-3.5 w-3.5"/>}
                    </Button>
                </div>

                <div className="relative min-h-0 flex-1 overflow-hidden">
                    {positionDetailLoading ? <LoadingPanel label={isZh ? "正在加载招聘需求详情" : "Loading hiring request details"}/> : positionDetail?.position.id === selectedPositionId ? (
                        <div className="flex h-full min-h-0 flex-col">
                            <div className="shrink-0 border-b border-[#F2F3F5] bg-white px-5 pt-[18px] dark:border-slate-800 dark:bg-slate-950 md:px-8">
                                <div className="flex flex-wrap items-start justify-between gap-4 pb-[14px]">
                                    <div className="flex min-w-0 items-start gap-3">
                                        <button
                                            type="button"
                                            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-[#E6E7EB] text-[#86888F] transition hover:border-[#1E3BFA] hover:bg-[#1E3BFA]/5 hover:text-[#1E3BFA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3BFA]/25 dark:border-slate-700"
                                            onClick={() => positionWorkspaceView === "jd" ? requestJDExit("back-list") : setPositionDetailViewOpen(false)}
                                            aria-label={isZh ? "返回岗位列表" : "Back to positions"}
                                        >
                                            <ArrowLeft className="h-4 w-4"/>
                                        </button>
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-[10px]">
                                                <h1 className="truncate text-[18px] font-semibold leading-6 text-[#0E1114] dark:text-slate-50">{positionDetail.position.title}</h1>
                                                <Badge className={cn("h-[22px] rounded-[4px] border px-[9px] py-0 text-[12px] font-normal", statusBadgeClass("position", positionDetail.position.status))}>{labelForPositionStatus(positionDetail.position.status)}</Badge>
                                                <span className="text-[12px] text-[#86888F]">{positionDetail.position.position_code}</span>
                                            </div>
                                            <p className="mt-[5px] truncate text-[12px] leading-[18px] text-[#86888F]">
                                                {[positionDetail.position.department, positionDetail.position.location, positionDetail.position.employment_type, getOrganizationLabel(positionDetail.position.org_code)].filter(Boolean).join(" · ")}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 flex-nowrap items-center justify-end gap-[10px]">
                                        {canManageCandidate ? (
                                            <Button variant="outline" className="h-8 rounded-[6px] border-[#E6E7EB] px-[13px] text-[12px] font-normal shadow-none hover:border-[#1E3BFA] hover:bg-[#1E3BFA]/5 hover:text-[#1E3BFA]" onClick={() => openResumeUploadDialog(positionDetail.position.id)}>
                                                {isZh ? "上传简历" : "Upload"}
                                            </Button>
                                        ) : null}
                                        <Button variant="outline" className="h-8 rounded-[6px] border-[#1E3BFA] px-[13px] text-[12px] font-normal text-[#1E3BFA] shadow-none hover:bg-[#1E3BFA]/5 hover:text-[#1E3BFA]" onClick={openPositionJDConfigDialog}>
                                            {isZh ? "JD 配置" : "JD Config"}
                                        </Button>
                                        <Button variant="outline" className="h-8 rounded-[6px] border-[#E6E7EB] px-[13px] text-[12px] font-normal shadow-none hover:border-[#1E3BFA] hover:bg-[#1E3BFA]/5 hover:text-[#1E3BFA]" onClick={openPositionAssessmentDialog}>
                                            {isZh ? "评估方案" : "Assessment"}
                                        </Button>
                                        <Button className="h-8 gap-1.5 rounded-[6px] bg-[#1E3BFA] px-[15px] text-[12px] font-normal text-white shadow-none hover:bg-[#0F23D9]" onClick={() => openEditPosition()}>
                                            <Pencil className="h-[13px] w-[13px]"/>{isZh ? "编辑岗位" : "Edit"}
                                        </Button>
                                        <Button variant="ghost" className="h-8 rounded-[6px] px-[10px] text-[12px] font-normal text-[#F53F3F] hover:bg-[#F53F3F]/5 hover:text-[#F53F3F]" onClick={() => setPositionDeleteConfirmOpen(true)} disabled={positionDeleting}>
                                            {isZh ? "删除" : "Delete"}
                                        </Button>
                                    </div>
                                </div>
                                <div className="flex items-center gap-[30px] overflow-x-auto">
                                    {([
                                        ["config", isZh ? "岗位信息" : "Position Info"],
                                        ["candidates", isZh ? "候选人" : "Candidates"],
                                        ["jd", isZh ? "JD 工作区" : "JD Workspace"],
                                        ["versions", isZh ? "版本与发布" : "Versions & Publishing"],
                                    ] as const).map(([value, label]) => (
                                        <button
                                            key={value}
                                            type="button"
                                            className={cn(
                                                "relative shrink-0 px-0.5 py-[9px] text-[13px] leading-[18px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3BFA]/25",
                                                positionWorkspaceView === value ? "font-semibold text-[#0E1114] dark:text-slate-100" : "text-[#86888F] hover:text-[#33353D] dark:hover:text-slate-200",
                                            )}
                                            onClick={() => {
                                                if (value === positionWorkspaceView) {
                                                    return;
                                                }
                                                if (positionWorkspaceView === "jd" && value !== "jd") {
                                                    requestJDExit(`switch-${value}` as JDUnsavedExitIntent);
                                                    return;
                                                }
                                                setPositionWorkspaceView(value);
                                            }}
                                        >
                                            {label}
                                            {positionWorkspaceView === value ? <span className="absolute inset-x-1 bottom-0 h-[3px] rounded-full bg-[#1E3BFA]"/> : null}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden bg-[#FBFBFC] px-5 pb-11 pt-5 dark:bg-slate-900/30 md:px-8 2xl:gap-6">
                                <div className="min-h-0 space-y-4 overflow-y-auto xl:pr-2 xl:[scrollbar-gutter:stable] 2xl:space-y-6 [scrollbar-width:auto] [scrollbar-color:rgba(148,163,184,0.9)_transparent] [&::-webkit-scrollbar]:h-3 [&::-webkit-scrollbar]:w-3 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:bg-clip-content hover:[&::-webkit-scrollbar-thumb]:bg-slate-400 dark:[scrollbar-color:rgba(71,85,105,0.95)_transparent] dark:[&::-webkit-scrollbar-thumb]:bg-slate-700 dark:hover:[&::-webkit-scrollbar-thumb]:bg-slate-600">
                                    {positionWorkspaceView === "jd" ? (
                                        <div className="max-w-[820px] overflow-hidden rounded-[10px] border border-[#EBEEF5] bg-white dark:border-slate-800 dark:bg-slate-950">
                                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F2F3F5] px-5 py-[14px] dark:border-slate-800">
                                                <div className="flex items-center gap-[10px]">
                                                    <span className="text-[13px] font-semibold leading-5 text-[#0E1114] dark:text-slate-100">
                                                        {isZh ? "当前 JD" : "Current JD"}
                                                    </span>
                                                    <span className="inline-flex h-[22px] items-center rounded-full bg-[#0CC991]/10 px-[9px] text-[11px] leading-[18px] text-[#0A9C71] dark:bg-emerald-500/15 dark:text-emerald-300">
                                                        {currentJDVersion
                                                            ? `V${currentJDVersion.version_no} ${isZh ? "生效中" : "Active"}`
                                                            : (isZh ? "未生成" : "Not generated")}
                                                    </span>
                                                </div>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    className="h-[30px] rounded-[6px] border-[#1E3BFA] px-[13px] text-[12px] font-normal text-[#1E3BFA] shadow-none hover:bg-[#1E3BFA]/5 hover:text-[#1E3BFA]"
                                                    onClick={openPositionJDConfigDialog}
                                                >
                                                    {isZh ? "打开 JD 配置" : "Open JD Config"}
                                                </Button>
                                            </div>
                                            <div className="min-h-[220px] whitespace-pre-wrap break-words px-6 py-[22px] text-[13px] leading-[2] text-[#33353D] [overflow-wrap:anywhere] dark:text-slate-300">
                                                {currentPublishText?.trim()
                                                    || currentJDVersion?.jd_markdown?.trim()
                                                    || (isZh
                                                        ? "当前岗位还没有生效的 JD，点击“打开 JD 配置”生成并保存版本。"
                                                        : "This position does not have an active JD yet. Open JD Config to generate and save one.")}
                                            </div>
                                        </div>
                                    ) : positionWorkspaceView === "candidates" && positionDetail ? (() => {
                                        return (
                                            <PositionCandidatesView
                                                positionDetail={positionDetail}
                                                positionCandidatesData={positionCandidatesData}
                                                positionCandidatesLoading={positionCandidatesLoading}
                                                positionCandidatesInitialLoaded={positionCandidatesInitialLoaded}
                                                positionCandidatesTotal={positionCandidatesTotal}
                                                positionCandidateStatusFilter={positionCandidateStatusFilter}
                                                positionFilteredSortedCandidates={positionFilteredSortedCandidates}
                                                onSelectCandidate={handlePositionCandidateSelect}
                                                isLoadingMorePositionCandidates={isLoadingMorePositionCandidates}
                                                selectedCandidateId={selectedCandidateId}
                                                initialSearchValue={positionCandidateSearch}
                                                isZh={isZh}
                                                recruitmentUiText={recruitmentUiText}
                                                candidateStatusLabels={candidateStatusLabels}
                                                onSearchChange={handlePositionCandidateSearchChange}
                                                onStatusFilterChange={(v) => setPositionCandidateStatusFilter(v)}
                                                onViewAllCandidates={() => {
                                                    setCandidatePositionFilter([String(positionDetail.position.id)]);
                                                    navigateToRecruitmentPage("candidates");
                                                }}
                                                onLoadMore={() => { if (selectedPositionId) void loadMorePositionCandidates(selectedPositionId); }}
                                            />
                                        );
                                    })() : positionWorkspaceView === "config" ? (() => {
                                        const position = positionDetail.position;
                                        const bossFields = resolveBossFieldsFromPosition(position);
                                        const emptyValue = isZh ? "—" : "—";
                                        const automationRows = [
                                            {
                                                label: isZh ? "上传简历后自动进入初筛" : "Auto-screen resumes after upload",
                                                enabled: Boolean(position.auto_screen_on_upload),
                                            },
                                            {
                                                label: isZh ? "初筛通过后自动推进候选人状态" : "Auto-advance candidates after screening",
                                                enabled: position.auto_advance_on_screening !== false,
                                            },
                                            {
                                                label: isZh ? "初筛完成后自动推送邮件" : "Auto-send mail after screening",
                                                enabled: Boolean(position.auto_mail_enabled),
                                            },
                                        ];
                                        const assessmentRows = [
                                            {
                                                label: isZh ? "JD 分析方案" : "JD Analysis Plan",
                                                ids: position.jd_skill_ids || [],
                                            },
                                            {
                                                label: isZh ? "初筛评估方案" : "Screening Assessment Plan",
                                                ids: position.screening_skill_ids || [],
                                            },
                                            {
                                                label: isZh ? "面试题评估方案" : "Interview Assessment Plan",
                                                ids: position.interview_skill_ids || [],
                                            },
                                        ];

                                        return (
                                            <div className="grid max-w-[1180px] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
                                                <div className="flex min-w-0 flex-col gap-4">
                                                    <PositionDetailSection title={isZh ? "基本信息" : "Basic Info"}>
                                                        <div className="grid gap-x-9 gap-y-4 sm:grid-cols-2">
                                                            <PositionDetailBasicItem label={isZh ? "公司" : "Company"} value={getOrganizationLabel(position.org_code) || emptyValue}/>
                                                            <PositionDetailBasicItem label={isZh ? "部门" : "Department"} value={position.department || emptyValue}/>
                                                            <PositionDetailBasicItem label={isZh ? "招聘类型" : "Recruitment Type"} value={position.employment_type || emptyValue}/>
                                                            <PositionDetailBasicItem label={isZh ? "职位类型" : "Job Type"} value={bossFields.jobType || emptyValue}/>
                                                            <PositionDetailBasicItem label={isZh ? "工作地址" : "Work Address"} value={position.location || emptyValue}/>
                                                            <PositionDetailBasicItem label={isZh ? "招聘人数" : "Headcount"} value={isZh ? `${position.headcount} 人` : String(position.headcount)}/>
                                                            <PositionDetailBasicItem label={isZh ? "创建时间" : "Created At"} value={formatDateTime(position.created_at)}/>
                                                        </div>
                                                    </PositionDetailSection>

                                                    <PositionDetailSection title={isZh ? "职位描述" : "Job Description"}>
                                                        <div className="whitespace-pre-wrap break-words text-[13px] leading-[1.95] text-[#33353D] [overflow-wrap:anywhere] dark:text-slate-300">
                                                            {position.key_requirements?.trim() || emptyValue}
                                                        </div>
                                                    </PositionDetailSection>

                                                    {position.bonus_points?.trim() || position.summary?.trim() ? (
                                                        <PositionDetailSection title={isZh ? "补充信息" : "Additional Info"}>
                                                            <div className="flex flex-col gap-[14px]">
                                                                <div className="flex min-w-0 flex-col gap-1.5">
                                                                    <span className="text-[11px] leading-[17px] text-[#86888F] dark:text-slate-400">{isZh ? "加分项" : "Bonus Points"}</span>
                                                                    <span className="whitespace-pre-wrap break-words text-[13px] leading-[1.85] text-[#33353D] [overflow-wrap:anywhere] dark:text-slate-300">{position.bonus_points?.trim() || emptyValue}</span>
                                                                </div>
                                                                <div className="h-px bg-[#F2F3F5] dark:bg-slate-800"/>
                                                                <div className="flex min-w-0 flex-col gap-1.5">
                                                                    <span className="text-[11px] leading-[17px] text-[#86888F] dark:text-slate-400">{isZh ? "岗位背景" : "Position Background"}</span>
                                                                    <span className="whitespace-pre-wrap break-words text-[13px] leading-[1.85] text-[#33353D] [overflow-wrap:anywhere] dark:text-slate-300">{position.summary?.trim() || emptyValue}</span>
                                                                </div>
                                                            </div>
                                                        </PositionDetailSection>
                                                    ) : null}
                                                </div>

                                                <div className="flex min-w-0 flex-col gap-4">
                                                    <PositionDetailSection title={isZh ? "职位要求" : "Position Requirements"}>
                                                        <div className="flex flex-col gap-[13px]">
                                                            {[
                                                                [isZh ? "经验要求" : "Experience", bossFields.experience || emptyValue],
                                                                [isZh ? "学历要求" : "Education", bossFields.education || emptyValue],
                                                                [isZh ? "薪资范围" : "Salary", position.salary_range || emptyValue],
                                                                [isZh ? "职位关键词" : "Keywords", bossFields.tagsText || emptyValue],
                                                            ].map(([label, value]) => (
                                                                <div key={label} className="flex items-baseline justify-between gap-3">
                                                                    <span className="shrink-0 text-[12px] leading-[18px] text-[#86888F] dark:text-slate-400">{label}</span>
                                                                    <span className="min-w-0 break-words text-right text-[13px] leading-[20px] text-[#0E1114] [overflow-wrap:anywhere] dark:text-slate-100">{value}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </PositionDetailSection>

                                                    <PositionDetailSection title={isZh ? "初筛与自动化" : "Screening & Automation"}>
                                                        <div className="flex flex-col gap-3">
                                                            {automationRows.map((item) => (
                                                                <div key={item.label} className="flex items-center justify-between gap-3">
                                                                    <span className="text-[12px] leading-[18px] text-[#33353D] dark:text-slate-300">{item.label}</span>
                                                                    <span className={cn(
                                                                        "inline-flex h-[22px] shrink-0 items-center rounded-full px-[9px] text-[11px] leading-[18px]",
                                                                        item.enabled
                                                                            ? "bg-[#0CC991]/10 text-[#0A9C71] dark:bg-emerald-500/15 dark:text-emerald-300"
                                                                            : "bg-[#B0B2B8]/15 text-[#86888F] dark:bg-slate-700/70 dark:text-slate-300",
                                                                    )}>
                                                                        {item.enabled ? (isZh ? "已开启" : "Enabled") : (isZh ? "未开启" : "Disabled")}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </PositionDetailSection>

                                                    <PositionDetailSection title={isZh ? "评估方案" : "Assessment Plans"}>
                                                        <div className="flex flex-col gap-3">
                                                            {assessmentRows.map((item) => {
                                                                const isBound = item.ids.length > 0;
                                                                return (
                                                                    <div key={item.label} className="flex min-w-0 flex-col gap-[5px]">
                                                                        <div className="flex items-center justify-between gap-[10px]">
                                                                            <span className="text-[12px] leading-[18px] text-[#86888F] dark:text-slate-400">{item.label}</span>
                                                                            <span className={cn(
                                                                                "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] leading-[16px]",
                                                                                isBound
                                                                                    ? "bg-[#0CC991]/10 text-[#0A9C71] dark:bg-emerald-500/15 dark:text-emerald-300"
                                                                                    : "bg-[#B0B2B8]/15 text-[#86888F] dark:bg-slate-700/70 dark:text-slate-300",
                                                                            )}>
                                                                                {isBound ? (isZh ? "已绑定" : "Bound") : (isZh ? "未绑定" : "Unbound")}
                                                                            </span>
                                                                        </div>
                                                                        <span className={cn(
                                                                            "break-words text-[13px] leading-[20px] [overflow-wrap:anywhere]",
                                                                            isBound ? "text-[#0E1114] dark:text-slate-100" : "text-[#B0B2B8] dark:text-slate-500",
                                                                        )}>
                                                                            {isBound
                                                                                ? formatSkillNames(item.ids, skillMap, language)
                                                                                : (isZh ? "未绑定 · 使用内置通用基座" : "Unbound · Using built-in base")}
                                                                        </span>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </PositionDetailSection>
                                                </div>
                                            </div>
                                        );
                                    })() : positionWorkspaceView === "versions" ? (() => {
                                        const publishTasks = [...(positionDetail.publish_tasks || [])].sort(
                                            (left, right) => Date.parse(String(right.created_at || "")) - Date.parse(String(left.created_at || "")),
                                        );
                                        const latestPublishTask = publishTasks[0];
                                        const latestPublishStatus = String(latestPublishTask?.status || "").toLowerCase();
                                        const publishFailed = ["failed", "error", "cancelled", "canceled"].includes(latestPublishStatus);
                                        const publishRunning = ["pending", "queued", "running", "processing"].includes(latestPublishStatus);
                                        const isPublished = Boolean(latestPublishTask?.published_url) && !publishFailed;
                                        const publishStatusLabel = isPublished
                                            ? (isZh ? "已发布" : "Published")
                                            : publishRunning
                                                ? (isZh ? "发布中" : "Publishing")
                                                : publishFailed
                                                    ? (isZh ? "发布失败" : "Failed")
                                                    : (isZh ? "未发布" : "Unpublished");
                                        const publishStatusDescription = isPublished
                                            ? (isZh ? "当前生效版本已发布到招聘平台" : "The active version has been published")
                                            : publishRunning
                                                ? (isZh ? "当前发布任务正在执行，请稍后刷新查看结果" : "The publishing task is currently running")
                                                : publishFailed
                                                    ? (isZh ? "最近一次发布未成功，可检查记录后重新发布" : "The latest publishing task failed")
                                                    : (isZh ? "当前生效版本尚未发布到招聘平台" : "The active version has not been published");

                                        return (
                                            <div className="flex max-w-[820px] flex-col gap-4">
                                                <div className="flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-[#EBEEF5] bg-white px-5 py-[18px] dark:border-slate-800 dark:bg-slate-950">
                                                    <div className="flex min-w-0 flex-col gap-1">
                                                        <span className="text-[13px] font-semibold leading-5 text-[#0E1114] dark:text-slate-100">
                                                            {isZh ? "发布状态" : "Publishing Status"}
                                                        </span>
                                                        <span className="text-[12px] leading-[18px] text-[#86888F] dark:text-slate-400">
                                                            {publishStatusDescription}
                                                        </span>
                                                    </div>
                                                    <div className="flex shrink-0 items-center gap-3">
                                                        <span className={cn(
                                                            "inline-flex h-6 items-center rounded-full px-[10px] text-[12px] leading-[18px]",
                                                            isPublished
                                                                ? "bg-[#0CC991]/10 text-[#0A9C71] dark:bg-emerald-500/15 dark:text-emerald-300"
                                                                : publishRunning
                                                                    ? "bg-[#1E3BFA]/8 text-[#1E3BFA] dark:bg-blue-500/15 dark:text-blue-300"
                                                                    : publishFailed
                                                                        ? "bg-[#F53F3F]/8 text-[#F53F3F] dark:bg-rose-500/15 dark:text-rose-300"
                                                                        : "bg-[#B0B2B8]/15 text-[#86888F] dark:bg-slate-700/70 dark:text-slate-300",
                                                        )}>
                                                            {publishStatusLabel}
                                                        </span>
                                                        <Button
                                                            type="button"
                                                            className="h-8 rounded-[6px] bg-[#1E3BFA] px-[15px] text-[12px] font-normal text-white shadow-none hover:bg-[#0F23D9]"
                                                            onClick={() => {
                                                                if (!currentPublishText.trim()) {
                                                                    toast.info(isZh ? "请先生成并保存可发布的 JD 文案" : "Generate and save publish-ready JD copy first");
                                                                    return;
                                                                }
                                                                setPublishDialogOpen(true);
                                                            }}
                                                        >
                                                            {isZh ? "发布职位" : "Publish Position"}
                                                        </Button>
                                                    </div>
                                                </div>

                                                <div className="overflow-hidden rounded-[10px] border border-[#EBEEF5] bg-white dark:border-slate-800 dark:bg-slate-950">
                                                    <div className="border-b border-[#F2F3F5] px-5 py-[14px] dark:border-slate-800">
                                                        <span className="text-[13px] font-semibold leading-5 text-[#0E1114] dark:text-slate-100">
                                                            {isZh ? "版本历史" : "Version History"}
                                                        </span>
                                                    </div>
                                                    {positionDetail.jd_versions.length ? positionDetail.jd_versions.map((version) => (
                                                        <div key={version.id} className="flex items-center gap-[14px] border-b border-[#F2F3F5] px-5 py-[14px] last:border-b-0 dark:border-slate-800">
                                                            <span className={cn(
                                                                "inline-flex h-[26px] min-w-[38px] shrink-0 items-center justify-center rounded-[6px] border px-2 text-[12px] font-semibold",
                                                                version.is_active
                                                                    ? "border-[#1E3BFA] text-[#0E1114] dark:text-slate-100"
                                                                    : "border-[#EBEEF5] text-[#33353D] dark:border-slate-700 dark:text-slate-300",
                                                            )}>
                                                                V{version.version_no}
                                                            </span>
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                                                    <span className={cn(
                                                                        "min-w-0 truncate text-[13px] leading-5",
                                                                        version.is_active ? "text-[#0E1114] dark:text-slate-100" : "text-[#33353D] dark:text-slate-300",
                                                                    )}>
                                                                        {version.notes?.trim()
                                                                            || version.title?.trim()
                                                                            || (version.is_active
                                                                                ? (isZh ? "由 AI 生成并人工校订 · 当前对外发布版本" : "AI generated and reviewed · Current public version")
                                                                                : (isZh ? "历史归档版本，可回滚" : "Archived version, available for rollback"))}
                                                                    </span>
                                                                    <span className={cn(
                                                                        "inline-flex h-[19px] shrink-0 items-center rounded-full px-2 text-[10px] leading-4",
                                                                        version.is_active
                                                                            ? "bg-[#0CC991]/10 text-[#0A9C71] dark:bg-emerald-500/15 dark:text-emerald-300"
                                                                            : "bg-[#B0B2B8]/15 text-[#86888F] dark:bg-slate-700/70 dark:text-slate-300",
                                                                    )}>
                                                                        {version.is_active ? (isZh ? "生效中" : "Active") : (isZh ? "历史版本" : "Historical")}
                                                                    </span>
                                                                </div>
                                                                <span className="mt-[3px] block text-[11px] leading-[17px] text-[#86888F] dark:text-slate-400">
                                                                    {formatDateTime(version.created_at)}
                                                                </span>
                                                            </div>
                                                            {!version.is_active ? (
                                                                <Button
                                                                    type="button"
                                                                    variant="outline"
                                                                    className="h-[28px] shrink-0 rounded-[6px] border-[#E6E7EB] px-[10px] text-[11px] font-normal text-[#1E3BFA] shadow-none hover:border-[#1E3BFA] hover:bg-[#1E3BFA]/5 hover:text-[#1E3BFA]"
                                                                    onClick={() => void activateJDVersion(version.id)}
                                                                    disabled={jdVersionActivating}
                                                                >
                                                                    {jdVersionActivating ? (isZh ? "切换中…" : "Switching…") : (isZh ? "设为生效" : "Activate")}
                                                                </Button>
                                                            ) : null}
                                                        </div>
                                                    )) : (
                                                        <div className="px-5 py-8 text-center text-[12px] text-[#86888F] dark:text-slate-400">
                                                            {isZh ? "暂无 JD 版本，请先在 JD 配置中生成并保存。" : "No JD versions yet. Generate and save one in JD Config."}
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="overflow-hidden rounded-[10px] border border-[#EBEEF5] bg-white dark:border-slate-800 dark:bg-slate-950">
                                                    <div className="border-b border-[#F2F3F5] px-5 py-[14px] dark:border-slate-800">
                                                        <span className="text-[13px] font-semibold leading-5 text-[#0E1114] dark:text-slate-100">
                                                            {isZh ? "发布记录" : "Publishing History"}
                                                        </span>
                                                    </div>
                                                    {publishTasks.length ? publishTasks.map((task) => (
                                                        <div key={task.id} className="flex items-start gap-[14px] border-b border-[#F2F3F5] px-5 py-[14px] last:border-b-0 dark:border-slate-800">
                                                            <span className="inline-flex h-[26px] min-w-[46px] shrink-0 items-center justify-center rounded-[6px] border border-[#EBEEF5] px-2 text-[11px] font-medium text-[#33353D] dark:border-slate-700 dark:text-slate-300">
                                                                {task.target_platform === "boss" ? "BOSS" : task.target_platform === "zhilian" ? (isZh ? "智联" : "Zhilian") : task.target_platform}
                                                            </span>
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <span className="text-[13px] leading-5 text-[#0E1114] dark:text-slate-100">
                                                                        {task.mode === "mock"
                                                                            ? (isZh ? "发布预演" : "Preview")
                                                                            : task.mode === "api"
                                                                                ? (isZh ? "接口发布" : "API Publishing")
                                                                                : (isZh ? "自动化发布" : "Automated Publishing")}
                                                                    </span>
                                                                    <Badge className={cn("h-[20px] rounded-full border px-2 py-0 text-[10px] font-normal", statusBadgeClass("task", task.status))}>
                                                                        {labelForTaskExecutionStatus(task.status)}
                                                                    </Badge>
                                                                </div>
                                                                <span className="mt-[3px] block text-[11px] leading-[17px] text-[#86888F] dark:text-slate-400">
                                                                    {formatDateTime(task.created_at)}
                                                                </span>
                                                                {task.error_message ? (
                                                                    <p className="mt-1.5 break-words text-[12px] leading-[18px] text-[#F53F3F]">{task.error_message}</p>
                                                                ) : null}
                                                            </div>
                                                            {task.published_url && task.mode !== "mock" ? (
                                                                <a
                                                                    className="shrink-0 text-[12px] leading-5 text-[#1E3BFA] hover:text-[#0F23D9] hover:underline"
                                                                    href={task.published_url}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                >
                                                                    {isZh ? "查看职位" : "Open"}
                                                                </a>
                                                            ) : null}
                                                        </div>
                                                    )) : (
                                                        <div className="px-5 py-8 text-center text-[12px] text-[#86888F] dark:text-slate-400">
                                                            {isZh ? "暂无发布记录。" : "No publishing history."}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })() : null}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <EmptyState title={isZh ? "岗位详情加载失败" : "Position Details Unavailable"} description={isZh ? "请返回岗位列表后重新打开，或刷新岗位数据。" : "Return to the position list and open it again, or refresh the position data."}/>
                    )}
                </div>
                    </div>
                ) : null}
            </>
        );
    }

    function renderCandidatesPage() {
        const candidatePageDetailMatchesSelection = Boolean(
            selectedCandidateId
            && candidateDetail?.candidate.id === selectedCandidateId
        );
        const candidatePageDetailLoading = candidateDetailLoading || Boolean(
            selectedCandidateId
            && !candidatePageDetailMatchesSelection
        );
        const currentPipelineStatsScopeKey = resolveCandidatePipelineStatsScopeKey();
        const scopedPipelineStats = candidatePipelineStatsScopeKey === currentPipelineStatsScopeKey
            ? candidatePipelineStatsData
            : null;
        const allPositionCandidateCount = candidateScopeTotal;
        return (
            <CandidatesPage
                pageActive={activePage === "candidates"}
                candidateWorkspaceMode={candidateWorkspaceMode}
                comparisonCandidates={comparisonSelectionItems}
                comparisonPreview={comparisonPreview}
                comparisonLoading={comparisonLoading}
                comparisonFailed={comparisonFailed}
                comparisonStale={comparisonStale}
                comparisonProcessing={comparisonProcessing}
                importCandidatesToComparison={importCandidatesToComparison}
                toggleCandidateInComparison={toggleCandidateInComparison}
                removeCandidateFromComparison={removeCandidateFromComparison}
                clearCandidateComparison={clearCandidateComparison}
                startCandidateComparison={startCandidateComparison}
                exitCandidateComparison={exitCandidateComparison}
                refreshCandidateComparison={refreshCandidateComparison}
                permissions={{
                    manageCandidate: canManageCandidate,
                    executeProcess: canExecuteProcess,
                    viewReview: canViewReview || canActReview || canManageReview,
                    actReview: canActReview,
                    manageReview: canManageReview,
                    viewInterview: canViewInterview || canActInterview || canManageInterview,
                    manageInterview: canManageInterview,
                    viewSkill: canViewSkill,
                    bindSkill: canBindSkill,
                    sendMail: canSendMail,
                    viewLog: canViewLog,
                    viewAssistant: canViewRecruitmentAssistant,
                    viewTalentPool: canViewTalentPool,
                }}
                panelClass={panelClass}
                candidateViewMode={candidateViewMode}
                candidateQuery={candidateQuery}
                setCandidateQuery={setCandidateQueryWithTransition}
                candidatePositionFilter={candidatePositionFilter}
                setCandidatePositionFilter={setCandidatePositionFilterWithTransition}
                candidateStatusFilter={candidateStatusFilter}
                setCandidateStatusFilter={setCandidateStatusFilterWithTransition}
                candidateMatchFilter={candidateMatchFilter}
                setCandidateMatchFilter={setCandidateMatchFilterWithTransition}
                candidateSourceFilter={candidateSourceFilter}
                setCandidateSourceFilter={setCandidateSourceFilterWithTransition}
                candidateTimeFilter={candidateTimeFilter}
                setCandidateTimeFilter={setCandidateTimeFilterWithTransition}
                positions={positions}
                positionsLoading={positionsLoading}
                sourceOptions={sourceOptions}
                visibleCandidates={visibleCandidates}
                selectedCandidateIds={selectedCandidateIds}
                setSelectedCandidateIds={setSelectedCandidateIds}
                triggerScreening={triggerScreening}
                triggerFreshScreening={triggerFreshScreening}
                isBatchScreeningCancelling={isBatchScreeningCancelling}
                screeningSubmitting={screeningSubmitting}
                isBatchScreeningRunning={isBatchScreeningRunning}
                openResumeMailDialog={openResumeMailDialog}
                candidatesLoading={candidatesLoading}
                candidatesInitialLoaded={candidatesInitialLoaded}
                candidateMatchSortLoading={candidateMatchSortLoading}
                allCandidatesCount={effectiveAllCandidatesCount}
                allPositionCandidateCount={allPositionCandidateCount}
                candidateTotal={effectiveVisibleCandidateTotal}
                candidatePageIndex={candidatePageIndex}
                candidatePageSize={candidatePageSize}
                candidatePageSizeOptions={CANDIDATE_LIST_PAGE_SIZE_OPTIONS}
                candidatePipelineStatusCounts={scopedPipelineStats?.status_counts}
                candidatePipelineTotal={scopedPipelineStats?.total}
                candidatePipelineStatsLoading={!scopedPipelineStats}
                setCandidatePageIndex={setCandidatePageIndexWithTransition}
                setCandidatePageSize={setCandidatePageSizeWithTransition}
                candidateListScrollRef={candidateListScrollRef}
                candidateListHorizontalRailRef={candidateListHorizontalRailRef}
                renderCandidateListHeaderCell={renderCandidateListHeaderCell}
                selectedCandidateId={selectedCandidateId}
                setSelectedCandidateId={handleCandidatePageSelect}
                toggleCandidateSelection={toggleCandidateSelection}
                candidateListDisplayColumnWidths={candidateListDisplayColumnWidths}
                showOrganizationColumn={showOrganizationColumn}
                getOrganizationLabel={getOrganizationLabel}
                getCandidateResumeMailSummary={getCandidateResumeMailSummary}
                groupedCandidates={groupedCandidates}
                candidateDetailLoading={candidatePageDetailLoading}
                candidateDetail={candidatePageDetailMatchesSelection ? candidateDetail : null}
                departmentReviews={candidatePageDetailMatchesSelection ? departmentReviews : []}
                createDepartmentReview={createDepartmentReview}
                departmentReviewDecisionContext={
                    candidatePageDetailMatchesSelection
                    && candidateDetailReviewContext?.candidateId === selectedCandidateId
                        ? candidateDetailReviewContext
                        : null
                }
                submitDepartmentReviewDecision={decideDepartmentReviewTask}
                isSelectedCandidateScreeningCancelling={isSelectedCandidateScreeningCancelling}
                selectedCandidateScreeningTaskId={selectedCandidateScreeningTaskId}
                openResumeFile={openResumeFile}
                resolveResumeFileDownloadPath={resolveResumeFileDownloadPath}
                generateInterviewQuestions={generateInterviewQuestions}
                isCurrentInterviewTaskCancelling={isCurrentInterviewTaskCancelling}
                currentCandidateInterviewTaskId={currentCandidateInterviewTaskId}
                candidateEditor={candidateEditor}
                setCandidateEditor={setCandidateEditor}
                saveCandidate={saveCandidate}
                candidateSaving={candidateSaving}
                exporting={exporting}
                requestDeleteResumeFile={requestDeleteResumeFile}
                requestDeleteCandidate={requestDeleteCandidate}
                effectiveScreeningSkillSourceLabel={effectiveScreeningSkillSourceLabel}
                effectiveScreeningSkillIds={effectiveScreeningSkillIds}
                skillMap={skillMap}
                pendingStatus={pendingStatus}
                setPendingStatus={setPendingStatus}
                updateCandidateStatus={updateCandidateStatus}
                statusUpdateReason={statusUpdateReason}
                setStatusUpdateReason={setStatusUpdateReason}
                candidateAssistantActivity={candidateAssistantActivity}
                preferredInterviewSkillSourceLabel={preferredInterviewSkillSourceLabel}
                effectiveInterviewSkillSourceLabel={effectiveInterviewSkillSourceLabel}
                openAssistantMode={openAssistantMode}
                candidateProcessActivity={candidateProcessActivity}
                candidateProcessLogsExpanded={candidateProcessLogsExpanded}
                setCandidateProcessLogsExpanded={setCandidateProcessLogsExpanded}
                openTaskLogDetail={openTaskLogDetail}
                interviewRoundName={interviewRoundName}
                setInterviewRoundName={setInterviewRoundName}
                effectiveInterviewSkillIds={effectiveInterviewSkillIds}
                interviewCustomRequirements={interviewCustomRequirements}
                setInterviewCustomRequirements={setInterviewCustomRequirements}
                interviewSkillSelectionDirty={interviewSkillSelectionDirty}
                setSelectedInterviewSkillIds={setSelectedInterviewSkillIds}
                setInterviewSkillSelectionDirty={setInterviewSkillSelectionDirty}
                skills={skills}
                toggleInterviewSkillSelection={toggleInterviewSkillSelection}
                downloadInterviewQuestion={downloadInterviewQuestion}
                interviewSchedules={interviewSchedules}
                createInterviewSchedule={createInterviewSchedule}
                deleteInterviewSchedule={deleteInterviewSchedule}
                offers={offers}
                createOffer={createOffer}
                updateOffer={updateOffer}
                deleteOffer={deleteOffer}
                exportCandidates={exportCandidates}
                requestBatchDelete={requestBatchDelete}
                batchBindPosition={batchBindPosition}
                onMoveToTalentPool={async (candidateIds) => {
                    await recruitmentApi("/candidates/batch-move-to-talent-pool", {
                        method: "POST",
                        body: JSON.stringify({ candidate_ids: candidateIds }),
                    });
                    removeCandidateIdsFromSelection(candidateIds);
                    await Promise.all([
                        loadCandidates(),
                        loadTalentPoolCandidates(),
                        refreshCandidateStats(),
                    ]);
                    if (selectedCandidateId && candidateIds.includes(selectedCandidateId)) {
                        await loadCandidateDetail(selectedCandidateId);
                    }
                }}
                onUploadResume={() => openResumeUploadDialog(null)}
                onRefreshCandidateDetail={async (candidateId) => {
                    await Promise.all([
                        loadCandidateDetail(candidateId, { force: true, includeDuplicates: true }),
                        loadInterviewSchedules(candidateId),
                        loadOffers(candidateId),
                        loadFollowUps(candidateId),
                        loadDepartmentReviews(candidateId),
                    ]);
                }}
                autoOpenInterviewScheduleCandidateId={autoOpenInterviewScheduleCandidateId}
                onAutoOpenInterviewScheduleHandled={(candidateId) => {
                    if (autoOpenInterviewScheduleCandidateId === candidateId) {
                        setAutoOpenInterviewScheduleCandidateId(null);
                    }
                }}
                batchUpdateStatus={batchUpdateStatus}
                duplicateCandidates={duplicateCandidates}
                followUps={followUps}
                createFollowUp={createFollowUp}
                deleteFollowUp={deleteFollowUp}
            />
        );
    }

    function renderAuditPage() {
        return (
            <AuditPage
                auditFiltersCollapsed={auditFiltersCollapsed}
                auditFilterSummary={auditFilterSummary}
                logsLoading={logsLoading}
                logTaskTypeFilter={logTaskTypeFilter}
                logStatusFilter={logStatusFilter}
                aiLogs={visibleAiLogs}
                aiLogTotal={aiLogTotal}
                selectedLogId={selectedLogId}
                selectedLogDetail={selectedLogDetail}
                logDetailLoading={logDetailLoading}
                auditListTableWidth={auditListTableWidth}
                auditListDisplayColumnWidths={auditListDisplayColumnWidths}
                positionMap={positionMap}
                candidateMap={candidateMap}
                skillMap={skillMap}
                refreshLogsWithFeedback={refreshLogsWithFeedback}
                setAuditFiltersCollapsed={setAuditFiltersCollapsed}
                setLogTaskTypeFilter={setLogTaskTypeFilter}
                setLogStatusFilter={setLogStatusFilter}
                setSelectedLogId={setSelectedLogId}
                auditListScrollRef={auditListScrollRef}
                auditListHorizontalRailRef={auditListHorizontalRailRef}
            />
        );
    }

    async function deleteTalentPoolCandidates(candidateIds: number[]) {
        try {
            const result = await recruitmentApi<{ deleted_count: number; skipped: { candidate_id: number; reason: string }[] }>("/candidates/batch-delete", {
                method: "POST",
                body: JSON.stringify({ candidate_ids: candidateIds }),
            });
            const deletedCount = result.deleted_count ?? 0;
            const skipped = result.skipped ?? [];
            if (skipped.length > 0) {
                const names = skipped.map((s) => `ID:${s.candidate_id}`).join(", ");
                toast.warning(recruitmentToast.candidatesDeletedWithSkipped(deletedCount, skipped.length, names));
            } else {
                toast.success(recruitmentToast.candidatesDeleted(deletedCount));
            }
            await Promise.allSettled([
                loadCandidates({ silent: true, force: true }),
                loadPositions({ force: true }),
                refreshCandidateStats(),
                loadTalentPoolCandidates(),
            ]);
        } catch (error) {
            toast.error(isZh ? `删除人才失败：${formatActionError(error)}` : `Failed to delete talent: ${formatActionError(error)}`);
            throw error;
        }
    }

    function renderTalentPoolPage() {
        return (
            <div className="relative h-full min-h-0 overflow-hidden">
                <TalentPoolPage
                    candidates={talentPoolCandidates}
                    positions={positions}
                    loading={talentPoolLoading}
                    onAssignPosition={batchBindPosition}
                    onViewCandidate={handleTalentPoolCandidateSelect}
                    onUploadResume={canManageCandidate ? () => openResumeUploadDialog(null) : undefined}
                    onDeleteCandidates={canManageCandidate ? deleteTalentPoolCandidates : undefined}
                    onRefresh={async () => {
                        setTalentPoolPageIndex(0);
                        talentPoolPageIndexRef.current = 0;
                        await loadTalentPoolCandidates({ query: { ...talentPoolQueryRef.current, pageIndex: 0 } });
                        toast.success(recruitmentToast.refreshed(recruitmentToastEntities.talentPool));
                    }}
                    total={effectiveTalentPoolTotal}
                    stats={shouldUseLocalScopedStats ? null : talentPoolStats}
                    availableTags={talentPoolAvailableTags}
                    pageIndex={talentPoolPageIndex}
                    pageSize={talentPoolPageSize}
                    pageSizeOptions={TALENT_POOL_PAGE_SIZE_OPTIONS}
                    setPageIndex={(nextPageIndex) => {
                        const normalized = Math.max(0, nextPageIndex);
                        setTalentPoolPageIndex(normalized);
                        talentPoolPageIndexRef.current = normalized;
                        void loadTalentPoolCandidates({ query: { ...talentPoolQueryRef.current, pageIndex: normalized } });
                    }}
                    setPageSize={(nextPageSize) => {
                        const normalized = TALENT_POOL_PAGE_SIZE_OPTIONS.includes(nextPageSize)
                            ? nextPageSize
                            : TALENT_POOL_PAGE_SIZE;
                        setTalentPoolPageIndex(0);
                        setTalentPoolPageSize(normalized);
                        talentPoolPageIndexRef.current = 0;
                        talentPoolPageSizeRef.current = normalized;
                        void loadTalentPoolCandidates({ query: { ...talentPoolQueryRef.current, pageIndex: 0, pageSize: normalized } });
                    }}
                    onQueryChange={async (query) => {
                        const nextQuery = {
                            ...talentPoolQueryRef.current,
                            ...query,
                            pageIndex: 0,
                        };
                        setTalentPoolPageIndex(0);
                        talentPoolPageIndexRef.current = 0;
                        await loadTalentPoolCandidates({ query: nextQuery });
                    }}
                    onReIdentify={canManageCandidate ? async (candidateId) => {
                        await reidentifyTalentPoolCandidates([candidateId]);
                    } : undefined}
                    onBatchReIdentify={canManageCandidate ? async (candidateIds) => {
                        await reidentifyTalentPoolCandidates(candidateIds);
                    } : undefined}
                    onCancelMatch={canManageCandidate ? async (candidateId) => {
                        await cancelTalentPoolCandidateMatch(candidateId);
                    } : undefined}
                    canManageCandidates={canManageCandidate}
                    preferredStatFilter={talentPoolPreferredStatFilter}
                    onPreferredStatFilterApplied={clearTalentPoolPreferredStatFilter}
                />
            </div>
        );
    }

    function renderAssistantPage() {
        return (
            <AssistantPage
                panelClass={panelClass}
                assistantOpen={assistantOpen}
                renderAssistantSuspendedState={renderAssistantSuspendedState}
                renderAssistantConsole={renderAssistantConsole}
            />
        );
    }

    function renderReviewWorkbenchPage() {
        return (
            <ReviewWorkbenchPage
                panelClass={panelClass}
                tasks={departmentReviewTasks}
                counts={departmentReviewCounts}
                loading={departmentReviewLoading}
                loadError={departmentReviewLoadError}
                activeFilter={departmentReviewFilter}
                setActiveFilter={setDepartmentReviewFilter}
                onRefresh={() => loadDepartmentReviewTasks()}
                canActReview={canActReview}
                onDecision={decideDepartmentReviewTask}
            />
        );
    }

    function renderInterviewWorkbenchPage() {
        return (
            <InterviewWorkbenchPage
                tasks={interviewWorkbenchTasks}
                calendarTasks={myInterviewCalendarTasks}
                counts={interviewWorkbenchCounts}
                loading={interviewWorkbenchLoading}
                activeFilter={interviewWorkbenchFilter}
                setActiveFilter={setInterviewWorkbenchFilter}
                currentUserCode={sessionUser?.id || null}
                canManageInterview={canManageInterview}
                canSubmitInterviewResults={canActInterview}
                availabilitySlots={myInterviewAvailabilitySlots}
                availabilityLoading={myInterviewAvailabilityLoading}
                availabilitySaving={myInterviewAvailabilitySaving}
                onRefresh={async () => {
                    await Promise.allSettled([
                        loadMyInterviewTasks(),
                        loadMyInterviewCalendarTasks({silent: true}),
                        loadMyInterviewAvailability({silent: true}),
                    ]);
                }}
                onSubmitResult={submitInterviewResult}
                onCreateSchedule={createInterviewSchedule}
                onUpdateSchedule={updateInterviewSchedule}
                onSaveAvailability={saveMyInterviewAvailability}
            />
        );
    }

    function renderSkillsPage() {
        return (
            <SkillSettingsPage
                skillsLoading={skillSettingsLoading}
                skills={skillSettingsRows}
                skillDetailLoadingId={skillDetailLoadingId}
                query={skillSettingsQueryInput}
                taskFilter={skillSettingsTaskFilter}
                total={skillSettingsTotal}
                pageIndex={skillSettingsPageIndex}
                pageSize={SETTINGS_LIST_PAGE_SIZE}
                canManageSkill={canManageSkill}
                openSkillEditor={openSkillEditor}
                openSkillEditorByTaskKind={openSkillEditorByTaskKind}
                openSkillEditorWithAI={openSkillEditorWithAI}
                toggleSkill={toggleSkill}
                setSkillDeleteTarget={setSkillDeleteTarget}
                onQueryChange={setSkillSettingsQueryInput}
                onTaskFilterChange={(taskFilter) => {
                    setSkillSettingsPageIndex(0);
                    setSkillSettingsTaskFilter(taskFilter);
                }}
                onPageChange={setSkillSettingsPageIndex}
            />
        );
    }

    function renderModelsPage() {
        return (
            <ModelSettingsPage
                llmConfigs={llmConfigs}
                modelsLoading={modelsLoading}
                canManageLLMConfig={canManageLLMConfig}
                assistantModelLabel={assistantModelLabel}
                assistantActiveLLMConfig={assistantActiveLLMConfig}
                preferredLLMConfigIds={preferredLLMConfigIds}
                openLLMEditor={openLLMEditor}
                copyLLMEditor={copyLLMEditor}
                setPreferredLLMConfig={setPreferredLLMConfig}
                setLlmDeleteTarget={setLlmDeleteTarget}
                refreshLLMConfigsWithFeedback={refreshLLMConfigsWithFeedback}
            />
        );
    }

    function renderMailSettingsPage() {
        return (
            <MailSettingsPage
                mailSenderConfigs={mailSenderConfigs}
                mailRecipients={mailRecipients}
                resumeMailDispatches={mailDispatchSettingsRows}
                mailAutoPushGlobalConfig={mailAutoPushGlobalConfig}
                mailSettingsLoading={mailSettingsLoading}
                mailSendersLoading={mailSendersLoading}
                mailRecipientsLoading={mailRecipientsLoading}
                mailDispatchesLoading={mailDispatchesLoading}
                mailAutoConfigLoading={mailAutoConfigLoading}
                mailAutoPushConfigSaving={mailAutoPushConfigSaving}
                mailRecipientMap={mailRecipientMap}
                mailSenderMap={mailSenderMap}
                candidateMap={candidateMap}
                positionMap={positionMap}
                mailDispatchActionKey={mailDispatchActionKey}
                mailDispatchDetailLoadingId={mailDispatchDetailLoadingId}
                resumeMailDispatchTotal={resumeMailDispatchTotal}
                resumeMailDispatchPageIndex={resumeMailDispatchPageIndex}
                resumeMailDispatchPageSize={SETTINGS_LIST_PAGE_SIZE}
                selectedCandidateIds={selectedCandidateIds}
                selectedCandidateId={selectedCandidateId}
                canViewMail={canViewMail}
                canManageMailSenders={canManageMailSenders}
                canManageMailRecipients={canManageMailRecipients}
                canSendMail={canSendMail}
                openMailSenderEditor={openMailSenderEditor}
                openMailRecipientEditor={openMailRecipientEditor}
                openResumeMailDialog={openResumeMailDialog}
                openResumeMailReplayDialog={openResumeMailReplayDialog}
                retryResumeMailDispatch={retryResumeMailDispatch}
                setMailSenderDeleteTarget={setMailSenderDeleteTarget}
                setMailRecipientDeleteTarget={setMailRecipientDeleteTarget}
                setMailAutoPushGlobalConfig={setMailAutoPushGlobalConfig}
                saveMailAutoPushGlobalConfig={saveMailAutoPushGlobalConfig}
                refreshMailSettingsWithFeedback={refreshMailSettingsWithFeedback}
                onResumeMailDispatchPageChange={setResumeMailDispatchPageIndex}
            />
        );
    }

    function renderPage() {
        switch (activePage) {
            case "workspace":
                return renderWorkspacePage();
            case "positions":
                return renderPositionsPage();
            case "candidates":
                return renderCandidatesPage();
            case "review-workbench":
                return renderReviewWorkbenchPage();
            case "interviews":
                return renderInterviewWorkbenchPage();
            case "talent-pool":
                return renderTalentPoolPage();
            case "audit":
                return renderAuditPage();
            case "assistant":
                return renderAssistantPage();
            case "settings-skills":
                return renderSkillsPage();
            case "settings-models":
                return renderModelsPage();
            case "settings-mail":
                return renderMailSettingsPage();
            default:
                return null;
        }
    }

    // Memoize page render results to avoid unnecessary re-renders
    const candidatesPageNode = useMemo(
        () => renderCandidatesPage(),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [
            visibleCandidates, selectedCandidateId, candidateDetail,
            departmentReviews,
            candidatesLoading, candidatesInitialLoaded,
            selectedCandidateIds, candidateDetailLoading, candidateEditor,
            candidateWorkspaceMode, comparisonSelectionItems, comparisonPreview,
            comparisonLoading, comparisonRefreshing, comparisonFailed,
            comparisonStale, comparisonProcessing,
            candidateSaving, exporting, pendingStatus, statusUpdateReason,
            candidateViewMode, candidatePositionFilter, candidateStatusFilter,
            candidateMatchFilter, candidateSourceFilter, candidateTimeFilter,
            candidateQuery, candidatePageIndex, candidatePageSize, candidateTotal,
            candidatePipelineStatsData, candidatePipelineStatsScopeKey,
            interviewSchedules, followUps, offers,
            screeningSubmitting, isBatchScreeningRunning, isBatchScreeningCancelling,
            batchStopScreeningTaskIds,
            candidateProcessLogsExpanded, interviewRoundName, interviewCustomRequirements,
            interviewSkillSelectionDirty, selectedInterviewSkillIds,
            candidateDetailReviewContext,
            activePage,
        ]
    );

    const auditPageNode = useMemo(
        () => renderAuditPage(),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [
            visibleAiLogs, selectedLogId, selectedLogDetail, logDetailLoading,
            logsLoading, logTaskTypeFilter, logStatusFilter, auditFiltersCollapsed,
            activePage, auditListDisplayColumnWidths, auditListTableWidth,
        ]
    );

    const handleOrgScopeChange = useCallback(async (orgScope: string, deptScope: string) => {
        candidateListRefreshQueryRef.current = {
            ...candidateListRefreshQueryRef.current,
            departmentScope: deptScope,
            orgScope,
        };
        updateOrgScopeSelection({orgScope, departmentScope: deptScope});
        setOrgSwitching(true);
        try {
            if (activePage === "workspace") {
                await Promise.allSettled([
                    loadCandidates({ silent: true, force: true, departmentScope: deptScope, orgScope }),
                    refreshCandidateStats(deptScope, orgScope),
                ]);
                return;
            }
            if (activePage === "candidates") {
                await loadCandidates({ silent: true, force: true, departmentScope: deptScope, orgScope });
                return;
            }
            if (activePage === "talent-pool") {
                await loadTalentPoolCandidates({ silent: true, departmentScope: deptScope, orgScope });
                return;
            }
            if (activePage === "audit") {
                await loadLogs({ silent: true, departmentScope: deptScope, orgScope });
                return;
            }
        } finally {
            setOrgSwitching(false);
        }
    }, [activePage, refreshCandidateStats, updateOrgScopeSelection]);

    function renderWorkspaceOrganizationControl() {
        return (
            <OrgScopeBreadcrumbPicker
                organizationCatalog={organizationCatalog}
                visibleOrgCodes={visibleOrgCodes}
                hasAllOrgScope={hasAllOrgScope}
                selectedOrgScope={selectedOrgScope}
                selectedDepartmentScope={selectedDepartmentScope}
                onOrgScopeChange={handleOrgScopeChange}
                allDepartmentsLabel={recruitmentUiText.allVisibleDepartments}
                disabled={organizationCatalogStatus !== "ready" || orgSwitching}
            />
        );
    }

    const positionsPageNode = visitedKeepAlivePagesRef.current.has("positions") && !positionDialogOpen
        ? renderPositionsPage()
        : null;

    if (bootstrapping) {
        return (
            <div
                className="flex h-full items-center justify-center bg-[#F7F8FA] dark:bg-slate-950">
                <div
                    className="flex items-center gap-3 rounded-[8px] border border-[#EBEEF5] bg-white px-5 py-3 text-sm text-[#33353D] shadow-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                    <Loader2 className="h-4 w-4 animate-spin"/>
                    {recruitmentUiText.loadingWorkspace}
                </div>
            </div>
        );
    }

    return (
        <div
            className="ats-dark-theme relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--tr-page)] text-[var(--tr-ink)] dark:text-[var(--ats-text-secondary)]">
            {activePage !== "workspace" && activePage !== "positions" && activePage !== "candidates" && activePage !== "talent-pool" && activePage !== "interviews" && activePage !== "review-workbench" && activePage !== "audit" && !isSettingsPage ? <div
                className="shrink-0 border-b border-[var(--tr-border)] bg-white dark:border-slate-800 dark:bg-slate-950">
                <div className="flex min-h-[62px] flex-wrap items-center justify-between gap-2 px-5 py-3 2xl:px-6">
                    <div className="flex min-w-0 items-center gap-2.5">
                        {canGoBack ? (
                            <Button variant="outline" size="sm" onClick={handleSmartBack} className="h-8 rounded-[4px] border-[#E6E7EB] bg-white px-3 text-[13px] text-[#33353D] shadow-none hover:border-[#1E3BFA] hover:bg-[#F7F8FA] hover:text-[#1E3BFA]">
                                <ArrowLeft className="h-3.5 w-3.5"/>
                                {recruitmentUiText.back}
                            </Button>
                        ) : null}
                        <div className="flex min-w-0 items-center gap-2">
                            <h1 className="shrink-0 text-[20px] font-semibold leading-7 tracking-normal text-[#0E1114] dark:text-slate-50">
                                {pageMeta[activePage].title}
                            </h1>
                            <span className="sr-only">{pageMeta[activePage].title}</span>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                        <OrgScopeBreadcrumbPicker
                            organizationCatalog={organizationCatalog}
                            visibleOrgCodes={visibleOrgCodes}
                            hasAllOrgScope={hasAllOrgScope}
                            selectedOrgScope={selectedOrgScope}
                            selectedDepartmentScope={selectedDepartmentScope}
                            onOrgScopeChange={handleOrgScopeChange}
                            allDepartmentsLabel={recruitmentUiText.allVisibleDepartments}
                            disabled={organizationCatalogStatus !== "ready" || orgSwitching}
                        />
                        {canManageCandidate && (
                            <Button onClick={() => openResumeUploadDialog(null)} className="h-9 rounded-[6px] bg-[#1E3BFA] px-4 text-[13px] text-white shadow-none hover:bg-[#0F23D9] dark:bg-[#1E3BFA] dark:text-white dark:hover:bg-[#0F23D9]">
                                <Upload className="h-3.5 w-3.5"/>
                                {recruitmentUiText.uploadResume}
                            </Button>
                        )}
                        {canManagePosition && (
                            <Button variant="outline" onClick={openCreatePosition} className="h-9 rounded-[6px] border-[#1E3BFA] bg-white px-4 text-[13px] text-[#1E3BFA] shadow-none hover:bg-[rgba(30,59,250,0.06)] hover:text-[#0F23D9] dark:border-[#1E3BFA] dark:bg-slate-950 dark:text-blue-300">
                                <Plus className="h-3.5 w-3.5"/>
                                {recruitmentUiText.createPosition}
                            </Button>
                        )}
                        {!hideTopRightAssistantEntry && canViewRecruitmentAssistant ? (
                            <Button
                                className="h-8 rounded-lg bg-slate-900 px-3 text-sm text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                                onClick={() => openAssistantMode("drawer")}>
                                <Bot className="h-3.5 w-3.5"/>
                                {recruitmentUiText.openAssistantDrawer}
                            </Button>
                        ) : null}
                    </div>
                </div>
            </div> : null}

            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                    {/* candidates/positions/audit 首次访问后保持挂载，用 hidden 控制 */}
                    {/* 原因：这三个页面有列表滚动位置、选中状态需要保持；未访问前不挂载以加快模块进入速度 */}
                    {visitedKeepAlivePagesRef.current.has("candidates") ? (
                        <div className={cn("h-full min-h-0", activePage !== "candidates" && "hidden")}>
                            <KeepAliveFreeze frozen={activePage !== "candidates"}>
                                {candidatesPageNode}
                            </KeepAliveFreeze>
                        </div>
                    ) : null}
                    {visitedKeepAlivePagesRef.current.has("positions") || positionDialogOpen ? (
                        <div className={cn("h-full min-h-0", activePage !== "positions" && "hidden")}>
                            <KeepAliveFreeze frozen={activePage !== "positions"}>
                                {positionDialogOpen ? renderPositionFormPage() : positionsPageNode}
                            </KeepAliveFreeze>
                        </div>
                    ) : null}
                    {visitedKeepAlivePagesRef.current.has("audit") ? (
                        <div className={cn("h-full min-h-0", activePage !== "audit" && "hidden")}>
                            <KeepAliveFreeze frozen={activePage !== "audit"}>
                                {auditPageNode}
                            </KeepAliveFreeze>
                        </div>
                    ) : null}

                    {/* 以下改为条件渲染，切换时重新挂载，无需保持状态 */}
                    {activePage === "talent-pool" && canViewTalentPool && (
                        <div className="h-full min-h-0">
                            {renderTalentPoolPage()}
                        </div>
                    )}
                    {activePage === "assistant" && canViewRecruitmentAssistant && (
                        <div className="h-full min-h-0 px-2 pb-2 pt-0">
                            {renderAssistantPage()}
                        </div>
                    )}
                    {activePage === "review-workbench" && (
                        <div className="h-full min-h-0">
                            {renderReviewWorkbenchPage()}
                        </div>
                    )}
                    {activePage === "interviews" && (
                        <div className="h-full min-h-0 px-2 pb-2 pt-0">
                            {renderInterviewWorkbenchPage()}
                        </div>
                    )}
                    {activePage === "workspace" && (
                        <ScrollArea className="h-full bg-white dark:bg-slate-950">
                            {renderWorkspacePage()}
                        </ScrollArea>
                    )}
                    {isSettingsPage ? (
                        <ScrollArea className="h-full bg-white dark:bg-slate-950">
                            <SettingsPageLayout
                                activePage={activePage as RecruitmentSettingsPage}
                                canAccessMail={canViewMail || canManageMailConfig}
                                canAccessModels={canViewLLMConfig || canManageLLMConfig}
                                canAccessSkills={canViewSkill || canManageSkill}
                                onNavigate={(page) => applyRecruitmentPageChange(page)}
                            >
                                {activePage === "settings-mail" ? renderMailSettingsPage() : null}
                                {activePage === "settings-models" ? renderModelsPage() : null}
                                {activePage === "settings-skills" ? renderSkillsPage() : null}
                            </SettingsPageLayout>
                        </ScrollArea>
                    ) : null}
                </div>

            {orgSwitching && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/50 backdrop-blur-sm transition-opacity duration-300 dark:bg-slate-950/50">
                    <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                        <Loader2 className="h-4 w-4 animate-spin"/>
                        {isZh ? "正在切换组织..." : "Switching organization..."}
                    </div>
                </div>
            )}
            {activePage !== "workspace" && canViewRecruitmentAssistant ? (
                <Button
                    className="fixed bottom-8 right-0 z-30 h-14 translate-x-[calc(100%-14px)] rounded-l-2xl rounded-r-none bg-slate-900 pl-4 pr-3 text-white shadow-[0_20px_40px_-18px_rgba(15,23,42,0.5)] transition-[transform,background-color] duration-200 hover:translate-x-0 hover:bg-slate-800 focus-visible:translate-x-0 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                    onClick={() => openAssistantMode("drawer")}
                >
                    <Bot className="h-4 w-4"/>
                    {recruitmentUiText.assistantPanelTitle}
                </Button>
            ) : null}

            <Dialog open={assistantOpen} onOpenChange={setAssistantOpen}>
                <DialogContent
                    className={cn(
                        "left-auto top-0 h-screen max-w-none translate-y-0 rounded-none p-0 sm:max-w-none",
                        assistantDisplayMode === "fullscreen"
                            ? "right-0 w-screen translate-x-0 border-0"
                            : "right-0 w-[min(1360px,100vw)] translate-x-0 border-l",
                    )}
                    onOpenAutoFocus={(event) => {
                        event.preventDefault();
                        queueAssistantInputFocus(true);
                    }}
                >
                    <DialogHeader className="sr-only">
                        <DialogTitle>{recruitmentUiText.assistantLabel}</DialogTitle>
                        <DialogDescription>{recruitmentUiText.assistantPanelDescription}</DialogDescription>
                    </DialogHeader>
                    {renderAssistantConsole(assistantDisplayMode)}
                </DialogContent>
            </Dialog>

            <Dialog
                open={activePage === "talent-pool" && talentPoolCandidateDetailOpen}
                onOpenChange={(open) => {
                    if (!open && !talentPoolDetailAssigning && !talentPoolDetailAction) {
                        closeTalentPoolCandidateDetail();
                    }
                }}
            >
                <DialogContent showCloseButton={false} className="left-auto right-0 top-0 h-dvh max-h-none min-w-0 w-[min(720px,100vw)] max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-y-0 border-r-0 border-l border-[#EBEEF5] bg-white p-0 shadow-[-8px_0_24px_rgba(14,17,20,0.12)] sm:max-w-none">
                    <DialogHeader className="sr-only">
                        <DialogTitle>{isZh ? "人才详情" : "Talent Details"}</DialogTitle>
                        <DialogDescription>{isZh ? "查看人才库候选人的完整资料" : "View the complete talent pool candidate profile"}</DialogDescription>
                    </DialogHeader>
                    {renderTalentPoolCandidateDrawerContent()}
                </DialogContent>
            </Dialog>

            <Dialog
                open={activePage === "talent-pool" && talentPoolCandidateDetailOpen && talentPoolDetailAssignOpen}
                onOpenChange={(open) => {
                    if (!talentPoolDetailAssigning) {
                        setTalentPoolDetailAssignOpen(open);
                    }
                }}
            >
                <DialogContent className="gap-0 overflow-hidden rounded-[8px] border-[#EBEEF5] bg-white p-0 text-[#0E1114] shadow-[0_8px_24px_rgba(14,17,20,0.16)] sm:max-w-[480px]">
                    <DialogHeader className="gap-1 border-b border-[#F2F3F5] px-6 pb-3.5 pr-14 pt-[18px] text-left">
                        <DialogTitle className="text-[16px] font-semibold text-[#0E1114]">{isZh ? "分配岗位" : "Assign Position"}</DialogTitle>
                        <DialogDescription className="text-[12px] leading-5 text-[#86888F]">
                            {isZh ? `为「${candidateDetail?.candidate ? resolveCandidateIdentity(candidateDetail.candidate).displayName : "当前人才"}」选择目标岗位，确认后将进入该岗位的招聘流程。` : `Choose a target position for ${candidateDetail?.candidate ? resolveCandidateIdentity(candidateDetail.candidate).displayName : "this talent"}. The talent will enter that recruitment flow after confirmation.`}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="px-6 py-5">
                        <Select value={talentPoolDetailAssignPositionId} onValueChange={setTalentPoolDetailAssignPositionId} disabled={talentPoolDetailAssigning}>
                            <SelectTrigger className="h-10 rounded-[6px] border-[#E6E7EB] bg-white text-[13px] shadow-none focus:border-[#1E3BFA] focus:ring-[#1E3BFA]/10">
                                <SelectValue placeholder={isZh ? "请选择目标岗位" : "Select a target position"}/>
                            </SelectTrigger>
                            <SelectContent>
                                {positions.map((position) => <SelectItem key={position.id} value={String(position.id)}>{position.title}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        {!positions.length ? <p className="mt-2 text-[12px] text-[#F53F3F]">{isZh ? "暂无可分配岗位，请先创建或启用岗位。" : "No assignable position is available. Create or activate a position first."}</p> : null}
                    </div>
                    <DialogFooter className="h-16 items-center gap-3 border-t border-[#F2F3F5] px-6 sm:justify-end">
                        <Button variant="outline" className="h-9 rounded-[6px] border-[#E6E7EB] px-4 shadow-none" onClick={() => setTalentPoolDetailAssignOpen(false)} disabled={talentPoolDetailAssigning}>{isZh ? "取消" : "Cancel"}</Button>
                        <Button className="h-9 rounded-[6px] bg-[#1E3BFA] px-4 text-white shadow-none hover:bg-[#0F23D9]" onClick={() => void submitTalentPoolDetailAssignment()} disabled={!talentPoolDetailAssignPositionId || talentPoolDetailAssigning}>
                            {talentPoolDetailAssigning ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin"/> : null}
                            {isZh ? "确认分配" : "Confirm Assignment"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={activePage === "talent-pool" && talentPoolCandidateDetailOpen && talentPoolDetailReidentifyConfirmOpen}
                onOpenChange={(open) => {
                    if (talentPoolDetailAction !== "reidentify") {
                        setTalentPoolDetailReidentifyConfirmOpen(open);
                    }
                }}
            >
                <DialogContent className="gap-0 overflow-hidden rounded-[8px] border-[#EBEEF5] bg-white p-0 text-[#0E1114] shadow-[0_8px_24px_rgba(14,17,20,0.16)] sm:max-w-[520px]">
                    <DialogHeader className="gap-1 border-b border-[#F2F3F5] px-6 pb-3.5 pr-14 pt-[18px] text-left">
                        <DialogTitle className="text-[16px] font-semibold text-[#0E1114]">{isZh ? "确认重新识别岗位" : "Confirm Re-identification"}</DialogTitle>
                        <DialogDescription className="text-[12px] leading-5 text-[#86888F]">
                            {isZh ? `将重新识别「${candidateDetail?.candidate ? resolveCandidateIdentity(candidateDetail.candidate).displayName : "当前人才"}」与开放岗位的匹配关系。` : `AI will re-identify open-position matches for ${candidateDetail?.candidate ? resolveCandidateIdentity(candidateDetail.candidate).displayName : "this talent"}.`}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="px-6 py-5">
                        <div className="rounded-[6px] border border-[rgba(255,171,36,0.35)] bg-[rgba(255,171,36,0.08)] px-3 py-2 text-[12px] leading-5 text-[#D48806]">
                            {isZh ? "当前人才并非“未匹配”或“识别异常”状态。重新识别会覆盖现有岗位识别结果，请确认后继续。" : "This talent is not unmatched or in an AI error state. Re-identification replaces the current position match result."}
                        </div>
                    </div>
                    <DialogFooter className="h-16 items-center gap-3 border-t border-[#F2F3F5] px-6 sm:justify-end">
                        <Button variant="outline" className="h-9 rounded-[6px] border-[#E6E7EB] px-4 shadow-none" onClick={() => setTalentPoolDetailReidentifyConfirmOpen(false)} disabled={talentPoolDetailAction === "reidentify"}>{isZh ? "取消" : "Cancel"}</Button>
                        <Button className="h-9 rounded-[6px] bg-[#1E3BFA] px-4 text-white shadow-none hover:bg-[#0F23D9]" onClick={() => void runTalentPoolDetailReidentify()} disabled={talentPoolDetailAction === "reidentify"}>
                            {talentPoolDetailAction === "reidentify" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin"/> : <RotateCcw className="mr-1.5 h-4 w-4"/>}
                            {isZh ? "确认重新识别" : "Confirm Re-identification"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={positionJDConfigOpen} onOpenChange={(open) => {
                if (open) {
                    setPositionJDConfigOpen(true);
                    return;
                }
                requestClosePositionJDConfigDialog();
            }}>
                <DialogContent className={cn(settingsDialogSurfaceClass, "flex h-[min(88vh,900px)] max-h-[88vh] flex-col sm:max-w-[960px]")}>
                    <DialogHeader className={settingsDialogHeaderClass}>
                        <DialogTitle className="text-[16px] font-semibold leading-5 text-[#0E1114]">
                            {isZh ? `JD 配置 · ${positionDetail?.position.title || ""}` : `JD Config · ${positionDetail?.position.title || ""}`}
                        </DialogTitle>
                        <DialogDescription className="text-[12px] leading-5 text-[#86888F]">
                            {isZh
                                ? "生成、编辑并保存当前岗位 JD，保存后可直接复制发布文案。"
                                : "Generate, edit, and save the current JD, then copy the publish-ready text."}
                        </DialogDescription>
                    </DialogHeader>

                    <ScrollArea className="min-h-0 flex-1">
                        {positionDetail ? (
                            <div className="flex flex-col gap-4 px-6 py-5">
                                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] bg-[#F7F8FA] px-4 py-[14px] dark:bg-slate-900/70">
                                    <div className="flex flex-wrap items-center gap-[10px]">
                                        <span className="text-[14px] font-semibold leading-5 text-[#0E1114] dark:text-slate-100">
                                            {positionDetail.position.title}
                                        </span>
                                        <Badge className={cn("h-[22px] rounded-full border px-2 py-0 text-[12px] font-normal", statusBadgeClass("task", currentJDGenerationStatus === "syncing" ? "running" : currentJDGenerationStatus))}>
                                            {labelForJDGenerationStatus(currentJDGenerationStatus)}
                                        </Badge>
                                        <Badge variant="outline" className="h-[22px] rounded-full border-[#E6E7EB] px-2 py-0 text-[12px] font-normal text-[#33353D]">
                                            {currentJDVersion ? `V${currentJDVersion.version_no} ${isZh ? "生效中" : "Active"}` : (isZh ? "未生成" : "Not generated")}
                                        </Badge>
                                    </div>
                                    <span className="text-[12px] leading-[18px] text-[#86888F] dark:text-slate-400">
                                        {positionDetail.jd_generation?.last_generated_at
                                            ? (isZh ? `上次生成 ${formatDateTime(positionDetail.jd_generation.last_generated_at)}` : `Last generated ${formatDateTime(positionDetail.jd_generation.last_generated_at)}`)
                                            : (isZh ? "暂无生成记录" : "No generation history")}
                                    </span>
                                </div>

                                {hasUnsavedJDDraft ? (
                                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] bg-[rgba(255,171,36,0.08)] px-4 py-3 text-[12px] leading-5 text-[#D48806]">
                                        <span>{isZh ? "这是一份未保存的 AI 生成草稿，关闭前请先保存，或确认放弃本次生成。" : "This AI-generated draft is unsaved. Save it before closing, or confirm discard."}</span>
                                        <Button
                                            type="button"
                                            className="h-[30px] rounded-[6px] bg-[#1E3BFA] px-[14px] text-[12px] font-normal text-white shadow-none hover:bg-[#0F23D9]"
                                            onClick={() => void saveJDVersion()}
                                            disabled={jdVersionSaving || isJDGenerating || !jdDraft.jdMarkdown.trim()}
                                        >
                                            {jdVersionSaving ? (isZh ? "保存中…" : "Saving…") : (isZh ? "立即保存" : "Save now")}
                                        </Button>
                                    </div>
                                ) : null}

                                <div className="overflow-hidden rounded-[8px] border border-[#EBEEF5] bg-white dark:border-slate-800 dark:bg-slate-950/70">
                                    <div className="flex items-center justify-between gap-3 border-b border-[#F2F3F5] px-4 py-3 dark:border-slate-800">
                                        <span className="flex items-center gap-1.5 text-[13px] font-semibold leading-5 text-[#0E1114] dark:text-slate-100">
                                            <Sparkles className="h-[13px] w-[13px] text-[#1E3BFA]"/>
                                            {isZh ? "AI 生成 JD" : "AI Generate JD"}
                                        </span>
                                        <span className="text-[12px] leading-[18px] text-[#B0B2B8] dark:text-slate-500">
                                            {positionDetail.jd_generation?.model_name || positionDetail.jd_generation?.model_provider
                                                ? (isZh ? `模型：${positionDetail.jd_generation?.model_name || positionDetail.jd_generation?.model_provider}` : `Model: ${positionDetail.jd_generation?.model_name || positionDetail.jd_generation?.model_provider}`)
                                                : ""}
                                        </span>
                                    </div>
                                    <div className="flex flex-col gap-3 px-4 py-[14px]">
                                        <Textarea
                                            value={jdExtraPrompt}
                                            onChange={(event) => setJdExtraPrompt(event.target.value)}
                                            rows={2}
                                            placeholder={isZh ? "补充本次生成要求（选填），例如：强调 IoT 场景、自动化测试、设备联调经验等" : "Add generation-specific requirements (optional)"}
                                            className={cn(settingsTextareaClass, "min-h-[52px] resize-none")}
                                        />
                                        {latestJDGenerationError ? (
                                            <div className="rounded-[6px] bg-[rgba(245,63,63,0.08)] px-3 py-2 text-[12px] leading-5 text-[#F53F3F]" role="alert">
                                                {isZh ? `上次生成失败：${latestJDGenerationError}` : `Last generation failed: ${latestJDGenerationError}`}
                                            </div>
                                        ) : null}
                                        <div className="flex items-center justify-end gap-[10px]">
                                            {isJDGenerating ? (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    className="h-8 rounded-[6px] border-[#E6E7EB] px-[14px] text-[12px] font-normal shadow-none"
                                                    onClick={() => void stopJDGeneration()}
                                                >
                                                    <Square className="h-3 w-3"/>
                                                    {isZh ? "停止生成" : "Stop"}
                                                </Button>
                                            ) : (
                                                <>
                                                    {currentJDVersion ? (
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            className="h-8 rounded-[6px] border-[#1E3BFA] px-[14px] text-[12px] font-normal text-[#1E3BFA] shadow-none hover:bg-[#1E3BFA]/5 hover:text-[#1E3BFA]"
                                                            onClick={() => void generateJD()}
                                                        >
                                                            <RefreshCw className="h-3 w-3"/>
                                                            {isZh ? "重新生成" : "Regenerate"}
                                                        </Button>
                                                    ) : null}
                                                    <Button
                                                        type="button"
                                                        className="h-8 rounded-[6px] bg-[#1E3BFA] px-[14px] text-[12px] font-normal text-white shadow-none hover:bg-[#0F23D9]"
                                                        onClick={() => void generateJD()}
                                                    >
                                                        <Wand2 className="h-3 w-3"/>
                                                        {isZh ? "AI 生成 JD" : "Generate JD"}
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                        {isJDGenerating ? (
                                            <JDStreamingPreview
                                                content={jdStreamingContent}
                                                jdGenerationStatus={jdGenerationStatus}
                                                isZh={isZh}
                                            />
                                        ) : null}
                                    </div>
                                </div>

                                <div className="overflow-hidden rounded-[8px] border border-[#EBEEF5] bg-white dark:border-slate-800 dark:bg-slate-950/70">
                                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F2F3F5] px-4 py-[10px] dark:border-slate-800">
                                        <div className="flex items-center gap-2">
                                            {([
                                                ["publish", isZh ? "可发布版" : "Publish Copy"],
                                                ["markdown", isZh ? "编辑源文本" : "Edit Source"],
                                                ["preview", isZh ? "排版预览" : "Preview"],
                                            ] as const).map(([mode, label]) => (
                                                <Button
                                                    key={mode}
                                                    type="button"
                                                    variant={jdViewMode === mode ? "default" : "outline"}
                                                    className={cn(
                                                        "h-[28px] rounded-[6px] border px-3 text-[12px] font-normal shadow-none",
                                                        jdViewMode === mode
                                                            ? "border-[#1E3BFA] bg-[#1E3BFA] text-white hover:bg-[#0F23D9]"
                                                            : "border-[#E6E7EB] bg-white text-[#33353D] hover:border-[#1E3BFA] hover:bg-[#1E3BFA]/5 hover:text-[#1E3BFA]",
                                                    )}
                                                    onClick={() => setJdViewMode(mode)}
                                                >
                                                    {label}
                                                </Button>
                                            ))}
                                        </div>
                                        {jdViewMode === "publish" ? (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="h-[28px] rounded-[6px] border-[#E6E7EB] px-3 text-[12px] font-normal shadow-none"
                                                onClick={() => void copyPublishJDText()}
                                                disabled={!currentPublishText.trim()}
                                            >
                                                <ClipboardCheck className="h-3 w-3"/>
                                                {isZh ? "复制发布文案" : "Copy Publish Copy"}
                                            </Button>
                                        ) : null}
                                    </div>

                                    {jdViewMode === "publish" ? (
                                        <div className="min-h-[180px] whitespace-pre-wrap break-words px-5 py-[18px] text-[13px] leading-[1.9] text-[#33353D] [overflow-wrap:anywhere] dark:text-slate-300">
                                            {currentPublishText || <span className="text-[#86888F] dark:text-slate-500">{isZh ? "暂无可发布的 JD 文案，点击「AI 生成 JD」后将在此展示。" : "No publish-ready JD yet. Generate one to see it here."}</span>}
                                        </div>
                                    ) : null}
                                    {jdViewMode === "markdown" ? (
                                        <div className="bg-[#F7F8FA] px-5 py-[18px] dark:bg-slate-900/40">
                                            <Textarea
                                                value={jdDraft.jdMarkdown}
                                                onChange={(event) => setJdDraft((current) => ({...current, jdMarkdown: event.target.value}))}
                                                rows={18}
                                                className={cn(settingsTextareaClass, "font-mono leading-[1.9]")}
                                            />
                                        </div>
                                    ) : null}
                                    {jdViewMode === "preview" ? (
                                        <div className="min-h-[180px] break-words px-5 py-[18px] text-[13px] leading-[2] text-[#33353D] [overflow-wrap:anywhere] dark:text-slate-300" dangerouslySetInnerHTML={{__html: currentPreviewHtml}}/>
                                    ) : null}

                                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#F2F3F5] bg-[#F7F8FA] px-4 py-[10px] dark:border-slate-800 dark:bg-slate-900/30">
                                        <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-[#33353D] dark:text-slate-300">
                                            <input
                                                type="checkbox"
                                                checked={jdDraft.autoActivate}
                                                onChange={(event) => setJdDraft((current) => ({...current, autoActivate: event.target.checked}))}
                                            />
                                            {isZh ? "保存后设为生效版本" : "Set as active after saving"}
                                        </label>
                                        <div className="flex flex-wrap items-center gap-3">
                                            <label className="flex items-center gap-1.5 text-[12px] text-[#86888F]">
                                                <span>{isZh ? "版本标题" : "Title"}</span>
                                                <Input
                                                    value={jdDraft.title}
                                                    onChange={(event) => setJdDraft((current) => ({...current, title: event.target.value}))}
                                                    className={cn(settingsInputClass, "h-[28px] w-40")}
                                                />
                                            </label>
                                            <label className="flex items-center gap-1.5 text-[12px] text-[#86888F]">
                                                <span>{isZh ? "备注" : "Notes"}</span>
                                                <Input
                                                    value={jdDraft.notes}
                                                    onChange={(event) => setJdDraft((current) => ({...current, notes: event.target.value}))}
                                                    className={cn(settingsInputClass, "h-[28px] w-36")}
                                                    placeholder={isZh ? "选填" : "Optional"}
                                                />
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </ScrollArea>

                    <DialogFooter className={cn(settingsDialogFooterClass, "sm:justify-start")}>
                        <span className="mr-auto text-[12px] leading-5 text-[#86888F]">
                            {hasUnsavedJDDraft ? (isZh ? "当前草稿尚未保存" : "Current draft is unsaved") : ""}
                        </span>
                        <Button variant="outline" className={settingsSecondaryButtonClass} onClick={requestClosePositionJDConfigDialog}>
                            {isZh ? "关闭" : "Close"}
                        </Button>
                        <Button
                            className={settingsPrimaryButtonClass}
                            onClick={() => void saveJDVersion()}
                            disabled={jdVersionSaving || isJDGenerating || !jdDraft.jdMarkdown.trim()}
                        >
                            {jdVersionSaving
                                ? (isZh ? "保存中…" : "Saving…")
                                : jdDraft.autoActivate
                                    ? (isZh ? "保存并设为生效版本" : "Save and Activate")
                                    : (isZh ? "保存新版本" : "Save New Version")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={jdUnsavedCloseConfirmOpen} onOpenChange={(open) => {
                setJdUnsavedCloseConfirmOpen(open);
                if (!open) {
                    setJdUnsavedExitIntent(null);
                }
            }}>
                <DialogContent className={cn(settingsDialogSurfaceClass, "sm:max-w-[480px]")}>
                    <DialogHeader className={settingsDialogHeaderClass}>
                        <DialogTitle className="text-[16px] font-semibold leading-5 text-[#0E1114]">{isZh ? "当前 JD 草稿还没有保存" : "This JD draft has not been saved"}</DialogTitle>
                        <DialogDescription className="text-[12px] leading-5 text-[#86888F]">
                            {isZh
                                ? "离开后，当前编辑内容会被放弃，不会写入 JD 版本记录。你可以继续编辑并点击「保存新版本」，也可以确认放弃草稿。"
                                : "Leaving will discard the current edits without adding a JD version. Keep editing and save a new version, or discard the draft."}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className={settingsDialogFooterClass}>
                        <Button variant="outline" className={settingsSecondaryButtonClass} onClick={() => {
                            setJdUnsavedCloseConfirmOpen(false);
                            setJdUnsavedExitIntent(null);
                        }}>
                            {isZh ? "继续编辑" : "Keep Editing"}
                        </Button>
                        <Button variant="destructive" className={settingsDangerButtonClass} onClick={discardGeneratedJDDraftAndClose}>
                            {isZh ? "放弃草稿并离开" : "Discard and Leave"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={positionAssessmentDialogOpen} onOpenChange={(open) => {
                setPositionAssessmentDialogOpen(open);
                if (!open) {
                    setPositionAssessmentSaving(false);
                }
            }}>
                <DialogContent className={cn(settingsDialogSurfaceClass, "flex max-h-[88vh] flex-col sm:max-w-[720px]")}>
                    <DialogHeader className={settingsDialogHeaderClass}>
                        <DialogTitle className="text-[16px] font-semibold leading-5 text-[#0E1114]">
                            {isZh ? "评估方案配置" : "Assessment Plan Configuration"}
                        </DialogTitle>
                        <DialogDescription className="text-[12px] leading-5 text-[#86888F]">
                            {isZh ? "只展示当前岗位已绑定或本次新建待绑定的方案，点击确定后才会写入岗位。" : "Only current or newly pending plans are shown. Changes are saved after confirmation."}
                        </DialogDescription>
                    </DialogHeader>

                    <ScrollArea className="min-h-0 flex-1">
                        <div className="flex flex-col gap-3 px-6 py-5">
                            {([
                                ["jdSkillIds", positionSkillFieldConfig.jdSkillIds],
                                ["screeningSkillIds", positionSkillFieldConfig.screeningSkillIds],
                                ["interviewSkillIds", positionSkillFieldConfig.interviewSkillIds],
                            ] as const).map(([formKey, config]) => {
                                const selectedSkillId = positionAssessmentDraft[formKey][0] || null;
                                const selectedSkill = selectedSkillId ? skillMap.get(selectedSkillId) || null : null;
                                const boundIds = formKey === "jdSkillIds"
                                    ? (positionDetail?.position.jd_skill_ids || [])
                                    : formKey === "screeningSkillIds"
                                        ? (positionDetail?.position.screening_skill_ids || [])
                                        : (positionDetail?.position.interview_skill_ids || []);
                                const isPending = Boolean(selectedSkillId && !boundIds.includes(selectedSkillId));

                                return (
                                    <div key={`assessment-config-${formKey}`} className="rounded-[8px] border border-[#EBEEF5] bg-white p-4 dark:border-slate-800 dark:bg-slate-950/70">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-[13px] font-semibold leading-5 text-[#0E1114] dark:text-slate-100">{config.label}</p>
                                                <p className="mt-[3px] text-[11px] leading-[17px] text-[#86888F] dark:text-slate-400">
                                                    {selectedSkill
                                                        ? (isPending ? (isZh ? "本次新增，待确认绑定" : "New this time, pending confirmation") : (isZh ? "当前岗位已绑定" : "Currently bound to this position"))
                                                        : (isZh ? "当前未绑定，系统会使用内置通用基座" : "No plan bound. The system uses its built-in base.")}
                                                </p>
                                            </div>
                                            {canManageSkill ? (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    className="h-[28px] shrink-0 rounded-[6px] border-[#E6E7EB] px-3 text-[12px] font-normal text-[#33353D] shadow-none hover:border-[#1E3BFA] hover:bg-[#1E3BFA]/5 hover:text-[#1E3BFA]"
                                                    onClick={() => openSkillEditorForAssessmentConfig(config.taskKind, formKey)}
                                                >
                                                    <Plus className="h-3 w-3"/>
                                                    {isZh ? "添加" : "Add"}
                                                </Button>
                                            ) : null}
                                        </div>

                                        {selectedSkill ? (
                                            <div className="mt-3 flex flex-col gap-2 rounded-[6px] bg-[#F7F8FA] px-[14px] py-3 dark:bg-slate-900/40">
                                                <div className="flex items-start justify-between gap-[10px]">
                                                    <div className="min-w-0">
                                                        <p className="truncate text-[13px] font-medium leading-5 text-[#0E1114] dark:text-slate-100">{selectedSkill.name}</p>
                                                        <p className="mt-0.5 line-clamp-2 text-[11px] leading-[17px] text-[#86888F] dark:text-slate-400">
                                                            {selectedSkill.description || shortText(selectedSkill.content, 120)}
                                                        </p>
                                                    </div>
                                                    <span className={cn(
                                                        "inline-flex h-[22px] shrink-0 items-center rounded-full border px-2 text-[12px] leading-[18px]",
                                                        isPending
                                                            ? "border-[rgba(255,171,36,0.35)] bg-[rgba(255,171,36,0.1)] text-[#D48806]"
                                                            : "border-[rgba(12,201,145,0.28)] bg-[rgba(12,201,145,0.1)] text-[#0A9C71]",
                                                    )}>
                                                        {isPending ? (isZh ? "待绑定" : "Pending") : (isZh ? "已绑定" : "Bound")}
                                                    </span>
                                                </div>
                                                <details className="group">
                                                    <summary className="cursor-pointer select-none text-[12px] leading-[18px] text-[#33353D] marker:text-[#86888F] hover:text-[#1E3BFA] dark:text-slate-300">
                                                        {isZh ? "查看当前方案详情" : "View Current Plan Details"}
                                                    </summary>
                                                    <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-[6px] border border-[#EBEEF5] bg-white px-3 py-2.5 text-[12px] leading-[1.8] text-[#33353D] [overflow-wrap:anywhere] dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
                                                        {selectedSkill.content || selectedSkill.description || (isZh ? "暂无方案内容" : "No plan content yet")}
                                                    </div>
                                                </details>
                                            </div>
                                        ) : (
                                            <div className="mt-3 rounded-[6px] bg-[#F7F8FA] px-[14px] py-3 text-[12px] leading-5 text-[#B0B2B8] dark:bg-slate-900/40 dark:text-slate-500">
                                                {isZh ? "暂无当前岗位方案，系统会使用该任务的内置通用基座约束" : "No plan for this position; the built-in task base will be used."}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </ScrollArea>

                    <DialogFooter className={cn(settingsDialogFooterClass, "sm:justify-start")}>
                        <span className="mr-auto text-[12px] leading-5 text-[#86888F]">
                            {isZh ? "取消不会保存本次新增或选择的绑定关系" : "Cancel will not save pending bindings."}
                        </span>
                        <Button variant="outline" className={settingsSecondaryButtonClass} onClick={() => setPositionAssessmentDialogOpen(false)} disabled={positionAssessmentSaving}>
                            {recruitmentUiText.cancelButton}
                        </Button>
                        <Button className={settingsPrimaryButtonClass} onClick={() => void submitPositionAssessmentBindings()} disabled={positionAssessmentSaving || !selectedPositionId}>
                            {positionAssessmentSaving ? (isZh ? "绑定中…" : "Binding…") : (isZh ? "确定绑定到岗位" : "Bind to Position")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={resumeUploadOpen} onOpenChange={(open) => {
                if (!open && uploadingResume) {
                    return;
                }
                setResumeUploadOpen(open);
                if (!open) {
                    resetResumeUploadDraft();
                }
            }}>
                {resumeUploadDialogBody}
            </Dialog>

            <Dialog open={positionFormCloseConfirmOpen} onOpenChange={setPositionFormCloseConfirmOpen}>
                <DialogContent className="rounded-[8px] border-[#EBEEF5] shadow-[0_8px_24px_rgba(14,17,20,0.16)] sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{isZh ? "有未保存的修改" : "Unsaved changes"}</DialogTitle>
                        <DialogDescription>
                            {isZh
                                ? "当前招聘需求表单还有未保存的内容，离开后将丢失这些修改。"
                                : "This hiring request form has unsaved changes. Leaving now will discard them."}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPositionFormCloseConfirmOpen(false)}>
                            {isZh ? "继续编辑" : "Keep editing"}
                        </Button>
                        <Button variant="destructive" onClick={closePositionFormPage}>
                            {isZh ? "放弃修改并离开" : "Discard and leave"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={positionDeleteConfirmOpen} onOpenChange={setPositionDeleteConfirmOpen}>
                <DialogContent className="rounded-[8px] border-[#EBEEF5] shadow-[0_8px_24px_rgba(14,17,20,0.16)] sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{recruitmentUiText.confirmDeletePosition}</DialogTitle>
                        <DialogDescription>{recruitmentUiText.positionDeleteHint}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPositionDeleteConfirmOpen(false)}>{recruitmentUiText.cancelButton}</Button>
                        <Button variant="destructive" onClick={() => void deletePosition()} disabled={positionDeleting}>
                            {positionDeleting ? recruitmentUiText.deletingPosition : recruitmentUiText.confirmDeletePositionAction}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(candidateDeleteTarget)} onOpenChange={(open) => {
                if (!open && !candidateDeleting) {
                    setCandidateDeleteError(null);
                    setCandidateDeleteTarget(null);
                }
            }}>
                <DialogContent className="gap-0 overflow-hidden rounded-[8px] border-[#EBEEF5] bg-white p-0 text-[#0E1114] shadow-[0_8px_24px_rgba(14,17,20,0.16)] sm:max-w-[480px] dark:border-[#EBEEF5] dark:bg-white dark:text-[#0E1114] [&_[data-slot=dialog-close]]:right-6 [&_[data-slot=dialog-close]]:top-[18px] [&_[data-slot=dialog-close]]:rounded-[4px] [&_[data-slot=dialog-close]]:text-[#86888F] [&_[data-slot=dialog-close]]:opacity-100 [&_[data-slot=dialog-close][data-state=open]]:bg-transparent [&_[data-slot=dialog-close][data-state=open]]:text-[#86888F] [&_[data-slot=dialog-close]]:hover:bg-[#F7F8FA] [&_[data-slot=dialog-close]]:hover:text-[#0E1114]">
                    <DialogHeader className="gap-1 border-b border-[#F2F3F5] px-6 pb-[14px] pr-14 pt-[18px] text-left">
                        <DialogTitle className="text-[16px] font-semibold leading-5 text-[#0E1114]">{recruitmentUiText.confirmDeleteCandidate}</DialogTitle>
                        <DialogDescription className="text-[12px] leading-5 text-[#86888F]">
                            {recruitmentUiText.candidateDeleteHint}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="px-6 py-5">
                        <div className="rounded-[6px] border border-[#EBEEF5] bg-[#F7F8FA] px-4 py-3 text-[12px] leading-5 text-[#33353D] dark:border-[#EBEEF5] dark:bg-[#F7F8FA] dark:text-[#33353D]">
                            <p className="text-[13px] font-medium text-[#0E1114] dark:text-[#0E1114]">{candidateDeleteTarget ? resolveCandidateIdentity(candidateDeleteTarget).displayName : recruitmentUiText.currentCandidate}</p>
                            <p className="mt-1 text-[11px] leading-[18px] text-[#86888F] dark:text-[#86888F]">
                                {recruitmentUiText.candidateDeleteWarning}
                            </p>
                        </div>
                        {candidateDeleteError ? (
                            <p className="mt-3 text-[12px] leading-5 text-[#F53F3F]">{candidateDeleteError}</p>
                        ) : null}
                    </div>
                    <DialogFooter className="h-16 shrink-0 items-center gap-3 border-t border-[#F2F3F5] px-6 sm:justify-end">
                        <Button
                            variant="outline"
                            className="h-[34px] rounded-[6px] border-[#E6E7EB] bg-white px-[18px] text-[13px] font-normal text-[#33353D] shadow-none hover:border-[#1E3BFA] hover:bg-[#F7F8FA] hover:text-[#0F23D9] dark:border-[#E6E7EB] dark:bg-white dark:text-[#33353D] dark:shadow-none dark:hover:border-[#1E3BFA] dark:hover:bg-[#F7F8FA] dark:hover:text-[#0F23D9]"
                            onClick={() => {
                                setCandidateDeleteError(null);
                                setCandidateDeleteTarget(null);
                            }}
                            disabled={candidateDeleting}
                        >
                            {recruitmentUiText.cancelButton}
                        </Button>
                        <Button variant="destructive" className="h-[34px] rounded-[6px] bg-[#F53F3F] px-[18px] text-[13px] font-normal text-white shadow-none hover:bg-[#D9363E] focus-visible:ring-[#F53F3F]/20 dark:bg-[#F53F3F] dark:text-white dark:shadow-none dark:hover:bg-[#D9363E] dark:focus-visible:ring-[#F53F3F]/20" onClick={() => void deleteCandidate()} disabled={candidateDeleting}>
                            {candidateDeleting ? recruitmentUiText.deletingPosition : recruitmentUiText.confirmDeletePositionAction}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(batchDeleteTargetIds)} onOpenChange={(open) => {
                if (!open && !batchDeleting) {
                    setBatchDeleteError(null);
                    setBatchDeleteTargetIds(null);
                }
            }}>
                <DialogContent className="gap-0 overflow-hidden rounded-[8px] border-[#EBEEF5] bg-white p-0 text-[#0E1114] shadow-[0_8px_24px_rgba(14,17,20,0.16)] sm:max-w-[480px] dark:border-[#EBEEF5] dark:bg-white dark:text-[#0E1114] [&_[data-slot=dialog-close]]:right-6 [&_[data-slot=dialog-close]]:top-[18px] [&_[data-slot=dialog-close]]:rounded-[4px] [&_[data-slot=dialog-close]]:text-[#86888F] [&_[data-slot=dialog-close]]:opacity-100 [&_[data-slot=dialog-close][data-state=open]]:bg-transparent [&_[data-slot=dialog-close][data-state=open]]:text-[#86888F] [&_[data-slot=dialog-close]]:hover:bg-[#F7F8FA] [&_[data-slot=dialog-close]]:hover:text-[#0E1114]">
                    <DialogHeader className="border-b border-[#F2F3F5] px-6 pb-[14px] pr-14 pt-[18px] text-left">
                        <DialogTitle className="text-[16px] font-semibold leading-5 text-[#0E1114]">{recruitmentUiText.confirmDeleteCandidates}</DialogTitle>
                    </DialogHeader>
                    <div className="px-6 py-5">
                        <DialogDescription className="rounded-[6px] border border-[#EBEEF5] bg-[#F7F8FA] px-4 py-3 text-[12px] leading-5 text-[#33353D] dark:border-[#EBEEF5] dark:bg-[#F7F8FA] dark:text-[#33353D]">
                            {recruitmentUiText.batchDeleteDescription(batchDeleteTargetIds?.length ?? 0)}
                        </DialogDescription>
                        {batchDeleteError ? (
                            <p className="mt-3 text-[12px] leading-5 text-[#F53F3F]">{batchDeleteError}</p>
                        ) : null}
                    </div>
                    <DialogFooter className="h-16 shrink-0 items-center gap-3 border-t border-[#F2F3F5] px-6 sm:justify-end">
                        <Button
                            variant="outline"
                            className="h-[34px] rounded-[6px] border-[#E6E7EB] bg-white px-[18px] text-[13px] font-normal text-[#33353D] shadow-none hover:border-[#1E3BFA] hover:bg-[#F7F8FA] hover:text-[#0F23D9] dark:border-[#E6E7EB] dark:bg-white dark:text-[#33353D] dark:shadow-none dark:hover:border-[#1E3BFA] dark:hover:bg-[#F7F8FA] dark:hover:text-[#0F23D9]"
                            onClick={() => {
                                setBatchDeleteError(null);
                                setBatchDeleteTargetIds(null);
                            }}
                            disabled={batchDeleting}
                        >
                            {recruitmentUiText.cancelButton}
                        </Button>
                        <Button variant="destructive" className="h-[34px] rounded-[6px] bg-[#F53F3F] px-[18px] text-[13px] font-normal text-white shadow-none hover:bg-[#D9363E] focus-visible:ring-[#F53F3F]/20 dark:bg-[#F53F3F] dark:text-white dark:shadow-none dark:hover:bg-[#D9363E] dark:focus-visible:ring-[#F53F3F]/20" onClick={() => void batchDeleteCandidates()} disabled={batchDeleting}>
                            {batchDeleting ? recruitmentUiText.deletingPosition : recruitmentUiText.confirmDeletePositionAction}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(resumeDeleteTarget)} onOpenChange={(open) => {
                if (!open && !resumeDeleting) {
                    setResumeDeleteTarget(null);
                }
            }}>
                <DialogContent className="gap-0 overflow-hidden rounded-[8px] border-[#EBEEF5] bg-white p-0 text-[#0E1114] shadow-[0_8px_24px_rgba(14,17,20,0.16)] sm:max-w-[480px] dark:border-[#EBEEF5] dark:bg-white dark:text-[#0E1114] [&_[data-slot=dialog-close]]:right-6 [&_[data-slot=dialog-close]]:top-[18px] [&_[data-slot=dialog-close]]:rounded-[4px] [&_[data-slot=dialog-close]]:text-[#86888F] [&_[data-slot=dialog-close]]:opacity-100 [&_[data-slot=dialog-close][data-state=open]]:bg-transparent [&_[data-slot=dialog-close][data-state=open]]:text-[#86888F] [&_[data-slot=dialog-close]]:hover:bg-[#F7F8FA] [&_[data-slot=dialog-close]]:hover:text-[#0E1114]">
                    <DialogHeader className="gap-1 border-b border-[#F2F3F5] px-6 pb-[14px] pr-14 pt-[18px] text-left">
                        <DialogTitle className="text-[16px] font-semibold leading-5 text-[#0E1114]">{recruitmentUiText.confirmDeleteResume}</DialogTitle>
                        <DialogDescription className="text-[12px] leading-5 text-[#86888F]">
                            {recruitmentUiText.resumeDeleteDescription}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="px-6 py-5">
                        <div className="rounded-[6px] border border-[#EBEEF5] bg-[#F7F8FA] px-4 py-3 text-[12px] leading-5 text-[#33353D] dark:border-[#EBEEF5] dark:bg-[#F7F8FA] dark:text-[#33353D]">
                            <p className="text-[13px] font-medium text-[#0E1114] dark:text-[#0E1114]">{resumeDeleteTarget?.original_name || recruitmentUiText.currentResume}</p>
                            <p className="mt-1 text-[11px] leading-[18px] text-[#86888F] dark:text-[#86888F]">{recruitmentUiText.resumeDeleteWarning}</p>
                        </div>
                    </div>
                    <DialogFooter className="h-16 shrink-0 items-center gap-3 border-t border-[#F2F3F5] px-6 sm:justify-end">
                        <Button
                            variant="outline"
                            className="h-[34px] rounded-[6px] border-[#E6E7EB] bg-white px-[18px] text-[13px] font-normal text-[#33353D] shadow-none hover:border-[#1E3BFA] hover:bg-[#F7F8FA] hover:text-[#0F23D9] dark:border-[#E6E7EB] dark:bg-white dark:text-[#33353D] dark:shadow-none dark:hover:border-[#1E3BFA] dark:hover:bg-[#F7F8FA] dark:hover:text-[#0F23D9]"
                            onClick={() => setResumeDeleteTarget(null)}
                            disabled={resumeDeleting}
                        >
                            {recruitmentUiText.cancelButton}
                        </Button>
                        <Button variant="destructive" className="h-[34px] rounded-[6px] bg-[#F53F3F] px-[18px] text-[13px] font-normal text-white shadow-none hover:bg-[#D9363E] focus-visible:ring-[#F53F3F]/20 dark:bg-[#F53F3F] dark:text-white dark:shadow-none dark:hover:bg-[#D9363E] dark:focus-visible:ring-[#F53F3F]/20" onClick={() => void deleteResumeFile()} disabled={resumeDeleting}>
                            {resumeDeleting ? recruitmentUiText.deletingPosition : recruitmentUiText.confirmDeletePositionAction}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <SettingsDeleteDialog
                open={Boolean(llmDeleteTarget)}
                title={recruitmentUiText.llmDeleteTitle}
                description={recruitmentUiText.llmDeleteDescription}
                cancelText={recruitmentUiText.cancel}
                confirmText={deleteActionKey === `llm-${llmDeleteTarget?.id}` ? recruitmentUiText.deleting : recruitmentUiText.confirmDelete}
                busy={deleteActionKey === `llm-${llmDeleteTarget?.id}`}
                onCancel={() => setLlmDeleteTarget(null)}
                onConfirm={() => llmDeleteTarget && void deleteLLMConfig(llmDeleteTarget.id)}
            />

            <SettingsDeleteDialog
                open={Boolean(skillDeleteTarget)}
                title={recruitmentUiText.skillDeleteTitle}
                description={recruitmentUiText.skillDeleteDescription}
                cancelText={recruitmentUiText.cancel}
                confirmText={deleteActionKey === `skill-${skillDeleteTarget?.id}` ? recruitmentUiText.deleting : recruitmentUiText.confirmDelete}
                busy={deleteActionKey === `skill-${skillDeleteTarget?.id}`}
                onCancel={() => setSkillDeleteTarget(null)}
                onConfirm={() => skillDeleteTarget && void deleteSkill(skillDeleteTarget.id)}
            />

            <SettingsDeleteDialog
                open={Boolean(mailSenderDeleteTarget)}
                title={recruitmentUiText.confirmDeleteMailSender}
                description={recruitmentUiText.mailSenderDeleteDescription}
                cancelText={recruitmentUiText.cancelButton}
                confirmText={deleteActionKey === `mail-sender-${mailSenderDeleteTarget?.id}` ? recruitmentUiText.deletingPosition : recruitmentUiText.confirmDeletePositionAction}
                busy={deleteActionKey === `mail-sender-${mailSenderDeleteTarget?.id}`}
                onCancel={() => setMailSenderDeleteTarget(null)}
                onConfirm={() => mailSenderDeleteTarget && void deleteMailSender(mailSenderDeleteTarget.id)}
            />

            <SettingsDeleteDialog
                open={Boolean(mailRecipientDeleteTarget)}
                title={recruitmentUiText.confirmDeleteMailRecipient}
                description={recruitmentUiText.mailRecipientDeleteDescription}
                cancelText={recruitmentUiText.cancelButton}
                confirmText={deleteActionKey === `mail-recipient-${mailRecipientDeleteTarget?.id}` ? recruitmentUiText.deletingPosition : recruitmentUiText.confirmDeletePositionAction}
                busy={deleteActionKey === `mail-recipient-${mailRecipientDeleteTarget?.id}`}
                onCancel={() => setMailRecipientDeleteTarget(null)}
                onConfirm={() => mailRecipientDeleteTarget && void deleteMailRecipient(mailRecipientDeleteTarget.id)}
            />

            <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
                <DialogContent className={cn(settingsDialogSurfaceClass, "sm:max-w-[480px]")}>
                    <DialogHeader className={settingsDialogHeaderClass}>
                        <DialogTitle className="text-[16px] font-semibold leading-5 text-[#0E1114]">{recruitmentUiText.createPublishTask}</DialogTitle>
                        <DialogDescription className="text-[12px] leading-5 text-[#86888F]">{recruitmentUiText.publishTaskDesc}</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 px-6 py-5">
                        <Field className="space-y-1.5 [&>p:first-child]:text-[12px] [&>p:first-child]:font-normal [&>p:first-child]:text-[#33353D]" label={recruitmentUiText.targetPlatform}>
                            <NativeSelect className={settingsInputClass} value={publishPlatform} onChange={(event) => setPublishPlatform(event.target.value)}>
                                <option value="boss">{recruitmentUiText.bossDirect}</option>
                                <option value="zhilian">{recruitmentUiText.zhilian}</option>
                            </NativeSelect>
                        </Field>
                        <Field className="space-y-1.5 [&>p:first-child]:text-[12px] [&>p:first-child]:font-normal [&>p:first-child]:text-[#33353D]" label={recruitmentUiText.executionMode}>
                            <div className="rounded-[6px] bg-[#F7F8FA] px-3 py-2.5 text-[12px] leading-5 text-[#33353D]">
                                {isZh ? "发布预演（不提交到招聘平台）" : "Publishing preview (no platform submission)"}
                            </div>
                        </Field>
                    </div>
                    <DialogFooter className={settingsDialogFooterClass}>
                        <Button variant="outline" className={settingsSecondaryButtonClass} onClick={() => setPublishDialogOpen(false)}>{recruitmentUiText.cancel}</Button>
                        <Button className={settingsPrimaryButtonClass} onClick={() => void submitPublishTask()} disabled={publishSubmitting}>
                            {publishSubmitting ? recruitmentUiText.publishing : recruitmentUiText.createTask}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={skillDialogOpen} onOpenChange={(open) => {
                if (open) {
                    setSkillDialogOpen(true);
                    return;
                }
                requestCloseSkillDialog();
            }}>
                <DialogContent className={cn(settingsDialogSurfaceClass, "flex h-[min(88vh,840px)] max-h-[88vh] flex-col sm:max-w-[900px]")}>
                    <DialogHeader className={settingsDialogHeaderClass}>
                        <DialogTitle className="text-[16px] font-semibold leading-5 text-[#0E1114]">
                            {skillEditingId
                                ? `${recruitmentUiText.skillEditTitle}${skillMap.get(skillEditingId)?.name ? ` · ${skillMap.get(skillEditingId)?.name}` : ""}`
                                : `${recruitmentUiText.skillCreateTitle}${skillDialogBindingTaskKind ? ` · ${skillDialogBindingTaskKind === "screening" ? (isZh ? "初筛" : "Screening") : skillDialogBindingTaskKind === "jd" ? (isZh ? "JD 生成" : "JD") : (isZh ? "面试题" : "Interview")}` : ""}`}
                        </DialogTitle>
                        <DialogDescription className="text-[12px] leading-5 text-[#86888F]">
                            {isAssessmentDraftSkillCreation
                                ? (isZh ? "创建可复用的评估方案，保存后返回当前岗位完成绑定。" : "Create a reusable assessment plan, then return to this position to confirm binding.")
                                : skillDialogMode === "structured"
                                    ? (isZh ? "方案将注入到对应 AI 任务的提示词中；结构化编辑、高级模式与 AI 生成可随时切换" : "This plan is injected into the corresponding AI task. Switch freely between structured, advanced, and AI modes.")
                                    : (isZh ? "方案将注入到对应 AI 任务的提示词中；请按当前业务字段维护方案内容" : "This plan is injected into the corresponding AI task. Maintain it using the fields below.")}
                        </DialogDescription>
                    </DialogHeader>
                    {skillDialogMode === "structured" ? (
                        <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
                            <StructuredSkillEditor
                                initialData={skillEditorData}
                                editingSkillId={skillEditingId}
                                onSubmit={submitStructuredSkill}
                                onCancel={requestCloseSkillDialog}
                                submitting={skillSubmitting}
                                submitError={skillFormSubmitError}
                                onGenerateAI={generateSkillWithAI}
                                onStopGeneration={stopSkillGeneration}
                                aiGenerating={skillGenerating}
                                defaultTab={skillEditorDefaultTab}
                                positionId={skillEditorPositionId}
                                positionJdContent={skillEditorPositionId ? (positionDetail?.current_jd_version?.jd_markdown || null) : null}
                                onGeneratedDirtyChange={setSkillGeneratedDraftUnsaved}
                                bindingControl={isAssessmentDraftSkillCreation ? (
                                    <div className="rounded-[6px] bg-[rgba(30,59,250,0.05)] px-3 py-2.5 text-[12px] leading-5 text-[#33353D]">
                                        {isZh
                                            ? `待绑定到「${positionDetail?.position.title || "当前岗位"}」，保存方案后回到评估配置弹窗确认绑定。`
                                            : `Pending for ${positionDetail?.position.title || "current position"}. Save this plan, then confirm binding in the assessment dialog.`}
                                    </div>
                                ) : (
                                    <div className="w-full space-y-1.5 md:max-w-[calc(50%-8px)]">
                                        <span className="block text-[12px] font-normal text-[#33353D]">{isZh ? "关联岗位" : "Bound Position"}</span>
                                        <NativeSelect
                                            className={settingsInputClass}
                                            value={skillBoundPositionId}
                                            onChange={(event) => {
                                                setSkillBoundPositionId(event.target.value);
                                                setSkillEditorPositionId(event.target.value ? Number(event.target.value) : null);
                                            }}
                                        >
                                            <option value="">{isZh ? "通用方案（未绑定岗位）" : "Generic Plan (Unbound)"}</option>
                                            {bindablePositionsForSkillDialog.map((position) => (
                                                <option key={`structured-skill-bound-position-${position.id}`} value={position.id}>
                                                    {position.title}
                                                </option>
                                            ))}
                                        </NativeSelect>
                                    </div>
                                )}
                            />
                        </div>
                    ) : (
                        <>
                            <div className="flex h-[53px] shrink-0 items-center gap-2 border-b border-[#F2F3F5] px-6 py-3">
                                <button type="button" disabled title={isZh ? "该类型使用高级模式维护" : "This type is maintained in advanced mode"} className="h-8 rounded-[6px] border border-[#E6E7EB] bg-white px-4 text-[12px] font-normal text-[#B0B2B8]">
                                    {isZh ? "结构化编辑" : "Structured Edit"}
                                </button>
                                <button type="button" className="h-8 rounded-[6px] border border-[#1E3BFA] bg-[#1E3BFA] px-4 text-[12px] font-normal text-white">
                                    {isZh ? "高级模式" : "Advanced"}
                                </button>
                                <button type="button" disabled title={isZh ? "该类型暂不支持 AI 结构化生成" : "AI structured generation is not available for this type"} className="h-8 rounded-[6px] border border-[#E6E7EB] bg-white px-4 text-[12px] font-normal text-[#B0B2B8]">
                                    {isZh ? "AI 生成" : "AI Generate"}
                                </button>
                            </div>
                            <ScrollArea className="min-h-0 flex-1">
                                <div className="grid gap-4 px-6 py-5 text-[12px]">
                                    <Field className="space-y-1.5 [&>p:first-child]:text-[12px] [&>p:first-child]:font-normal [&>p:first-child]:text-[#33353D]" label={isZh ? "方案标题" : "Plan Title"} required error={skillFormErrors.name}>
                                        <Input
                                            ref={skillNameInputRef}
                                            value={skillForm.name}
                                            maxLength={120}
                                            aria-invalid={Boolean(skillFormErrors.name)}
                                            className={cn(settingsInputClass, skillFormErrors.name ? "border-rose-500 focus-visible:ring-rose-500/20" : "")}
                                            onChange={(event) => setSkillForm((current) => ({...current, name: event.target.value.slice(0, 120)}))}
                                        />
                                    </Field>
                                    {isAssessmentDraftSkillCreation ? (
                                        <div className="rounded-[8px] border border-[#EBEEF5] bg-[#F7F8FA] px-3 py-2 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
                                            {isZh
                                                ? `待绑定到「${positionDetail?.position.title || "当前岗位"}」，保存方案后回到评估配置弹窗确认绑定。`
                                                : `Pending for ${positionDetail?.position.title || "current position"}. Save this plan, then confirm binding in the assessment dialog.`}
                                        </div>
                                    ) : (
                                        <Field className="space-y-1.5 [&>p:first-child]:text-[12px] [&>p:first-child]:font-normal [&>p:first-child]:text-[#33353D]" label={isZh ? "关联岗位" : "Bound Position"}>
                                            <NativeSelect
                                                value={skillBoundPositionId}
                                                onChange={(event) => {
                                                    setSkillBoundPositionId(event.target.value);
                                                    setSkillEditorPositionId(event.target.value ? Number(event.target.value) : null);
                                                }}
                                            >
                                                <option value="">{isZh ? "通用方案（未绑定岗位）" : "Generic Plan (Unbound)"}</option>
                                                {bindablePositionsForSkillDialog.map((position) => (
                                                    <option key={`skill-bound-position-${position.id}`} value={position.id}>
                                                        {position.title}
                                                    </option>
                                                ))}
                                            </NativeSelect>
                                        </Field>
                                    )}
                                    <div className="space-y-2">
                                        <span className="text-[12px] font-normal text-[#33353D]">{isZh ? "适用场景" : "Applies To"}</span>
                                        <div className="flex flex-wrap gap-2">
                                            {([["jd", recruitmentUiText.jdSkillLabel], ["interview", recruitmentUiText.interviewSkillLabel]] as const).map(([taskType, label]) => (
                                                <button
                                                    key={`basic-skill-task-${taskType}`}
                                                    type="button"
                                                    className={cn(
                                                        "rounded-[6px] border px-3 py-1.5 text-xs transition",
                                                        skillForm.taskTypes.includes(taskType)
                                                            ? "border-[#1E3BFA] bg-[#1E3BFA] text-white hover:bg-[#0F23D9]"
                                                            : "border-[#E6E7EB] bg-white text-[#33353D] hover:border-[#D6D8DD] hover:bg-[#F7F8FA] dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300",
                                                    )}
                                                    onClick={() => setSkillForm((current) => ({...current, taskTypes: [taskType]}))}
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <Field className="space-y-1.5 [&>p:first-child]:text-[12px] [&>p:first-child]:font-normal [&>p:first-child]:text-[#33353D]" label={isZh ? "方案内容" : "Plan Content"} required error={skillFormErrors.content}>
                                        <Textarea
                                            ref={skillContentInputRef}
                                            value={skillForm.content}
                                            rows={10}
                                            aria-invalid={Boolean(skillFormErrors.content)}
                                            className={cn(settingsTextareaClass, skillFormErrors.content ? "border-rose-500 focus-visible:ring-rose-500/20" : "")}
                                            onChange={(event) => setSkillForm((current) => ({...current, content: event.target.value}))}
                                        />
                                    </Field>
                                    <Field className="space-y-1.5 [&>p:first-child]:text-[12px] [&>p:first-child]:font-normal [&>p:first-child]:text-[#33353D]" label={isZh ? "附加条件" : "Additional Conditions"}>
                                        <Textarea
                                            className={settingsTextareaClass}
                                            value={skillExtraConditions}
                                            rows={4}
                                            placeholder={isZh ? "例如：输出语气、补充限制、必须强调的判断标准" : "Optional constraints, tone, or extra criteria"}
                                            onChange={(event) => setSkillExtraConditions(event.target.value)}
                                        />
                                    </Field>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <Field className="space-y-1.5 [&>p:first-child]:text-[12px] [&>p:first-child]:font-normal [&>p:first-child]:text-[#33353D]" label={isZh ? "标签" : "Tags"}>
                                            <Input
                                                className={settingsInputClass}
                                                value={skillForm.tagsText}
                                                onChange={(event) => setSkillForm((current) => ({...current, tagsText: event.target.value}))}
                                            />
                                        </Field>
                                        <Field className="space-y-1.5 [&>p:first-child]:text-[12px] [&>p:first-child]:font-normal [&>p:first-child]:text-[#33353D]" label={recruitmentUiText.sortLabel} error={skillFormErrors.sortOrder}>
                                            <Input
                                                type="number"
                                                value={skillForm.sortOrder}
                                                aria-invalid={Boolean(skillFormErrors.sortOrder)}
                                                className={cn(settingsInputClass, skillFormErrors.sortOrder ? "border-rose-500 focus-visible:ring-rose-500/20" : "")}
                                                onChange={(event) => setSkillForm((current) => ({...current, sortOrder: event.target.value}))}
                                            />
                                        </Field>
                                    </div>
                                    <label className="flex items-center gap-2 text-[12px] text-[#33353D]">
                                        <input
                                            type="checkbox"
                                            checked={skillForm.isEnabled}
                                            onChange={(event) => setSkillForm((current) => ({...current, isEnabled: event.target.checked}))}
                                        />
                                        <span>{isZh ? "启用" : "Enabled"}</span>
                                    </label>
                                </div>
                            </ScrollArea>
                            {skillFormSubmitError ? (
                                <div className="mx-6 mt-2 rounded-[4px] bg-[rgba(245,63,63,0.08)] px-3 py-2 text-[12px] text-[#F53F3F]">
                                    {skillFormSubmitError}
                                </div>
                            ) : null}
                            <DialogFooter className={cn(settingsDialogFooterClass, "sm:justify-start")}>
                                <span className="mr-auto text-[12px] text-[#86888F]">{isZh ? "保存后立即对绑定该方案的岗位生效" : "Changes apply immediately to positions bound to this plan."}</span>
                                <Button variant="outline" className={settingsSecondaryButtonClass} onClick={requestCloseSkillDialog} disabled={skillSubmitting}>
                                    {recruitmentUiText.cancel}
                                </Button>
                                <Button className={settingsPrimaryButtonClass} onClick={() => void submitSkill()} disabled={skillSubmitting}>
                                    {skillSubmitting ? recruitmentUiText.saving : (isZh ? "保存方案" : "Save plan")}
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={skillUnsavedCloseConfirmOpen} onOpenChange={setSkillUnsavedCloseConfirmOpen}>
                <DialogContent className={cn(settingsDialogSurfaceClass, "sm:max-w-[480px]")}>
                    <DialogHeader className={settingsDialogHeaderClass}>
                        <DialogTitle className="text-[16px] font-semibold leading-5 text-[#0E1114]">{isZh ? "这次生成的评估方案还没有保存" : "This generated assessment plan has not been saved"}</DialogTitle>
                        <DialogDescription className="pt-1 text-[12px] leading-5 text-[#86888F]">
                            {isZh
                                ? "关闭后，本次 AI 生成并代入编辑区的内容会被放弃，不会创建评估方案。你可以继续检查并点击「创建」，也可以确认不保存直接关闭。"
                                : "If you close now, the AI-generated content applied to the editor will be discarded and no assessment plan will be created. You can keep editing and click Create, or close without saving."}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className={settingsDialogFooterClass}>
                        <Button variant="outline" className={settingsSecondaryButtonClass} onClick={() => setSkillUnsavedCloseConfirmOpen(false)}>
                            {isZh ? "继续编辑" : "Keep Editing"}
                        </Button>
                        <Button variant="destructive" className={settingsDangerButtonClass} onClick={discardGeneratedSkillDraftAndClose}>
                            {isZh ? "不保存，关闭" : "Close Without Saving"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={llmDialogOpen} onOpenChange={(open) => {
                setLlmDialogOpen(open);
                if (!open) {
                    setLlmFormErrors({});
                    setLlmFormSubmitError(null);
                    setLlmSubmitting(false);
                }
            }}>
                <DialogContent className={cn(settingsDialogSurfaceClass, "flex max-h-[88vh] flex-col sm:max-w-[760px]")}>
                    <DialogHeader className={settingsDialogHeaderClass}>
                        <DialogTitle className="text-[16px] font-semibold leading-5 text-[#0E1114]">{llmEditingId ? recruitmentUiText.modelConfigEditTitle : recruitmentUiText.modelConfigCreateTitle}</DialogTitle>
                        <DialogDescription className="text-[12px] leading-5 text-[#86888F]">{recruitmentUiText.modelDialogDescription}</DialogDescription>
                    </DialogHeader>
                    <ScrollArea className="min-h-0 flex-1">
                        <div className="grid gap-4 px-6 py-5 md:grid-cols-2">
                            <Field label={recruitmentUiText.configKeyLabel} required error={llmFormErrors.configKey}>
                                <Input
                                    ref={llmConfigKeyInputRef}
                                    value={llmForm.configKey}
                                    maxLength={120}
                                    aria-invalid={Boolean(llmFormErrors.configKey)}
                                    className={cn(settingsInputClass, llmFormErrors.configKey ? "border-rose-500 focus-visible:ring-rose-500/20" : "")}
                                    onChange={(event) => updateLLMFormField("configKey", event.target.value.slice(0, 120))}
                                />
                            </Field>
                            <Field label={recruitmentUiText.taskTypeLabel} required error={llmFormErrors.taskType}>
                                <Input
                                    ref={llmTaskTypeInputRef}
                                    value={llmForm.taskType}
                                    maxLength={80}
                                    aria-invalid={Boolean(llmFormErrors.taskType)}
                                    className={cn(settingsInputClass, llmFormErrors.taskType ? "border-rose-500 focus-visible:ring-rose-500/20" : "")}
                                    onChange={(event) => updateLLMFormField("taskType", event.target.value.slice(0, 80))}
                                />
                            </Field>
                            <Field label={recruitmentUiText.providerLabel} required error={llmFormErrors.provider}>
                                <NativeSelect
                                    value={llmForm.provider}
                                    aria-invalid={Boolean(llmFormErrors.provider)}
                                    className={cn(settingsInputClass, llmFormErrors.provider ? "border-rose-500 focus-visible:ring-rose-500/20" : "")}
                                    onChange={(event) => updateLLMFormField("provider", event.target.value)}
                                >
                                    {Object.entries(providerLabels).map(([value, label]) => (
                                        <option key={value} value={value}>{label}</option>
                                    ))}
                                </NativeSelect>
                            </Field>
                            <Field label={recruitmentUiText.modelNameLabel} required error={llmFormErrors.modelName}>
                                <Input
                                    ref={llmModelNameInputRef}
                                    value={llmForm.modelName}
                                    maxLength={120}
                                    aria-invalid={Boolean(llmFormErrors.modelName)}
                                    className={cn(settingsInputClass, llmFormErrors.modelName ? "border-rose-500 focus-visible:ring-rose-500/20" : "")}
                                    onChange={(event) => updateLLMFormField("modelName", event.target.value.slice(0, 120))}
                                />
                                <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                                    {recruitmentUiText.modelNameHint}
                                </p>
                            </Field>
                            <Field label={recruitmentUiText.baseUrlLabel}>
                                <Input className={settingsInputClass} value={llmForm.baseUrl}
                                       onChange={(event) => updateLLMFormField("baseUrl", event.target.value)}/>
                            </Field>
                            <Field label={recruitmentUiText.apiKeyEnvLabel}>
                                <Input
                                    className={settingsInputClass}
                                    value={llmForm.apiKeyEnv}
                                    onChange={(event) => updateLLMFormField("apiKeyEnv", event.target.value)}
                                    placeholder={recruitmentUiText.apiKeyEnvPlaceholder}
                                />
                            </Field>
                            <Field label={recruitmentUiText.apiKeyValueLabel}>
                                <Input
                                    className={settingsInputClass}
                                    value={llmForm.apiKeyValue}
                                    onChange={(event) => updateLLMFormField("apiKeyValue", event.target.value)}
                                    placeholder={recruitmentUiText.apiKeyValuePlaceholder}
                                />
                            </Field>
                            <Field label={recruitmentUiText.maxConcurrentLabel} error={llmFormErrors.maxConcurrent}>
                                <Input
                                    type="number"
                                    min={1}
                                    max={100}
                                    value={llmForm.maxConcurrent}
                                    aria-invalid={Boolean(llmFormErrors.maxConcurrent)}
                                    className={cn(settingsInputClass, llmFormErrors.maxConcurrent ? "border-rose-500 focus-visible:ring-rose-500/20" : "")}
                                    onChange={(event) => updateLLMFormField("maxConcurrent", event.target.value)}
                                />
                                <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                                    {recruitmentUiText.maxConcurrentHint}
                                </p>
                            </Field>
                            <Field label={recruitmentUiText.maxQpsLabel} error={llmFormErrors.maxQps}>
                                <Input
                                    type="number"
                                    min={0}
                                    max={1000}
                                    value={llmForm.maxQps}
                                    aria-invalid={Boolean(llmFormErrors.maxQps)}
                                    className={cn(settingsInputClass, llmFormErrors.maxQps ? "border-rose-500 focus-visible:ring-rose-500/20" : "")}
                                    onChange={(event) => updateLLMFormField("maxQps", event.target.value)}
                                />
                                <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                                    {recruitmentUiText.maxQpsHint}
                                </p>
                            </Field>
                            <Field label={recruitmentUiText.priorityLabel} error={llmFormErrors.priority}>
                                <Input
                                    type="number"
                                    value={llmForm.priority}
                                    aria-invalid={Boolean(llmFormErrors.priority)}
                                    className={cn(settingsInputClass, llmFormErrors.priority ? "border-rose-500 focus-visible:ring-rose-500/20" : "")}
                                    onChange={(event) => updateLLMFormField("priority", event.target.value)}
                                />
                            </Field>
                        </div>
                        <Field label={recruitmentUiText.extraConfigLabel} error={llmFormErrors.extraConfigText} className="px-6 pb-4">
                            <Textarea
                                ref={llmExtraConfigInputRef}
                                value={llmForm.extraConfigText}
                                aria-invalid={Boolean(llmFormErrors.extraConfigText)}
                                className={cn(settingsTextareaClass, llmFormErrors.extraConfigText ? "border-rose-500 focus-visible:ring-rose-500/20" : "")}
                                onChange={(event) => updateLLMFormField("extraConfigText", event.target.value)}
                                rows={10}
                            />
                        </Field>
                        <label className="flex items-center gap-2 px-6 pb-5 text-[12px] text-[#33353D]">
                            <input type="checkbox" className="h-4 w-4 accent-[#1E3BFA]" checked={llmForm.isActive}
                                   onChange={(event) => updateLLMFormField("isActive", event.target.checked)}/>
                            {recruitmentUiText.saveAndEnableLabel}
                        </label>
                    </ScrollArea>
                    <DialogFooter className={cn(settingsDialogFooterClass, "sm:justify-between")}>
                        <div className="min-h-5 flex-1 text-left text-[12px] text-[#F53F3F]">
                            {llmFormSubmitError ?? ""}
                        </div>
                        <Button variant="outline" className={settingsSecondaryButtonClass} onClick={() => setLlmDialogOpen(false)}
                                disabled={llmSubmitting}>{recruitmentUiText.cancel}</Button>
                        <Button className={settingsPrimaryButtonClass} onClick={() => void submitLLMConfig()}
                                disabled={llmSubmitting}>{llmSubmitting ? recruitmentUiText.saving : recruitmentUiText.saveModelConfig}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={mailSenderDialogOpen} onOpenChange={setMailSenderDialogOpen}>
                <DialogContent className={cn(settingsDialogSurfaceClass, "flex max-h-[88vh] flex-col sm:max-w-[720px]")}>
                    <DialogHeader className={settingsDialogHeaderClass}>
                        <DialogTitle className="text-[16px] font-semibold leading-5 text-[#0E1114]">{mailSenderEditingId ? recruitmentUiText.editMailSender : recruitmentUiText.newMailSender}</DialogTitle>
                        <DialogDescription className="text-[12px] leading-5 text-[#86888F]">{recruitmentUiText.mailSenderDescription}</DialogDescription>
                    </DialogHeader>
                    <ScrollArea className="min-h-0 flex-1">
                        <div className="grid gap-4 px-6 py-5 md:grid-cols-2">
                            <Field label={recruitmentUiText.mailSenderName} required><Input className={settingsInputClass} value={mailSenderForm.name}
                                                       onChange={(event) => setMailSenderForm((current) => ({
                                                           ...current,
                                                           name: event.target.value
                                                       }))}/></Field>
                            <Field label={recruitmentUiText.mailSenderFromName}><Input className={settingsInputClass} value={mailSenderForm.fromName}
                                                             onChange={(event) => setMailSenderForm((current) => ({
                                                                 ...current,
                                                                 fromName: event.target.value
                                                             }))} placeholder={recruitmentUiText.mailSenderFromNamePlaceholder}/></Field>
                            <Field label={recruitmentUiText.mailSenderEmail} required><Input className={settingsInputClass} value={mailSenderForm.fromEmail}
                                                           onChange={(event) => setMailSenderForm((current) => ({
                                                               ...current,
                                                               fromEmail: event.target.value
                                                           }))} placeholder={recruitmentUiText.mailSenderEmailPlaceholder}/></Field>
                            <Field label={recruitmentUiText.mailSenderUsername}><Input className={settingsInputClass} value={mailSenderForm.username}
                                                           onChange={(event) => setMailSenderForm((current) => ({
                                                               ...current,
                                                               username: event.target.value
                                                           }))}/></Field>
                            <Field label={recruitmentUiText.smtpHost}><Input className={settingsInputClass} value={mailSenderForm.smtpHost}
                                                            onChange={(event) => setMailSenderForm((current) => ({
                                                                ...current,
                                                                smtpHost: event.target.value
                                                            }))} placeholder={recruitmentUiText.smtpHostPlaceholder}/></Field>
                            <Field label={recruitmentUiText.smtpPort}><Input className={settingsInputClass} type="number" value={mailSenderForm.smtpPort}
                                                            onChange={(event) => setMailSenderForm((current) => ({
                                                                ...current,
                                                                smtpPort: event.target.value
                                                            }))}/></Field>
                            <div className="flex flex-wrap gap-2 md:col-span-2">
                                {mailSenderPresets.map((preset) => (
                                    <Button key={preset.key} type="button" size="sm" variant="outline" className="h-7 rounded-[4px] border-[#E6E7EB] px-3 text-[11px] text-[#0F23D9] shadow-none hover:border-[#1E3BFA] hover:bg-[#F7F8FA]"
                                            onClick={() => applyMailSenderPreset(preset.key)}>
                                        {preset.label}
                                    </Button>
                                ))}
                                <p className="self-center text-xs text-slate-500 dark:text-slate-400">{recruitmentUiText.smtpHostAutoHint}</p>
                            </div>
                            <Field label={mailSenderEditingId ? recruitmentUiText.mailSenderPasswordEdit : recruitmentUiText.mailSenderPassword} required={!mailSenderEditingId}>
                                <Input className={settingsInputClass} type="password" value={mailSenderForm.password}
                                       onChange={(event) => setMailSenderForm((current) => ({
                                           ...current,
                                           password: event.target.value
                                       }))}/>
                            </Field>
                            <div className="grid gap-3 md:col-span-2 md:grid-cols-2">
                            <label className="flex items-center gap-2 text-[12px] text-[#33353D]">
                                <input type="checkbox" className="h-4 w-4 accent-[#1E3BFA]" checked={mailSenderForm.useSsl}
                                       onChange={(event) => setMailSenderForm((current) => ({
                                           ...current,
                                           useSsl: event.target.checked
                                       }))}/>
                                {recruitmentUiText.useSSL}
                            </label>
                            <label className="flex items-center gap-2 text-[12px] text-[#33353D]">
                                <input type="checkbox" className="h-4 w-4 accent-[#1E3BFA]" checked={mailSenderForm.useStarttls}
                                       onChange={(event) => setMailSenderForm((current) => ({
                                           ...current,
                                           useStarttls: event.target.checked
                                       }))}/>
                                {recruitmentUiText.useSTARTTLS}
                            </label>
                            <label className="flex items-center gap-2 text-[12px] text-[#33353D]">
                                <input type="checkbox" className="h-4 w-4 accent-[#1E3BFA]" checked={mailSenderForm.isDefault}
                                       onChange={(event) => setMailSenderForm((current) => ({
                                           ...current,
                                           isDefault: event.target.checked
                                       }))}/>
                                {recruitmentUiText.setAsDefaultSender}
                            </label>
                            <label className="flex items-center gap-2 text-[12px] text-[#33353D]">
                                <input type="checkbox" className="h-4 w-4 accent-[#1E3BFA]" checked={mailSenderForm.isEnabled}
                                       onChange={(event) => setMailSenderForm((current) => ({
                                           ...current,
                                           isEnabled: event.target.checked
                                       }))}/>
                                {recruitmentUiText.enableSender}
                            </label>
                            </div>
                        </div>
                    </ScrollArea>
                    <DialogFooter className={settingsDialogFooterClass}>
                        <Button variant="outline" className={settingsSecondaryButtonClass} onClick={() => setMailSenderDialogOpen(false)}>{recruitmentUiText.cancelButton}</Button>
                        <Button className={settingsPrimaryButtonClass} onClick={() => void submitMailSender()} disabled={mailSenderSaving}>{mailSenderSaving ? recruitmentUiText.saving : recruitmentUiText.saveMailSender}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={mailRecipientDialogOpen} onOpenChange={setMailRecipientDialogOpen}>
                <DialogContent className={cn(settingsDialogSurfaceClass, "flex max-h-[88vh] flex-col sm:max-w-[640px]")}>
                    <DialogHeader className={settingsDialogHeaderClass}>
                        <DialogTitle className="text-[16px] font-semibold leading-5 text-[#0E1114]">{mailRecipientEditingId ? recruitmentUiText.editMailRecipient : recruitmentUiText.newMailRecipient}</DialogTitle>
                        <DialogDescription className="text-[12px] leading-5 text-[#86888F]">{recruitmentUiText.mailRecipientDescription}</DialogDescription>
                    </DialogHeader>
                    <ScrollArea className="min-h-0 flex-1">
                        <div className="space-y-4 px-6 py-5">
                            <div className="grid gap-4 md:grid-cols-2">
                                <Field label={recruitmentUiText.recipientName} required><Input className={settingsInputClass} value={mailRecipientForm.name}
                                                           onChange={(event) => setMailRecipientForm((current) => ({
                                                               ...current,
                                                               name: event.target.value
                                                           }))}/></Field>
                                <Field label={recruitmentUiText.recipientEmail} required><Input className={settingsInputClass} value={mailRecipientForm.email}
                                                           onChange={(event) => setMailRecipientForm((current) => ({
                                                               ...current,
                                                               email: event.target.value
                                                           }))} placeholder="name@example.com"/></Field>
                                <Field label={recruitmentUiText.recipientDepartment}><Input className={settingsInputClass} value={mailRecipientForm.department}
                                                           onChange={(event) => setMailRecipientForm((current) => ({
                                                               ...current,
                                                               department: event.target.value
                                                           }))}/></Field>
                                <Field label={recruitmentUiText.recipientRoleTitle}><Input className={settingsInputClass} value={mailRecipientForm.roleTitle}
                                                           onChange={(event) => setMailRecipientForm((current) => ({
                                                               ...current,
                                                               roleTitle: event.target.value
                                                           }))}/></Field>
                            </div>
                            <Field label={recruitmentUiText.recipientTags}>
                                <Input className={settingsInputClass} value={mailRecipientForm.tagsText}
                                       onChange={(event) => setMailRecipientForm((current) => ({
                                           ...current,
                                           tagsText: event.target.value
                                       }))} placeholder={recruitmentUiText.recipientTagsPlaceholder}/>
                            </Field>
                            <Field label={recruitmentUiText.recipientNotes}>
                                <Textarea className={cn(settingsTextareaClass, "resize-y")} value={mailRecipientForm.notes}
                                          onChange={(event) => setMailRecipientForm((current) => ({
                                              ...current,
                                              notes: event.target.value
                                          }))} rows={4}/>
                            </Field>
                            <label className="flex items-center gap-2 text-[12px] text-[#33353D]">
                                <input type="checkbox" className="h-4 w-4 accent-[#1E3BFA]" checked={mailRecipientForm.isEnabled}
                                       onChange={(event) => setMailRecipientForm((current) => ({
                                           ...current,
                                           isEnabled: event.target.checked
                                       }))}/>
                                {recruitmentUiText.enableRecipient}
                            </label>
                        </div>
                    </ScrollArea>
                    <DialogFooter className={settingsDialogFooterClass}>
                        <Button variant="outline" className={settingsSecondaryButtonClass} onClick={() => setMailRecipientDialogOpen(false)}>{recruitmentUiText.cancelButton}</Button>
                        <Button className={settingsPrimaryButtonClass} onClick={() => void submitMailRecipient()} disabled={mailRecipientSaving}>{mailRecipientSaving ? recruitmentUiText.saving : recruitmentUiText.saveMailRecipient}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={resumeMailDialogOpen}
                onOpenChange={(open) => {
                    setResumeMailDialogOpen(open);
                    if (!open) {
                        if (resumeMailSourceAssistantMessageId) {
                            setAssistantMailActionState((current) => {
                                const currentState = current[resumeMailSourceAssistantMessageId];
                                if (!currentState?.editing) {
                                    return current;
                                }
                                return {
                                    ...current,
                                    [resumeMailSourceAssistantMessageId]: {
                                        ...currentState,
                                        editing: false,
                                    },
                                };
                            });
                        }
                        setResumeMailDialogMode("send");
                        setResumeMailSourceDispatchId(null);
                        setResumeMailSourceAssistantMessageId(null);
                        setResumeMailError(null);
                    }
                }}
            >
                <DialogContent className="flex max-h-[86vh] flex-col gap-0 overflow-hidden rounded-[8px] border-[#EBEEF5] bg-white p-0 text-[#0E1114] shadow-[0_8px_24px_rgba(14,17,20,0.16)] sm:max-w-[840px] dark:border-[#EBEEF5] dark:bg-white dark:text-[#0E1114] [&_[data-slot=dialog-close]]:right-6 [&_[data-slot=dialog-close]]:top-[18px] [&_[data-slot=dialog-close]]:rounded-[4px] [&_[data-slot=dialog-close]]:text-[#86888F] [&_[data-slot=dialog-close]]:opacity-100 [&_[data-slot=dialog-close][data-state=open]]:bg-transparent [&_[data-slot=dialog-close][data-state=open]]:text-[#86888F] [&_[data-slot=dialog-close]]:hover:bg-[#F7F8FA] [&_[data-slot=dialog-close]]:hover:text-[#0E1114]">
                    <DialogHeader className="shrink-0 gap-1 border-b border-[#F2F3F5] px-6 pb-[14px] pr-14 pt-[18px] text-left">
                        <DialogTitle className="text-[16px] font-semibold leading-5 text-[#0E1114]">{resumeMailDialogTitle}</DialogTitle>
                        <DialogDescription className="text-[12px] leading-5 text-[#86888F]">{resumeMailDialogDescription}</DialogDescription>
                    </DialogHeader>
                    <ScrollArea className="min-h-0 flex-1">
                        <div className="space-y-5 px-6 py-5">
                            <Field label={recruitmentUiText.candidatesInThisSendLabel} className="space-y-2 [&>p]:text-[12px] [&>p]:font-normal [&>p]:text-[#33353D] [&>p]:dark:text-[#33353D]">
                                <div className="grid gap-2">
                                    {resumeMailTargetCandidates.length ? resumeMailTargetCandidates.map((candidate) => {
                                        const identity = resolveCandidateIdentity(candidate);
                                        return (
                                        <div key={candidate.id}
                                             className="rounded-[8px] border border-[#EBEEF5] bg-white px-4 py-3 dark:border-[#EBEEF5] dark:bg-white">
                                            <div className="flex items-center justify-between gap-4">
                                                <div className="flex min-w-0 items-center gap-2.5">
                                                    <CandidateAvatar identity={identity} className="h-8 w-8 bg-[#1E3BFA] text-[12px] font-medium text-white"/>
                                                    <div className="min-w-0">
                                                        <p className="truncate text-[13px] font-medium leading-5 text-[#0E1114] dark:text-[#0E1114]">{identity.displayName}</p>
                                                        <p className="truncate text-[11px] leading-[18px] text-[#86888F] dark:text-[#86888F]">{candidate.position_title || recruitmentUiText.resumeNoLinkedPosition}</p>
                                                        <p className={cn(
                                                            "truncate text-[11px] leading-[18px]",
                                                            getCandidateResumeMailSummary(candidate.id) ? "text-[#0CC991]" : "text-[#86888F]",
                                                        )}>
                                                            {getCandidateResumeMailSummary(candidate.id) || recruitmentUiText.noSendHistory}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex shrink-0 flex-wrap gap-2">
                                                    {getCandidateResumeMailSummary(candidate.id) ? (
                                                        <Badge
                                                            className="h-[22px] rounded-[4px] border-transparent bg-[rgba(12,201,145,0.1)] px-2 py-0 text-[12px] font-normal text-[#0CC991] shadow-none dark:border-transparent dark:bg-[rgba(12,201,145,0.1)] dark:text-[#0CC991]">
                                                            {recruitmentUiText.alreadySent}
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="outline"
                                                               className="h-[22px] rounded-[4px] border-transparent bg-[rgba(30,59,250,0.08)] px-2 py-0 text-[12px] font-normal text-[#1E3BFA] shadow-none dark:border-transparent dark:bg-[rgba(30,59,250,0.08)] dark:text-[#1E3BFA]">{recruitmentUiText.firstSend}</Badge>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        );
                                    }) : (
                                        <p className="rounded-[6px] border border-[#EBEEF5] bg-[#F7F8FA] px-4 py-3 text-[12px] text-[#86888F] dark:border-[#EBEEF5] dark:bg-[#F7F8FA] dark:text-[#86888F]">{recruitmentUiText.noCandidateDetails}</p>
                                    )}
                                </div>
                            </Field>

                            <div className="grid gap-4 md:grid-cols-2">
                                <Field label={recruitmentUiText.senderConfig} className="space-y-1.5 [&>p]:text-[12px] [&>p]:font-normal [&>p]:text-[#33353D] [&>p]:dark:text-[#33353D]">
                                    <NativeSelect value={resumeMailForm.senderConfigId}
                                                  className="h-[34px] rounded-[4px] border-[#E6E7EB] bg-white text-[12px] text-[#0E1114] shadow-none focus-visible:border-[#1E3BFA] focus-visible:ring-[#1E3BFA]/15 dark:border-[#E6E7EB] dark:bg-white dark:text-[#0E1114]"
                                                  onChange={(event) => setResumeMailForm((current) => ({
                                                      ...current,
                                                      senderConfigId: event.target.value
                                                  }))}>
                                        <option value="">{recruitmentUiText.useDefaultSender}</option>
                                        {mailSenderConfigs.filter((sender) => sender.is_enabled).map((sender) => (
                                            <option key={sender.id} value={sender.id}>
                                                {sender.name} / {sender.from_email}
                                            </option>
                                        ))}
                                    </NativeSelect>
                                </Field>
                                <Field label={recruitmentUiText.recipientEmailsOptional} className="space-y-1.5 [&>p]:text-[12px] [&>p]:font-normal [&>p]:text-[#33353D] [&>p]:dark:text-[#33353D]">
                                    <Input
                                        className="h-[34px] rounded-[4px] border-[#E6E7EB] bg-white px-3 text-[12px] text-[#0E1114] shadow-none placeholder:text-[#B0B2B8] focus-visible:border-[#1E3BFA] focus-visible:ring-2 focus-visible:ring-[#1E3BFA]/15 dark:border-[#E6E7EB] dark:bg-white dark:text-[#0E1114] dark:placeholder:text-[#B0B2B8]"
                                        value={resumeMailForm.extraRecipientEmails}
                                        onChange={(event) => setResumeMailForm((current) => ({
                                            ...current,
                                            extraRecipientEmails: event.target.value
                                        }))}
                                        placeholder={recruitmentUiText.recipientEmailsPlaceholder}
                                    />
                                </Field>
                            </div>

                            <Field label={recruitmentUiText.selectInternalRecipients} className="space-y-2 [&>p]:text-[12px] [&>p]:font-normal [&>p]:text-[#33353D] [&>p]:dark:text-[#33353D]">
                                <div className="grid gap-2.5 md:grid-cols-2">
                                    {enabledMailRecipients.length ? enabledMailRecipients.map((recipient) => (
                                        <label key={recipient.id}
                                               className={cn(
                                                   "flex cursor-pointer items-start gap-2.5 rounded-[8px] border px-3.5 py-3 text-[12px] transition-colors",
                                                   resumeMailForm.recipientIds.includes(recipient.id)
                                                       ? "border-[#1E3BFA] bg-[rgba(30,59,250,0.03)] dark:border-[#1E3BFA] dark:bg-[rgba(30,59,250,0.03)]"
                                                       : "border-[#EBEEF5] bg-white hover:border-[#E6E7EB] dark:border-[#EBEEF5] dark:bg-white dark:hover:border-[#E6E7EB]",
                                               )}>
                                            <input
                                                type="checkbox"
                                                className="mt-px h-[15px] w-[15px] shrink-0 cursor-pointer accent-[#1E3BFA]"
                                                checked={resumeMailForm.recipientIds.includes(recipient.id)}
                                                onChange={(event) => setResumeMailForm((current) => ({
                                                    ...current,
                                                    recipientIds: toggleIdInList(current.recipientIds, recipient.id, event.target.checked),
                                                }))}
                                            />
                                            <div className="min-w-0">
                                                <p className="truncate text-[13px] font-medium leading-5 text-[#0E1114] dark:text-[#0E1114]">{recipient.name}</p>
                                                <p className="truncate text-[11px] leading-[18px] text-[#86888F] dark:text-[#86888F]">{recipient.email}</p>
                                                <p className="truncate text-[11px] leading-[18px] text-[#B0B2B8] dark:text-[#B0B2B8]">{recipient.department || recruitmentUiText.noDepartmentSet} / {recipient.role_title || recruitmentUiText.noRoleSet}</p>
                                            </div>
                                        </label>
                                    )) : (
                                        <EmptyState title={recruitmentUiText.noRecipientsAvailable}
                                                    description={recruitmentUiText.noRecipientsAvailableDesc}/>
                                    )}
                                </div>
                            </Field>

                            <Field label={recruitmentUiText.emailSubjectOptional} className="space-y-1.5 [&>p]:text-[12px] [&>p]:font-normal [&>p]:text-[#33353D] [&>p]:dark:text-[#33353D]">
                                <Input className="h-[34px] rounded-[4px] border-[#E6E7EB] bg-white px-3 text-[12px] text-[#0E1114] shadow-none placeholder:text-[#B0B2B8] focus-visible:border-[#1E3BFA] focus-visible:ring-2 focus-visible:ring-[#1E3BFA]/15 dark:border-[#E6E7EB] dark:bg-white dark:text-[#0E1114] dark:placeholder:text-[#B0B2B8]" value={resumeMailForm.subject}
                                       onChange={(event) => setResumeMailForm((current) => ({
                                           ...current,
                                           subject: event.target.value
                                       }))} placeholder={recruitmentUiText.emailSubjectPlaceholder}/>
                            </Field>
                            <Field label={recruitmentUiText.emailBodyOptional} className="space-y-1.5 [&>p]:text-[12px] [&>p]:font-normal [&>p]:text-[#33353D] [&>p]:dark:text-[#33353D]">
                                <Textarea className="min-h-[96px] resize-y rounded-[4px] border-[#E6E7EB] bg-white px-3 py-2.5 text-[12px] leading-5 text-[#0E1114] shadow-none placeholder:text-[#B0B2B8] focus-visible:border-[#1E3BFA] focus-visible:ring-2 focus-visible:ring-[#1E3BFA]/15 dark:border-[#E6E7EB] dark:bg-white dark:text-[#0E1114] dark:placeholder:text-[#B0B2B8]" value={resumeMailForm.bodyText}
                                          onChange={(event) => setResumeMailForm((current) => ({
                                              ...current,
                                              bodyText: event.target.value
                                          }))} rows={10}
                                          placeholder={recruitmentUiText.emailBodyPlaceholder}/>
                            </Field>
                        </div>
                    </ScrollArea>
                    <DialogFooter className="h-16 shrink-0 items-center gap-3 border-t border-[#F2F3F5] px-6 sm:justify-end">
                        {resumeMailError && (
                            <p className="flex-1 text-left text-[12px] leading-5 text-[#F53F3F]">{resumeMailError}</p>
                        )}
                        <Button variant="outline" className="h-[34px] rounded-[6px] border-[#E6E7EB] bg-white px-[18px] text-[13px] font-normal text-[#33353D] shadow-none hover:border-[#1E3BFA] hover:bg-[#F7F8FA] hover:text-[#0F23D9] dark:border-[#E6E7EB] dark:bg-white dark:text-[#33353D] dark:shadow-none dark:hover:border-[#1E3BFA] dark:hover:bg-[#F7F8FA] dark:hover:text-[#0F23D9]" onClick={() => setResumeMailDialogOpen(false)}>{recruitmentUiText.cancelButton}</Button>
                        <Button className="h-[34px] rounded-[6px] bg-[#1E3BFA] px-[18px] text-[13px] font-normal text-white shadow-none hover:bg-[#0F23D9] focus-visible:ring-[#1E3BFA]/20 dark:bg-[#1E3BFA] dark:text-white dark:shadow-none dark:hover:bg-[#0F23D9] dark:focus-visible:ring-[#1E3BFA]/20" onClick={() => void submitResumeMail()} disabled={resumeMailSubmitting}>
                            <Send className="h-[13px] w-[13px]"/>
                            {resumeMailSubmitLabel}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

        </div>
    );
}
