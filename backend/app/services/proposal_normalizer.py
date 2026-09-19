from __future__ import annotations

from collections import defaultdict

from app.models.domain import ApplyPlanEnvelope, ApplyPreview, ApplyValidation, GraphOperation, GraphProposal, GraphProposalEnvelope, PatchGroup, PatchOperation, StudyGraph
from app.services.proposal_validator import ProposalValidator


class ProposalNormalizationError(RuntimeError):
    pass


class ProposalNormalizer:
    def __init__(self) -> None:
        self._validator = ProposalValidator()

    def normalize(self, envelope: GraphProposalEnvelope, graph: StudyGraph | None = None) -> ApplyPlanEnvelope:
        validation = self._validator.validate(envelope, graph) if graph else ApplyValidation(warnings=list(envelope.warnings))
        errors: list[str] = list(validation.errors)
        warnings: list[str] = list(validation.warnings)
        patch_operations: list[PatchOperation] = []
        grouped_operations: dict[str, list[GraphOperation]] = defaultdict(list)
        preview = ApplyPreview()
        existing_topic_ids = {topic.id for topic in graph.topics} if graph else set()
        existing_edge_ids = {edge.id for edge in graph.edges} if graph else set()
        existing_zone_ids = {zone.id for zone in graph.zones} if graph else set()

        seen_op_ids: set[str] = set()
        for operation in envelope.operations:
            if operation.op_id in seen_op_ids:
                errors.append(f"duplicate op_id {operation.op_id}")
                continue
            seen_op_ids.add(operation.op_id)

            group_label = self._group_label(operation)
            grouped_operations[group_label].append(operation)

            try:
                patch_operation = self._to_patch_operation(operation)
            except ProposalNormalizationError as exc:
                errors.append(str(exc))
                continue

            patch_operations.append(patch_operation)
            self._accumulate_preview(preview, operation, existing_topic_ids, existing_edge_ids, existing_zone_ids)

        normalized_proposal = GraphProposal(
            proposal_id=envelope.proposal_id,
            base_graph_version=envelope.base_graph_version,
            graph_id=envelope.graph_id,
            user_prompt=envelope.intent.user_prompt,
            summary=envelope.summary,
            assistant_message=envelope.assistant_message,
            warnings=list(warnings),
            assumptions=list(envelope.assumptions),
            operations=patch_operations,
        )
        patch_groups = [
            PatchGroup(group_id=f"group_{index + 1}", label=label, operations=operations)
            for index, (label, operations) in enumerate(grouped_operations.items())
        ]
        validation = ApplyValidation(ok=not errors, errors=errors, warnings=warnings)
        return ApplyPlanEnvelope(
            proposal_id=envelope.proposal_id,
            graph_id=envelope.graph_id,
            validation=validation,
            normalized_proposal=normalized_proposal,
            patch_groups=patch_groups,
            preview=preview,
        )

    def _to_patch_operation(self, operation: GraphOperation) -> PatchOperation:
        if operation.op == "upsert_topic" and operation.topic is None:
            raise ProposalNormalizationError(f"{operation.op_id}: upsert_topic missing topic payload")
        if operation.op == "upsert_edge" and operation.edge is None:
            raise ProposalNormalizationError(f"{operation.op_id}: upsert_edge missing edge payload")
        if operation.op == "upsert_zone" and operation.zone is None:
            raise ProposalNormalizationError(f"{operation.op_id}: upsert_zone missing zone payload")
        if operation.op == "set_mastery" and not (operation.topic_id and operation.state):
            raise ProposalNormalizationError(f"{operation.op_id}: set_mastery missing topic_id or state")
        return PatchOperation(
            op=operation.op,
            topic_id=operation.topic_id,
            edge_id=operation.edge_id,
            zone_id=operation.zone_id,
            state=operation.state,
            topic=operation.topic,
            edge=operation.edge,
            zone=operation.zone,
        )

    def _group_label(self, operation: GraphOperation) -> str:
        if operation.entity_kind == "topic":
            return "Topic changes"
        if operation.entity_kind == "edge":
            return "Dependency changes"
        if operation.entity_kind == "zone":
            return "Zone changes"
        if operation.entity_kind == "mastery":
            return "Mastery changes"
        return "Other changes"

    def _accumulate_preview(
        self,
        preview: ApplyPreview,
        operation: GraphOperation,
        existing_topic_ids: set[str],
        existing_edge_ids: set[str],
        existing_zone_ids: set[str],
    ) -> None:
        if operation.op == "upsert_topic":
            topic_id = operation.topic.id if operation.topic else operation.topic_id
            if topic_id and topic_id in existing_topic_ids:
                return
            preview.topic_add_count += 1
        elif operation.op == "upsert_edge":
            edge_id = operation.edge.id if operation.edge else operation.edge_id
            if edge_id and edge_id in existing_edge_ids:
                return
            preview.edge_add_count += 1
        elif operation.op == "upsert_zone":
            zone_id = operation.zone.id if operation.zone else operation.zone_id
            if zone_id and zone_id in existing_zone_ids:
                preview.zone_update_count += 1
            else:
                preview.zone_add_count += 1
        elif operation.op == "set_mastery":
            preview.mastery_update_count += 1
