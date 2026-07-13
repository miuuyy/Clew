import React from "react";

import type { TopicAnchorPoint } from "../components/GraphCanvas";
import {
  computePopoverPosition,
  samePopoverPosition,
  shouldCommitAnchorUpdate,
  shouldKeepCurrentAnchor,
  type PopoverPosition,
} from "../lib/appUiHelpers";
import { canPlaceFloatingRect, toFloatingRect, type FloatingRect } from "../lib/floatingDesktopLayout";
import type { GraphEnvelope, Topic } from "../lib/types";

const POPOVER_BLOCKED_SELECTORS = [
  ".lightDock",
  ".lightWorkspaceWindow",
  ".lightChatWindow",
  ".floatingStatsContainer",
];

export type TopicPopoverController = {
  selectedTopicId: string | null;
  setSelectedTopicId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedTopicAnchor: TopicAnchorPoint | null;
  setSelectedTopicAnchor: React.Dispatch<React.SetStateAction<TopicAnchorPoint | null>>;
  selectedTopic: Topic | null;
  popoverPosition: PopoverPosition | null;
  topicPopoverRef: React.RefObject<HTMLDivElement | null>;
  popoverDragRef: React.MutableRefObject<{
    pointerX: number;
    pointerY: number;
    startX: number;
    startY: number;
  } | null>;
  handleSelectedTopicAnchorChange: (next: TopicAnchorPoint | null) => void;
  handleSelectTopic: (topicId: string | null, anchor: TopicAnchorPoint | null) => void;
};

export function useTopicPopover({
  activeGraph,
  isMobileViewport,
  graphShellRef,
}: {
  activeGraph: GraphEnvelope | null;
  isMobileViewport: boolean;
  graphShellRef: React.RefObject<HTMLDivElement | null>;
}): TopicPopoverController {
  const [selectedTopicId, setSelectedTopicId] = React.useState<string | null>(null);
  const [selectedTopicAnchor, setSelectedTopicAnchor] = React.useState<TopicAnchorPoint | null>(null);
  const [popoverPosition, setPopoverPosition] = React.useState<PopoverPosition | null>(null);
  const [popoverDragOffset, setPopoverDragOffset] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [popoverFollowAnchor, setPopoverFollowAnchor] = React.useState(true);

  const topicPopoverRef = React.useRef<HTMLDivElement | null>(null);
  const popoverDragRef = React.useRef<{
    pointerX: number;
    pointerY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const selectedTopicAnchorRef = React.useRef(selectedTopicAnchor);
  selectedTopicAnchorRef.current = selectedTopicAnchor;
  const popoverDragOffsetRef = React.useRef(popoverDragOffset);
  popoverDragOffsetRef.current = popoverDragOffset;
  const lastAnchorCommitAtRef = React.useRef(0);

  const selectedTopic: Topic | null = React.useMemo(() => {
    if (!activeGraph || !selectedTopicId) return null;
    return activeGraph.topics.find((topic) => topic.id === selectedTopicId) ?? null;
  }, [activeGraph, selectedTopicId]);

  React.useEffect(() => {
    if (!activeGraph) {
      setSelectedTopicId(null);
      setSelectedTopicAnchor(null);
      return;
    }
    setSelectedTopicId((previous) => {
      const stillExists = activeGraph.topics.some((topic) => topic.id === previous);
      return stillExists ? previous : null;
    });
  }, [activeGraph]);

  React.useEffect(() => {
    setPopoverFollowAnchor(true);
    setPopoverDragOffset({ x: 0, y: 0 });
    if (!selectedTopicId) {
      setSelectedTopicAnchor(null);
      setPopoverPosition(null);
    }
  }, [selectedTopicId]);

  const handleSelectedTopicAnchorChange = React.useCallback(
    (next: TopicAnchorPoint | null) => {
      const current = selectedTopicAnchorRef.current;
      if (isMobileViewport && current && next) return;
      if (!popoverFollowAnchor) {
        if (shouldKeepCurrentAnchor(current, next)) return;
        setSelectedTopicAnchor(next);
        return;
      }
      if (shouldKeepCurrentAnchor(current, next)) return;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const elapsed = now - lastAnchorCommitAtRef.current;
      if (!shouldCommitAnchorUpdate(current, next, elapsed)) return;
      lastAnchorCommitAtRef.current = now;
      if (!current && next) {
        setSelectedTopicAnchor(next);
        const base = computePopoverPosition(next, graphShellRef.current, topicPopoverRef.current);
        if (base) {
          const drag = popoverDragOffsetRef.current;
          const positioned = {
            left: base.left + drag.x,
            top: base.top + drag.y,
            side: base.side,
          } satisfies PopoverPosition;
          setPopoverPosition((existing) => (samePopoverPosition(existing, positioned) ? existing : positioned));
        }
        setPopoverFollowAnchor(false);
        return;
      }
      setSelectedTopicAnchor(next);
    },
    [graphShellRef, isMobileViewport, popoverFollowAnchor],
  );

  React.useLayoutEffect(() => {
    if (!popoverFollowAnchor) return;
    if (!selectedTopic || !selectedTopicAnchor) {
      setPopoverPosition(null);
      return;
    }

    const updatePosition = () => {
      const anchor = selectedTopicAnchorRef.current;
      if (!anchor) {
        setPopoverPosition(null);
        return;
      }
      const base = computePopoverPosition(anchor, graphShellRef.current, topicPopoverRef.current);
      if (!base) {
        setPopoverPosition(null);
        return;
      }
      const drag = popoverDragOffsetRef.current;
      const next = {
        left: base.left + drag.x,
        top: base.top + drag.y,
        side: base.side,
      } satisfies PopoverPosition;
      setPopoverPosition((current) => (samePopoverPosition(current, next) ? current : next));
      setPopoverFollowAnchor(false);
    };

    const frame = window.requestAnimationFrame(updatePosition);
    const shell = graphShellRef.current;
    if (!shell) {
      window.cancelAnimationFrame(frame);
      return;
    }

    const resizeObserver = new ResizeObserver(() => updatePosition());
    resizeObserver.observe(shell);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePosition);
    };
    // Recreate the observer only when the selected topic changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popoverFollowAnchor, selectedTopic?.id]);

  // Update the popover position without recreating the observer.
  React.useEffect(() => {
    if (!selectedTopic || !selectedTopicAnchor) return;
    if (!popoverFollowAnchor) return;
    const base = computePopoverPosition(selectedTopicAnchor, graphShellRef.current, topicPopoverRef.current);
    if (!base) return;
    const next = {
      left: base.left + popoverDragOffset.x,
      top: base.top + popoverDragOffset.y,
      side: base.side,
    } satisfies PopoverPosition;
    setPopoverPosition((current) => (samePopoverPosition(current, next) ? current : next));
  }, [popoverFollowAnchor, selectedTopic, selectedTopicAnchor, popoverDragOffset, graphShellRef]);

  React.useEffect(() => {
    function stopDrag(): void {
      popoverDragRef.current = null;
      document.body.style.userSelect = "";
    }

    function onPointerMove(event: PointerEvent): void {
      const drag = popoverDragRef.current;
      const shell = graphShellRef.current;
      const popover = topicPopoverRef.current;
      if (!drag || !shell || !popover) return;
      const shellRect = shell.getBoundingClientRect();
      const nextLeft = drag.startX + (event.clientX - drag.pointerX);
      const nextTop = drag.startY + (event.clientY - drag.pointerY);
      const boundedLeft = Math.max(16, Math.min(shellRect.width - popover.offsetWidth - 16, nextLeft));
      const boundedTop = Math.max(16, Math.min(shellRect.height - popover.offsetHeight - 16, nextTop));
      const blockedRects: FloatingRect[] = [];
      for (const selector of POPOVER_BLOCKED_SELECTORS) {
        const element = shell.querySelector(selector);
        if (!(element instanceof HTMLElement)) continue;
        blockedRects.push(toFloatingRect(shellRect, element.getBoundingClientRect()));
      }
      const candidateRect = {
        x: boundedLeft,
        y: boundedTop,
        width: popover.offsetWidth,
        height: popover.offsetHeight,
      } satisfies FloatingRect;
      setPopoverFollowAnchor(false);
      document.body.style.userSelect = "none";
      setPopoverPosition((current) => {
        if (!canPlaceFloatingRect(candidateRect, blockedRects)) {
          return current;
        }
        const next = {
          left: boundedLeft,
          top: boundedTop,
          side: current?.side ?? "right",
        } satisfies PopoverPosition;
        return samePopoverPosition(current, next) ? current : next;
      });
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDrag);
    };
  }, [graphShellRef, selectedTopicAnchor]);

  const handleSelectTopic = React.useCallback(
    (topicId: string | null, anchor: TopicAnchorPoint | null) => {
      setSelectedTopicId(topicId);
      setSelectedTopicAnchor(anchor);
    },
    [],
  );

  return {
    selectedTopicId,
    setSelectedTopicId,
    selectedTopicAnchor,
    setSelectedTopicAnchor,
    selectedTopic,
    popoverPosition,
    topicPopoverRef,
    popoverDragRef,
    handleSelectedTopicAnchorChange,
    handleSelectTopic,
  };
}
