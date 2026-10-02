import { GithubLogo, OpenAiLogo, XLogo } from "@phosphor-icons/react";
import type { ChatGPTAccountController } from "../hooks/useChatGPTAccount";
import { ClewLogo } from "./ClewLogo";

export function SignIn({ chatgpt }: { chatgpt: ChatGPTAccountController }) {
  const { account, loading, error, warning, login, cancelLogin, logout, refresh } = chatgpt;
  const pending = account?.login;
  const completing = pending?.phase === "completing";
  const checking = !account && loading;
  return <main className="signIn">
    <section className="signInMain" aria-labelledby="signInTitle">
      <ClewLogo className="signInMark" />
      <h1 id="signInTitle">Welcome to Clew</h1>
      <div className="signInAction">
        <button className="signInContinue" type="button" disabled={loading || completing} aria-busy={loading || completing}
          onClick={() => void login()}>
          <OpenAiLogo size={20} aria-hidden="true" />
          <span>{completing ? "Finishing sign-in…" : pending ? "Continue in browser" : loading && !checking ? "Opening ChatGPT…" : "Continue with ChatGPT"}</span>
        </button>
        {pending && <div className="signInStatus" role="status">
          <p>Finish signing in in your browser.</p>
          <button type="button" disabled={loading} onClick={() => void cancelLogin()}>Cancel</button>
        </div>}
      </div>
      {(error || account?.error) && <div className="signInError" role="alert">{error || account?.error}<button type="button" onClick={() => void refresh()}>Try again</button></div>}
      {warning && <p className="signInStatus" role="status">{warning}</p>}
      {account && (account.can_disconnect || account.authenticated) && !account.sharing && <button className="signInQuiet" type="button" disabled={loading} onClick={() => void logout()}>Disconnect this account</button>}
      <footer className="signInFooter">
        <a href="https://github.com/miuuyy/Clew" target="_blank" rel="noopener noreferrer" aria-label="Star on GitHub" title="Star on GitHub"><GithubLogo size={20} aria-hidden="true" /></a>
        <a href="https://x.com/miu21590" target="_blank" rel="noopener noreferrer" aria-label="Follow on X" title="Follow on X"><XLogo size={18} aria-hidden="true" /></a>
        <a href="https://clew.my/docs" target="_blank" rel="noopener noreferrer">Docs</a>
      </footer>
    </section>
  </main>;
}
