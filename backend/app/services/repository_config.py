from app.models.domain import MEMORY_MODE_PRESETS, UpdateWorkspaceConfigRequest, WorkspaceDocument


def apply_workspace_config_update(workspace: WorkspaceDocument, request: UpdateWorkspaceConfigRequest) -> list[str]:
    values = request.model_dump(exclude_unset=True)
    if not values:
        raise ValueError("no config fields provided")
    for key, value in values.items():
        if value is None and key not in {"default_model", "reasoning_effort"}:
            raise ValueError(f"{key} cannot be null")
        if key in {"default_model", "assistant_nickname", "persona_rules"} and isinstance(value, str):
            value = value.strip()
            if key == "default_model" and not value:
                raise ValueError("default_model cannot be empty")
        setattr(workspace.config, key, value)
    if request.memory_mode and request.memory_mode != "custom":
        for key, value in MEMORY_MODE_PRESETS[request.memory_mode].items():
            setattr(workspace.config, key, value)
    workspace.config = type(workspace.config).model_validate(workspace.config.model_dump())
    return [f"{key} updated" for key in values]
