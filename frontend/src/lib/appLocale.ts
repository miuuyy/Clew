import { APP_COPY, type AppCopy } from "./appCopy";
import { APP_COPY_ZH_CN } from "./appCopy.zh-CN";

export const INTERFACE_LANGUAGES = { en: "English", "zh-CN": "简体中文" };
export type AppLocale = keyof typeof INTERFACE_LANGUAGES;
export type LocalePreference = { locale: AppLocale; changeLocale: (locale: AppLocale) => Promise<void> };

const STORAGE_KEY = "clew_interface_language";
const COPY: Record<AppLocale, AppCopy> = { en: APP_COPY, "zh-CN": APP_COPY_ZH_CN };

export function isAppLocale(value: string | null): value is AppLocale {
  return value !== null && Object.hasOwn(INTERFACE_LANGUAGES, value);
}

export function getAppCopy(locale: AppLocale): AppCopy {
  return COPY[locale];
}

export function readBrowserLocale(): AppLocale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isAppLocale(stored)) return stored;
  } catch {
    // The browser may disable access to preferences.
  }
  const preferred = navigator.languages[0] ?? navigator.language;
  return preferred.toLowerCase().split("-")[0] === "zh" ? "zh-CN" : "en";
}

export async function readAppLocale(): Promise<AppLocale> {
  if (window.clewDesktop) return window.clewDesktop.getLocale();
  return readBrowserLocale();
}

export async function saveAppLocale(locale: AppLocale): Promise<void> {
  if (window.clewDesktop) await window.clewDesktop.setLocale(locale);
  else localStorage.setItem(STORAGE_KEY, locale);
}
