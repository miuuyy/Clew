import type {
  ChatMessage,
  GraphEnvelope,
  GraphOperation,
  ProposalGenerateResponse,
  Topic,
  TopicClosureStatus,
} from "./types";
import type { AppCopy } from "./appCopy";

export function formatTopicState(state: Topic["state"]): string {
  return state
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

export function getTopicStateTone(state: Topic["state"]): "neutral" | "good" | "warn" {
  if (state === "solid" || state === "mastered") return "good";
  if (state === "not_started") return "neutral";
  return "warn";
}

export function formatMinutes(minutes: number, copy: AppCopy): string {
  if (minutes <= 0) return copy.graphText.timeNotSet;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!rest) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

export function isPrerequisiteEdge(relation: string): boolean {
  return relation === "requires";
}

export function computeRootTopicIds(graph: Pick<GraphEnvelope, "topics" | "edges">): Set<string> {
  const prerequisiteTargets = new Set(
    graph.edges
      .filter((edge) => isPrerequisiteEdge(edge.relation))
      .map((edge) => edge.target_topic_id),
  );
  return new Set(
    graph.topics
      .filter((topic) => !prerequisiteTargets.has(topic.id))
      .map((topic) => topic.id),
  );
}

function isClosedTopic(topic: Topic | undefined): boolean {
  return topic?.state === "solid" || topic?.state === "mastered";
}

export function computeGraphSummary(graph: GraphEnvelope | null): {
  topicCount: number;
  completedPercent: number;
  completedCount: number;
  reviewCount: number;
} {
  if (!graph || graph.topics.length === 0) {
    return {
      topicCount: 0,
      completedPercent: 0,
      completedCount: 0,
      reviewCount: 0,
    };
  }

  const completedCount = graph.topics.filter((topic) => topic.state === "solid" || topic.state === "mastered").length;
  const reviewCount = graph.topics.filter((topic) => topic.state === "needs_review" || topic.state === "shaky").length;
  return {
    topicCount: graph.topics.length,
    completedPercent: Math.round((completedCount / graph.topics.length) * 100),
    completedCount,
    reviewCount,
  };
}

export function buildFallbackAssessment(graph: GraphEnvelope | null, copy: AppCopy): {
  cards: Array<{ label: string; value: string; tone: "neutral" | "good" | "warn"; rationale: string }>;
} {
  if (!graph) return { cards: [] };
  const closed = graph.topics.filter((topic) => topic.state === "solid" || topic.state === "mastered").length;
  const maxLevel = Math.max(...graph.topics.map((topic) => topic.level), 0);
  return {
    cards: [
      {
        label: copy.graphText.roadmapLabel,
        value: maxLevel >= 4 ? copy.graphText.roadmapMlRunway : maxLevel >= 2 ? copy.graphText.roadmapUsableRunway : copy.graphText.roadmapThinRunway,
        tone: maxLevel >= 4 ? "good" : maxLevel >= 2 ? "neutral" : "warn",
        rationale: copy.graphText.roadmapRationale,
      },
      {
        label: copy.graphText.levelAchievedLabel,
        value: closed > 0 ? copy.graphText.levelAchievedFoundationMoving : copy.graphText.levelAchievedNoBaseline,
        tone: closed > 0 ? "neutral" : "warn",
        rationale: copy.graphText.levelAchievedRationale,
      },
    ],
  };
}

export function computeFocusData(
  graph: GraphEnvelope | null,
  selectedTopicId: string | null,
): {
  rootIds: Set<string>;
  ancestorIds: Set<string>;
  pathNodeIds: Set<string>;
  pathEdgeIds: Set<string>;
  frontierEdgeIds: Set<string>;
  pathLayers: Array<Array<{ id: string; title: string }>>;
} {
  if (!graph) {
    return {
      rootIds: new Set<string>(),
      ancestorIds: new Set<string>(),
      pathNodeIds: new Set<string>(),
      pathEdgeIds: new Set<string>(),
      frontierEdgeIds: new Set<string>(),
      pathLayers: [],
    };
  }

  const parentsByChild = new Map<string, string[]>();
  const byId = new Map(graph.topics.map((topic) => [topic.id, topic]));
  for (const topic of graph.topics) {
    parentsByChild.set(topic.id, []);
  }
  for (const edge of graph.edges) {
    if (!isPrerequisiteEdge(edge.relation)) continue;
    parentsByChild.set(edge.target_topic_id, [...(parentsByChild.get(edge.target_topic_id) ?? []), edge.source_topic_id]);
  }

  const rootIds = computeRootTopicIds(graph);

  const frontierEdgeIds = new Set<string>();
  for (const topic of graph.topics) {
    if (isClosedTopic(topic)) continue;
    const parentIds = parentsByChild.get(topic.id) ?? [];
    if (parentIds.length === 0) continue;
    if (!parentIds.every((parentId) => isClosedTopic(byId.get(parentId)))) continue;
    for (const edge of graph.edges) {
      if (!isPrerequisiteEdge(edge.relation)) continue;
      if (edge.target_topic_id !== topic.id) continue;
      if (!isClosedTopic(byId.get(edge.source_topic_id))) continue;
      frontierEdgeIds.add(edge.id);
    }
  }

  if (!selectedTopicId) {
    return {
      rootIds,
      ancestorIds: new Set<string>(),
      pathNodeIds: new Set<string>(),
      pathEdgeIds: new Set<string>(),
      frontierEdgeIds,
      pathLayers: [],
    };
  }

  // Collect the full prerequisite ancestor tree.
  const ancestorIds = new Set<string>();
  const stack = [...(parentsByChild.get(selectedTopicId) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (ancestorIds.has(current)) continue;
    ancestorIds.add(current);
    stack.push(...(parentsByChild.get(current) ?? []));
  }

  // Build the selected-topic path.
  const pathNodeIds = new Set<string>([...ancestorIds, selectedTopicId]);

  // Collect prerequisite edges within the path.
  const pathEdgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (!isPrerequisiteEdge(edge.relation)) continue;
    if (pathNodeIds.has(edge.source_topic_id) && pathNodeIds.has(edge.target_topic_id)) {
      pathEdgeIds.add(edge.id);
    }
  }

  // Build prerequisite layers from path roots.
  const depthOf = new Map<string, number>();
  const bfsQueue: string[] = [];
  for (const nodeId of pathNodeIds) {
    const parents = (parentsByChild.get(nodeId) ?? []).filter((p) => pathNodeIds.has(p));
    if (parents.length === 0) {
      depthOf.set(nodeId, 0);
      bfsQueue.push(nodeId);
    }
  }
  let head = 0;
  while (head < bfsQueue.length) {
    const current = bfsQueue[head++];
    const currentDepth = depthOf.get(current) ?? 0;
    // Walk only prerequisite children that remain inside the current path.
    for (const edge of graph.edges) {
      if (!isPrerequisiteEdge(edge.relation)) continue;
      if (edge.source_topic_id === current && pathNodeIds.has(edge.target_topic_id)) {
        const existing = depthOf.get(edge.target_topic_id);
        if (existing === undefined || currentDepth + 1 > existing) {
          depthOf.set(edge.target_topic_id, currentDepth + 1);
          bfsQueue.push(edge.target_topic_id);
        }
      }
    }
  }

  const maxDepth = Math.max(...depthOf.values(), 0);
  const pathLayers: Array<Array<{ id: string; title: string }>> = [];
  for (let d = 0; d <= maxDepth; d++) {
    const layer: Array<{ id: string; title: string }> = [];
    for (const [nodeId, depth] of depthOf) {
      if (depth === d) {
        layer.push({ id: nodeId, title: byId.get(nodeId)?.title ?? nodeId });
      }
    }
    if (layer.length > 0) pathLayers.push(layer);
  }

  return {
    rootIds,
    ancestorIds,
    pathNodeIds,
    pathEdgeIds,
    frontierEdgeIds,
    pathLayers,
  };
}

export function describeOperationTarget(operation: GraphOperation): string {
  if (operation.topic?.title) return operation.topic.title;
  if (operation.edge) return `${operation.edge.source_topic_id} -> ${operation.edge.target_topic_id}`;
  if (operation.zone?.title) return operation.zone.title;
  if (operation.topic_id) return operation.topic_id;
  if (operation.edge_id) return operation.edge_id;
  if (operation.zone_id) return operation.zone_id;
  return operation.op_id;
}

export function summarizePreviewCounts(result: ProposalGenerateResponse, copy: AppCopy): Array<{ label: string; value: number }> {
  const preview = result.apply_plan.preview;
  return [
    { label: copy.graphText.previewTopics, value: preview.topic_add_count },
    { label: copy.graphText.previewEdges, value: preview.edge_add_count },
    { label: copy.graphText.previewNewZones, value: preview.zone_add_count },
    { label: copy.graphText.previewZoneUpdates, value: preview.zone_update_count },
    { label: copy.graphText.previewMastery, value: preview.mastery_update_count },
  ].filter((item) => item.value > 0);
}

export function summarizeTopOperations(result: ProposalGenerateResponse, copy: AppCopy): Array<{ label: string; target: string }> {
  const highlights = result.display.highlights;
  if (highlights.length > 0) {
    return highlights.map((item) => ({ label: copy.graphText.previewExpand, target: item }));
  }
  return result.apply_plan.patch_groups
    .flatMap((group) =>
      group.operations.map((operation) => ({
        label: operation.entity_kind,
        target: describeOperationTarget(operation),
      })),
    )
    .slice(0, 5);
}

export function computeClosureStatus(graph: GraphEnvelope | null, topicId: string | null): TopicClosureStatus | null {
  if (!graph || !topicId) return null;
  const parentsByChild = new Map<string, string[]>();
  const topicById = new Map(graph.topics.map((topic) => [topic.id, topic]));
  for (const topic of graph.topics) {
    parentsByChild.set(topic.id, []);
  }
  for (const edge of graph.edges) {
    if (!isPrerequisiteEdge(edge.relation)) continue;
    parentsByChild.set(edge.target_topic_id, [...(parentsByChild.get(edge.target_topic_id) ?? []), edge.source_topic_id]);
  }

  const prerequisiteIds: string[] = [];
  const visited = new Set<string>();
  const stack = [...(parentsByChild.get(topicId) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    prerequisiteIds.push(current);
    stack.push(...(parentsByChild.get(current) ?? []));
  }

  const blockedIds = prerequisiteIds.filter((id) => {
    const state = topicById.get(id)?.state;
    return state !== "solid" && state !== "mastered";
  });
  const latestAttempt =
    [...(graph.quiz_attempts ?? [])]
      .filter((attempt) => attempt.topic_id === topicId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null;
  return {
    topic_id: topicId,
    prerequisite_topic_ids: prerequisiteIds,
    blocked_prerequisite_ids: blockedIds,
    can_award_completion: blockedIds.length === 0,
    latest_attempt: latestAttempt,
  };
}

export function recentMessagesForContext(messages: ChatMessage[], limit = 50): ChatMessage[] {
  return messages.slice(-Math.max(1, limit));
}

export function firstProposedTopicId(result: ProposalGenerateResponse): string | null {
  return (
    result.apply_plan.patch_groups
      .flatMap((group) => group.operations)
      .find((operation) => operation.topic?.id)?.topic?.id ?? null
  );
}

export function templatePrompt(kind: "expand" | "ingest", copy: AppCopy): string {
  if (kind === "expand") return copy.graphText.templateExpandPrompt;
  return copy.graphText.templateIngestPrompt;
}
