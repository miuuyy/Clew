import React from "react";
import { Check } from "@phosphor-icons/react";

import type { GraphChatState } from "../../lib/appContracts";
import type { AppCopy } from "../../lib/appCopy";
import { renderDisplayText } from "../../lib/appUiHelpers";
import { summarizePreviewCounts, summarizeTopOperations } from "../../lib/graph";
import { AgentInteraction, type AgentControls } from "./AgentInteraction";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { ClewLoader } from "../ClewLoader";
import { groupChatReplies, presentChatReply } from "../../lib/chatPresentation";

type AssistantMessage = GraphChatState["messages"][number];
type AssistantProposal = NonNullable<AssistantMessage["proposal"]>;

export type AssistantThreadProps = {
  copy: AppCopy;
  agentControls: AgentControls;
  chatViewportRef: React.RefObject<HTMLDivElement | null>;
  chatThreadLoading: boolean;
  currentChatState: GraphChatState;
  visibleMessages: AssistantMessage[];
  chatLoading: boolean;
  hasInlinePlanningWidget: boolean;
  applyLoadingMessageId: string | null;
  applyProposalFromMessage: (messageId: string, proposal: AssistantProposal) => Promise<void>;
  updateCurrentChatState: (updater: (current: GraphChatState) => GraphChatState) => void;
  chatComposerRef: React.RefObject<HTMLTextAreaElement | null>;
};

export function AssistantThread({
  copy,
  agentControls,
  chatViewportRef,
  chatThreadLoading,
  currentChatState,
  visibleMessages,
  chatLoading,
  hasInlinePlanningWidget,
  applyLoadingMessageId,
  applyProposalFromMessage,
  updateCurrentChatState,
  chatComposerRef,
}: AssistantThreadProps): React.JSX.Element {
  const replies = groupChatReplies(visibleMessages);
  const activeReplyId = chatLoading && replies.some((reply) => reply.role === "assistant" && reply.id === currentChatState.runId)
    ? currentChatState.runId : null;
  return (
    <div ref={chatViewportRef} className="assistantThread">
      {chatThreadLoading ? (
        <div className="assistantHello assistantHelloLoading" role="status" aria-label="Loading chat thread">
          <ClewLoader size={56} />
        </div>
      ) : null}
      {currentChatState.messages.length === 0 && !chatThreadLoading ? (
        <div className="assistantHello">
          <div className="assistantHelloTitle">{copy.sessions.helloTitle}</div>
          <div className="assistantHelloCopy">{copy.sessions.helloCopy}</div>
        </div>
      ) : null}
      {replies.map((reply) => {
        const view = presentChatReply(reply, reply.id === activeReplyId, currentChatState.status === "waiting");
        if (!view.texts.length && !view.cards.length && !view.commentary && !view.progress && !view.interrupted) return null;
        return <div key={reply.id} className={`chatMessage chatMessage-${reply.role}`}>
          <div className="chatBubble">
            {view.commentary ? <div className="chatCopy"><AssistantMarkdown content={view.commentary} /></div> : null}
            {view.texts.map((message) => <div key={message.id} className="chatCopy">
              {message.role === "assistant" ? <AssistantMarkdown content={message.content} /> : renderDisplayText(message.content)}
            </div>)}
            {view.cards.map((message) => {
              const proposal = message.proposal;
              const proposalCounts = proposal ? summarizePreviewCounts(proposal, copy) : [];
              const proposalHighlights = proposal ? summarizeTopOperations(proposal, copy) : [];
              return <React.Fragment key={message.id}>
                {message.activity?.status === "failed" && message.question?.status !== "interrupted" && message.inline_quiz?.status !== "interrupted"
                  ? <div className="inlineNotice inlineNoticeError">{message.activity.detail}</div> : null}
                {message.question || message.inline_quiz ? <AgentInteraction question={message.question} quiz={message.inline_quiz} controls={agentControls} /> : null}
                {message.closure_quiz ? <div className="proposalInlineCard">
                  <div className="proposalInlineTitle">Completion test ready</div>
                  <div className="mutedSmall">{message.closure_quiz.question_count} questions</div>
                  <button className="btn btn-sm" type="button" onClick={() => agentControls.openQuiz(message.closure_quiz!)}>Open test</button>
                </div> : null}
                {message.planning_status ? (
                  <div className="proposalInlineCard proposalInlinePending">
                    <div className="proposalInlinePendingRow">
                      <div className="proposalInlinePendingLabel">{message.planning_status}</div>
                      <div className="proposalInlinePendingDots" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  </div>
                ) : null}
                {message.planning_error ? (
                  <div className="inlineNotice inlineNoticeError">{message.planning_error}</div>
                ) : null}
                {proposal ? (
                  <div className="proposalInlineCard">
                    <div className="proposalInlineHead">
                      <div>
                        <div className="proposalInlineTitle">{proposal.display.summary}</div>
                        {proposal.proposal_envelope.assistant_message ? (
                          <div className="mutedSmall">{proposal.proposal_envelope.assistant_message}</div>
                        ) : null}
                      </div>
                      <button
                        className={`proposalAddButton${message.proposal_applied ? " proposalAddButtonApplied" : ""}`}
                        disabled={
                          applyLoadingMessageId === message.id ||
                          message.proposal_applied ||
                          !proposal.apply_plan.validation.ok
                        }
                        onClick={() => void applyProposalFromMessage(message.id, proposal)}
                        type="button"
                        aria-label={message.proposal_applied ? copy.sessions.proposalApplied : copy.sessions.addProposalToGraph}
                        title={message.proposal_applied ? copy.sessions.applied : copy.sessions.addProposalToGraph}
                      >
                        {applyLoadingMessageId === message.id
                          ? "…"
                          : message.proposal_applied
                            ? <span className="proposalAppliedMark" aria-hidden="true"><Check size={12} weight="bold" /></span>
                            : "+"}
                      </button>
                    </div>
                    {proposalCounts.length > 0 ? (
                      <div className="previewStatGrid">
                        {proposalCounts.map((item) => (
                          <div key={item.label} className="previewStatCard">
                            <strong>{item.value}</strong>
                            <span>{item.label}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {proposalHighlights.length > 0 ? (
                      <div className="proposalMiniList">
                        {proposalHighlights.map((item, index) => (
                          <button
                            key={`${item.label}-${item.target}-${index}`}
                            className="proposalMiniItem"
                            type="button"
                            onClick={() => {
                              updateCurrentChatState((current) => ({
                                ...current,
                                input: `Expand from topic ${item.target} to topic: `,
                              }));
                              window.requestAnimationFrame(() => chatComposerRef.current?.focus());
                            }}
                          >
                            <span>{item.target}</span>
                            <span className="badge badge-gray">{item.label}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <details className="proposalReviewDetails">
                      <summary>Review changes</summary>
                      {proposal.proposal_envelope.operations.map((operation) => <div key={operation.op_id} className="proposalReviewItem">
                        {operation.topic ? <><strong>{operation.topic.title}</strong><AssistantMarkdown content={operation.topic.description} />
                          {operation.topic.estimated_minutes > 0 ? <div className="mutedSmall">Estimated study time: {operation.topic.estimated_minutes} minutes</div> : null}
                          {operation.topic.resources.map((resource, index) => <a key={`${resource.url}-${index}`} href={resource.url} target="_blank" rel="noopener noreferrer">{resource.label}</a>)}
                        </> : operation.zone ? <strong>{operation.zone.title}</strong> : operation.edge ? <div>{operation.edge.source_topic_id} → {operation.edge.target_topic_id}</div> : null}
                        {operation.rationale ? <div className="mutedSmall">{operation.rationale}</div> : null}
                      </div>)}
                    </details>
                    {proposal.apply_plan.validation.errors.length > 0 ? (
                      <div className="stackCompact">
                        {proposal.apply_plan.validation.errors.map((entry) => (
                          <div key={entry} className="inlineNotice inlineNoticeError">
                            {entry}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {proposal.apply_plan.validation.warnings.length > 0 ? (
                      <div className="stackCompact">
                        {proposal.apply_plan.validation.warnings.map((entry) => (
                          <div key={entry} className="inlineNotice inlineNoticeWarn">
                            {entry}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </React.Fragment>;
            })}
            {view.progress ? <div className="proposalInlineCard proposalInlinePending" role="status">
              <div className="proposalInlinePendingRow">
                <div className="proposalInlinePendingLabel">{view.progressLabel}</div>
                <div className="proposalInlinePendingDots" aria-hidden="true"><span /><span /><span /></div>
              </div>
            </div> : null}
            {view.interrupted ? <div className="mutedSmall">Stopped</div> : null}
          </div>
        </div>;
      })}
      {chatLoading && currentChatState.status !== "waiting" && !activeReplyId && !hasInlinePlanningWidget ? (
        <div className="chatMessage chatMessage-assistant">
          <div className="chatBubble chatBubbleLoading">
            <span className="chatTypingDot" />
            <span className="chatTypingDot" />
            <span className="chatTypingDot" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
