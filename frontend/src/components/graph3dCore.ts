import type { Edge, Topic, Zone } from "../lib/types";
import { hashString } from "./graphCanvasCore";

export type GraphPoint3D = { x: number; y: number; z: number };

export type Graph3DLayout = {
  positions: Map<string, GraphPoint3D>;
  center: GraphPoint3D;
  radius: number;
  zoneCenters: Map<string, GraphPoint3D>;
};

function stableUnit(seed: string): GraphPoint3D {
  const hashA = hashString(`${seed}:a`);
  const hashB = hashString(`${seed}:b`);
  const theta = ((hashA % 10000) / 10000) * Math.PI * 2;
  const y = ((hashB % 10000) / 5000) - 1;
  const radial = Math.sqrt(Math.max(0, 1 - y * y));
  return { x: Math.cos(theta) * radial, y, z: Math.sin(theta) * radial };
}

function addScaled(target: GraphPoint3D, vector: GraphPoint3D, scale: number): void {
  target.x += vector.x * scale;
  target.y += vector.y * scale;
  target.z += vector.z * scale;
}

function distance(left: GraphPoint3D, right: GraphPoint3D): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

export function buildGraph3DLayout(topics: Topic[], edges: Edge[], zones: Zone[]): Graph3DLayout {
  if (topics.length === 0) {
    return {
      positions: new Map(),
      center: { x: 0, y: 0, z: 0 },
      radius: 120,
      zoneCenters: new Map(),
    };
  }

  const topicIndex = new Map(topics.map((topic, index) => [topic.id, index]));
  const topicZone = new Map<string, string>();
  for (const zone of zones) {
    for (const topicId of zone.topic_ids) {
      if (topicIndex.has(topicId) && !topicZone.has(topicId)) topicZone.set(topicId, zone.id);
    }
  }

  const effectiveZoneIds = [
    ...zones.filter((zone) => zone.topic_ids.some((topicId) => topicIndex.has(topicId))).map((zone) => zone.id),
    ...(topics.some((topic) => !topicZone.has(topic.id)) ? ["__unassigned__"] : []),
  ];
  const zoneMembers = new Map<string, string[]>();
  for (const zoneId of effectiveZoneIds) zoneMembers.set(zoneId, []);
  for (const topic of topics) {
    const zoneId = topicZone.get(topic.id) ?? "__unassigned__";
    zoneMembers.set(zoneId, [...(zoneMembers.get(zoneId) ?? []), topic.id]);
  }

  const zoneLevelProfiles = new Map<string, { midpoint: number; spacing: number }>();
  for (const [zoneId, memberIds] of zoneMembers) {
    const levels = memberIds.map((topicId) => topics[topicIndex.get(topicId) ?? 0]?.level ?? 0);
    const minimum = levels.length > 0 ? Math.min(...levels) : 0;
    const maximum = levels.length > 0 ? Math.max(...levels) : 0;
    const range = Math.max(1, maximum - minimum);
    zoneLevelProfiles.set(zoneId, {
      midpoint: (minimum + maximum) / 2,
      spacing: Math.min(24, Math.max(10, 116 / range)),
    });
  }

  const zoneCenters = new Map<string, GraphPoint3D>();
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  effectiveZoneIds.forEach((zoneId, index) => {
    if (effectiveZoneIds.length === 1) {
      zoneCenters.set(zoneId, { x: 0, y: 0, z: 0 });
      return;
    }
    const angle = index * goldenAngle;
    const normalizedY = 1 - (2 * (index + 0.5)) / effectiveZoneIds.length;
    const radial = Math.sqrt(Math.max(0, 1 - normalizedY * normalizedY));
    const sphereRadius = 190 + Math.sqrt(effectiveZoneIds.length) * 44;
    zoneCenters.set(zoneId, {
      x: Math.cos(angle) * radial * sphereRadius,
      y: normalizedY * sphereRadius,
      z: Math.sin(angle) * radial * sphereRadius,
    });
  });

  const positions = new Map<string, GraphPoint3D>();
  for (const topic of topics) {
    const zoneId = topicZone.get(topic.id) ?? "__unassigned__";
    const center = zoneCenters.get(zoneId) ?? { x: 0, y: 0, z: 0 };
    const levelProfile = zoneLevelProfiles.get(zoneId) ?? { midpoint: 0, spacing: 18 };
    const direction = stableUnit(topic.id);
    const memberCount = zoneMembers.get(zoneId)?.length ?? 1;
    const scatter = 30 + Math.sqrt(memberCount) * 8;
    positions.set(topic.id, {
      x: center.x + direction.x * scatter,
      y: center.y + (topic.level - levelProfile.midpoint) * levelProfile.spacing + direction.y * scatter * 0.5,
      z: center.z + direction.z * scatter,
    });
  }

  const velocities = new Map(topics.map((topic) => [topic.id, { x: 0, y: 0, z: 0 }]));
  const edgePairs = edges
    .map((edge) => ({ edge, source: positions.get(edge.source_topic_id), target: positions.get(edge.target_topic_id) }))
    .filter((item): item is { edge: Edge; source: GraphPoint3D; target: GraphPoint3D } => Boolean(item.source && item.target));

  const iterations = topics.length > 450 ? 72 : topics.length > 220 ? 96 : 128;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const temperature = 1 - iteration / iterations;
    for (let leftIndex = 0; leftIndex < topics.length; leftIndex += 1) {
      const leftTopic = topics[leftIndex];
      const left = positions.get(leftTopic.id)!;
      const leftVelocity = velocities.get(leftTopic.id)!;
      for (let rightIndex = leftIndex + 1; rightIndex < topics.length; rightIndex += 1) {
        const rightTopic = topics[rightIndex];
        const right = positions.get(rightTopic.id)!;
        const dx = left.x - right.x;
        const dy = left.y - right.y;
        const dz = left.z - right.z;
        const rawDistance = Math.hypot(dx, dy, dz) || 0.001;
        if (rawDistance > 190) continue;
        const sameZone = (topicZone.get(leftTopic.id) ?? "__unassigned__") === (topicZone.get(rightTopic.id) ?? "__unassigned__");
        const strength = (sameZone ? 420 : 760) / Math.max(rawDistance * rawDistance, 36);
        const rightVelocity = velocities.get(rightTopic.id)!;
        leftVelocity.x += (dx / rawDistance) * strength;
        leftVelocity.y += (dy / rawDistance) * strength;
        leftVelocity.z += (dz / rawDistance) * strength;
        rightVelocity.x -= (dx / rawDistance) * strength;
        rightVelocity.y -= (dy / rawDistance) * strength;
        rightVelocity.z -= (dz / rawDistance) * strength;
      }
    }

    for (const { edge, source, target } of edgePairs) {
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dz = target.z - source.z;
      const currentDistance = Math.hypot(dx, dy, dz) || 0.001;
      const sourceLevel = topics[topicIndex.get(edge.source_topic_id) ?? 0]?.level ?? 0;
      const targetLevel = topics[topicIndex.get(edge.target_topic_id) ?? 0]?.level ?? 0;
      const sourceZone = topicZone.get(edge.source_topic_id) ?? "__unassigned__";
      const targetZone = topicZone.get(edge.target_topic_id) ?? "__unassigned__";
      const sameZone = sourceZone === targetZone;
      const targetDistance = sameZone
        ? 42 + Math.abs(targetLevel - sourceLevel) * 7
        : Math.max(150, distance(zoneCenters.get(sourceZone)!, zoneCenters.get(targetZone)!) * 0.72);
      const force = (currentDistance - targetDistance) * (sameZone ? 0.0018 : 0.00032);
      const sourceVelocity = velocities.get(edge.source_topic_id)!;
      const targetVelocity = velocities.get(edge.target_topic_id)!;
      sourceVelocity.x += (dx / currentDistance) * force;
      sourceVelocity.y += (dy / currentDistance) * force;
      sourceVelocity.z += (dz / currentDistance) * force;
      targetVelocity.x -= (dx / currentDistance) * force;
      targetVelocity.y -= (dy / currentDistance) * force;
      targetVelocity.z -= (dz / currentDistance) * force;
    }

    for (const topic of topics) {
      const position = positions.get(topic.id)!;
      const velocity = velocities.get(topic.id)!;
      const zoneId = topicZone.get(topic.id) ?? "__unassigned__";
      const zoneCenter = zoneCenters.get(zoneId) ?? { x: 0, y: 0, z: 0 };
      const levelProfile = zoneLevelProfiles.get(zoneId) ?? { midpoint: 0, spacing: 18 };
      const zoneAttraction = topics.length >= 160 ? 0.00165 : 0.0009;
      velocity.x += (zoneCenter.x - position.x) * zoneAttraction;
      velocity.z += (zoneCenter.z - position.z) * zoneAttraction;
      const levelTarget = zoneCenter.y + (topic.level - levelProfile.midpoint) * levelProfile.spacing;
      velocity.y += (levelTarget - position.y) * Math.max(0.0012, zoneAttraction);
      velocity.x *= 0.84;
      velocity.y *= 0.84;
      velocity.z *= 0.84;
      const step = 0.65 + temperature * 1.35;
      addScaled(position, velocity, step);
    }
  }

  const center = topics.reduce<GraphPoint3D>((sum, topic) => {
    const position = positions.get(topic.id)!;
    sum.x += position.x / topics.length;
    sum.y += position.y / topics.length;
    sum.z += position.z / topics.length;
    return sum;
  }, { x: 0, y: 0, z: 0 });
  let radius = 0;
  for (const position of positions.values()) radius = Math.max(radius, distance(position, center));

  return { positions, center, radius: Math.max(radius, 120), zoneCenters };
}
