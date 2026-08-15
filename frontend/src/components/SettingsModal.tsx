import React from "react";

import { Card } from "./Card";
import { MEMORY_MODE_OPTIONS, THINKING_MODE_OPTIONS, type MemoryMode, type SettingsDraftSetters, type SettingsDrafts, type ThinkingMode } from "../lib/appContracts";
import type { AppCopy } from "../lib/appCopy";
import type { GraphEnvelope, SnapshotRecord, WorkspaceConfig, WorkspaceEnvelope } from "../lib/types";

type StateSetter<T> = React.Dispatch<React.SetStateAction<T>>;
type SupportedProvider = "gemini" | "openai";

const DEFAULT_PROVIDER_MODELS: Record<SupportedProvider, string[]> = {
  openai: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.1", "gpt-4.1", "gpt-4.1-mini"],
  gemini: ["gemini-3.7-flash", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3-pro-preview", "gemini-3-flash-preview"],
};

type ModeOption<T extends string> = {
  id: T;
  label: string;
  title: string;
  description: string;
};

type SettingsModalProps = {
  isSettingsOpen: boolean;
  copy: AppCopy;
  setSettingsOpen: StateSetter<boolean>;
  currentConfig: WorkspaceConfig | null;
  drafts: SettingsDrafts;
  setDrafts: SettingsDraftSetters;
  geminiKeyLockedByEnv: boolean;
  openaiKeyLockedByEnv: boolean;
  providerOptions: string[];
  openaiBaseUrlLockedByEnv: boolean;
  activeThinkingOption: ModeOption<ThinkingMode>;
  activeThinkingValues: string;
  activeMemoryOption: ModeOption<MemoryMode>;
  activeMemoryValues: string;
  activeGraph: GraphEnvelope | null;
  loadSnapshots: () => Promise<void>;
  historyLoading: boolean;
  historyError: string | null;
  snapshots: SnapshotRecord[];
  data: WorkspaceEnvelope | null;
  rollbackSnapshot: (snapshotId: number) => Promise<void>;
  configSaving: boolean;
  settingsDirty: boolean;
  saveSettings: () => void;
};

export function SettingsModal(props: SettingsModalProps): React.JSX.Element | null {
  const {
    isSettingsOpen,
    copy,
    setSettingsOpen,
    currentConfig,
    drafts,
    setDrafts,
    geminiKeyLockedByEnv,
    openaiKeyLockedByEnv,
    providerOptions,
    openaiBaseUrlLockedByEnv,
    activeThinkingOption,
    activeThinkingValues,
    activeMemoryOption,
    activeMemoryValues,
    activeGraph,
    loadSnapshots,
    historyLoading,
    historyError,
    snapshots,
    data,
    rollbackSnapshot,
    configSaving,
    settingsDirty,
    saveSettings,
  } = props;
  const {
    provider: providerDraft,
    model: modelDraft,
    modelPreset: modelPresetDraft,
    geminiApiKey: geminiApiKeyDraft,
    openaiApiKey: openaiApiKeyDraft,
    openaiBaseUrl: openaiBaseUrlDraft,
    showOpenAIEndpoint: showOpenAIEndpointDraft,
    thinkingMode: thinkingModeDraft,
    plannerMaxTokens: plannerMaxTokensDraft,
    plannerThinkingBudget: plannerThinkingBudgetDraft,
    orchestratorMaxTokens: orchestratorMaxTokensDraft,
    quizMaxTokens: quizMaxTokensDraft,
    assistantMaxTokens: assistantMaxTokensDraft,
    assistantNickname: assistantNicknameDraft,
    persona: personaDraft,
    disableIdleAnimations: disableIdleAnimationsDraft,
    memoryMode: memoryModeDraft,
    memoryHistoryLimit: memoryHistoryLimitDraft,
    memoryIncludeGraphContext: memoryIncludeGraphContextDraft,
    memoryIncludeProgressContext: memoryIncludeProgressContextDraft,
    memoryIncludeQuizContext: memoryIncludeQuizContextDraft,
    memoryIncludeFrontierContext: memoryIncludeFrontierContextDraft,
    memoryIncludeSelectedTopicContext: memoryIncludeSelectedTopicContextDraft,
    enableClosureTests: enableClosureTestsDraft,
    debugModeEnabled: debugModeEnabledDraft,
    straightEdgeLines: straightEdgeLinesDraft,
    themeMode: themeModeDraft,
    quizQuestionCount: quizQuestionCountDraft,
    quizPassCount: quizPassCountDraft,
  } = drafts;
  const {
    provider: setProviderDraft,
    model: setModelDraft,
    modelPreset: setModelPresetDraft,
    geminiApiKey: setGeminiApiKeyDraft,
    openaiApiKey: setOpenaiApiKeyDraft,
    openaiBaseUrl: setOpenaiBaseUrlDraft,
    showOpenAIEndpoint: setShowOpenAIEndpointDraft,
    thinkingMode: setThinkingModeDraft,
    plannerMaxTokens: setPlannerMaxTokensDraft,
    plannerThinkingBudget: setPlannerThinkingBudgetDraft,
    orchestratorMaxTokens: setOrchestratorMaxTokensDraft,
    quizMaxTokens: setQuizMaxTokensDraft,
    assistantMaxTokens: setAssistantMaxTokensDraft,
    assistantNickname: setAssistantNicknameDraft,
    persona: setPersonaDraft,
    disableIdleAnimations: setDisableIdleAnimationsDraft,
    memoryMode: setMemoryModeDraft,
    memoryHistoryLimit: setMemoryHistoryLimitDraft,
    memoryIncludeGraphContext: setMemoryIncludeGraphContextDraft,
    memoryIncludeProgressContext: setMemoryIncludeProgressContextDraft,
    memoryIncludeQuizContext: setMemoryIncludeQuizContextDraft,
    memoryIncludeFrontierContext: setMemoryIncludeFrontierContextDraft,
    memoryIncludeSelectedTopicContext: setMemoryIncludeSelectedTopicContextDraft,
    enableClosureTests: setEnableClosureTestsDraft,
    debugModeEnabled: setDebugModeEnabledDraft,
    straightEdgeLines: setStraightEdgeLinesDraft,
    quizQuestionCount: setQuizQuestionCountDraft,
    quizPassCount: setQuizPassCountDraft,
  } = setDrafts;
  const resolvedProvider = providerDraft === "openai" ? "openai" : "gemini";
  const providerModelOptions = (
    providerDraft === currentConfig?.ai_provider
      ? currentConfig.model_options
      : DEFAULT_PROVIDER_MODELS[resolvedProvider]
  ) ?? [];
  const snapshotsScrollRef = React.useRef<HTMLDivElement | null>(null);
  const [snapshotsScrolledTop, setSnapshotsScrolledTop] = React.useState(false);
  const [snapshotsScrolledBottom, setSnapshotsScrolledBottom] = React.useState(false);

  React.useEffect(() => {
    const el = snapshotsScrollRef.current;
    if (!el) return;

    const syncSnapshotsScrollState = () => {
      const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      setSnapshotsScrolledTop(el.scrollTop > 2);
      setSnapshotsScrolledBottom(el.scrollTop < maxScrollTop - 2);
    };

    syncSnapshotsScrollState();
    el.addEventListener("scroll", syncSnapshotsScrollState, { passive: true });
    window.addEventListener("resize", syncSnapshotsScrollState);

    return () => {
      el.removeEventListener("scroll", syncSnapshotsScrollState);
      window.removeEventListener("resize", syncSnapshotsScrollState);
    };
  }, [isSettingsOpen, activeGraph?.graph_id, historyError, snapshots.length]);

  if (!isSettingsOpen) {
    return null;
  }

  return (
    <div
      className="quizOverlay settingsOverlay"
      style={{ zIndex: 100 }}
    >
      <div className="settingsModal">
        <div className="settingsContent">
          <div className="settingsContentHeader">
            <h2>{copy.settings.workspaceConfiguration}</h2>
            <button
              className="modalCloseButton"
              onClick={() => setSettingsOpen(false)}
              type="button"
              aria-label={copy.settingsPanel.closeSettings}
            >
              <span style={{ transform: "translateY(-1px)", display: "block" }}>✕</span>
            </button>
          </div>

          <div className="settingsContentScroll">
            <div className="settingsConfigSurface">
              <div className="settingsConfigGrid">
                <div className="settingsPrimaryColumn">
                  <section className="settingsPanel settingsPanelWide">
                    <div className="settingsPanelHeader">
                      <div>
                        <div className="settingsPanelEyebrow">{copy.settingsPanel.providersEyebrow}</div>
                        <div className="settingsPanelTitle">{copy.settingsPanel.modelProviderTitle}</div>
                      </div>
                    </div>
                    <div className="settingsPanelBody">
                      <div className="settingsLead">
                        {copy.settingsPanel.modelProviderLead}
                      </div>
                      <div className="settingsInlineFields">
                        <label className="field">
                          <span className="fieldLabel">{copy.settingsPanel.providerLabel}</span>
                          <select
                            className="input"
                            value={providerDraft}
                            onChange={(event) => {
                              const nextProvider = event.target.value;
                              const nextOptions = DEFAULT_PROVIDER_MODELS[nextProvider === "openai" ? "openai" : "gemini"];
                              setProviderDraft(nextProvider);
                              setModelDraft((current) => nextOptions.includes(current) ? current : nextOptions[0]);
                              setModelPresetDraft((current) => current !== "__custom__" && nextOptions.includes(current) ? current : nextOptions[0]);
                            }}
                          >
                            {providerOptions.map((providerId) => (
                              <option key={providerId} value={providerId}>{providerId}</option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span className="fieldLabel">{copy.settingsPanel.modelLabel}</span>
                          <select
                            className="input"
                            value={modelPresetDraft}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              setModelPresetDraft(nextValue);
                              if (nextValue !== "__custom__") {
                                setModelDraft(nextValue);
                              }
                            }}
                          >
                            {providerModelOptions.map((modelId) => (
                              <option key={modelId} value={modelId}>{modelId}</option>
                            ))}
                            <option value="__custom__">{copy.settingsPanel.customModelOption}</option>
                          </select>
                        </label>
                      </div>
                      {modelPresetDraft === "__custom__" ? (
                        <label className="field">
                          <span className="fieldLabel">{copy.settingsPanel.customModelId}</span>
                          <input
                            className="input"
                            value={modelDraft}
                            onChange={(event) => setModelDraft(event.target.value)}
                            placeholder={providerDraft === "openai" ? "gpt-5.4-mini" : "gemini-3.1-pro"}
                          />
                        </label>
                      ) : null}
                      <label className="field">
                        <span className="fieldLabel">{copy.settingsPanel.geminiApiKey}</span>
                        <input
                          className="input"
                          value={geminiKeyLockedByEnv ? copy.settingsPanel.providedByEnv : geminiApiKeyDraft}
                          onChange={(event) => setGeminiApiKeyDraft(event.target.value)}
                          placeholder={copy.settingsPanel.geminiApiKeyPlaceholder}
                          disabled={geminiKeyLockedByEnv}
                        />
                      </label>
                      {geminiKeyLockedByEnv ? (
                        <div className="settingsInlineNotice">
                          {copy.settingsPanel.geminiApiKeyEnvNotice}
                        </div>
                      ) : null}
                      <label className="field">
                        <span className="fieldLabel">{copy.settingsPanel.openaiApiKey}</span>
                        <input
                          className="input"
                          value={openaiKeyLockedByEnv ? copy.settingsPanel.providedByEnv : openaiApiKeyDraft}
                          onChange={(event) => setOpenaiApiKeyDraft(event.target.value)}
                          placeholder={copy.settingsPanel.openaiApiKeyPlaceholder}
                          disabled={openaiKeyLockedByEnv}
                        />
                      </label>
                      {openaiKeyLockedByEnv ? (
                        <div className="settingsInlineNotice">
                          {copy.settingsPanel.openaiApiKeyEnvNotice}
                        </div>
                      ) : null}
                      {providerDraft === "openai" ? (
                        <>
                          <div className="mutedSmall" style={{ marginTop: -4 }}>
                            <button
                              type="button"
                              onClick={() => setShowOpenAIEndpointDraft((current) => !current)}
                              style={{
                                appearance: "none",
                                border: 0,
                                background: "transparent",
                                color: themeModeDraft === "light" ? "rgba(17,24,39,0.62)" : "rgba(255,255,255,0.62)",
                                padding: 0,
                                font: "inherit",
                                cursor: "pointer",
                                textDecoration: "underline",
                                textUnderlineOffset: "3px",
                              }}
                            >
                              {showOpenAIEndpointDraft ? copy.settingsPanel.hideCustomEndpoint : copy.settingsPanel.useCustomEndpoint}
                            </button>
                          </div>
                          {showOpenAIEndpointDraft ? (
                            <>
                              <label className="field">
                                <span className="fieldLabel">{copy.settingsPanel.openaiEndpointLabel}</span>
                                <input
                                  className="input"
                                  value={openaiBaseUrlDraft}
                                  onChange={(event) => setOpenaiBaseUrlDraft(event.target.value)}
                                  placeholder="https://api.openai.com/v1"
                                  disabled={openaiBaseUrlLockedByEnv}
                                />
                              </label>
                              <div className="settingsInlineNotice">
                                {copy.settingsPanel.openaiEndpointHelp}
                              </div>
                            </>
                          ) : null}
                          {openaiBaseUrlLockedByEnv ? (
                            <div className="settingsInlineNotice">
                              {copy.settingsPanel.openaiEndpointEnvNotice}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </section>
                  <section className="settingsPanel settingsPanelWide">
                    <div className="settingsPanelHeader">
                      <div>
                        <div className="settingsPanelEyebrow">{copy.settingsPanel.aiBehavior}</div>
                        <div className="settingsPanelTitle">{copy.settingsPanel.thinking}</div>
                      </div>
                    </div>
                    <div className="settingsPanelBody">
                      <div className="settingsLead">
                        {copy.settingsPanel.thinkingLead}
                      </div>
                      <div className="thinkingModeSwitch">
                        {THINKING_MODE_OPTIONS.map((option) => (
                          <button
                            key={option.id}
                            className={`thinkingModeChip ${thinkingModeDraft === option.id ? "thinkingModeChipActive" : ""}`}
                            onClick={() => setThinkingModeDraft(option.id)}
                            type="button"
                          >
                            <span className="thinkingModeChipLabel">{option.label}</span>
                            <span className="thinkingModeChipTitle">{option.title}</span>
                          </button>
                        ))}
                      </div>
                      <div className="settingsInlineNotice">
                        <strong>{activeThinkingOption.label}</strong>: {activeThinkingValues}
                      </div>
                      {thinkingModeDraft === "custom" ? (
                        <div className="settingsInlineFields">
                          <label className="field">
                            <span className="fieldLabel">{copy.settingsPanel.plannerMaxOutputTokens}</span>
                            <input className="input" type="number" step={100} value={plannerMaxTokensDraft} onChange={(event) => setPlannerMaxTokensDraft(Number.isNaN(event.currentTarget.valueAsNumber) ? 0 : event.currentTarget.valueAsNumber)} />
                          </label>
                          <label className="field">
                            <span className="fieldLabel">{copy.settingsPanel.plannerThinkingBudget}</span>
                            <input className="input" type="number" step={100} value={plannerThinkingBudgetDraft} onChange={(event) => setPlannerThinkingBudgetDraft(Number.isNaN(event.currentTarget.valueAsNumber) ? 0 : event.currentTarget.valueAsNumber)} />
                          </label>
                          <label className="field">
                            <span className="fieldLabel">{copy.settingsPanel.orchestratorMaxOutputTokens}</span>
                            <input className="input" type="number" step={100} value={orchestratorMaxTokensDraft} onChange={(event) => setOrchestratorMaxTokensDraft(Number.isNaN(event.currentTarget.valueAsNumber) ? 0 : event.currentTarget.valueAsNumber)} />
                          </label>
                          <label className="field">
                            <span className="fieldLabel">{copy.settingsPanel.quizMaxOutputTokens}</span>
                            <input className="input" type="number" step={100} value={quizMaxTokensDraft} onChange={(event) => setQuizMaxTokensDraft(Number.isNaN(event.currentTarget.valueAsNumber) ? 0 : event.currentTarget.valueAsNumber)} />
                          </label>
                          <label className="field">
                            <span className="fieldLabel">{copy.settingsPanel.assistantMaxOutputTokens}</span>
                            <input className="input" type="number" step={100} value={assistantMaxTokensDraft} onChange={(event) => setAssistantMaxTokensDraft(Number.isNaN(event.currentTarget.valueAsNumber) ? 0 : event.currentTarget.valueAsNumber)} />
                          </label>
                        </div>
                      ) : null}
                      <label className="field">
                        <span className="fieldLabel">{copy.settingsPanel.assistantNickname}</span>
                        <input
                          className="input"
                          value={assistantNicknameDraft}
                          onChange={(event) => setAssistantNicknameDraft(event.target.value)}
                          placeholder={copy.settingsPanel.assistantNicknamePlaceholder}
                          maxLength={80}
                        />
                        <span className="mutedSmall">{copy.settingsPanel.assistantNicknameHelp}</span>
                      </label>
                      <label className="field">
                        <span className="fieldLabel">{copy.settingsPanel.personaRules}</span>
                        <textarea
                          className="textarea textareaCompact textareaPersona"
                          value={personaDraft}
                          onChange={(event) => setPersonaDraft(event.target.value)}
                          placeholder={copy.settingsPanel.personaPlaceholder}
                        />
                      </label>
                      <label className="settingsToggleRow" htmlFor="idle-animations-toggle">
                        <div className="settingsToggleCopy">
                          <span className="fieldLabel">{copy.settingsPanel.idleGraphMotion}</span>
                          <span className="mutedSmall">{copy.settingsPanel.idleGraphMotionHelp}</span>
                        </div>
                        <button
                          id="idle-animations-toggle"
                          className={`settingsSwitch ${disableIdleAnimationsDraft ? "settingsSwitchActive" : ""}`}
                          onClick={() => setDisableIdleAnimationsDraft((current) => !current)}
                          type="button"
                          aria-pressed={disableIdleAnimationsDraft}
                        >
                          <span className="settingsSwitchKnob" />
                        </button>
                      </label>
                      <label className="settingsToggleRow" htmlFor="debug-mode-toggle">
                        <div className="settingsToggleCopy">
                          <span className="fieldLabel">{copy.settingsPanel.debugMode}</span>
                          <span className="mutedSmall">{copy.settingsPanel.debugModeHelp}</span>
                        </div>
                        <button
                          id="debug-mode-toggle"
                          className={`settingsSwitch ${debugModeEnabledDraft ? "settingsSwitchActive" : ""}`}
                          onClick={() => setDebugModeEnabledDraft((current) => !current)}
                          type="button"
                          aria-pressed={debugModeEnabledDraft}
                        >
                          <span className="settingsSwitchKnob" />
                        </button>
                      </label>
                      <label className="settingsToggleRow" htmlFor="edge-lines-toggle">
                        <div className="settingsToggleCopy">
                          <span className="fieldLabel">{copy.settingsPanel.edgeLines}</span>
                          <span className="mutedSmall">{copy.settingsPanel.edgeLinesHelp}</span>
                        </div>
                        <button
                          id="edge-lines-toggle"
                          className={`settingsSwitch ${straightEdgeLinesDraft ? "settingsSwitchActive" : ""}`}
                          onClick={() => setStraightEdgeLinesDraft((current) => !current)}
                          type="button"
                          aria-pressed={straightEdgeLinesDraft}
                        >
                          <span className="settingsSwitchKnob" />
                        </button>
                      </label>
                    </div>
                  </section>

                  <section className="settingsPanel settingsPanelWide">
                    <div className="settingsPanelHeader">
                      <div>
                        <div className="settingsPanelEyebrow">{copy.settingsPanel.aiBehavior}</div>
                        <div className="settingsPanelTitle">{copy.settingsPanel.memory}</div>
                      </div>
                    </div>
                    <div className="settingsPanelBody">
                      <div className="settingsLead">
                        {copy.settingsPanel.memoryLead}
                      </div>
                      <div className="thinkingModeSwitch settingsPresetSwitch">
                        {MEMORY_MODE_OPTIONS.map((option) => (
                          <button
                            key={option.id}
                            className={`thinkingModeChip ${memoryModeDraft === option.id ? "thinkingModeChipActive" : ""}`}
                            onClick={() => setMemoryModeDraft(option.id)}
                            type="button"
                          >
                            <span className="thinkingModeChipLabel">{option.label}</span>
                            <span className="thinkingModeChipTitle">{option.title}</span>
                          </button>
                        ))}
                      </div>
                      <div className="settingsInlineNotice">
                        <strong>{activeMemoryOption.label}</strong>: {activeMemoryValues}
                      </div>
                      {memoryModeDraft === "custom" ? (
                        <>
                          <div className="settingsInlineFields">
                            <label className="field">
                              <span className="fieldLabel">{copy.settingsPanel.memoryHistoryLimit}</span>
                              <input
                                className="input"
                                type="number"
                                step={1}
                                value={memoryHistoryLimitDraft}
                                onChange={(event) => setMemoryHistoryLimitDraft(Number.isNaN(event.currentTarget.valueAsNumber) ? 0 : event.currentTarget.valueAsNumber)}
                              />
                            </label>
                          </div>
                          <label className="settingsToggleRow" htmlFor="memory-graph-context-toggle">
                            <div className="settingsToggleCopy">
                              <span className="fieldLabel">{copy.settingsPanel.memoryGraphContext}</span>
                            </div>
                            <button
                              id="memory-graph-context-toggle"
                              className={`settingsSwitch ${memoryIncludeGraphContextDraft ? "settingsSwitchActive" : ""}`}
                              onClick={() => setMemoryIncludeGraphContextDraft((current) => !current)}
                              type="button"
                              aria-pressed={memoryIncludeGraphContextDraft}
                            >
                              <span className="settingsSwitchKnob" />
                            </button>
                          </label>
                          <label className="settingsToggleRow" htmlFor="memory-progress-context-toggle">
                            <div className="settingsToggleCopy">
                              <span className="fieldLabel">{copy.settingsPanel.memoryProgressContext}</span>
                            </div>
                            <button
                              id="memory-progress-context-toggle"
                              className={`settingsSwitch ${memoryIncludeProgressContextDraft ? "settingsSwitchActive" : ""}`}
                              onClick={() => setMemoryIncludeProgressContextDraft((current) => !current)}
                              type="button"
                              aria-pressed={memoryIncludeProgressContextDraft}
                            >
                              <span className="settingsSwitchKnob" />
                            </button>
                          </label>
                          <label className="settingsToggleRow" htmlFor="memory-quiz-context-toggle">
                            <div className="settingsToggleCopy">
                              <span className="fieldLabel">{copy.settingsPanel.memoryQuizContext}</span>
                            </div>
                            <button
                              id="memory-quiz-context-toggle"
                              className={`settingsSwitch ${memoryIncludeQuizContextDraft ? "settingsSwitchActive" : ""}`}
                              onClick={() => setMemoryIncludeQuizContextDraft((current) => !current)}
                              type="button"
                              aria-pressed={memoryIncludeQuizContextDraft}
                            >
                              <span className="settingsSwitchKnob" />
                            </button>
                          </label>
                          <label className="settingsToggleRow" htmlFor="memory-frontier-context-toggle">
                            <div className="settingsToggleCopy">
                              <span className="fieldLabel">{copy.settingsPanel.memoryFrontierContext}</span>
                            </div>
                            <button
                              id="memory-frontier-context-toggle"
                              className={`settingsSwitch ${memoryIncludeFrontierContextDraft ? "settingsSwitchActive" : ""}`}
                              onClick={() => setMemoryIncludeFrontierContextDraft((current) => !current)}
                              type="button"
                              aria-pressed={memoryIncludeFrontierContextDraft}
                            >
                              <span className="settingsSwitchKnob" />
                            </button>
                          </label>
                          <label className="settingsToggleRow" htmlFor="memory-selected-topic-context-toggle">
                            <div className="settingsToggleCopy">
                              <span className="fieldLabel">{copy.settingsPanel.memorySelectedTopicContext}</span>
                            </div>
                            <button
                              id="memory-selected-topic-context-toggle"
                              className={`settingsSwitch ${memoryIncludeSelectedTopicContextDraft ? "settingsSwitchActive" : ""}`}
                              onClick={() => setMemoryIncludeSelectedTopicContextDraft((current) => !current)}
                              type="button"
                              aria-pressed={memoryIncludeSelectedTopicContextDraft}
                            >
                              <span className="settingsSwitchKnob" />
                            </button>
                          </label>
                        </>
                      ) : null}
                    </div>
                  </section>
                </div>

                <div className="settingsSecondaryColumn">
                  {activeGraph ? (
                    <Card className="snapshotsCard settingsSnapshotsCard" title={copy.settingsPanel.snapshots} right={<button className="btn btn-sm" onClick={() => void loadSnapshots()} type="button">{historyLoading ? copy.settingsPanel.refreshing : copy.settingsPanel.refresh}</button>}>
                      <div
                        ref={snapshotsScrollRef}
                        className={`snapshotsScrollContainer stack ${snapshotsScrolledTop ? "snapshotsScrollContainerScrolledTop" : ""} ${snapshotsScrolledBottom ? "snapshotsScrollContainerScrolledBottom" : ""}`}
                      >
                        {historyError ? <div className="inlineNotice inlineNoticeError">{historyError}</div> : null}
                        {snapshots.length > 0 ? (
                          <div className="list">
                            {snapshots.map((snapshot) => (
                              <div key={snapshot.id} className="listItem">
                                <div className="listMain">
                                  <div className="listTitle">{copy.settingsPanel.snapshotLabel(snapshot.id)}</div>
                                  <div className="mutedSmall">
                                    {snapshot.source}
                                    {snapshot.reason ? ` · ${snapshot.reason}` : ""}
                                  </div>
                                </div>
                                <div className="listActions">
                                  {data?.snapshot.id === snapshot.id ? <span className="badge badge-blue">{copy.settingsPanel.current}</span> : null}
                                  {data?.snapshot.id !== snapshot.id ? (
                                    <button className="btn btn-sm" onClick={() => void rollbackSnapshot(snapshot.id)} type="button">
                                      {copy.settingsPanel.rollback}
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="muted">{copy.settingsPanel.noSnapshots}</div>
                        )}
                      </div>
                    </Card>
                  ) : null}

                  <section className="settingsPanel">
                    <div className="settingsPanelHeader">
                      <div>
                        <div className="settingsPanelEyebrow">{copy.settingsPanel.closureQuiz}</div>
                        <div className="settingsPanelTitle">{copy.settingsPanel.assessmentThreshold}</div>
                      </div>
                    </div>
                    <div className="settingsPanelBody">
                      <label className="settingsToggleRow" htmlFor="closure-tests-toggle">
                        <div className="settingsToggleCopy">
                          <span className="fieldLabel">{copy.settingsPanel.enableClosureTests}</span>
                          <span className="mutedSmall">{copy.settingsPanel.enableClosureTestsHelp}</span>
                        </div>
                        <button
                          id="closure-tests-toggle"
                          className={`settingsSwitch ${enableClosureTestsDraft ? "settingsSwitchActive" : ""}`}
                          onClick={() => setEnableClosureTestsDraft((current) => !current)}
                          type="button"
                          aria-pressed={enableClosureTestsDraft}
                        >
                          <span className="settingsSwitchKnob" />
                        </button>
                      </label>
                      <div className="settingsInlineFields">
                        <label className="field">
                          <span className="fieldLabel">{copy.settingsPanel.questionsPerQuiz}</span>
                          <select
                            className="input"
                            value={quizQuestionCountDraft}
                            onChange={(event) => setQuizQuestionCountDraft(Number(event.target.value))}
                          >
                            {Array.from({ length: 7 }, (_, index) => index + 6).map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span className="fieldLabel">{copy.settingsPanel.correctAnswersRequired}</span>
                          <select
                            className="input"
                            value={quizPassCountDraft}
                            onChange={(event) => setQuizPassCountDraft(Math.min(Number(event.target.value), quizQuestionCountDraft))}
                          >
                            {Array.from({ length: quizQuestionCountDraft }, (_, index) => index + 1).map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="settingsInlineNotice">
                        {copy.settingsPanel.closureRule(quizPassCountDraft, quizQuestionCountDraft)}
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </div>
          <div className="settingsFooterBar">
            <button
              className="assistantSendButton"
              disabled={configSaving || !currentConfig || !settingsDirty}
              onClick={saveSettings}
              type="button"
            >
              {configSaving ? copy.settingsPanel.saving : copy.settingsPanel.save}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
