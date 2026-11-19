import { GithubLogo, OpenAiLogo, XLogo } from "@phosphor-icons/react";
import type { ChatGPTAccountController } from "../hooks/useChatGPTAccount";
import { getAppCopy, type LocalePreference } from "../lib/appLocale";
import { ClewLogo } from "./ClewLogo";
import { LanguageSelect } from "./LanguageSelect";

export function SignIn({ chatgpt, ...preference }: { chatgpt: ChatGPTAccountController } & LocalePreference) {
  const copy = getAppCopy(preference.locale);
  const { account, loading, error, warning, login, cancelLogin, logout, refresh } = chatgpt;
  const pending = account?.login;
  const completing = pending?.phase === "completing";
  const checking = !account && loading;
  return <main className="signIn">
    <section className="signInMain" aria-labelledby="signInTitle">
      <ClewLogo className="signInMark" />
      <h1 id="signInTitle">{copy.signIn.welcome}</h1>
      <div className="signInAction">
        <button className="signInContinue" type="button" disabled={loading || completing} aria-busy={loading || completing}
          onClick={() => void login()}>
          <OpenAiLogo size={20} aria-hidden="true" />
          <span>{completing ? copy.signIn.finishing : pending ? copy.signIn.continueInBrowser : loading && !checking ? copy.signIn.opening : copy.signIn.continue}</span>
        </button>
        {pending && <div className="signInStatus" role="status">
          <p>{copy.signIn.finishInBrowser}</p>
          <button type="button" disabled={loading} onClick={() => void cancelLogin()}>{copy.dialogs.cancel}</button>
        </div>}
      </div>
      {(error || account?.error) && <div className="signInError" role="alert">{error || account?.error}<button type="button" onClick={() => void refresh()}>{copy.launch.retry}</button></div>}
      {warning && <p className="signInStatus" role="status">{warning}</p>}
      {account && (account.can_disconnect || account.authenticated) && !account.sharing && <button className="signInQuiet" type="button" disabled={loading} onClick={() => void logout()}>{copy.signIn.disconnect}</button>}
      <footer className="signInFooter">
        <a href="https://github.com/miuuyy/Clew" target="_blank" rel="noopener noreferrer" aria-label={copy.signIn.star} title={copy.signIn.star}><GithubLogo size={20} aria-hidden="true" /></a>
        <a href="https://x.com/miu21590" target="_blank" rel="noopener noreferrer" aria-label={copy.signIn.follow} title={copy.signIn.follow}><XLogo size={18} aria-hidden="true" /></a>
        <a href={copy.locale.docsUrl} target="_blank" rel="noopener noreferrer">{copy.signIn.docs}</a>
        <LanguageSelect {...preference} copy={copy.locale} compact />
      </footer>
    </section>
  </main>;
}
