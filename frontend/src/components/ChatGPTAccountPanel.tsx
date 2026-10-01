import type { ChatGPTAccountController } from "../hooks/useChatGPTAccount";
import type { SettingsDrafts, SettingsDraftSetters } from "../lib/appContracts";
import type { ReasoningEffort } from "../lib/types";
import { SectionHead } from "./SettingsSection";

// Responses API effort levels. A model that rejects one returns an explicit error.
const EFFORTS: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh"];

export function ChatGPTAccountPanel({ chatgpt, drafts, setDrafts }: {
  chatgpt: ChatGPTAccountController; drafts: SettingsDrafts; setDrafts: SettingsDraftSetters;
}) {
  const { account, loading, error, warning } = chatgpt;
  const models = account?.models ?? [];
  const defaultModel = models.find((item) => item.isDefault);
  const model = drafts.model ? models.find((item) => item.model === drafts.model) : defaultModel;
  const login = account?.login;
  const ready = !!account?.authenticated && account.sharing;
  return <section className="stSection">
    <SectionHead
      eyebrow="AI connection"
      title="ChatGPT"
      action={<button className="uiButton uiButtonQuiet uiButtonSmall" type="button" disabled={loading} onClick={() => void chatgpt.refresh()}>{loading ? "Checking…" : "Refresh"}</button>}
    />
    {account?.authenticated ? <div className="stAccount">
      <span className={`stAccountDot${ready ? " stAccountDotOn" : ""}`} aria-hidden="true" />
      <div className="stAccountMain">
        <div className="stAccountName">{account.account?.email ?? account.account?.name ?? "Connected to ChatGPT"}</div>
        <div className="uiHelp">{account.sharing ? "Using your ChatGPT plan" : "Plan sharing not granted"}</div>
      </div>
      <a className="uiButton uiButtonSmall" href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">Manage usage</a>
      <button className="uiButton uiButtonQuiet uiButtonSmall" type="button" disabled={loading} onClick={() => void chatgpt.logout()}>Sign out</button>
    </div> : login ? <div className="stAccount">
      <span className="stAccountDot stAccountDotPending" aria-hidden="true" />
      <div className="stAccountMain">
        <div className="stAccountName" role="status">Finish signing in in your browser</div>
        <div className="uiHelp">Allow Clew to use your ChatGPT plan, then return here.</div>
      </div>
      <a className="uiButton uiButtonSmall" href={login.authUrl} target="_blank" rel="noopener noreferrer">Open sign in</a>
      <button className="uiButton uiButtonQuiet uiButtonSmall" type="button" disabled={loading} onClick={() => void chatgpt.cancelLogin()}>Cancel</button>
    </div> : <div className="stConnect">
      <p className="stLead">Sign in with ChatGPT to learn and build your graph. Clew uses your ChatGPT Plus or Pro plan; no API key is needed.</p>
      <button className="uiButton uiButtonPrimary" type="button" disabled={loading} onClick={() => void chatgpt.login()}>Sign in with ChatGPT</button>
    </div>}
    {(error || account?.error) ? <div className="inlineNotice inlineNoticeError" role="alert">{error ?? account?.error}</div> : null}
    {warning ? <div className="inlineNotice" role="status">{warning}</div> : null}
    <div className="stFieldPair">
      <label className="uiField">
        <span className="uiLabel">Model</span>
        <select className="uiSelect" value={drafts.model} disabled={!ready} onChange={(event) => setDrafts.model(event.target.value)}>
          <option value="">Plan default{defaultModel ? ` · ${defaultModel.displayName}` : ""}</option>
          {drafts.model && !models.some((item) => item.model === drafts.model) ? <option value={drafts.model}>{drafts.model} · unavailable</option> : null}
          {models.map((item) => <option key={item.id} value={item.model}>{item.displayName}</option>)}
        </select>
      </label>
      <label className="uiField">
        <span className="uiLabel">Reasoning</span>
        <select className="uiSelect" value={drafts.reasoningEffort} disabled={!ready} onChange={(event) => setDrafts.reasoningEffort(event.target.value as ReasoningEffort | "")}>
          <option value="">Model default</option>
          {drafts.reasoningEffort && !EFFORTS.includes(drafts.reasoningEffort) ? <option value={drafts.reasoningEffort}>{drafts.reasoningEffort} · unsupported</option> : null}
          {EFFORTS.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
        </select>
      </label>
    </div>
    {model?.description ? <p className="uiHelp">{model.description}</p> : null}
  </section>;
}
