from typing import Literal

AppLocale = Literal["en", "zh-CN"]


def preferred_locale(accept_language: str | None) -> AppLocale:
    primary = (accept_language or "").split(",", 1)[0].split(";", 1)[0].strip()
    return "zh-CN" if primary.lower().split("-", 1)[0] == "zh" else "en"
