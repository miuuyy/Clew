from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ProviderCatalogEntry:
    provider_id: str
    default_model: str
    model_options: tuple[str, ...]
    supports_web_grounding: bool


PROVIDER_CATALOG: dict[str, ProviderCatalogEntry] = {
    "gemini": ProviderCatalogEntry(
        provider_id="gemini",
        default_model="gemini-3.7-flash",
        model_options=(
            "gemini-3.7-flash",
            "gemini-2.5-pro",
            "gemini-2.5-flash",
            "gemini-2.5-flash-lite",
            "gemini-3-pro-preview",
            "gemini-3-flash-preview",
        ),
        supports_web_grounding=True,
    ),
    "openai": ProviderCatalogEntry(
        provider_id="openai",
        default_model="gpt-5.4",
        model_options=(
            "gpt-5.4",
            "gpt-5.4-mini",
            "gpt-5.4-nano",
            "gpt-5.1",
            "gpt-4.1",
            "gpt-4.1-mini",
        ),
        supports_web_grounding=True,
    ),
}


def supported_provider_ids() -> list[str]:
    return list(PROVIDER_CATALOG.keys())


def provider_catalog_entry(provider_id: str) -> ProviderCatalogEntry:
    normalized = (provider_id or "gemini").strip().lower()
    entry = PROVIDER_CATALOG.get(normalized)
    if entry is None:
        raise ValueError(f"unsupported provider {provider_id}")
    return entry


def provider_model_options(provider_id: str) -> list[str]:
    return list(provider_catalog_entry(provider_id).model_options)


def provider_default_model(provider_id: str) -> str:
    return provider_catalog_entry(provider_id).default_model
