import { useState } from "react";
import { Globe } from "@phosphor-icons/react";
import { INTERFACE_LANGUAGES, isAppLocale, type LocalePreference } from "../lib/appLocale";
import type { AppCopy } from "../lib/appCopy";

export function LanguageSelect({ locale, changeLocale, copy, compact = false }: LocalePreference & {
  copy: AppCopy["locale"];
  compact?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  async function select(value: string) {
    if (!isAppLocale(value) || value === locale) return;
    setSaving(true);
    setError(false);
    try {
      await changeLocale(value);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return <div className={compact ? "signInLanguage" : undefined}>
    <label className={compact ? "signInLanguageControl" : "uiField"}>
      {compact ? <Globe size={16} aria-hidden="true" /> : <span className="uiLabel">{copy.label}</span>}
      <select className="uiSelect" aria-label={copy.label} value={locale} disabled={saving}
        onChange={(event) => void select(event.target.value)}>
        {Object.entries(INTERFACE_LANGUAGES).map(([value, label]) => <option key={value} value={value} lang={value}>{label}</option>)}
      </select>
    </label>
    {error ? <p className={compact ? "signInError" : "inlineNotice inlineNoticeError"} role="alert">{copy.saveError}</p> : null}
  </div>;
}
