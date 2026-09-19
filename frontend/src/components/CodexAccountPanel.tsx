import type { CodexAccountController } from "../hooks/useCodexAccount";
import type { SettingsDrafts, SettingsDraftSetters } from "../lib/appContracts";
import type { ReasoningEffort } from "../lib/types";

export function CodexAccountPanel({ codex, drafts, setDrafts }: {
  codex: CodexAccountController; drafts: SettingsDrafts; setDrafts: SettingsDraftSetters;
}) {
  const { account, loading, error } = codex;
  const models = account?.models ?? [];
  const model = drafts.model ? models.find((item) => item.model === drafts.model) : models.find((item) => item.isDefault);
  const efforts = model?.supportedReasoningEfforts ?? [];
  const login = account?.login;
  const loginUrl = login?.authUrl ?? login?.verificationUrl;
  return <section className="settingsPanel settingsPanelWide">
    <div className="settingsPanelHeader"><div>
      <div className="settingsPanelEyebrow">AI connection</div>
      <div className="settingsPanelTitle">Codex</div>
    </div></div>
    <div className="settingsPanelBody">
      <div className="settingsLead">Sign in with ChatGPT to learn, build your graph, and continue your conversations with Codex.</div>
      {account?.authenticated ? <div className="codexAccountRow">
        <div><strong>{account.account?.email ?? "Connected to Codex"}</strong><div className="mutedSmall">{account.account?.planType ?? "ChatGPT"}</div></div>
        <button className="btn btn-sm" type="button" disabled={loading} onClick={() => void codex.logout()}>Sign out</button>
      </div> : login ? <div className="stack">
        <div role="status">Finish signing in in your browser.</div>
        {login.userCode ? <div>Enter code: <strong className="codexDeviceCode">{login.userCode}</strong></div> : null}
        <div className="row">
          {loginUrl ? <a className="btn btn-sm" href={loginUrl} target="_blank" rel="noopener noreferrer">Open sign in</a> : null}
          <button className="btn btn-sm" type="button" disabled={loading} onClick={() => void codex.cancelLogin()}>Cancel</button>
        </div>
      </div> : <div className="row">
        <button className="assistantSendButton" type="button" disabled={loading || !account?.connected} onClick={() => void codex.login()}>Sign in with ChatGPT</button>
        <button className="btn btn-sm" type="button" disabled={loading || !account?.connected} onClick={() => void codex.login(true)}>Use a device code</button>
      </div>}
      {(error || account?.error) ? <div className="inlineNotice inlineNoticeError" role="alert">{error ?? account?.error}</div> : null}
      <button className="btn btn-sm" type="button" disabled={loading} onClick={() => void codex.refresh()}>{loading ? "Connecting…" : "Refresh connection"}</button>
      <div className="settingsInlineFields">
        <label className="field"><span className="fieldLabel">Model</span>
          <select className="input" value={drafts.model} disabled={!account?.authenticated} onChange={(event) => { setDrafts.model(event.target.value); setDrafts.reasoningEffort(""); }}>
            <option value="">Codex default{models.find((item) => item.isDefault) ? ` · ${models.find((item) => item.isDefault)?.displayName}` : ""}</option>
            {drafts.model && !model ? <option value={drafts.model}>{drafts.model} · unavailable</option> : null}
            {models.map((item) => <option key={item.id} value={item.model}>{item.displayName}</option>)}
          </select>
        </label>
        <label className="field"><span className="fieldLabel">Reasoning</span>
          <select className="input" value={drafts.reasoningEffort} disabled={!model} onChange={(event) => setDrafts.reasoningEffort(event.target.value as ReasoningEffort | "")}>
            <option value="">Model default{model ? ` · ${model.defaultReasoningEffort}` : ""}</option>
            {drafts.reasoningEffort && !efforts.some((item) => item.reasoningEffort === drafts.reasoningEffort) ? <option value={drafts.reasoningEffort}>{drafts.reasoningEffort} · unavailable</option> : null}
            {efforts.map((item) => <option key={item.reasoningEffort} value={item.reasoningEffort}>{item.reasoningEffort}</option>)}
          </select>
        </label>
      </div>
      {model?.description ? <div className="mutedSmall">{model.description}</div> : null}
    </div>
  </section>;
}
