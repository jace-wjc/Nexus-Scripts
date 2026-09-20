"use client";

import { authenticatedFetch, type AuthenticatedFetchInit } from "@/lib/auth";
import type { ScriptHubOrganizationDefinition } from "@/lib/types";

export interface RecruitmentOption {
  value: string;
  label: string;
}

export interface RecruitmentMetadata {
  candidate_statuses: RecruitmentOption[];
  position_statuses: RecruitmentOption[];
  publish_platforms: RecruitmentOption[];
  publish_modes: RecruitmentOption[];
  ai_task_types: string[];
  llm_provider_options: RecruitmentOption[];
  llm_task_types: RecruitmentOption[];
}

export interface RecruitmentOrganizationScope {
  primary_org_code: string;
  data_scope: string;
  has_all_orgs: boolean;
  visible_org_codes: string[];
  organizations: ScriptHubOrganizationDefinition[];
}

export interface PositionSummary {
  id: number;
  position_code: string;
  org_code?: string | null;
  title: string;
  department?: string | null;
  location?: string | null;
  employment_type?: string | null;
  salary_range?: string | null;
  headcount: number;
  key_requirements?: string | null;
  bonus_points?: string | null;
  summary?: string | null;
  status: string;
  auto_screen_on_upload?: boolean;
  auto_advance_on_screening?: boolean;
  auto_mail_enabled?: boolean;
  auto_mail_use_global_recipients?: boolean;
  auto_mail_use_position_recipients?: boolean;
  auto_mail_position_recipient_ids?: number[];
  auto_mail_allowed_candidate_statuses?: string[];
  auto_mail_template_id?: string | null;
  auto_mail_dedup_mode?: string | null;
  auto_mail_cc_recipient_ids?: number[];
  auto_mail_bcc_recipient_ids?: number[];
  jd_skill_ids?: number[];
  jd_skills?: RecruitmentSkill[];
  screening_skill_ids?: number[];
  screening_skills?: RecruitmentSkill[];
  interview_skill_ids?: number[];
  interview_skills?: RecruitmentSkill[];
  tags?: string[];
  current_jd_version_id?: number | null;
  current_jd_title?: string | null;
  jd_version_count: number;
  candidate_count: number;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface JDVersion {
  id: number;
  position_id: number;
  org_code?: string | null;
  version_no: number;
  title: string;
  prompt_snapshot?: string | null;
  jd_markdown: string;
  jd_html?: string | null;
  publish_text?: string | null;
  notes?: string | null;
  is_active: boolean;
  created_by?: string | null;
  created_at?: string | null;
}

export interface JDGenerationState {
  status: string;
  task_id?: number | null;
  last_generated_at?: string | null;
  started_at?: string | null;
  error_message?: string | null;
  model_provider?: string | null;
  model_name?: string | null;
}

export interface PublishTask {
  id: number;
  position_id: number;
  org_code?: string | null;
  target_platform: string;
  mode: string;
  adapter_code?: string | null;
  status: string;
  request_payload?: Record<string, unknown> | null;
  response_payload?: Record<string, unknown> | null;
  published_url?: string | null;
  screenshot_path?: string | null;
  retry_count?: number | null;
  error_message?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CandidateSummary {
  id: number;
  candidate_code: string;
  org_code?: string | null;
  position_id?: number | null;
  position_title?: string | null;
  position_auto_screen_on_upload?: boolean;
  position_jd_skill_ids?: number[];
  position_jd_skills?: RecruitmentSkill[];
  position_screening_skill_ids?: number[];
  position_screening_skills?: RecruitmentSkill[];
  position_interview_skill_ids?: number[];
  position_interview_skills?: RecruitmentSkill[];
  name: string;
  name_source?: "filename_untrusted" | "filename_high_confidence" | "resume_text_explicit" | "resume_parsed" | "hr_manual" | "legacy_unknown" | null;
  name_confidence?: number | null;
  phone?: string | null;
  email?: string | null;
  current_company?: string | null;
  years_of_experience?: string | null;
  education?: string | null;
  age?: number | null;
  city?: string | null;
  expected_city?: string | null;
  source?: string | null;
  source_detail?: string | null;
  status: string;
  display_status?: string | null;
  display_status_reason?: string | null;
  active_screening_run_id?: string | null;
  active_screening_task_id?: number | null;
  active_screening_task_type?: string | null;
  active_screening_stage?: string | null;
  active_screening_status?: string | null;
  active_screening_task_status?: string | null;
  active_screening_auto_retry_scheduled?: boolean;
  active_screening_failure_code?: string | null;
  active_screening_started_at?: string | null;
  latest_completed_parse_task_id?: number | null;
  latest_completed_score_task_id?: number | null;
  ai_recommended_status?: string | null;
  match_percent?: number | null;
  tags: string[];
  notes?: string | null;
  note_summary?: string | null;
  latest_resume_file_id?: number | null;
  latest_parse_result_id?: number | null;
  latest_score_id?: number | null;
  latest_total_score?: number | null;
  owner_id?: string | null;
  screened_position_title?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  // AI 岗位匹配相关字段
  ai_match_position_id?: number | null;
  ai_match_position_title?: string | null;
  ai_match_confidence?: number | null;
  ai_match_reason?: string | null;
  ai_match_alternatives?: Array<{ position_id: number; position_title: string; confidence: number }> | null;
  ai_potential_position?: string | null;
  ai_potential_reason?: string | null;
  // 人才库归档字段
  talent_pool_reason?: "unmatched_by_ai" | "ai_error" | "auto_archived" | "moved_by_hr" | null;
  talent_pool_source_status?: string | null;
  talent_pool_moved_by?: string | null;
  talent_pool_moved_at?: string | null;
}

export interface ResumeFile {
  id: number;
  candidate_id: number;
  original_name: string;
  stored_name: string;
  file_ext?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  parse_status: string;
  parse_error?: string | null;
  created_at?: string | null;
}

export interface ResumeParseResult {
  id: number;
  candidate_id: number;
  resume_file_id: number;
  raw_text: string;
  basic_info: Record<string, unknown>;
  work_experiences: unknown[];
  education_experiences: unknown[];
  skills: unknown[];
  projects: unknown[];
  summary?: string | null;
  status: string;
  error_message?: string | null;
  created_at?: string | null;
}

export interface CandidateScoreDimension {
  label?: string | null;
  score?: number | null;
  max_score?: number | null;
  reason?: string | null;
  evidence?: string | string[] | null;
  is_inferred?: boolean | null;
  radar_category?: string | null;
  [key: string]: unknown;
}

export interface RadarScore {
  category?: string | null;
  score?: number | null;
  max_score?: number | null;
  reason?: string | null;
  evidence?: string | null;
}

export interface CandidateScreeningPositionMatch {
  recommended_position?: string | null;
  confidence?: number | null;
  reason?: string | null;
  potential_position?: string | null;
  potential_reason?: string | null;
}

export interface CandidateScore {
  id: number;
  candidate_id: number;
  parse_result_id: number;
  total_score?: number | null;
  total_score_scale?: number | null;
  match_percent?: number | null;
  advantages?: string[];
  concerns?: string[];
  recommendation?: string | null;
  suggested_status?: string | null;
  dimensions?: CandidateScoreDimension[];
  radar_scores?: RadarScore[];
  screening_position_match?: CandidateScreeningPositionMatch | null;
  score_validation_passed?: boolean | null;
  validation_warnings?: string[];
  validation_warning_levels?: { text: string; level: "info" | "risk" }[] | null;
  review_required?: boolean | null;
  evidence_review_labels?: string[] | null;
  manual_override_score?: number | null;
  manual_override_reason?: string | null;
  hr_feedback?: string | null;
  hr_feedback_reason?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

export type CandidateComparisonComparabilityLevel = "strict" | "limited" | "incompatible";
export type CandidateComparisonManualOverrideMode = "none" | "partial" | "complete";
export type CandidateComparisonDuplicateMatch = "phone" | "email" | "both";
export type CandidateComparisonArtifactState = "strict" | "legacy" | "stale" | "missing" | "invalid" | "processing" | "failed";
export type CandidateComparisonReasonCode =
  | "artifact_missing"
  | "artifact_legacy"
  | "artifact_stale"
  | "artifact_invalid"
  | "artifact_processing"
  | "artifact_failed"
  | "protocol_mismatch"
  | "dimension_mismatch"
  | "score_total_mismatch"
  | "audit_request_hash_mismatch"
  | "position_context_mismatch"
  | "manual_override_mixed"
  | "possible_duplicate_contact";

export interface CandidateComparisonPreviewRequest {
  candidate_ids: number[];
  expected_position_id: number;
}

export interface CandidateComparisonTargetContext {
  position_id: number;
  position_title: string;
  evaluation_protocol_hash: string | null;
}

export type CandidateComparisonRankingBasis = "ai" | "manual" | "none";

export interface CandidateComparisonComparability {
  level: CandidateComparisonComparabilityLevel;
  facts_allowed: boolean;
  score_deltas_allowed: boolean;
  ranking_allowed: boolean;
  ranking_basis: CandidateComparisonRankingBasis;
  reasons: CandidateComparisonReasonCode[];
}

export interface CandidateComparisonDuplicateGroup {
  candidate_ids: number[];
  matched_by: CandidateComparisonDuplicateMatch;
}

export interface CandidateComparisonRevisions {
  candidate_updated_at: string | null;
  resume_id: number | null;
  parse_id: number | null;
  score_id: number | null;
  screening_task_id: number | null;
}

export interface CandidateComparisonFacts {
  city: string | null;
  education: string | null;
  years_of_experience: string | null;
  current_company: string | null;
  source: string | null;
}

export interface CandidateComparisonManualReview {
  score: number | null;
  reason: string | null;
  is_highest?: boolean;
}

export interface CandidateComparisonAiScreening {
  total_score: number | null;
  total_score_scale: number | null;
  match_percent: number | null;
  recommendation: string | null;
  suggested_status: string | null;
  advantages: string[];
  concerns: string[];
}

export interface CandidateComparisonManualOverride {
  score: number | null;
  reason: string | null;
}

export interface CandidateComparisonScreeningDimension {
  dimension_key: string;
  label: string;
  max_score: number | null;
  score: number | null;
  normalized_score: number | null;
  reason: string | null;
  evidence: string[];
  is_inferred: boolean;
  radar_category: string | null;
}

export interface CandidateComparisonScreeningProtocol {
  evaluation_protocol_hash: string | null;
  screening_run_id: string | null;
  prompt_version: string | null;
  provider: string | null;
  model_name: string | null;
}

export interface CandidateComparisonScreening {
  ai: CandidateComparisonAiScreening;
  manual_override: CandidateComparisonManualOverride;
  dimensions: CandidateComparisonScreeningDimension[];
  protocol: CandidateComparisonScreeningProtocol;
}

export interface CandidateComparisonMemberCandidate {
  id: number;
  name: string;
  name_source?: CandidateSummary["name_source"];
  name_confidence?: number | null;
  status: string;
  display_status: string;
  position_id: number;
}

export interface CandidateComparisonMember {
  candidate: CandidateComparisonMemberCandidate;
  artifact_state: CandidateComparisonArtifactState;
  revisions: CandidateComparisonRevisions;
  facts: CandidateComparisonFacts;
  screening: CandidateComparisonScreening | null;
  manual_review: CandidateComparisonManualReview | null;
  warnings: CandidateComparisonReasonCode[];
}

export interface CandidateComparisonDimensionValue {
  candidate_id: number;
  score: number | null;
  normalized_score: number | null;
  reason: string | null;
  evidence: string[];
  is_highest: boolean;
  is_tied_highest: boolean;
}

export interface CandidateComparisonAlignedDimension {
  dimension_key: string;
  label: string;
  max_score: number | null;
  is_core: boolean;
  spread: number | null;
  values: CandidateComparisonDimensionValue[];
}

export interface CandidateComparisonPreview {
  snapshot_version: string;
  target_context: CandidateComparisonTargetContext;
  comparability: CandidateComparisonComparability;
  manual_override_mode: CandidateComparisonManualOverrideMode;
  possible_duplicate_groups: CandidateComparisonDuplicateGroup[];
  members: CandidateComparisonMember[];
  aligned_dimensions: CandidateComparisonAlignedDimension[];
  key_differences: string[];
}

export interface CandidateStatusHistory {
  id: number;
  candidate_id: number;
  from_status?: string | null;
  to_status: string;
  reason?: string | null;
  changed_by?: string | null;
  source?: string | null;
  created_at?: string | null;
}

export interface InterviewQuestion {
  id: number;
  round_name: string;
  custom_requirements?: string | null;
  skill_ids?: number[];
  html_content: string;
  markdown_content: string;
  status: string;
  created_by?: string | null;
  created_at?: string | null;
}

export interface InterviewSchedule {
  id: number;
  candidate_id: number;
  position_id?: number | null;
  org_code?: string | null;
  subject?: string | null;
  round_name: string;
  round_index?: number | null;
  interview_method?: "onsite" | "video" | "phone" | string | null;
  interviewer_user_code?: string | null;
  interviewer_name?: string | null;
  scheduled_at?: string | null;
  duration_minutes?: number | null;
  location?: string | null;
  meeting_room?: string | null;
  video_tool?: string | null;
  meeting_link?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
  visible_sections?: string[];
  availability_slot_id?: number | null;
  department_review_assignment_id?: number | null;
  notification_status?: string | null;
  notified_at?: string | null;
  result_status?: string | null;
  result_comment?: string | null;
  result_submitted_at?: string | null;
  status: string;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface InterviewAvailabilitySlot {
  id: number;
  interviewer_user_code: string;
  interviewer_name?: string | null;
  org_code?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  status: "available" | "unavailable" | "booked" | "cancelled" | string;
  schedule_id?: number | null;
  notes?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface InterviewTask {
  task_type?: "scheduled" | "needs_scheduling" | string;
  schedule?: InterviewSchedule | null;
  candidate: CandidateSummary;
  position?: PositionSummary | null;
  next_round_index?: number | null;
  next_round_name?: string | null;
  last_completed_schedule?: InterviewSchedule | null;
  interview_stage_reason?: string | null;
}

export interface InterviewTaskList {
  items: InterviewTask[];
  total: number;
  counts: {
    todo: number;
    today: number;
    completed: number;
    cancelled: number;
  };
}

export interface FollowUp {
  id: number;
  candidate_id: number;
  org_code?: string | null;
  content: string;
  follow_up_type: string;
  created_by?: string | null;
  created_at?: string | null;
}

export interface RecruitmentOffer {
  id: number;
  candidate_id: number;
  position_id?: number | null;
  org_code?: string | null;
  offer_title?: string | null;
  salary?: string | null;
  department?: string | null;
  entry_date?: string | null;
  offer_content?: string | null;
  notes?: string | null;
  status: string;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DepartmentReviewAssignment {
  id: number;
  batch_id: number;
  candidate_id: number;
  position_id?: number | null;
  org_code?: string | null;
  reviewer_user_code: string;
  reviewer_name?: string | null;
  status: "pending" | "passed" | "rejected" | "deferred" | string;
  comment?: string | null;
  decision_at?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DepartmentReviewReviewerOption {
  user_code: string;
  name?: string | null;
  display_name?: string | null;
  primary_org_code?: string | null;
}

export interface DepartmentReviewBatch {
  id: number;
  candidate_id: number;
  position_id?: number | null;
  org_code?: string | null;
  status: "pending" | "passed" | "rejected" | "cancelled" | string;
  visible_sections: string[];
  cc_user_codes: string[];
  message?: string | null;
  due_at?: string | null;
  created_by?: string | null;
  cancelled_by?: string | null;
  cancelled_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  assignments: DepartmentReviewAssignment[];
}

export interface DepartmentReviewTask {
  assignment: DepartmentReviewAssignment;
  batch: DepartmentReviewBatch;
  candidate: CandidateSummary;
  position?: PositionSummary | null;
}

export interface DepartmentReviewTaskList {
  items: DepartmentReviewTask[];
  total: number;
  counts: {
    pending: number;
    deferred: number;
    completed: number;
    todo: number;
  };
}

export interface RecruitmentSkill {
  id: number;
  skill_code: string;
  org_code?: string | null;
  scope_level?: string | null;
  share_policy?: string | null;
  allow_sub_org_use?: boolean;
  allow_copy?: boolean;
  is_system_base?: boolean;
  name: string;
  description?: string | null;
  content: string;
  tags: string[];
  sort_order: number;
  is_enabled: boolean;
  skill_group?: string | null;
  version?: string | null;
  task_types?: Array<"jd" | "screening" | "interview">;
  bound_position_id?: number | null;
  bound_position_title?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface RecruitmentLLMConfig {
  id: number;
  config_key: string;
  org_code?: string | null;
  scope_level?: string | null;
  share_policy?: string | null;
  allow_sub_org_use?: boolean;
  allow_copy?: boolean;
  task_type: string;
  provider: string;
  model_name: string;
  base_url?: string | null;
  api_key_env?: string | null;
  api_key_masked?: string | null;
  has_stored_api_key: boolean;
  has_runtime_api_key: boolean;
  extra_config?: Record<string, unknown> | null;
  max_concurrent: number;
  max_qps: number;
  is_active: boolean;
  priority: number;
  resolved_provider?: string | null;
  resolved_model_name?: string | null;
  resolved_base_url?: string | null;
  resolved_source?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AITaskLog {
  id: number;
  org_code?: string | null;
  task_type: string;
  screening_run_id?: string | null;
  parent_task_id?: number | null;
  root_task_id?: number | null;
  stage?: string | null;
  stage_started_at?: string | null;
  stage_completed_at?: string | null;
  related_position_id?: number | null;
  related_candidate_id?: number | null;
  related_skill_id?: number | null;
  related_skill_ids?: number[];
  related_skill_snapshots?: RecruitmentSkill[];
  related_resume_file_id?: number | null;
  related_publish_task_id?: number | null;
  memory_source?: string | null;
  skill_resolution_source?: string | null;
  skill_resolution_detail?: Record<string, unknown> | null;
  score_rule_snapshot?: Array<Record<string, unknown>>;
  timing_breakdown?: Record<string, unknown> | null;
  request_hash?: string | null;
  model_provider?: string | null;
  model_name?: string | null;
  model_source?: string | null;
  prompt_snapshot?: string | null;
  full_request_snapshot?: string | null;
  input_summary?: string | null;
  output_summary?: string | null;
  output_snapshot?: unknown;
  raw_response_text?: string | null;
  parsed_response_json?: Record<string, unknown> | null;
  sanitized_response_json?: Record<string, unknown> | null;
  validation_meta?: Record<string, unknown> | null;
  persisted_result_refs?: Record<string, unknown> | null;
  duration_ms?: number | null;
  status: string;
  error_message?: string | null;
  token_usage?: Record<string, unknown> | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DashboardData {
  cards: {
    positions_total: number;
    positions_recruiting: number;
    candidates_total: number;
    pending_screening: number;
    screening_passed: number;
    recent_ai_tasks: number;
  };
  status_distribution: Array<{ status: string; count: number }>;
  recent_candidates: CandidateSummary[];
}

export interface FunnelStage {
  key: string;
  label_zh: string;
  label_en: string;
  count: number;
}

export interface RecruitmentFunnelData {
  stages: FunnelStage[];
  rejected_count: number;
  talent_pool_count: number;
}

export interface SourceStatItem {
  source: string;
  count: number;
}

export interface SourceStatsData {
  total: number;
  sources: SourceStatItem[];
}

export interface CandidateStatsData {
  total: number;
  pending_screening: number;
  status_counts: Record<string, number>;
  today_total: number;
  today_status_counts: Record<string, number>;
}

export interface PositionDetail {
  position: PositionSummary;
  current_jd_version?: JDVersion | null;
  jd_versions: JDVersion[];
  jd_generation?: JDGenerationState | null;
  publish_tasks: PublishTask[];
  candidates: CandidateSummary[];
}

export interface CandidateWorkflowMemory {
  id: number;
  candidate_id: number;
  position_id?: number | null;
  screening_skill_ids: number[];
  screening_skills: RecruitmentSkill[];
  screening_memory_source?: string | null;
  screening_rule_snapshot?: Record<string, unknown> | null;
  latest_parse_result_id?: number | null;
  latest_score_id?: number | null;
  last_screened_at?: string | null;
  interview_skill_ids: number[];
  interview_skills: RecruitmentSkill[];
  last_interview_question_id?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CandidateDetail {
  candidate: CandidateSummary;
  resume_files: ResumeFile[];
  parse_result?: ResumeParseResult | null;
  score?: CandidateScore | null;
  workflow_memory?: CandidateWorkflowMemory | null;
  status_history: CandidateStatusHistory[];
  interview_questions: InterviewQuestion[];
  interview_schedules?: InterviewSchedule[];
  activity: AITaskLog[];
  department_review_context?: {
    assignment: DepartmentReviewAssignment;
    batch: DepartmentReviewBatch;
  } | null;
}

export interface ChatContext {
  position_id?: number | null;
  position_title?: string | null;
  candidate_id?: number | null;
  skill_ids: number[];
  skills: RecruitmentSkill[];
  updated_at?: string | null;
}

export interface ChatResponse {
  reply: string;
  context: ChatContext;
  actions?: string[];
  question?: InterviewQuestion | null;
  log_id?: number | null;
  task_id?: number | null;
  pending?: boolean;
  memory_source?: string | null;
  model_provider?: string | null;
  model_name?: string | null;
  used_skill_ids?: number[];
  used_skills?: RecruitmentSkill[];
  used_fallback?: boolean;
  fallback_error?: string | null;
}

export interface RecruitmentTaskStartResponse {
  task_id: number;
  status: string;
  task_type: string;
  screening_run_id?: string | null;
  related_position_id?: number | null;
  related_candidate_id?: number | null;
  reused_existing_task?: boolean;
  reused_existing_result?: boolean;
}

export interface RecruitmentTaskBatchStartResponse {
  batch_id?: string | null;
  queued_count: number;
  duplicated_count?: number;
  skipped_existing_live_task_count: number;
  failed_count?: number;
  task_ids: number[];
  tasks: RecruitmentTaskStartResponse[];
}

export interface RecruitmentVisibleScreeningCancelResponse {
  org_code?: string | null;
  total: number;
  cancelled_count: number;
  stop_requested_count?: number;
  already_terminal_count?: number;
  task_ids: number[];
  results: AITaskLog[];
}

export interface ResumeUploadItem extends CandidateSummary {
  skipped_duplicate?: boolean;
  overwritten?: boolean;
  auto_screen_enabled?: boolean;
  auto_screen_needed?: boolean;
  auto_screen_candidate_id?: number | null;
  auto_screen_queued?: boolean;
  auto_screen_task_id?: number | null;
  auto_screen_task_status?: string | null;
  auto_screen_reused_existing_task?: boolean;
  auto_screen_error?: string | null;
}

export interface ResumeUploadFileResult {
  file_index: number;
  file_name: string;
  status: "uploaded" | "skipped_duplicate" | "failed" | "unknown";
  candidate_id?: number | null;
  error_code?: string | null;
  retryable?: boolean;
}

export interface ResumeUploadResponse {
  items: ResumeUploadItem[];
  file_results?: ResumeUploadFileResult[];
  failed_count?: number;
  unknown_count?: number;
  auto_screen_dispatch_pending?: boolean;
  uploaded_count: number;
  skipped_duplicate_count?: number;
  returned_count?: number;
  auto_screen_queued_count: number;
  auto_screen_skipped_existing_live_task_count: number;
  auto_screen_failed_count: number;
  auto_screen_task_ids: number[];
  auto_screen_tasks: RecruitmentTaskStartResponse[];
  ai_match_result?: { matched_count: number; total_candidates: number; background?: boolean; skipped_duplicate_count?: number; message?: string; error?: string } | null;
}

export interface CandidateExportRequest {
  candidate_ids?: number[] | null;
  include_resumes?: boolean;
  fields?: string[];
}

export interface RecruitmentMailSenderConfig {
  id: number;
  org_code?: string | null;
  scope_level?: string | null;
  share_policy?: string | null;
  allow_sub_org_use?: boolean;
  allow_copy?: boolean;
  name: string;
  from_name?: string | null;
  from_email: string;
  smtp_host: string;
  smtp_port: number;
  username: string;
  password_masked?: string | null;
  has_password: boolean;
  use_ssl: boolean;
  use_starttls: boolean;
  is_default: boolean;
  is_enabled: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface RecruitmentMailRecipient {
  id: number;
  org_code?: string | null;
  scope_level?: string | null;
  share_policy?: string | null;
  allow_sub_org_use?: boolean;
  allow_copy?: boolean;
  name: string;
  email: string;
  department?: string | null;
  role_title?: string | null;
  tags: string[];
  notes?: string | null;
  is_enabled: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface RecruitmentResumeMailDispatch {
  id: number;
  org_code?: string | null;
  sender_config_id?: number | null;
  sender_name?: string | null;
  position_id?: number | null;
  screening_score_id?: number | null;
  candidate_ids: number[];
  recipient_ids: number[];
  recipient_emails: string[];
  cc_recipient_ids?: number[];
  cc_recipient_emails?: string[];
  bcc_recipient_ids?: number[];
  bcc_recipient_emails?: string[];
  subject?: string | null;
  body_text?: string | null;
  body_html?: string | null;
  attachment_count: number;
  status: string;
  error_message?: string | null;
  send_mode?: string | null;
  trigger_type?: string | null;
  candidate_status?: string | null;
  dedup_key?: string | null;
  trigger_rule?: Record<string, unknown> | null;
  sent_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface RecruitmentMailAutoPushGlobalConfig {
  global_default_recipient_ids: number[];
  global_default_recipient_emails: string[];
  global_auto_push_enabled: boolean;
}

export type RecruitmentRequestInit = AuthenticatedFetchInit;

export function isRecruitmentRequestAborted(error: unknown): boolean {
  if (!error) {
    return false;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("__SCRIPT_HUB_REQUEST_TIMEOUT__") || message.includes("aborted");
}

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
  detail?: string;
}

function stringifyApiError(value: unknown): string {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stringifyApiError(item)).filter(Boolean).join("; ");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.msg === "string" && Array.isArray(record.loc)) {
      return `${record.loc.join(".")}: ${record.msg}`;
    }
    return (
      stringifyApiError(record.error)
      || stringifyApiError(record.detail)
      || stringifyApiError(record.message)
      || JSON.stringify(record)
    );
  }
  return String(value);
}

async function parseError(response: Response, payload: ApiEnvelope<unknown> | null, rawText: string) {
  const message = stringifyApiError(payload?.error) || stringifyApiError(payload?.detail);
  if (message) {
    return message;
  }

  if (rawText) {
    if (!payload) {
      try {
        const parsed = JSON.parse(rawText) as Record<string, unknown>;
        const parsedMessage = stringifyApiError(parsed.error) || stringifyApiError(parsed.detail) || stringifyApiError(parsed.message);
        if (parsedMessage) {
          return parsedMessage;
        }
      } catch {
        // Keep the original raw text when the response is not JSON.
      }
    }
    const html = rawText.trim();
    if (/^<!doctype html/i.test(html) || /^<html[\s>]/i.test(html)) {
      return `服务端返回了 HTML 错误页（${response.status}），请稍后重试；如果持续出现，请重启前端开发服务。`;
    }
    return rawText;
  }

  return `Request failed (${response.status})`;
}

export async function recruitmentApi<T>(path: string, init: RecruitmentRequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  const headers = new Headers(init.headers);

  if (!isFormData && init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await authenticatedFetch(`/api/recruitment${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("__SCRIPT_HUB_REQUEST_TIMEOUT__")) {
      throw new Error("请求超时，请稍后重试。");
    }
    throw error;
  }

  const raw = await response.text();
  let payload: ApiEnvelope<T> | null = null;

  if (raw) {
    try {
      payload = JSON.parse(raw) as ApiEnvelope<T>;
    } catch {
      payload = null;
    }
  }

  if (!response.ok || (payload && payload.success === false)) {
    throw new Error(await parseError(response, payload, raw));
  }

  if (!payload || typeof payload !== "object") {
    return undefined as T;
  }

  if (!("data" in payload)) {
    if (payload.success !== false) {
      return undefined as T;
    }
    throw new Error("Invalid recruitment response");
  }

  return payload.data as T;
}

export function joinTags(value: string[] | null | undefined) {
  return (value || []).join(", ");
}

export function splitTags(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

// 获取待归岗候选人
export async function getPendingMatchCandidates(orgCode?: string): Promise<CandidateSummary[]> {
  const params = new URLSearchParams();
  if (orgCode) params.set("org_code", orgCode);
  const query = params.toString();
  return recruitmentApi<CandidateSummary[]>(`/candidates/pending-match${query ? `?${query}` : ""}`);
}

// 获取人才库候选人
export async function getTalentPoolCandidates(orgCode?: string): Promise<CandidateSummary[]> {
  const params = new URLSearchParams();
  if (orgCode) params.set("org_code", orgCode);
  const query = params.toString();
  return recruitmentApi<CandidateSummary[]>(`/candidates/talent-pool${query ? `?${query}` : ""}`);
}

// 批量分配岗位并更新状态
export async function batchAssignPosition(
  candidateIds: number[],
  positionId: number | null,
  updateStatus: boolean = true
): Promise<{ updated_count: number }> {
  return recruitmentApi<{ updated_count: number }>(
    `/candidates/batch-assign-position?update_status=${updateStatus}`,
    {
      method: "POST",
      body: JSON.stringify({ candidate_ids: candidateIds, position_id: positionId }),
    }
  );
}

// 触发AI智能岗位匹配
export async function triggerAIPositionMatch(
  candidateIds: number[]
): Promise<{ matched_count: number; total_candidates: number; message: string }> {
  return recruitmentApi<{ matched_count: number; total_candidates: number; message: string }>(
    "/candidates/ai-match-positions",
    {
      method: "POST",
      timeoutMs: 45000,
      body: JSON.stringify(candidateIds),
    }
  );
}
