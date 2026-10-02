import type { Edge, Topic, Zone } from "../lib/types";

export type GraphNode = {
  id: string;
  title: string;
  state: Topic["state"];
  level: number;
};

export type NodePosition = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export type IdleMotionState = {
  idleFrozen: boolean;
  idleSettleFrames: number;
};

export type IdleRenderOffsetArgs = {
  enabled: boolean;
  frameCount: number;
  nodeId: string;
  progress?: number;
  zoneId: string | null;
};

export type EdgeRenderMotionArgs = {
  edgeMotionFrozen: boolean;
  fadeRate: number;
  frameCount: number;
  fromX: number;
  litFrame: number | undefined;
};

export type ManualNodePositions = Record<string, { x: number; y: number }>;

export type LabelBox = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type ZoneGeometry = {
  center: { x: number; y: number };
  spread: number;
  contour: Array<{ x: number; y: number }>;
};

export const ZONE_REVEAL_STAGGER_FRAMES = 5;
export const ZONE_REVEAL_DURATION_FRAMES = 24;
export const ZONE_GEOMETRY_REFRESH_FRAMES = 160;

export type NodeAnchor = {
  x: number;
  y: number;
  angle: number;
  primaryRootId: string;
  primaryBranchId: string;
};

export type TopicAnchorPoint = {
  x: number;
  y: number;
  side: "left" | "right";
};

export type GraphCanvasThemeMode = "dark" | "light";

const POSITION_CACHE_KEY = "knowledge_graph_pos_v21";
export const positionCache = new Map<string, { x: number; y: number }>();

try {
  const saved = localStorage.getItem(POSITION_CACHE_KEY);
  if (saved) {
    const parsed = JSON.parse(saved) as Record<string, { x: number; y: number }>;
    Object.entries(parsed).forEach(([id, pos]) => positionCache.set(id, pos));
  }
} catch {
  // Ignore corrupted cached positions.
}

export function savePositionCache(): void {
  try {
    localStorage.setItem(POSITION_CACHE_KEY, JSON.stringify(Object.fromEntries(positionCache.entries())));
  } catch {
    // Ignore localStorage write failures.
  }
}

export function hexToRgb(color: string): { r: number; g: number; b: number } | null {
  const value = color.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

export function rgbaString(rgb: { r: number; g: number; b: number }, alpha: number): string {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

export function mixRgb(
  left: { r: number; g: number; b: number },
  right: { r: number; g: number; b: number },
  ratio: number,
): { r: number; g: number; b: number } {
  const t = clamp(ratio, 0, 1);
  return {
    r: Math.round(left.r * (1 - t) + right.r * t),
    g: Math.round(left.g * (1 - t) + right.g * t),
    b: Math.round(left.b * (1 - t) + right.b * t),
  };
}

export type GraphCanvasPalette = {
  gridStroke: string;
  edgeRgb: string;
  nodeBaseFill: string;
  nodeSelectedFill: string;
  nodePathFill: string;
  nodeStableFill: string;
  nodeLearningFill: string;
  nodeReviewFill: string;
  nodeDefaultFill: string;
  frontierRgb: string;
  reviewRingRgb: string;
  labelRgb: string;
  shadowSelected: string;
  shadowPath: string;
  shadowContext: string;
  zoneOpacityMultiplier: number;
  zoneOutlineAlpha: number;
  zoneOutlineWidth: number;
};

export function graphCanvasPalette(themeMode: GraphCanvasThemeMode): GraphCanvasPalette {
  if (themeMode === "light") {
    // Keep light-theme node fills warm so they sit with the paper-and-ink palette.
    return {
      gridStroke: "rgba(45,43,40,0.05)",
      edgeRgb: "45,43,40",
      nodeBaseFill: "rgba(250,249,246,0.98)",
      nodeSelectedFill: "rgba(217,119,87,0.92)",
      nodePathFill: "rgba(128,104,78,0.82)",
      nodeStableFill: "rgba(158,138,112,0.74)",
      nodeLearningFill: "rgba(195,178,156,0.66)",
      nodeReviewFill: "rgba(217,119,87,0.86)",
      nodeDefaultFill: "rgba(178,162,140,0.56)",
      frontierRgb: "176,134,24",
      reviewRingRgb: "217,119,87",
      labelRgb: "45,43,40",
      shadowSelected: "rgba(45,43,40,0.18)",
      shadowPath: "rgba(45,43,40,0.1)",
      shadowContext: "rgba(45,43,40,0.05)",
      zoneOpacityMultiplier: 0.02,
      zoneOutlineAlpha: 0.2,
      zoneOutlineWidth: 1.5,
    };
  }

  return {
    gridStroke: "rgba(255,255,255,0.025)",
    edgeRgb: "255,255,255",
    nodeBaseFill: "rgba(38,38,38,0.95)",
    nodeSelectedFill: "rgba(255,255,255,0.96)",
    nodePathFill: "rgba(255,255,255,0.86)",
    nodeStableFill: "rgba(255,255,255,0.76)",
    nodeLearningFill: "rgba(255,255,255,0.62)",
    nodeReviewFill: "rgba(190,190,190,0.82)",
    nodeDefaultFill: "rgba(120,120,120,0.76)",
    frontierRgb: "255,214,102",
    reviewRingRgb: "255,50,40",
    labelRgb: "255,255,255",
    shadowSelected: "rgba(255,255,255,0.35)",
    shadowPath: "rgba(255,255,255,0.16)",
    shadowContext: "rgba(255,255,255,0.07)",
    zoneOpacityMultiplier: 1,
    zoneOutlineAlpha: 0,
    zoneOutlineWidth: 0,
  };
}

export function nodeFillColor(node: GraphNode, selected: boolean, onPath: boolean, palette: GraphCanvasPalette): string {
  if (selected) return palette.nodeSelectedFill;
  if (onPath) return palette.nodePathFill;
  if (node.state === "mastered" || node.state === "solid") return palette.nodeStableFill;
  if (node.state === "learning") return palette.nodeLearningFill;
  if (node.state === "needs_review" || node.state === "shaky") return palette.nodeReviewFill;
  return palette.nodeDefaultFill;
}

export function nodeRadius(node: GraphNode, selected: boolean, onPath: boolean, isRoot: boolean): number {
  if (selected) return 8;
  if (onPath) return 7;
  if (isRoot) return 6;
  if (node.level <= 1) return 5.5;
  return 5;
}

export function labelSpreadRadius(node: GraphNode): number {
  return 26 + Math.min(110, node.title.length * 3.4);
}

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function normalizeAngle(value: number): number {
  let angle = value;
  while (angle <= -Math.PI) angle += Math.PI * 2;
  while (angle > Math.PI) angle -= Math.PI * 2;
  return angle;
}

export function intersectsAny(box: LabelBox, others: LabelBox[]): boolean {
  return others.some(
    (other) => !(box.right < other.left || box.left > other.right || box.bottom < other.top || box.top > other.bottom),
  );
}

export function labelCandidateOrder(): number[] {
  return [0, 4, 2, 3, 1, 5];
}

export function withinBounds(box: LabelBox, width: number, height: number, margin = 8): boolean {
  return box.left >= margin && box.right <= width - margin && box.top >= margin && box.bottom <= height - margin;
}

export function averageAngles(values: number[]): number {
  if (values.length === 0) return -Math.PI / 2;
  const x = values.reduce((sum, value) => sum + Math.cos(value), 0);
  const y = values.reduce((sum, value) => sum + Math.sin(value), 0);
  return Math.atan2(y, x);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function nextIdleMotionState({
  currentMaxVelocity,
  draggedNodeId,
  frameCount,
  idleFrozen,
  idleSettleFrames,
  layoutEditMode,
  revealActive,
  structureActivityFrame,
}: {
  currentMaxVelocity: number;
  draggedNodeId: string | null;
  frameCount: number;
  idleFrozen: boolean;
  idleSettleFrames: number;
  layoutEditMode: boolean;
  revealActive: boolean;
  structureActivityFrame: number;
}): IdleMotionState {
  if (layoutEditMode || draggedNodeId) {
    return { idleFrozen: false, idleSettleFrames: 0 };
  }
  if (revealActive || frameCount - structureActivityFrame <= 90) {
    return { idleFrozen: false, idleSettleFrames: 0 };
  }
  if (idleFrozen) {
    return { idleFrozen: true, idleSettleFrames: 0 };
  }
  if (currentMaxVelocity < 0.35 || frameCount - structureActivityFrame > 180) {
    const nextSettleFrames = idleSettleFrames + 1;
    return {
      idleFrozen: nextSettleFrames >= 4,
      idleSettleFrames: nextSettleFrames,
    };
  }
  return { idleFrozen: false, idleSettleFrames: 0 };
}

export function idleRenderOffset({
  enabled,
  frameCount,
  nodeId,
  progress = 1,
  zoneId,
}: IdleRenderOffsetArgs): { x: number; y: number } {
  if (!enabled) return { x: 0, y: 0 };
  const amplitude = clamp(progress, 0, 1);
  if (amplitude === 0) return { x: 0, y: 0 };

  const topicSeed = hashString(nodeId);
  const zoneSeed = zoneId ? hashString(zoneId) : topicSeed;
  const topicPhase = ((topicSeed % 8192) / 8192) * Math.PI * 2;
  const zonePhase = ((zoneSeed % 8192) / 8192) * Math.PI * 2;
  const slowTime = frameCount * 0.018;
  const localTime = frameCount * 0.011;

  return {
    x: (Math.sin(slowTime + zonePhase) * 1.45 + Math.sin(localTime + topicPhase) * 0.42) * amplitude,
    y: (Math.cos(slowTime * 0.82 + zonePhase) * 1.05 + Math.cos(localTime * 0.91 + topicPhase * 1.17) * 0.34) * amplitude,
  };
}

export function edgeRenderMotion({
  edgeMotionFrozen,
  fadeRate,
  frameCount,
  fromX,
  litFrame,
}: EdgeRenderMotionArgs): { brightness: number; pulse: number } {
  if (edgeMotionFrozen) {
    return { brightness: 1, pulse: 0.84 };
  }

  const safeFadeRate = Math.max(fadeRate, Number.EPSILON);
  return {
    brightness: litFrame === undefined ? 0 : clamp((frameCount - litFrame) / safeFadeRate, 0, 1),
    pulse: 0.84 + Math.sin(frameCount * 0.03 + fromX * 0.008) * 0.05,
  };
}

export function buildZoneContour(points: NodePosition[], intensity: number): Array<{ x: number; y: number }> {
  if (points.length === 0) return [];
  const contourPoints =
    points.length === 1
      ? expandSinglePointContourSeed(points[0], intensity)
      : points;

  const center = contourPoints.reduce(
    (acc, point) => ({ x: acc.x + point.x / contourPoints.length, y: acc.y + point.y / contourPoints.length }),
    { x: 0, y: 0 },
  );
  const basePadding = 42 + intensity * 10;

  if (contourPoints.length === 2) {
    const [first, second] = contourPoints;
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / distance;
    const uy = dy / distance;
    const px = -uy;
    const py = ux;
    const sidePadding = 44 + intensity * 10;
    const capPadding = 32 + intensity * 8;
    return [
      { x: first.x - ux * capPadding + px * sidePadding, y: first.y - uy * capPadding + py * sidePadding },
      { x: first.x - ux * capPadding - px * sidePadding, y: first.y - uy * capPadding - py * sidePadding },
      { x: second.x + ux * capPadding - px * sidePadding, y: second.y + uy * capPadding - py * sidePadding },
      { x: second.x + ux * capPadding + px * sidePadding, y: second.y + uy * capPadding + py * sidePadding },
    ];
  }

  const expanded = contourPoints
    .map((point) => {
      const dx = point.x - center.x;
      const dy = point.y - center.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const nx = dx / distance;
      const ny = dy / distance;
      const padding = basePadding + clamp(distance * 0.18, 10, 28);
      return {
        x: point.x + nx * padding,
        y: point.y + ny * padding,
        angle: Math.atan2(dy, dx),
      };
    })
    .sort((a, b) => a.angle - b.angle)
    .map(({ x, y }) => ({ x, y }));

  return convexHull(expanded);
}

function expandSinglePointContourSeed(point: NodePosition, intensity: number): NodePosition[] {
  const radiusX = 34 + intensity * 6;
  const radiusY = 28 + intensity * 5;
  return Array.from({ length: 6 }, (_, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / 6;
    return {
      ...point,
      x: point.x + Math.cos(angle) * radiusX,
      y: point.y + Math.sin(angle) * radiusY,
    };
  });
}

function convexHull(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (points.length <= 3) return points;
  const sorted = [...points].sort((left, right) => {
    if (left.x !== right.x) return left.x - right.x;
    return left.y - right.y;
  });

  const cross = (
    origin: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): number => {
    return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  };

  const lower: Array<{ x: number; y: number }> = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: Array<{ x: number; y: number }> = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function preferredZone(candidate: Zone, current: Zone | undefined): boolean {
  return !current || candidate.topic_ids.length < current.topic_ids.length
    || (candidate.topic_ids.length === current.topic_ids.length && candidate.intensity > current.intensity);
}

export function primaryZoneIdForTopic(zones: Zone[], topicId: string | null): string | null {
  if (!topicId) return null;
  let chosen: Zone | undefined;
  for (const zone of zones) {
    if (zone.topic_ids.includes(topicId) && preferredZone(zone, chosen)) chosen = zone;
  }
  return chosen?.id ?? null;
}

export function highlightedZoneIdsForSelection(zones: Zone[], selectedTopicId: string | null, pathNodeIds: Set<string>): Set<string> {
  const byTopic = zoneIdByTopicId(zones);
  const ids = new Set<string>();
  const selectedZoneId = selectedTopicId ? byTopic.get(selectedTopicId) : undefined;
  if (selectedZoneId) ids.add(selectedZoneId);
  for (const topicId of pathNodeIds) {
    const zoneId = byTopic.get(topicId);
    if (zoneId) ids.add(zoneId);
  }
  return ids;
}

export function zoneIdByTopicId(zones: Zone[]): Map<string, string> {
  const chosen = new Map<string, Zone>();
  for (const zone of zones) {
    for (const topicId of zone.topic_ids) {
      if (preferredZone(zone, chosen.get(topicId))) chosen.set(topicId, zone);
    }
  }
  return new Map([...chosen].map(([topicId, zone]) => [topicId, zone.id]));
}

export function cloneManualNodePositions(positions: ManualNodePositions): ManualNodePositions {
  return Object.fromEntries(
    Object.entries(positions).map(([topicId, point]) => [topicId, { x: point.x, y: point.y }]),
  );
}

export function cacheEntryKey(namespace: string, nodeId: string): string {
  return `${namespace}::${nodeId}`;
}

export function buildAnchorMap(nodes: GraphNode[], edges: Edge[], width: number, height: number): Map<string, NodeAnchor> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parentsByChild = new Map<string, string[]>();
  const childrenByParent = new Map<string, string[]>();
  for (const node of nodes) {
    parentsByChild.set(node.id, []);
    childrenByParent.set(node.id, []);
  }
  for (const edge of edges) {
    const parents = parentsByChild.get(edge.target_topic_id) ?? [];
    parents.push(edge.source_topic_id);
    parentsByChild.set(edge.target_topic_id, parents);
    const children = childrenByParent.get(edge.source_topic_id) ?? [];
    children.push(edge.target_topic_id);
    childrenByParent.set(edge.source_topic_id, children);
  }

  const explicitRoots = nodes.filter((node) => (parentsByChild.get(node.id) ?? []).length === 0).sort((a, b) => a.title.localeCompare(b.title));
  const roots = explicitRoots.length > 0
    ? explicitRoots
    : [...nodes].sort((left, right) => left.level !== right.level ? left.level - right.level : left.title.localeCompare(right.title));
  const stableWidth = Math.max(width, 900);
  const stableHeight = Math.max(height, 600);
  const minDimension = Math.min(stableWidth, stableHeight);
  const maxLevel = Math.max(...nodes.map((n) => n.level), 1);
  const anchors = new Map<string, NodeAnchor>();
  const resolving = new Set<string>();
  const resolvedPrimaryRoots = new Map<string, string>();
  const rootAngles = new Map<string, number>();
  const rootCount = Math.max(roots.length, 1);
  const rootRingRadius = Math.max(22, Math.min(58, minDimension * 0.064));
  const fullSpread = Math.PI * 2;
  const branchAngles = new Map<string, number>();
  const resolvedPrimaryBranches = new Map<string, string>();
  const resolvingPrimaryRoots = new Set<string>();
  const resolvingPrimaryBranches = new Set<string>();

  roots.forEach((root, index) => {
    const seed = hashString(root.id);
    const jitter = (((seed >> 20) % 1000) / 1000 - 0.5) * 0.16;
    rootAngles.set(root.id, (-Math.PI / 2) + (index / rootCount) * fullSpread + jitter);
  });

  function resolvePrimaryRootId(nodeId: string): string {
    const cached = resolvedPrimaryRoots.get(nodeId);
    if (cached) return cached;
    if (resolvingPrimaryRoots.has(nodeId)) {
      resolvedPrimaryRoots.set(nodeId, nodeId);
      return nodeId;
    }
    resolvingPrimaryRoots.add(nodeId);
    const parents = (parentsByChild.get(nodeId) ?? []).filter((pid) => byId.has(pid));
    if (parents.length === 0) {
      resolvedPrimaryRoots.set(nodeId, nodeId);
      resolvingPrimaryRoots.delete(nodeId);
      return nodeId;
    }
    const freq = new Map<string, number>();
    for (const pid of parents) {
      const rid = resolvePrimaryRootId(pid);
      freq.set(rid, (freq.get(rid) ?? 0) + 1);
    }
    const sorted = [...freq.entries()].sort((a, b) => b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0]));
    const resolved = sorted[0]?.[0] ?? parents[0];
    resolvedPrimaryRoots.set(nodeId, resolved);
    resolvingPrimaryRoots.delete(nodeId);
    return resolved;
  }

  function resolvePrimaryBranchId(nodeId: string): string {
    const cached = resolvedPrimaryBranches.get(nodeId);
    if (cached) return cached;
    if (resolvingPrimaryBranches.has(nodeId)) {
      resolvedPrimaryBranches.set(nodeId, nodeId);
      return nodeId;
    }
    resolvingPrimaryBranches.add(nodeId);
    const parents = (parentsByChild.get(nodeId) ?? []).filter((pid) => byId.has(pid));
    if (parents.length === 0) {
      resolvedPrimaryBranches.set(nodeId, nodeId);
      resolvingPrimaryBranches.delete(nodeId);
      return nodeId;
    }
    if (parents.find((pid) => (parentsByChild.get(pid) ?? []).length === 0)) {
      resolvedPrimaryBranches.set(nodeId, nodeId);
      resolvingPrimaryBranches.delete(nodeId);
      return nodeId;
    }
    const freq = new Map<string, number>();
    for (const pid of parents) {
      const bid = resolvePrimaryBranchId(pid);
      freq.set(bid, (freq.get(bid) ?? 0) + 1);
    }
    const sorted = [...freq.entries()].sort((a, b) => b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0]));
    resolvedPrimaryBranches.set(nodeId, sorted[0]?.[0] ?? nodeId);
    resolvingPrimaryBranches.delete(nodeId);
    return resolvedPrimaryBranches.get(nodeId)!;
  }

  for (const root of roots) {
    const kids = (childrenByParent.get(root.id) ?? []).filter((cid) => byId.has(cid))
      .sort((a, b) => (byId.get(a)?.title ?? a).localeCompare(byId.get(b)?.title ?? b));
    const sectorW = rootCount === 1 ? Math.PI * 1.6 : Math.max(0.8, (fullSpread / rootCount) * 0.88);
    const rootAngle = rootAngles.get(root.id) ?? -Math.PI / 2;
    kids.forEach((cid, i) => {
      const off = kids.length === 1 ? 0 : ((i / (kids.length - 1)) - 0.5) * sectorW;
      branchAngles.set(cid, rootAngle + off);
    });
  }

  const siblingGroups = new Map<string, { size: number; indexById: Map<string, number> }>();
  function siblingsFor(parents: string[]) {
    const key = JSON.stringify(parents);
    const cached = siblingGroups.get(key);
    if (cached) return cached;
    const ids = Array.from(new Set(parents.flatMap((pid) => childrenByParent.get(pid) ?? []))).sort(
      (a, b) => (byId.get(a)?.title ?? a).localeCompare(byId.get(b)?.title ?? b),
    );
    const group = { size: ids.length, indexById: new Map(ids.map((id, index) => [id, index])) };
    siblingGroups.set(key, group);
    return group;
  }

  function resolveAnchor(nodeId: string): NodeAnchor {
    const cached = anchors.get(nodeId);
    if (cached) return cached;
    if (resolving.has(nodeId)) {
      return { x: width / 2, y: height / 2, angle: -Math.PI / 2, primaryRootId: nodeId, primaryBranchId: nodeId };
    }
    resolving.add(nodeId);
    const node = byId.get(nodeId);
    if (!node) {
      const fallback = { x: width / 2, y: height / 2, angle: -Math.PI / 2, primaryRootId: nodeId, primaryBranchId: nodeId };
      anchors.set(nodeId, fallback);
      resolving.delete(nodeId);
      return fallback;
    }
    const seed = hashString(node.id);
    const parents = (parentsByChild.get(node.id) ?? []).filter((pid) => byId.has(pid));
    const primaryRootId = resolvePrimaryRootId(node.id);
    const primaryBranchId = resolvePrimaryBranchId(node.id);
    const usableRadius = Math.max(200, minDimension * 0.72 - rootRingRadius);
    const radialStep = usableRadius / Math.max(maxLevel + 0.35, 1);
    const baseRadius = node.level <= 0 ? rootRingRadius : rootRingRadius + node.level * radialStep;
    const radiusJitter = (((seed >> 12) % 1000) / 1000 - 0.5) * minDimension * 0.018;
    let angle: number;
    if (parents.length === 0) {
      angle = rootAngles.get(node.id) ?? -Math.PI / 2;
    } else {
      const parentAnchors = parents.map((pid) => resolveAnchor(pid));
      const parentAngle = averageAngles(parentAnchors.map((anchor) => anchor.angle));
      const branchAngle = branchAngles.get(primaryBranchId) ?? rootAngles.get(primaryRootId) ?? parentAngle;
      const siblings = siblingsFor(parents);
      const siblingIndex = siblings.indexById.get(node.id) ?? 0;
      const spread = Math.max(0.15, 0.85 / Math.max(siblings.size, 1));
      const siblingOffset = (siblingIndex - (siblings.size - 1) / 2) * spread;
      const branchPull = normalizeAngle(branchAngle - parentAngle) * 0.68;
      const jitter = (((seed >> 22) % 1000) / 1000 - 0.5) * 0.05;
      angle = node.level === 1 ? branchAngle + siblingOffset + jitter : parentAngle + branchPull + siblingOffset + jitter;
    }
    const radius = Math.max(rootRingRadius, baseRadius + radiusJitter);
    const anchor = {
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
      angle,
      primaryRootId,
      primaryBranchId,
    };
    anchors.set(node.id, anchor);
    resolving.delete(nodeId);
    return anchor;
  }

  for (const node of nodes) resolveAnchor(node.id);
  return anchors;
}

export function buildGraphNodePositions(
  topics: Topic[],
  zones: Zone[],
  width: number,
  height: number,
  graphCacheKey: string,
): Map<string, NodePosition> {
  const anchorMap = buildAnchorMap(
    topics.map((topic) => ({ id: topic.id, title: topic.title, state: topic.state, level: topic.level })),
    [],
    width,
    height,
  );
  const next = new Map<string, NodePosition>();
  const zoneByTopic = zoneIdByTopicId(zones);
  for (const topic of topics) {
    const anchor = anchorMap.get(topic.id);
    const cached = positionCache.get(cacheEntryKey(graphCacheKey, topic.id));
    const zoneId = zoneByTopic.get(topic.id);
    const zoneSeed = zoneId ? hashString(zoneId) : 0;
    const topicSeed = hashString(topic.id);
    const combinedSeed = topicSeed ^ zoneSeed;
    const jitterRadius = zoneId ? 34 : 20;
    const jitterAngle = ((combinedSeed % 1000) / 1000) * Math.PI * 2;
    const jitterScale = zoneId ? 0.82 : 0.54;
    const jitterX = Math.cos(jitterAngle) * jitterRadius * jitterScale;
    const jitterY = Math.sin(jitterAngle) * jitterRadius * jitterScale;
    const x = cached?.x ?? (anchor?.x ?? width / 2) + jitterX;
    const y = cached?.y ?? (anchor?.y ?? height / 2) + jitterY;
    next.set(topic.id, { x, y, vx: 0, vy: 0 });
  }
  return next;
}

export function computeLabelBoxes(
  topics: Topic[],
  positions: Map<string, NodePosition>,
  rootIds: Set<string>,
  selectedTopicId: string | null,
  pathNodeIds: Set<string>,
  width: number,
  height: number,
): LabelBox[] {
  const occupied: LabelBox[] = [];
  const candidates = labelCandidateOrder();
  for (const topic of topics) {
    const node = positions.get(topic.id);
    if (!node) continue;
    const graphNode: GraphNode = { id: topic.id, title: topic.title, state: topic.state, level: topic.level };
    const radius = labelSpreadRadius(graphNode);
    const labelWidth = Math.max(70, Math.min(200, topic.title.length * 7.4 + 18));
    const labelHeight = 18;
    const seed = hashString(topic.id);
    const baseAngle = ((seed % 1000) / 1000) * Math.PI * 2;

    for (const index of candidates) {
      const angle = baseAngle + (index / candidates.length) * Math.PI * 2;
      const left = node.x + Math.cos(angle) * radius - labelWidth / 2;
      const top = node.y + Math.sin(angle) * radius - labelHeight / 2;
      const box = { left, right: left + labelWidth, top, bottom: top + labelHeight };
      if (withinBounds(box, width, height) && !intersectsAny(box, occupied)) {
        occupied.push(box);
        break;
      }
    }

    if (topic.id === selectedTopicId || pathNodeIds.has(topic.id) || rootIds.has(topic.id)) {
      const fallback = {
        left: node.x - labelWidth / 2,
        right: node.x + labelWidth / 2,
        top: node.y - radius - labelHeight,
        bottom: node.y - radius,
      };
      if (!intersectsAny(fallback, occupied)) occupied.push(fallback);
    }
  }
  return occupied;
}
