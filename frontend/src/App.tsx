import React, { Suspense, useEffect, useLayoutEffect, useState } from "react";
import { useChatGPTAccount } from "./hooks/useChatGPTAccount";
import { ClewLoader } from "./components/ClewLoader";
import { SignIn } from "./components/SignIn";
import { APP_FAVICON_DARK_SRC } from "./lib/appContracts";
import { getAppCopy, saveAppLocale, type AppLocale, type LocalePreference } from "./lib/appLocale";
import { AppErrorBoundary } from "./components/AppErrorBoundary";

const WorkspaceApp = React.lazy(() => import("./WorkspaceApp"));

export default function App({ initialLocale }: { initialLocale: AppLocale }): React.JSX.Element {
  const [locale, setLocale] = useState(initialLocale);
  const copy = getAppCopy(locale);
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.title = copy.shell.workspace;
  }, [locale, copy]);
  async function changeLocale(next: AppLocale) {
    await saveAppLocale(next);
    setLocale(next);
  }
  return <AppErrorBoundary copy={copy.launch}>
    <AppContent locale={locale} changeLocale={changeLocale} />
  </AppErrorBoundary>;
}

function AppContent(preference: LocalePreference): React.JSX.Element {
  const copy = getAppCopy(preference.locale);
  const chatgpt = useChatGPTAccount(preference.locale);
  const ready = !!chatgpt.account?.authenticated && chatgpt.account.sharing;
  useEffect(() => {
    if (ready) return;
    document.querySelector('link[rel="icon"]')?.setAttribute("href", APP_FAVICON_DARK_SRC);
    document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute("href", APP_FAVICON_DARK_SRC);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#000000");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", "dark");
  }, [ready]);
  useEffect(() => {
    const refresh = () => void chatgpt.refresh();
    window.addEventListener("clew-sign-in-required", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("clew-sign-in-required", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [chatgpt.refresh]);
  if (!ready) return <SignIn chatgpt={chatgpt} {...preference} />;
  return <Suspense fallback={<div className="launchLoading"><ClewLoader size={56} label={copy.launch.openingWorkspace} /></div>}>
    <WorkspaceApp chatgpt={chatgpt} {...preference} />
  </Suspense>;
}
