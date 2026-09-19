import React from "react";
import type { AgentControls } from "./AgentInteraction";

import type { GraphChatState } from "../../lib/appContracts";
import type { AppCopy } from "../../lib/appCopy";

type AssistantTemplate = {
  id: string;
  label: string;
  value: string;
};

export type AssistantComposerProps = {
  copy: AppCopy;
  agentControls: AgentControls;
  chatError: string | null;
  chatSessionsError: string | null;
  applyError: string | null;
  composerUseGrounding: boolean;
  setComposerUseGrounding: React.Dispatch<React.SetStateAction<boolean>>;
  assistantTemplates: AssistantTemplate[];
  updateCurrentChatState: (updater: (current: GraphChatState) => GraphChatState) => void;
  chatComposerRef: React.RefObject<HTMLTextAreaElement | null>;
  currentChatState: GraphChatState;
  chatLoading: boolean;
  chatThreadLoading: boolean;
  sendChat: () => void;
};

export function AssistantComposer({
  copy,
  agentControls,
  chatError,
  chatSessionsError,
  applyError,
  composerUseGrounding,
  setComposerUseGrounding,
  assistantTemplates,
  updateCurrentChatState,
  chatComposerRef,
  currentChatState,
  chatLoading,
  chatThreadLoading,
  sendChat,
}: AssistantComposerProps): React.JSX.Element {
  return (
    <div className="assistantComposerWrap">
      {chatError ? <div className="inlineNotice inlineNoticeError" role="alert">{chatError}<button className="btn btn-sm" type="button" onClick={agentControls.reconnect}>Reconnect chat</button></div> : null}
      {!agentControls.authenticated ? <div className="codexChatConnect"><span>Connect Codex to start learning.</span><button className="btn btn-sm" type="button" onClick={agentControls.connect}>Sign in with ChatGPT</button></div> : null}
      {chatSessionsError ? <div className="inlineNotice inlineNoticeError">{chatSessionsError}</div> : null}
      {applyError ? <div className="inlineNotice inlineNoticeError">{applyError}</div> : null}
      <div className="assistantTemplates">
        <button
          className={`assistantTemplate webGroundingToggle ${composerUseGrounding ? "active" : ""}`}
          onClick={() => setComposerUseGrounding((current) => !current)}
          title={copy.sessions.groundingToggle}
          type="button"
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginRight: "6px" }}
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          Web
        </button>
        {assistantTemplates.map((template) => (
          <button
            key={template.id}
            className="assistantTemplate"
            onClick={() => {
              updateCurrentChatState((current) => ({
                ...current,
                input: template.value,
              }));
              window.requestAnimationFrame(() => chatComposerRef.current?.focus());
            }}
            type="button"
          >
            {template.label}
          </button>
        ))}
      </div>
      <div className="assistantComposer">
        <textarea
          ref={chatComposerRef}
          className="assistantInput"
          value={currentChatState.input}
          onChange={(event) =>
            updateCurrentChatState((current) => ({
              ...current,
              input: event.target.value,
            }))
          }
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!chatLoading && !chatThreadLoading && agentControls.authenticated) sendChat();
            }
          }}
          placeholder={copy.sessions.composerPlaceholder}
        />
        <button
          className="assistantSendButton assistantSendButtonIcon"
          disabled={chatThreadLoading || (!chatLoading && (!currentChatState.input.trim() || !agentControls.authenticated))}
          onClick={() => chatLoading ? void agentControls.stop() : sendChat()}
          aria-label={chatLoading ? "Stop Codex" : "Send message"}
          title={chatLoading ? "Stop Codex" : "Send message"}
          type="button"
        >
          {chatLoading ? (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor" /></svg>
          ) : (
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19V5" />
              <path d="M5 12L12 5L19 12" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
