from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

INLINE_QUIZ_CHOICE_COUNT = 4
from app.models.domain import EdgeRelation, ProposalOpenQuestion


class ToolInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ProposalResourceDraft(ToolInput):
    id: str | None = None
    label: str
    url: str
    kind: str = "reference"


class ProposalTopicDraft(ToolInput):
    id: str
    title: str
    slug: str
    description: str = ""
    difficulty: float = 0.0
    estimated_minutes: int = 0
    level: int = 0
    state: str = "not_started"
    zones: list[str] = Field(default_factory=list)
    resources: list[ProposalResourceDraft] = Field(default_factory=list)


class ProposalEdgeDraft(ToolInput):
    id: str
    source_topic_id: str
    target_topic_id: str
    relation: EdgeRelation = "requires"
    rationale: str = ""
    weight: float = 1.0


class ProposalZoneDraft(ToolInput):
    id: str
    title: str
    kind: str
    topic_ids: list[str] = Field(default_factory=list)


class GraphOperationDraft(ToolInput):
    op_id: str = Field(min_length=1)
    op: Literal["upsert_topic", "upsert_edge", "upsert_zone"]
    entity_kind: Literal["topic", "edge", "zone"]
    rationale: str = ""
    topic: ProposalTopicDraft | None = None
    edge: ProposalEdgeDraft | None = None
    zone: ProposalZoneDraft | None = None

    @model_validator(mode="after")
    def matching_payload(self):
        entity = self.op.removeprefix("upsert_")
        if self.entity_kind != entity or getattr(self, entity) is None:
            raise ValueError("Operation, entity_kind and payload must describe the same entity.")
        if sum(getattr(self, kind) is not None for kind in ("topic", "edge", "zone")) != 1:
            raise ValueError("An operation must contain exactly one entity payload.")
        return self


class ProposalDraft(ToolInput):
    model_config = {"extra": "forbid"}
    base_graph_version: int = Field(ge=1)
    summary: str = Field(min_length=1, description="A concise description of the proposed graph change for user review.")
    assistant_message: str = Field(
        default="",
        description="A message explaining the proposal. Format with standard single unescaped newlines. DO NOT output literal double-escaped '\\n' strings."
    )
    assumptions: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    open_questions: list[ProposalOpenQuestion] = Field(default_factory=list)
    operations: list[GraphOperationDraft] = Field(default_factory=list)


class InlineQuizDraft(ToolInput):
    question: str = Field(min_length=1)
    choices: list[str]
    correct_index: int

    @model_validator(mode="after")
    def _validate_shape(self) -> "InlineQuizDraft":
        if len(self.choices) != INLINE_QUIZ_CHOICE_COUNT:
            raise ValueError(f"inline quiz must contain exactly {INLINE_QUIZ_CHOICE_COUNT} choices")
        if len(set(self.choices)) != INLINE_QUIZ_CHOICE_COUNT:
            raise ValueError("inline quiz choices must be distinct")
        if self.correct_index < 0 or self.correct_index >= INLINE_QUIZ_CHOICE_COUNT:
            raise ValueError("inline quiz correct_index is out of range")
        return self


class QuizQuestionDraft(ToolInput):
    prompt: str = Field(min_length=1)
    choices: list[str]
    correct_choice_index: int
    explanation: str = ""

    @model_validator(mode="after")
    def _validate_shape(self) -> "QuizQuestionDraft":
        if len(self.choices) != INLINE_QUIZ_CHOICE_COUNT:
            raise ValueError(f"quiz question must contain exactly {INLINE_QUIZ_CHOICE_COUNT} choices")
        if len(set(self.choices)) != INLINE_QUIZ_CHOICE_COUNT:
            raise ValueError("quiz question choices must be distinct")
        if self.correct_choice_index < 0 or self.correct_choice_index >= INLINE_QUIZ_CHOICE_COUNT:
            raise ValueError("quiz question correct_choice_index is out of range")
        return self


class QuizQuestionSetDraft(ToolInput):
    questions: list[QuizQuestionDraft] = Field(default_factory=list)


class QuestionDraft(ToolInput):
    model_config = {"extra": "forbid"}
    question: str = Field(min_length=1, max_length=4000)
    choices: list[str] = Field(default_factory=list, max_length=6)


class ClosureQuizDraft(QuizQuestionSetDraft):
    model_config = {"extra": "forbid"}
    topic_id: str


TOOL_MODELS = {
    "propose_ingest": ProposalDraft,
    "propose_expand": ProposalDraft,
    "ask_question": QuestionDraft,
    "present_quiz": InlineQuizDraft,
    "create_closure_quiz": ClosureQuizDraft,
}


def tool_specs() -> list[dict[str, Any]]:
    descriptions = {
        "propose_ingest": "Submit graph operations that preserve the supplied source material. Clew validates and presents them for user review; this does not apply changes. Omitted descriptive metadata is preserved on existing topics. Read the current graph version first.",
        "propose_expand": "Submit graph operations that extend the learning path toward the user's goal. Clew validates and presents them for user review; this does not apply changes. Omitted descriptive metadata is preserved on existing topics. Read the current graph version first.",
        "ask_question": "Ask the user a focused question, optionally with choices. Waits for their answer; free-text replies are always allowed.",
        "present_quiz": "Present one multiple-choice learning checkpoint with exactly four distinct choices. Waits for the user's answer and returns the graded result. Does not award topic completion.",
        "create_closure_quiz": "Register a complete closure quiz for a topic. Supply the requested number of questions with four distinct choices each. Clew checks prerequisites and grades the learner's answers itself.",
    }
    functions = [
        {"type": "function", "name": name, "description": descriptions[name], "inputSchema": model.model_json_schema()}
        for name, model in TOOL_MODELS.items()
    ]
    functions.extend([
        {"type": "function", "name": "read_graph", "description": "Read the current graph, its version, topics, edges, zones and progress. Call again after a conflict; do not guess ids or graph revisions.", "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
        {"type": "function", "name": "read_topic", "description": "Read the full content, resources, artifacts and prerequisites of a topic in this conversation's graph.", "inputSchema": {"type": "object", "properties": {"topic_id": {"type": "string"}}, "required": ["topic_id"], "additionalProperties": False}},
    ])
    return [{"type": "namespace", "name": "clew", "description": "The learning workspace: graph proposals and interactive study tools.", "tools": functions}]
