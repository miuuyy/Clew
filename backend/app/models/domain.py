from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator



TopicState = Literal["not_started", "learning", "shaky", "solid", "mastered", "needs_review"]
EdgeRelation = Literal["requires", "supports", "bridges", "extends", "reviews"]
GraphLanguage = Literal["en", "uk", "ru"]
ReasoningEffort = Literal["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]
ChatAction = Literal["answer", "propose_ingest", "propose_expand"]
MemoryMode = Literal["balanced", "max", "custom"]
OperationType = Literal[
    "upsert_topic",
    "remove_topic",
    "upsert_edge",
    "remove_edge",
    "upsert_zone",
    "set_mastery",
]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ResourceLink(BaseModel):
    id: str
    label: str
    url: str
    kind: str = "reference"


class Artifact(BaseModel):
    id: str
    title: str
    kind: str
    body: str
    created_at: datetime = Field(default_factory=utc_now)


class QuizPolicy(BaseModel):
    question_count: int = 12
    pass_threshold: float = 0.75


MEMORY_MODE_PRESETS: dict[MemoryMode, dict[str, int | bool]] = {
    "balanced": {
        "memory_history_message_limit": 32,
        "memory_include_graph_context": True,
        "memory_include_progress_context": True,
        "memory_include_quiz_context": True,
        "memory_include_frontier_context": True,
        "memory_include_selected_topic_context": True,
    },
    "max": {
        "memory_history_message_limit": 64,
        "memory_include_graph_context": True,
        "memory_include_progress_context": True,
        "memory_include_quiz_context": True,
        "memory_include_frontier_context": True,
        "memory_include_selected_topic_context": True,
    },
    "custom": {
        "memory_history_message_limit": 32,
        "memory_include_graph_context": True,
        "memory_include_progress_context": True,
        "memory_include_quiz_context": True,
        "memory_include_frontier_context": True,
        "memory_include_selected_topic_context": True,
    },
}

LEGACY_COMPACT_MEMORY_PRESET: dict[str, int | bool] = {
    "memory_history_message_limit": 12,
    "memory_include_graph_context": False,
    "memory_include_progress_context": True,
    "memory_include_quiz_context": False,
    "memory_include_frontier_context": True,
    "memory_include_selected_topic_context": True,
}


class QuizAttempt(BaseModel):
    id: str
    topic_id: str
    passed: bool
    score: float
    question_count: int
    closure_awarded: bool = False
    created_at: datetime = Field(default_factory=utc_now)
    missed_questions: list[str] = Field(default_factory=list)
    fail_count: int = 0


class QuizQuestion(BaseModel):
    id: str
    prompt: str
    choices: list[str] = Field(default_factory=list)
    correct_choice_index: int
    explanation: str = ""


class QuizQuestionSet(BaseModel):
    questions: list[QuizQuestion] = Field(default_factory=list)


class QuizAnswer(BaseModel):
    question_id: str
    choice_index: int


class TopicClosureStatus(BaseModel):
    topic_id: str
    prerequisite_topic_ids: list[str] = Field(default_factory=list)
    blocked_prerequisite_ids: list[str] = Field(default_factory=list)
    can_award_completion: bool = True
    latest_attempt: QuizAttempt | None = None


class TopicQuizSession(BaseModel):
    session_id: str
    graph_id: str
    topic_id: str
    created_at: datetime = Field(default_factory=utc_now)
    question_count: int
    questions: list[QuizQuestion] = Field(default_factory=list)
    closure_status: TopicClosureStatus
    generator: str = "heuristic"


class QuizQuestionPublic(BaseModel):
    id: str
    prompt: str
    choices: list[str] = Field(default_factory=list)
    explanation: str = ""


class TopicQuizSessionPublic(BaseModel):
    session_id: str
    graph_id: str
    topic_id: str
    created_at: datetime = Field(default_factory=utc_now)
    question_count: int
    questions: list[QuizQuestionPublic] = Field(default_factory=list)
    closure_status: TopicClosureStatus
    generator: str = "heuristic"


class QuizQuestionReview(BaseModel):
    question_id: str
    prompt: str
    selected_choice: str | None = None
    correct_choice: str
    was_correct: bool
    explanation: str = ""


class QuizStartRequest(BaseModel):
    question_count: int | None = None
    model: str | None = None


class QuizStartResponse(BaseModel):
    session: TopicQuizSessionPublic


class QuizSubmitRequest(BaseModel):
    session_id: str
    answers: list[QuizAnswer] = Field(default_factory=list)


class QuizSubmitResponse(BaseModel):
    attempt: QuizAttempt
    closure_status: TopicClosureStatus
    awarded_state: TopicState | None = None
    reviews: list[QuizQuestionReview] = Field(default_factory=list)
    workspace: "WorkspaceEnvelope"


class Topic(BaseModel):
    id: str
    title: str
    slug: str
    description: str = ""
    difficulty: float = 0.0
    estimated_minutes: int = 0
    level: int = 0
    state: TopicState = "not_started"
    zones: list[str] = Field(default_factory=list)
    resources: list[ResourceLink] = Field(default_factory=list)
    artifacts: list[Artifact] = Field(default_factory=list)
    quiz_policy: QuizPolicy = Field(default_factory=QuizPolicy)
    metadata: dict[str, Any] = Field(default_factory=dict)


class Edge(BaseModel):
    id: str
    source_topic_id: str
    target_topic_id: str
    relation: EdgeRelation = "requires"
    rationale: str = ""
    weight: float = 1.0


class Zone(BaseModel):
    id: str
    title: str
    kind: str
    color: str
    intensity: float = 0.5
    topic_ids: list[str] = Field(default_factory=list)


class StudyGraph(BaseModel):
    graph_id: str
    subject: str
    title: str
    language: GraphLanguage = "en"
    version: int = 1
    generated_at: datetime = Field(default_factory=utc_now)
    topics: list[Topic] = Field(default_factory=list)
    edges: list[Edge] = Field(default_factory=list)
    zones: list[Zone] = Field(default_factory=list)
    quiz_attempts: list[QuizAttempt] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkspaceConfig(BaseModel):
    @model_validator(mode="before")
    @classmethod
    def migrate_agent_settings(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        data = dict(data)
        # A one-time data migration, never a runtime provider/model fallback.
        if data.get("ai_provider") in {"gemini", "openai"}:
            data["default_model"] = None
        if data.get("memory_mode") == "compact":
            data["memory_mode"] = "custom"
            for key, value in LEGACY_COMPACT_MEMORY_PRESET.items():
                data.setdefault(key, value)
        return data

    agent_backend: Literal["codex"] = "codex"
    default_model: str | None = None
    reasoning_effort: ReasoningEffort | None = None
    ui_language: str = "en"
    canonical_graph_language: str = "en"
    web_search_enabled: bool = True
    disable_idle_animations: bool = False
    memory_mode: MemoryMode = "balanced"
    assistant_nickname: str = ""
    persona_rules: str = ""
    quiz_question_count: int = Field(default=12, ge=6, le=12)
    pass_threshold: float = Field(default=0.75, gt=0, le=1)
    enable_closure_tests: bool = True
    debug_mode_enabled: bool = False
    memory_history_message_limit: int = Field(default=32, ge=4, le=120)
    memory_include_graph_context: bool = True
    memory_include_progress_context: bool = True
    memory_include_quiz_context: bool = True
    memory_include_frontier_context: bool = True
    memory_include_selected_topic_context: bool = True
    allow_explore_without_closure: bool = True
    require_prerequisite_closure_for_completion: bool = True


class WorkspaceDocument(BaseModel):
    workspace_id: str = "default"
    title: str = "Clew Workspace"
    active_graph_id: str | None = None
    config: WorkspaceConfig = Field(default_factory=WorkspaceConfig)
    graphs: list[StudyGraph] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class GraphSummary(BaseModel):
    graph_id: str
    subject: str
    title: str
    topic_count: int
    edge_count: int
    zone_count: int
    version: int


class CreateGraphRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    subject: str = Field(min_length=1, max_length=120)
    language: GraphLanguage = "en"
    description: str = Field(default="", max_length=2000)


class UpdateWorkspaceConfigRequest(BaseModel):
    model_config = {"extra": "forbid"}
    default_model: str | None = None
    reasoning_effort: ReasoningEffort | None = None
    web_search_enabled: bool | None = None
    disable_idle_animations: bool | None = None
    memory_mode: MemoryMode | None = None
    assistant_nickname: str | None = None
    persona_rules: str | None = None
    quiz_question_count: int | None = Field(default=None, ge=6, le=12)
    pass_threshold: float | None = Field(default=None, gt=0, le=1)
    enable_closure_tests: bool | None = None
    debug_mode_enabled: bool | None = None
    memory_history_message_limit: int | None = Field(default=None, ge=4, le=120)
    memory_include_graph_context: bool | None = None
    memory_include_progress_context: bool | None = None
    memory_include_quiz_context: bool | None = None
    memory_include_frontier_context: bool | None = None
    memory_include_selected_topic_context: bool | None = None






ChatRole = Literal["user", "assistant"]


class InlineChatQuiz(BaseModel):
    question: str
    choices: list[str]  # exactly 4
    correct_index: int  # 0-3
    answered_index: int | None = None
    interaction_id: str | None = None
    status: Literal["pending", "answered", "interrupted"] = "pending"


class AgentQuestion(BaseModel):
    interaction_id: str
    question: str
    choices: list[str] = Field(default_factory=list)
    answer: str | None = None
    status: Literal["pending", "answered", "interrupted"] = "pending"


class AgentActivity(BaseModel):
    id: str
    tool: str
    status: Literal["running", "completed", "failed"]
    detail: str = ""


class ChatMessage(BaseModel):
    id: str | None = None
    role: ChatRole
    reply_id: str | None = None
    message_phase: Literal["commentary", "final_answer"] | None = None
    content: str
    hidden: bool = False
    created_at: datetime = Field(default_factory=utc_now)
    model: str | None = None
    fallback_used: bool = False
    action: ChatAction | None = None
    planning_status: str | None = None
    planning_error: str | None = None
    proposal_applied: bool = False
    proposal: "ProposalGenerateResponse | None" = None
    inline_quiz: InlineChatQuiz | None = None
    question: AgentQuestion | None = None
    closure_quiz: TopicQuizSessionPublic | None = None
    activity: AgentActivity | None = None
    agent_status: Literal["streaming", "completed", "interrupted", "failed"] | None = None


class GraphChatThread(BaseModel):
    session_id: str
    graph_id: str
    topic_id: str | None = None
    title: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    messages: list[ChatMessage] = Field(default_factory=list)
    codex_thread_id: str | None = None
    run_id: str | None = None
    active_turn_id: str | None = None
    agent_status: str = "idle"


class ChatSessionSummary(BaseModel):
    session_id: str
    graph_id: str
    topic_id: str | None = None
    title: str | None = None
    created_at: datetime
    updated_at: datetime
    message_count: int = 0


class GraphChatRequest(BaseModel):
    model_config = {"extra": "forbid", "str_strip_whitespace": True}
    prompt: str = Field(min_length=1, max_length=200000)
    hidden_user_message: bool = False
    client_message_id: str | None = None
    selected_topic_id: str | None = None
    session_id: str | None = None
    model: str | None = None
    use_grounding: bool = True




class GraphAssessmentCard(BaseModel):
    label: str
    value: str
    tone: Literal["neutral", "good", "warn"]
    rationale: str = ""


class GraphAssessment(BaseModel):
    graph_id: str
    cards: list[GraphAssessmentCard] = Field(default_factory=list)


class SourceLink(BaseModel):
    label: str
    url: str


class SourceTopicSeed(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=4000)
    estimated_minutes: int | None = None
    testing_notes: str = Field(default="", max_length=4000)
    links: list[SourceLink] = Field(default_factory=list)


ProposalMode = Literal["ingest_topics", "expand_goal"]
ProtocolKind = Literal["graph_proposal", "apply_plan", "quiz_closure", "rollback"]
ImpactLevel = Literal["low", "medium", "high"]
ProposalStatus = Literal["proposed", "reviewed", "rejected", "applied"]
EntityKind = Literal["topic", "edge", "zone", "mastery"]




class ProposalTopic(BaseModel):
    id: str
    title: str
    slug: str
    description: str = ""
    difficulty: float = 0.0
    estimated_minutes: int = 0
    level: int = 0
    state: TopicState = "not_started"
    zones: list[str] = Field(default_factory=list)
    resources: list[ResourceLink] = Field(default_factory=list)


class ProposalEdge(BaseModel):
    id: str
    source_topic_id: str
    target_topic_id: str
    relation: EdgeRelation = "requires"
    rationale: str = ""
    weight: float = 1.0


class ProposalZone(BaseModel):
    id: str
    title: str
    kind: str
    color: str = ""
    intensity: float = 0.5
    topic_ids: list[str] = Field(default_factory=list)


class ProposalIntent(BaseModel):
    user_prompt: str = ""
    target_goal: str = ""
    instructions: str = ""


class ProposalSourceBundle(BaseModel):
    raw_text: str = ""
    source_items: list[SourceTopicSeed] = Field(default_factory=list)
    grounding_enabled: bool = True


class ProposalOpenQuestion(BaseModel):
    id: str
    kind: str
    message: str
    impact: ImpactLevel = "medium"
    suggested_resolution: str = ""


class ProposalProvenance(BaseModel):
    model: str = ""
    grounding_used: bool = False
    generated_at: datetime = Field(default_factory=utc_now)
    search_queries: list[str] = Field(default_factory=list)
    source_urls: list[str] = Field(default_factory=list)


class GraphOperation(BaseModel):
    op_id: str
    op: OperationType
    entity_kind: EntityKind
    status: ProposalStatus = "proposed"
    depends_on: list[str] = Field(default_factory=list)
    rationale: str = ""
    topic_id: str | None = None
    edge_id: str | None = None
    zone_id: str | None = None
    state: TopicState | None = None
    topic: ProposalTopic | None = None
    edge: ProposalEdge | None = None
    zone: ProposalZone | None = None


class PatchOperation(BaseModel):
    op: OperationType
    topic_id: str | None = None
    edge_id: str | None = None
    zone_id: str | None = None
    state: TopicState | None = None
    topic: ProposalTopic | None = None
    edge: ProposalEdge | None = None
    zone: ProposalZone | None = None


class GraphProposal(BaseModel):
    proposal_id: str = ""
    base_graph_version: int | None = None
    graph_id: str
    user_prompt: str
    summary: str
    assistant_message: str
    warnings: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    operations: list[PatchOperation] = Field(default_factory=list)


class GraphProposalEnvelope(BaseModel):
    protocol_version: str = "2.0"
    kind: ProtocolKind = "graph_proposal"
    workspace_id: str = "default"
    graph_id: str
    proposal_id: str = ""
    base_graph_version: int | None = None
    mode: ProposalMode
    intent: ProposalIntent = Field(default_factory=ProposalIntent)
    source_bundle: ProposalSourceBundle = Field(default_factory=ProposalSourceBundle)
    summary: str = ""
    assistant_message: str = ""
    assumptions: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    open_questions: list[ProposalOpenQuestion] = Field(default_factory=list)
    operations: list[GraphOperation] = Field(default_factory=list)
    provenance: ProposalProvenance = Field(default_factory=ProposalProvenance)


class PatchGroup(BaseModel):
    group_id: str
    label: str
    operations: list[GraphOperation] = Field(default_factory=list)


class ApplyPreview(BaseModel):
    topic_add_count: int = 0
    edge_add_count: int = 0
    zone_add_count: int = 0
    zone_update_count: int = 0
    mastery_update_count: int = 0


class ApplyValidation(BaseModel):
    ok: bool = True
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ApplyPlanEnvelope(BaseModel):
    protocol_version: str = "2.0"
    kind: ProtocolKind = "apply_plan"
    proposal_id: str
    graph_id: str
    validation: ApplyValidation
    normalized_proposal: GraphProposal
    patch_groups: list[PatchGroup] = Field(default_factory=list)
    preview: ApplyPreview


class ProposalTrace(BaseModel):
    model: str
    mode: ProposalMode
    used_grounding: bool
    raw_text_present: bool
    source_item_count: int
    usage_metadata: dict[str, Any] = Field(default_factory=dict)


class ProposalDisplay(BaseModel):
    summary: str
    highlights: list[str] = Field(default_factory=list)


class ProposalGenerateResponse(BaseModel):
    proposal_envelope: GraphProposalEnvelope
    apply_plan: ApplyPlanEnvelope
    trace: ProposalTrace
    display: ProposalDisplay



class SnapshotRecord(BaseModel):
    id: int
    created_at: datetime
    source: str
    reason: str | None = None
    parent_snapshot_id: int | None = None


class WorkspaceEnvelope(BaseModel):
    snapshot: SnapshotRecord
    workspace: WorkspaceDocument
