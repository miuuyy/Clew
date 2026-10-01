import { X } from "@phosphor-icons/react";
import React from "react";

import type { AppCopy } from "../../lib/appCopy";
import type { ChatSessionSummary } from "../../lib/types";

export type AssistantSessionListProps = {
  copy: AppCopy;
  sessionListWrapRef: React.RefObject<HTMLDivElement | null>;
  sessionListRef: React.RefObject<HTMLDivElement | null>;
  sessionDragRef: React.MutableRefObject<{ startX: number; scrollLeft: number } | null>;
  activeSessionId: string | null;
  setActiveSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  generalSession: ChatSessionSummary | null;
  topicSessions: ChatSessionSummary[];
  setSessionDeleteConfirm: React.Dispatch<
    React.SetStateAction<{ sessionId: string; title: string } | null>
  >;
  chatSessions: ChatSessionSummary[];
  selectedTopic: { id: string; title: string } | null;
  selectedTopicId: string | null;
  createTopicSession: () => Promise<void>;
  /** Extra class merged onto every session chip. */
  chipClassName?: string;
  /** Extra class merged onto the active session chip. */
  chipActiveClassName?: string;
};

function joinClassNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function AssistantSessionList({
  copy,
  sessionListWrapRef,
  sessionListRef,
  sessionDragRef,
  activeSessionId,
  setActiveSessionId,
  generalSession,
  topicSessions,
  setSessionDeleteConfirm,
  chatSessions,
  selectedTopic,
  selectedTopicId,
  createTopicSession,
  chipClassName,
  chipActiveClassName,
}: AssistantSessionListProps): React.JSX.Element {
  const generalActive = !activeSessionId;
  const generalClasses = joinClassNames(
    "sessionItem",
    chipClassName,
    generalActive && "sessionItemActive",
    generalActive && chipActiveClassName,
  );

  return (
    <div className="sessionListWrap" ref={sessionListWrapRef}>
      <div
        className="sessionList"
        ref={sessionListRef}
        onScroll={() => {
          const list = sessionListRef.current;
          const wrap = sessionListWrapRef.current;
          if (!list || !wrap) return;
          wrap.classList.toggle("scrolledLeft", list.scrollLeft > 4);
          wrap.classList.toggle(
            "scrolledRight",
            list.scrollLeft >= list.scrollWidth - list.clientWidth - 4,
          );
        }}
        onMouseDown={(event) => {
          if (!sessionListRef.current) return;
          sessionDragRef.current = {
            startX: event.clientX,
            scrollLeft: sessionListRef.current.scrollLeft,
          };
        }}
        onMouseMove={(event) => {
          if (!sessionDragRef.current || !sessionListRef.current) return;
          const deltaX = event.clientX - sessionDragRef.current.startX;
          sessionListRef.current.scrollLeft = sessionDragRef.current.scrollLeft - deltaX;
        }}
        onMouseUp={() => {
          sessionDragRef.current = null;
        }}
        onMouseLeave={() => {
          sessionDragRef.current = null;
        }}
        onWheel={(event) => {
          if (!sessionListRef.current) return;
          if (Math.abs(event.deltaX) < Math.abs(event.deltaY)) {
            event.preventDefault();
            sessionListRef.current.scrollLeft += event.deltaY;
          }
        }}
      >
        <button
          className={generalClasses}
          onClick={() => setActiveSessionId(null)}
          type="button"
        >
          <span className="sessionItemLabel">{copy.sessions.general}</span>
          <span className="sessionItemBadge">{generalSession?.message_count ?? 0}</span>
        </button>
        {topicSessions.map((session) => {
          const sessionActive = activeSessionId === session.session_id;
          const groupClasses = joinClassNames(
            "sessionItemGroup",
            chipClassName,
            sessionActive && "sessionItemGroupActive",
            sessionActive && chipActiveClassName,
          );
          const fallbackTitle = session.title ?? session.topic_id ?? copy.sessions.fallbackSessionTitle;
          return (
            <div key={session.session_id} className={groupClasses}>
              <button
                className="sessionItemInline"
                onClick={() => setActiveSessionId(session.session_id)}
                type="button"
              >
                <span className="sessionItemLabel">{session.title ?? session.topic_id}</span>
                <span className="sessionItemBadge">{session.message_count}</span>
              </button>
              <button
                className="sessionDeleteBtn"
                title={copy.sessions.deleteSession}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  setSessionDeleteConfirm({ sessionId: session.session_id, title: fallbackTitle });
                }}
                aria-label={copy.sessions.deleteSessionAria(fallbackTitle)}
                type="button"
              >
                <X size={11} weight="bold" aria-hidden="true" />
              </button>
            </div>
          );
        })}
        {selectedTopic && !chatSessions.find((session) => session.topic_id === selectedTopicId) ? (
          <button
            className="sessionItem sessionItemNew"
            type="button"
            onClick={() => {
              void createTopicSession();
            }}
          >
            {copy.sessions.learnTopic(selectedTopic.title)}
          </button>
        ) : null}
      </div>
    </div>
  );
}
