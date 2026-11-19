from app.core.locale import AppLocale

_RENEW_SIGN_IN = "无法续期 ChatGPT 连接。请重新登录。"

ERRORS_ZH_CN = {
    "subscription_sharing_user_not_eligible": "此 ChatGPT 账号无法授权应用使用订阅。Clew 需要 ChatGPT Plus 或 Pro。",
    "subscription_sharing_usage_limit_exceeded": "已达到 ChatGPT 订阅的应用用量上限。请在 ChatGPT 设置中查看用量。",
    "subscription_sharing_usage_unavailable": "暂时无法查询 ChatGPT 用量。请稍后重试。",
    "subscription_sharing_unsupported_capability": "ChatGPT 订阅共享不支持此请求所需的功能。",
    "subscription_sharing_route_not_supported": "ChatGPT 订阅共享不支持此 API 路径。",
    "subscription_sharing_invalid_user": "ChatGPT 无法验证此账号的订阅。请重新登录。",
    "subscription_sharing_user_unavailable": "你的 ChatGPT 账号暂时无法使用。请稍后重试。",
    "invalid_grant": "ChatGPT 未接受此次登录。请重新登录。",
    "invalid_refresh_token": _RENEW_SIGN_IN,
    "refresh_token_expired": _RENEW_SIGN_IN,
    "refresh_token_invalidated": _RENEW_SIGN_IN,
    "refresh_token_reused": _RENEW_SIGN_IN,
    "token_expired": _RENEW_SIGN_IN,
    "invalid_token": "ChatGPT 未接受此凭据。请重新登录。",
    "access_denied": "登录未完成。",
    "model_not_found": "你的 ChatGPT 订阅无法使用此模型。请选择其他模型。",
    "transport_error": "Clew 无法连接到 ChatGPT。请检查网络后重试。",
    "credential_storage_unavailable": "无法使用系统凭据管理器。请检查系统设置后重试。",
    "credential_storage_corrupt": "无法使用已保存的 ChatGPT 连接。请退出后重新登录。",
    "connection_changed": "请求期间 ChatGPT 连接发生变化。请在 Clew 中重试。",
    "discovery_failed": "无法验证 ChatGPT 的登录配置。",
    "identity_verification_unavailable": "暂时无法验证 ChatGPT 身份。请稍后重试。",
    "invalid_id_token": "无法验证 ChatGPT 身份。请重新登录。",
    "invalid_token_response": "ChatGPT 返回的登录凭据信息无效或不完整。请重新登录。",
    "login_not_pending": "Clew 中没有等待完成的登录。登录可能已结束，或应用已重启。请返回 Clew 重新登录。",
    "missing_state": "登录链接缺少安全校验信息。请返回 Clew，取消待完成的登录，再选择「使用 ChatGPT 继续」。",
    "invalid_state": "此链接与 Clew 发起的登录不匹配。请在 Clew 中重新登录。",
    "login_expired": "登录已超时。请在 Clew 中重新登录。",
    "registration_incomplete": "ChatGPT 未完成应用注册。请重新登录。",
    "account_mismatch": "登录的 ChatGPT 账号与此连接关联的账号不符。",
    "not_signed_in": "请使用 ChatGPT 登录后再开始对话。",
    "sharing_not_granted": "尚未授权使用订阅。请重新登录并允许 Clew 使用你的 ChatGPT 订阅。",
    "invalid_model_catalog": "ChatGPT 返回的模型列表无效或不完整。",
    "account_change_active": "请先停止进行中的对话，再更换 ChatGPT 账号。",
    "sign_out_active": "请先停止进行中的对话，再退出登录。",
}


def error_message(code: str, detail: str, locale: AppLocale) -> str:
    if locale == "zh-CN":
        return ERRORS_ZH_CN.get(code) or f"ChatGPT 请求失败。详细信息：{detail}"
    return detail


def revoke_warning(locale: AppLocale) -> str:
    if locale == "zh-CN":
        return "本地凭据已移除，ChatGPT 尚未确认断开连接。请前往 ChatGPT 的「设置 → 已连接的应用」移除 Clew。"
    return "Local credentials were removed, but ChatGPT did not confirm the disconnect. Remove Clew in ChatGPT Settings → Connected apps."
