from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, StrictInt, field_validator


class PositionCreateRequest(BaseModel):
    org_code: Optional[str] = Field(None, max_length=100)
    title: str = Field(..., min_length=1, max_length=200)
    department: Optional[str] = None
    location: Optional[str] = None
    employment_type: Optional[str] = None
    salary_range: Optional[str] = None
    headcount: int = Field(1, ge=1, le=999)
    key_requirements: Optional[str] = None
    bonus_points: Optional[str] = None
    summary: Optional[str] = None
    status: str = Field("draft")
    tags: List[str] = Field(default_factory=list)
    auto_screen_on_upload: bool = False
    auto_advance_on_screening: bool = True
    auto_mail_enabled: bool = False
    auto_mail_use_global_recipients: bool = False
    auto_mail_use_position_recipients: bool = False
    auto_mail_position_recipient_ids: List[int] = Field(default_factory=list)
    auto_mail_allowed_candidate_statuses: List[str] = Field(default_factory=lambda: ["screening_passed"])
    auto_mail_template_id: Optional[str] = None
    auto_mail_dedup_mode: str = Field("once_per_candidate_per_status")
    auto_mail_cc_recipient_ids: List[int] = Field(default_factory=list)
    auto_mail_bcc_recipient_ids: List[int] = Field(default_factory=list)
    jd_skill_ids: List[int] = Field(default_factory=list)
    screening_skill_ids: List[int] = Field(default_factory=list)
    interview_skill_ids: List[int] = Field(default_factory=list)
    skill_pack_ids: List[int] = Field(default_factory=list)


class PositionUpdateRequest(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    department: Optional[str] = None
    location: Optional[str] = None
    employment_type: Optional[str] = None
    salary_range: Optional[str] = None
    headcount: Optional[int] = Field(None, ge=1, le=999)
    key_requirements: Optional[str] = None
    bonus_points: Optional[str] = None
    summary: Optional[str] = None
    status: Optional[str] = None
    tags: Optional[List[str]] = None
    auto_screen_on_upload: Optional[bool] = None
    auto_advance_on_screening: Optional[bool] = None
    auto_mail_enabled: Optional[bool] = None
    auto_mail_use_global_recipients: Optional[bool] = None
    auto_mail_use_position_recipients: Optional[bool] = None
    auto_mail_position_recipient_ids: Optional[List[int]] = None
    auto_mail_allowed_candidate_statuses: Optional[List[str]] = None
    auto_mail_template_id: Optional[str] = None
    auto_mail_dedup_mode: Optional[str] = None
    auto_mail_cc_recipient_ids: Optional[List[int]] = None
    auto_mail_bcc_recipient_ids: Optional[List[int]] = None
    jd_skill_ids: Optional[List[int]] = None
    screening_skill_ids: Optional[List[int]] = None
    interview_skill_ids: Optional[List[int]] = None
    skill_pack_ids: Optional[List[int]] = None


class JDGenerateRequest(BaseModel):
    extra_prompt: Optional[str] = None
    auto_activate: bool = True


class SaveJDVersionRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    jd_markdown: str = Field(..., min_length=1)
    jd_html: Optional[str] = None
    publish_text: Optional[str] = None
    notes: Optional[str] = None
    auto_activate: bool = False


class CandidateUpdateRequest(BaseModel):
    position_id: Optional[int] = None
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    phone: Optional[str] = None
    email: Optional[str] = None
    current_company: Optional[str] = None
    years_of_experience: Optional[str] = None
    education: Optional[str] = None
    age: Optional[int] = None
    city: Optional[str] = None
    expected_city: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    manual_override_score: Optional[float] = Field(None, ge=0, le=100)
    manual_override_reason: Optional[str] = None
    hr_feedback: Optional[str] = None
    hr_feedback_reason: Optional[str] = None
    owner_id: Optional[str] = None


class CandidateDuplicateCheckRequest(BaseModel):
    phone: Optional[str] = None
    email: Optional[str] = None
    exclude_candidate_id: Optional[int] = None


class CandidateComparisonPreviewRequest(BaseModel):
    candidate_ids: List[StrictInt] = Field(..., min_length=2, max_length=4)
    expected_position_id: StrictInt = Field(..., ge=1)

    @field_validator("candidate_ids")
    @classmethod
    def validate_candidate_ids(cls, value: List[int]) -> List[int]:
        if any(candidate_id <= 0 for candidate_id in value):
            raise ValueError("candidate_comparison_candidate_ids_must_be_positive")
        if len(set(value)) != len(value):
            raise ValueError("candidate_comparison_candidate_ids_must_be_unique")
        return value


class CandidateStatusUpdateRequest(BaseModel):
    status: str = Field(..., min_length=1, max_length=50)
    reason: Optional[str] = None


class CandidateExportRequest(BaseModel):
    candidate_ids: List[int] = Field(..., min_length=1)
    include_resumes: bool = True
    fields: List[str] = Field(default_factory=list)


class CandidateBatchUpdatePositionRequest(BaseModel):
    candidate_ids: List[int] = Field(..., min_length=1)
    position_id: Optional[int] = None


class CandidateBatchDeleteRequest(BaseModel):
    candidate_ids: List[int] = Field(..., min_length=1)


class CandidateBatchStatusUpdateRequest(BaseModel):
    candidate_ids: List[int] = Field(..., min_length=1)
    status: str = Field(..., min_length=1, max_length=50)
    reason: Optional[str] = None


class DepartmentReviewReviewerRequest(BaseModel):
    user_code: str = Field(..., min_length=1, max_length=100)
    name: Optional[str] = Field(None, max_length=120)


class DepartmentReviewCreateRequest(BaseModel):
    candidate_id: int = Field(..., ge=1)
    reviewers: List[DepartmentReviewReviewerRequest] = Field(..., min_length=1)
    visible_sections: List[str] = Field(default_factory=list)
    cc_user_codes: List[str] = Field(default_factory=list)
    message: Optional[str] = None
    due_at: Optional[str] = None
    replace_existing: bool = False


class DepartmentReviewDecisionRequest(BaseModel):
    status: str = Field(..., min_length=1, max_length=30)
    comment: Optional[str] = None


class TriggerCandidateProcessRequest(BaseModel):
    force: bool = False


class CandidateScreenRequest(BaseModel):
    skill_ids: List[int] = Field(default_factory=list)
    use_candidate_memory: bool = True
    use_position_skills: bool = True
    custom_requirements: Optional[str] = None
    force_one_pass: bool = True
    force_fallback: bool = False
    allow_reuse_parse: bool = True
    allow_score_only_rerun: bool = True
    screening_mode: str = Field("default", min_length=1, max_length=64)


class CandidateScreenBatchStartRequest(BaseModel):
    candidate_ids: List[int] = Field(default_factory=list)
    skill_ids: List[int] = Field(default_factory=list)
    use_candidate_memory: bool = True
    use_position_skills: bool = True
    custom_requirements: Optional[str] = None
    force_one_pass: bool = True
    force_fallback: bool = False
    allow_reuse_parse: bool = True
    allow_score_only_rerun: bool = True
    screening_mode: str = Field("default", min_length=1, max_length=64)


class CandidateScreenBatchQueryRequest(BaseModel):
    batch_id: str = Field(..., min_length=1, max_length=80)


class CandidateScreenBatchCancelRequest(BaseModel):
    batch_id: str = Field(..., min_length=1, max_length=80)


class CandidateScreenVisibleCancelRequest(BaseModel):
    org_code: Optional[str] = Field(None, max_length=100)


class SkillUpsertRequest(BaseModel):
    org_code: Optional[str] = Field(None, max_length=100)
    scope_level: str = Field("ORG", max_length=40)
    share_policy: str = Field("PRIVATE", max_length=40)
    allow_sub_org_use: bool = False
    allow_copy: bool = False
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = None
    skill_group: Optional[str] = Field(None, max_length=120)
    version: Optional[str] = Field(None, max_length=40)
    content: str = Field(..., min_length=1)
    tags: List[str] = Field(default_factory=list)
    task_types: List[str] = Field(default_factory=list)
    bound_position_id: Optional[int] = Field(None, ge=1)
    sort_order: int = Field(99, ge=0, le=9999)
    is_enabled: bool = True


class SkillContentGenerateRequest(BaseModel):
    role_name: str = Field(..., min_length=1, max_length=120)
    extra_requirements: Optional[str] = None
    position_jd: Optional[str] = None


class PublishTaskCreateRequest(BaseModel):
    position_id: int = Field(..., ge=1)
    target_platform: str = Field(..., min_length=1, max_length=80)
    mode: str = Field("mock", min_length=1, max_length=50)


class InterviewQuestionGenerateRequest(BaseModel):
    round_name: str = Field("初试", min_length=1, max_length=80)
    custom_requirements: Optional[str] = None
    skill_ids: List[int] = Field(default_factory=list)
    use_candidate_memory: bool = True
    use_position_skills: bool = True


class InterviewResultCreateRequest(BaseModel):
    candidate_id: int = Field(..., ge=1)
    position_id: Optional[int] = None
    interviewer_name: Optional[str] = None
    round_name: str = Field("初试", min_length=1, max_length=80)
    notes_text: Optional[str] = None
    transcript_text: Optional[str] = None


class InterviewScheduleCreateRequest(BaseModel):
    candidate_id: int = Field(..., ge=1)
    position_id: Optional[int] = None
    subject: Optional[str] = Field(None, max_length=200)
    round_name: str = Field("初试", min_length=1, max_length=80)
    round_index: int = Field(1, ge=1, le=20)
    interview_method: Optional[str] = Field("onsite", max_length=50)
    interviewer_user_code: Optional[str] = Field(None, max_length=100)
    interviewer_name: Optional[str] = None
    scheduled_at: Optional[str] = None
    duration_minutes: int = Field(60, ge=1, le=480)
    location: Optional[str] = None
    meeting_room: Optional[str] = Field(None, max_length=120)
    video_tool: Optional[str] = Field(None, max_length=120)
    meeting_link: Optional[str] = None
    contact_phone: Optional[str] = Field(None, max_length=50)
    notes: Optional[str] = None
    visible_sections: Optional[List[str]] = None
    availability_slot_id: Optional[int] = Field(None, ge=1)
    department_review_assignment_id: Optional[int] = Field(None, ge=1)


class InterviewScheduleUpdateRequest(BaseModel):
    subject: Optional[str] = Field(None, max_length=200)
    round_name: Optional[str] = Field(None, min_length=1, max_length=80)
    round_index: Optional[int] = Field(None, ge=1, le=20)
    interview_method: Optional[str] = Field(None, max_length=50)
    interviewer_user_code: Optional[str] = Field(None, max_length=100)
    interviewer_name: Optional[str] = None
    scheduled_at: Optional[str] = None
    duration_minutes: Optional[int] = Field(None, ge=1, le=480)
    location: Optional[str] = None
    meeting_room: Optional[str] = Field(None, max_length=120)
    video_tool: Optional[str] = Field(None, max_length=120)
    meeting_link: Optional[str] = None
    contact_phone: Optional[str] = Field(None, max_length=50)
    notes: Optional[str] = None
    visible_sections: Optional[List[str]] = None
    availability_slot_id: Optional[int] = Field(None, ge=1)
    status: Optional[str] = None


class InterviewAvailabilitySlotRequest(BaseModel):
    start_at: str = Field(..., min_length=1)
    end_at: str = Field(..., min_length=1)
    status: Optional[str] = Field("available", max_length=50)
    notes: Optional[str] = None


class InterviewAvailabilityReplaceRequest(BaseModel):
    slots: List[InterviewAvailabilitySlotRequest] = Field(default_factory=list)
    range_start: Optional[str] = None
    range_end: Optional[str] = None


class InterviewScheduleResultRequest(BaseModel):
    result_status: str = Field(..., min_length=1, max_length=50)
    result_comment: Optional[str] = None
    next_round_name: Optional[str] = Field(None, max_length=80)


class FollowUpCreateRequest(BaseModel):
    candidate_id: int = Field(..., ge=1)
    content: str = Field(..., min_length=1)
    follow_up_type: str = Field("note", max_length=50)


class OfferCreateRequest(BaseModel):
    candidate_id: int = Field(..., ge=1)
    position_id: Optional[int] = None
    offer_title: Optional[str] = None
    salary: Optional[str] = None
    department: Optional[str] = None
    entry_date: Optional[str] = None
    offer_content: Optional[str] = None
    notes: Optional[str] = None


class OfferUpdateRequest(BaseModel):
    offer_title: Optional[str] = None
    salary: Optional[str] = None
    department: Optional[str] = None
    entry_date: Optional[str] = None
    offer_content: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None


class RecruitmentChatContextUpdateRequest(BaseModel):
    position_id: Optional[int] = None
    candidate_id: Optional[int] = None
    skill_ids: List[int] = Field(default_factory=list)


class RecruitmentChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    context: Optional[Dict[str, Any]] = None


class RecruitmentLLMConfigUpsertRequest(BaseModel):
    config_key: str = Field(..., min_length=1, max_length=120)
    org_code: Optional[str] = Field(None, max_length=100)
    scope_level: str = Field("ORG", max_length=40)
    share_policy: str = Field("PRIVATE", max_length=40)
    allow_sub_org_use: bool = False
    allow_copy: bool = False
    task_type: str = Field("default", min_length=1, max_length=80)
    provider: str = Field(..., min_length=1, max_length=80)
    model_name: str = Field(..., min_length=1, max_length=120)
    base_url: Optional[str] = None
    api_key_env: Optional[str] = None
    api_key_value: Optional[str] = None
    extra_config: Optional[Dict[str, Any]] = None
    max_concurrent: int = Field(4, ge=1, le=100, description="该key最大并发数")
    max_qps: int = Field(10, ge=0, le=1000, description="该key每秒最大请求数，0表示不限制")
    is_active: bool = True
    priority: int = Field(99, ge=0, le=999)


class RecruitmentMailSenderUpsertRequest(BaseModel):
    org_code: Optional[str] = Field(None, max_length=100)
    scope_level: str = Field("ORG", max_length=40)
    share_policy: str = Field("PRIVATE", max_length=40)
    allow_sub_org_use: bool = False
    allow_copy: bool = False
    name: str = Field(..., min_length=1, max_length=120)
    from_name: Optional[str] = None
    from_email: str = Field(..., min_length=3, max_length=180)
    smtp_host: str = Field(..., min_length=1, max_length=255)
    smtp_port: int = Field(465, ge=1, le=65535)
    username: str = Field(..., min_length=1, max_length=180)
    password: Optional[str] = None
    use_ssl: bool = True
    use_starttls: bool = False
    is_default: bool = False
    is_enabled: bool = True


class RecruitmentMailRecipientUpsertRequest(BaseModel):
    org_code: Optional[str] = Field(None, max_length=100)
    scope_level: str = Field("ORG", max_length=40)
    share_policy: str = Field("PRIVATE", max_length=40)
    allow_sub_org_use: bool = False
    allow_copy: bool = False
    name: str = Field(..., min_length=1, max_length=120)
    email: str = Field(..., min_length=3, max_length=180)
    department: Optional[str] = None
    role_title: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    notes: Optional[str] = None
    is_enabled: bool = True


class RecruitmentResourceGovernanceUpdateRequest(BaseModel):
    org_code: Optional[str] = Field(None, max_length=100)
    scope_level: Optional[str] = Field(None, max_length=40)
    share_policy: Optional[str] = Field(None, max_length=40)
    allow_sub_org_use: Optional[bool] = None
    allow_copy: Optional[bool] = None
    is_enabled: Optional[bool] = None


class RecruitmentResourceCopyRequest(BaseModel):
    target_org_code: Optional[str] = Field(None, max_length=100)


class RecruitmentResumeMailSendRequest(BaseModel):
    sender_config_id: Optional[int] = None
    candidate_ids: List[int] = Field(..., min_length=1)
    recipient_ids: List[int] = Field(default_factory=list)
    recipient_emails: List[str] = Field(default_factory=list)
    cc_recipient_ids: List[int] = Field(default_factory=list)
    cc_recipient_emails: List[str] = Field(default_factory=list)
    bcc_recipient_ids: List[int] = Field(default_factory=list)
    bcc_recipient_emails: List[str] = Field(default_factory=list)
    subject: Optional[str] = None
    body_text: Optional[str] = None
    body_html: Optional[str] = None


class RecruitmentMailAutoPushGlobalConfigRequest(BaseModel):
    global_default_recipient_ids: List[int] = Field(default_factory=list)
    global_auto_push_enabled: bool = False
