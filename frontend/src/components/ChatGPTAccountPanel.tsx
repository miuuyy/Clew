import type { ChatGPTAccountController } from "../hooks/useChatGPTAccount";
import type { SettingsDrafts, SettingsDraftSetters } from "../lib/appContracts";
import type { AppCopy } from "../lib/appCopy";
import type { ReasoningEffort } from "../lib/types";
import { SectionHead } from "./SettingsSection";

// Responses API effort levels. A model that rejects one returns an explicit error.
const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

export function ChatGPTAccountPanel({ chatgpt, drafts, setDrafts, copy }: {
  copy: AppCopy;
  chatgpt: ChatGPTAccountController; drafts: SettingsDrafts; setDrafts: SettingsDraftSetters;
}) {
  const labels = copy.account;
  const { account, loading, error, warning } = chatgpt;
  const models = account?.models ?? [];
  const defaultModel = models.find((item) => item.isDefault);
  const model = drafts.model ? models.find((item) => item.model === drafts.model) : defaultModel;
  const login = account?.login;
  const ready = !!account?.authenticated && account.sharing;
  return <section className="stSection">
    <SectionHead
      eyebrow={labels.section}
      title="ChatGPT"
      action={<button className="uiButton uiButtonQuiet uiButtonSmall" type="button" disabled={loading} onClick={() => void chatgpt.refresh()}>{loading ? labels.checking : copy.settingsPanel.refresh}</button>}
    />
    {account?.authenticated ? <div className="stAccount">
      <span className={`stAccountDot${ready ? " stAccountDotOn" : ""}`} aria-hidden="true" />
      <div className="stAccountMain">
        <div className="stAccountName">{account.account?.email ?? account.account?.name ?? labels.connected}</div>
        <div className="uiHelp">{account.sharing ? labels.usingPlan : labels.sharingNotGranted}</div>
      </div>
      <a className="uiButton uiButtonSmall" href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">{labels.manageUsage}</a>
      <button className="uiButton uiButtonQuiet uiButtonSmall" type="button" disabled={loading} onClick={() => void chatgpt.logout()}>{labels.signOut}</button>
    </div> : login ? <div className="stAccount">
      <span className="stAccountDot stAccountDotPending" aria-hidden="true" />
      <div className="stAccountMain">
        <div className="stAccountName" role="status">{labels.finishInBrowser}</div>
        <div className="uiHelp">{labels.allowPlan}</div>
      </div>
      <a className="uiButton uiButtonSmall" href={login.authUrl} target="_blank" rel="noopener noreferrer">{labels.openSignIn}</a>
      <button className="uiButton uiButtonQuiet uiButtonSmall" type="button" disabled={loading} onClick={() => void chatgpt.cancelLogin()}>{copy.dialogs.cancel}</button>
    </div> : <div className="stConnect">
      <p className="stLead">{labels.connectHelp}</p>
      <button className="uiButton uiButtonPrimary" type="button" disabled={loading} onClick={() => void chatgpt.login()}>{labels.signIn}</button>
    </div>}
    {(error || account?.error) ? <div className="inlineNotice inlineNoticeError" role="alert">{error ?? account?.error}</div> : null}
    {warning ? <div className="inlineNotice" role="status">{warning}</div> : null}
    <div className="stFieldPair">
      <label className="uiField">
        <span className="uiLabel">{labels.model}</span>
        <select className="uiSelect" value={drafts.model} disabled={!ready} onChange={(event) => setDrafts.model(event.target.value)}>
          <option value="">{labels.planDefault}{defaultModel ? ` · ${defaultModel.displayName}` : ""}</option>
          {drafts.model && !models.some((item) => item.model === drafts.model) ? <option value={drafts.model}>{drafts.model} · {labels.unavailable}</option> : null}
          {models.map((item) => <option key={item.id} value={item.model}>{item.displayName}</option>)}
        </select>
      </label>
      <label className="uiField">
        <span className="uiLabel">{labels.reasoning}</span>
        <select className="uiSelect" value={drafts.reasoningEffort} disabled={!ready} onChange={(event) => setDrafts.reasoningEffort(event.target.value as ReasoningEffort | "")}>
          <option value="">{labels.modelDefault}</option>
          {drafts.reasoningEffort && !Object.hasOwn(labels.effort, drafts.reasoningEffort) ? <option value={drafts.reasoningEffort}>{drafts.reasoningEffort} · {labels.unsupported}</option> : null}
          {EFFORTS.map((effort) => <option key={effort} value={effort}>{labels.effort[effort]}</option>)}
        </select>
      </label>
    </div>
    {model?.description ? <p className="uiHelp">{model.description}</p> : null}
  </section>;
}
