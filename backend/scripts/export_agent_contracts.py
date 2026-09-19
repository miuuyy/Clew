"""Regenerate public agent contracts: PYTHONPATH=backend python backend/scripts/export_agent_contracts.py."""
import json
from pathlib import Path
from app.agent.contracts import tool_specs
from app.models.domain import GraphProposalEnvelope

root = Path(__file__).resolve().parents[2]
schema = GraphProposalEnvelope.model_json_schema()
schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
schema["$id"] = "https://clew.local/contracts/graph_patch.schema.json"
schema["required"] = sorted(set(schema.get("required", [])) | {"proposal_id", "base_graph_version", "operations"})
schema["properties"]["proposal_id"] = {"type": "string", "minLength": 1}
schema["properties"]["base_graph_version"] = {"type": "integer", "minimum": 1}
schema["$defs"]["GraphOperation"]["properties"]["op"]["enum"] = ["upsert_topic", "upsert_edge", "upsert_zone"]
(root/"contracts"/"graph_patch.schema.json").write_text(json.dumps(schema, indent=2) + "\n")
(root/"contracts"/"clew_tools.schema.json").write_text(json.dumps(tool_specs(), indent=2) + "\n")
