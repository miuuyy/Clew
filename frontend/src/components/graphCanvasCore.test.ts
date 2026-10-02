import { describe, expect, it } from "vitest";

import { buildAnchorMap, buildZoneContour, edgeRenderMotion, idleRenderOffset, nextIdleMotionState, zoneIdByTopicId } from "./graphCanvasCore";
import type { Zone } from "../lib/types";

describe("overlapping zones", () => {
  it("prefers the smallest zone, then strongest intensity, retaining first-on-tie order", () => {
    const zones = [
      { id: "broad", topic_ids: ["a", "b", "c"], intensity: 1 },
      { id: "small", topic_ids: ["a", "b"], intensity: .4 },
      { id: "strong", topic_ids: ["a", "b"], intensity: .8 },
      { id: "tie", topic_ids: ["a", "b"], intensity: .8 },
      { id: "single", topic_ids: ["b"], intensity: .1 },
    ] as Zone[];
    expect([...zoneIdByTopicId(zones)]).toEqual([["a", "strong"], ["b", "single"], ["c", "broad"]]);
  });
});

describe("buildAnchorMap", () => {
  it("does not recurse forever on cyclic graphs", () => {
    const anchors = buildAnchorMap(
      [
        { id: "a", title: "A", state: "not_started", level: 0 },
        { id: "b", title: "B", state: "not_started", level: 1 },
      ],
      [
        { id: "e1", source_topic_id: "a", target_topic_id: "b", relation: "bridges", rationale: "" },
        { id: "e2", source_topic_id: "b", target_topic_id: "a", relation: "bridges", rationale: "" },
      ],
      1200,
      800,
    );

    expect(anchors.get("a")).toBeDefined();
    expect(anchors.get("b")).toBeDefined();
  });
});

function polygonContainsPoint(
  polygon: Array<{ x: number; y: number }>,
  point: { x: number; y: number },
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = ((yi > point.y) !== (yj > point.y))
      && point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

describe("buildZoneContour", () => {
  it("keeps irregular expanded clusters inside the final contour", () => {
    const points = [
      { x: 120, y: 120, vx: 0, vy: 0 },
      { x: 280, y: 140, vx: 0, vy: 0 },
      { x: 190, y: 230, vx: 0, vy: 0 },
      { x: 340, y: 260, vx: 0, vy: 0 },
      { x: 140, y: 300, vx: 0, vy: 0 },
      { x: 260, y: 360, vx: 0, vy: 0 },
    ];

    const contour = buildZoneContour(points, 0.55);

    expect(contour.length).toBeGreaterThanOrEqual(3);
    for (const point of points) {
      expect(polygonContainsPoint(contour, point)).toBe(true);
    }
  });
});

describe("nextIdleMotionState", () => {
  it("lets graph physics settle even while visual idle animations are enabled", () => {
    let state = { idleFrozen: false, idleSettleFrames: 0 };

    for (let i = 0; i < 4; i += 1) {
      state = nextIdleMotionState({
        currentMaxVelocity: 0.03,
        draggedNodeId: null,
        frameCount: 120 + i,
        idleFrozen: state.idleFrozen,
        idleSettleFrames: state.idleSettleFrames,
        layoutEditMode: false,
        revealActive: false,
        structureActivityFrame: 0,
      });
    }

    expect(state).toEqual({ idleFrozen: true, idleSettleFrames: 4 });
  });

  it("keeps graph physics active while the user edits or drags nodes", () => {
    expect(
      nextIdleMotionState({
        currentMaxVelocity: 0.01,
        draggedNodeId: "topic-a",
        frameCount: 240,
        idleFrozen: true,
        idleSettleFrames: 3,
        layoutEditMode: false,
        revealActive: false,
        structureActivityFrame: 0,
      }),
    ).toEqual({ idleFrozen: false, idleSettleFrames: 0 });
  });

  it("waits for cascade reveal before freezing edge geometry", () => {
    expect(
      nextIdleMotionState({
        currentMaxVelocity: 0.01,
        draggedNodeId: null,
        frameCount: 240,
        idleFrozen: false,
        idleSettleFrames: 3,
        layoutEditMode: false,
        revealActive: true,
        structureActivityFrame: 0,
      }),
    ).toEqual({ idleFrozen: false, idleSettleFrames: 0 });
  });
});

describe("idleRenderOffset", () => {
  it("keeps visual idle motion deterministic and bounded", () => {
    const first = idleRenderOffset({
      enabled: true,
      frameCount: 240,
      nodeId: "kernel-trick",
      zoneId: "dimensionality-reduction-kernels",
    });
    const second = idleRenderOffset({
      enabled: true,
      frameCount: 240,
      nodeId: "kernel-trick",
      zoneId: "dimensionality-reduction-kernels",
    });

    expect(second).toEqual(first);
    expect(Math.hypot(first.x, first.y)).toBeLessThan(2.3);
  });

  it("can be disabled without moving render positions", () => {
    expect(
      idleRenderOffset({
        enabled: false,
        frameCount: 240,
        nodeId: "kernel-trick",
        zoneId: "dimensionality-reduction-kernels",
      }),
    ).toEqual({ x: 0, y: 0 });
  });

  it("ramps visual idle motion in without snapping", () => {
    const full = idleRenderOffset({
      enabled: true,
      frameCount: 240,
      nodeId: "kernel-trick",
      progress: 1,
      zoneId: "dimensionality-reduction-kernels",
    });
    const half = idleRenderOffset({
      enabled: true,
      frameCount: 240,
      nodeId: "kernel-trick",
      progress: 0.5,
      zoneId: "dimensionality-reduction-kernels",
    });

    expect(
      idleRenderOffset({
        enabled: true,
        frameCount: 240,
        nodeId: "kernel-trick",
        progress: 0,
        zoneId: "dimensionality-reduction-kernels",
      }),
    ).toEqual({ x: 0, y: 0 });
    expect(half.x).toBeCloseTo(full.x * 0.5);
    expect(half.y).toBeCloseTo(full.y * 0.5);
  });
});

describe("edgeRenderMotion", () => {
  it("freezes curved edge reveal and stroke pulse after settle", () => {
    expect(
      edgeRenderMotion({
        edgeMotionFrozen: true,
        fadeRate: 18,
        frameCount: 240,
        fromX: 120,
        litFrame: 300,
      }),
    ).toEqual({ brightness: 1, pulse: 0.84 });
  });

  it("keeps cascade reveal active before edge motion freezes", () => {
    const motion = edgeRenderMotion({
      edgeMotionFrozen: false,
      fadeRate: 20,
      frameCount: 110,
      fromX: 120,
      litFrame: 100,
    });

    expect(motion.brightness).toBeCloseTo(0.5);
    expect(motion.pulse).not.toBe(0.84);
  });

  it("does not produce invalid brightness when fade rate is zero", () => {
    expect(
      edgeRenderMotion({
        edgeMotionFrozen: false,
        fadeRate: 0,
        frameCount: 110,
        fromX: 120,
        litFrame: 100,
      }).brightness,
    ).toBe(1);
  });
});
