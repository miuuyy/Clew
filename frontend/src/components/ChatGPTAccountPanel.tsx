import type { ChatGPTAccountController } from "../hooks/useChatGPTAccount";
import type { SettingsDrafts, SettingsDraftSetters } from "../lib/appContracts";
import type { ReasoningEffort } from "../lib/types";

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
  return <section className="settingsPanel settingsPanelWide">
    <div className="settingsPanelHeader"><div>
      <div className="settingsPanelEyebrow">AI connection</div>
      <div className="settingsPanelTitle">ChatGPT</div>
    </div></div>
    <div className="settingsPanelBody">
      <div className="settingsLead">Sign in with ChatGPT to learn and build your graph. Clew uses your ChatGPT Plus or Pro plan; no API key is needed.</div>
      {account?.authenticated ? <div className="chatgptAccountRow">
        <div><strong>{account.account?.email ?? account.account?.name ?? "Connected to ChatGPT"}</strong><div className="mutedSmall">{account.sharing ? "Using your ChatGPT plan" : "Plan sharing not granted"}</div></div>
        <div className="row">
          <a className="btn btn-sm" href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">Manage usage</a>
          <button className="btn btn-sm" type="button" disabled={loading} onClick={() => void chatgpt.logout()}>Sign out</button>
        </div>
      </div> : login ? <div className="stack">
        <div role="status">Finish signing in in your browser.</div>
        <div className="row">
          <a className="btn btn-sm" href={login.authUrl} target="_blank" rel="noopener noreferrer">Open sign in</a>
          <button className="btn btn-sm" type="button" disabled={loading} onClick={() => void chatgpt.cancelLogin()}>Cancel</button>
        </div>
      </div> : <div className="row">
        <button className="assistantSendButton" type="button" disabled={loading} onClick={() => void chatgpt.login()}>Sign in with ChatGPT</button>
      </div>}
      {(error || account?.error) ? <div className="inlineNotice inlineNoticeError" role="alert">{error ?? account?.error}</div> : null}
      {warning ? <div className="inlineNotice" role="status">{warning}</div> : null}
      <button className="btn btn-sm" type="button" disabled={loading} onClick={() => void chatgpt.refresh()}>{loading ? "Checking…" : "Refresh connection"}</button>
      <div className="settingsInlineFields">
        <label className="field"><span className="fieldLabel">Model</span>
          <select className="input" value={drafts.model} disabled={!ready} onChange={(event) => setDrafts.model(event.target.value)}>
            <option value="">Plan default{defaultModel ? ` · ${defaultModel.displayName}` : ""}</option>
            {drafts.model && !models.some((item) => item.model === drafts.model) ? <option value={drafts.model}>{drafts.model} · unavailable</option> : null}
            {models.map((item) => <option key={item.id} value={item.model}>{item.displayName}</option>)}
          </select>
        </label>
        <label className="field"><span className="fieldLabel">Reasoning</span>
          <select className="input" value={drafts.reasoningEffort} disabled={!ready} onChange={(event) => setDrafts.reasoningEffort(event.target.value as ReasoningEffort | "")}>
            <option value="">Model default</option>
            {drafts.reasoningEffort && !EFFORTS.includes(drafts.reasoningEffort) ? <option value={drafts.reasoningEffort}>{drafts.reasoningEffort} · unsupported</option> : null}
            {EFFORTS.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
          </select>
        </label>
      </div>
      {model?.description ? <div className="mutedSmall">{model.description}</div> : null}
    </div>
  </section>;
}
