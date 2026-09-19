from __future__ import annotations

from app.agent.contracts import ProposalDraft
from app.models.domain import (
    GraphOperation, GraphProposalEnvelope, ProposalDisplay, ProposalGenerateResponse,
    ProposalIntent, ProposalProvenance, ProposalSourceBundle, ProposalTrace, StudyGraph,
)
from app.services.proposal_normalizer import ProposalNormalizer


class ProposalService:
    """Validate model-authored operations. This service does not call a model."""

    def prepare(self, graph: StudyGraph, draft: ProposalDraft, *, tool: str,
                proposal_id: str, prompt: str, model: str, use_grounding: bool) -> ProposalGenerateResponse:
        if draft.base_graph_version != graph.version:
            raise ValueError(f"Graph revision conflict: read_graph again. Current version is {graph.version}.")
        operations = []
        existing_topics = {topic.id: topic for topic in graph.topics}
        for item in draft.operations:
            payload = item.model_dump(exclude_none=True)
            if item.topic is not None and item.topic.id in existing_topics:
                existing = existing_topics[item.topic.id]
                # Native upsert input is a partial edit for descriptive metadata.
                # An omitted field must not erase the learner's existing study data.
                for field in ("description", "difficulty", "estimated_minutes", "level"):
                    if field not in item.topic.model_fields_set:
                        payload["topic"][field] = getattr(existing, field)
            for index, resource in enumerate((payload.get("topic") or {}).get("resources", [])):
                if not resource.get("id"):
                    resource["id"] = f"{payload['topic']['id']}_resource_{index + 1}"
            operations.append(GraphOperation.model_validate(payload))
        if not operations:
            raise ValueError("A proposal needs at least one graph operation. Reply normally if no change is needed.")
        mode = "ingest_topics" if tool == "propose_ingest" else "expand_goal"
        envelope = GraphProposalEnvelope(
            graph_id=graph.graph_id, proposal_id=proposal_id, base_graph_version=graph.version,
            mode=mode, intent=ProposalIntent(user_prompt=prompt),
            source_bundle=ProposalSourceBundle(raw_text=prompt, grounding_enabled=use_grounding),
            summary=draft.summary, assistant_message=draft.assistant_message,
            assumptions=draft.assumptions, warnings=draft.warnings,
            open_questions=draft.open_questions, operations=operations,
            provenance=ProposalProvenance(model=model, grounding_used=use_grounding),
        )
        plan = ProposalNormalizer().normalize(envelope, graph)
        if not plan.validation.ok:
            raise ValueError("; ".join(plan.validation.errors))
        envelope.warnings = list(plan.validation.warnings)
        highlights = [op.topic.title if op.topic else op.zone.title if op.zone else
                      f"{op.edge.source_topic_id} → {op.edge.target_topic_id}" if op.edge else op.op
                      for op in operations[:5]]
        return ProposalGenerateResponse(
            proposal_envelope=envelope, apply_plan=plan,
            trace=ProposalTrace(model=model, mode=mode, used_grounding=use_grounding,
                                raw_text_present=bool(prompt), source_item_count=0, usage_metadata={}),
            display=ProposalDisplay(summary=draft.summary, highlights=highlights),
        )
