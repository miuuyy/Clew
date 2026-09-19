from __future__ import annotations

from pathlib import Path

from fastapi import Depends, HTTPException, Request

from app.core.config import Settings, get_settings
from app.services.assessment_service import AssessmentService
from app.services.debug_log_service import get_debug_log_service
from app.services.proposal_normalizer import ProposalNormalizer
from app.services.repository import GraphRepository

_repository_instance: GraphRepository | None = None
_repository_db_path: Path | None = None


def get_repository(settings: Settings = Depends(get_settings)) -> GraphRepository:
    global _repository_instance, _repository_db_path
    if _repository_instance is None or _repository_db_path != settings.db_path:
        _repository_instance = GraphRepository(settings.db_path)
        _repository_db_path = settings.db_path
    return _repository_instance


def get_agent_runtime(request: Request):
    return request.app.state.agent_runtime


def get_normalizer() -> ProposalNormalizer:
    return ProposalNormalizer()


def get_quiz_service(settings: Settings = Depends(get_settings)) -> "QuizService":
    from app.services.quiz_service import QuizService

    return QuizService(settings)


def get_assessment_service() -> AssessmentService:
    return AssessmentService()


def get_debug_logs(settings: Settings = Depends(get_settings)):
    return get_debug_log_service(settings.root_dir)


def ensure_debug_logs_enabled(repository: GraphRepository = Depends(get_repository)) -> None:
    if not repository.current().workspace.config.debug_mode_enabled:
        raise HTTPException(status_code=403, detail="debug logs are disabled")
