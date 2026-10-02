import React, { Suspense, useEffect } from "react";
import { useChatGPTAccount } from "./hooks/useChatGPTAccount";
import { ClewLoader } from "./components/ClewLoader";
import { SignIn } from "./components/SignIn";
import { APP_FAVICON_DARK_SRC } from "./lib/appContracts";

const WorkspaceApp = React.lazy(() => import("./WorkspaceApp"));

export default function App(): React.JSX.Element {
  const chatgpt = useChatGPTAccount();
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
  if (!ready) return <SignIn chatgpt={chatgpt} />;
  return <Suspense fallback={<div className="launchLoading"><ClewLoader size={56} label="Opening your workspace" /></div>}>
    <WorkspaceApp chatgpt={chatgpt} />
  </Suspense>;
}
