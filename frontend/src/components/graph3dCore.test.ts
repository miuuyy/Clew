import { describe, expect, it } from "vitest";

import type { Edge, Topic, Zone } from "../lib/types";
import { buildGraph3DLayout } from "./graph3dCore";

const topics = [
  { id: "root", title: "Root", state: "not_started", level: 0 },
  { id: "middle", title: "Middle", state: "not_started", level: 1 },
  { id: "advanced", title: "Advanced", state: "not_started", level: 2 },
] as Topic[];

const edges = [
  { id: "e1", source_topic_id: "root", target_topic_id: "middle", relation: "requires", rationale: "" },
  { id: "e2", source_topic_id: "middle", target_topic_id: "advanced", relation: "requires", rationale: "" },
] as Edge[];

const zones = [
  { id: "foundations", title: "Foundations", color: "#8295a0", topic_ids: ["root", "middle"] },
  { id: "advanced-zone", title: "Advanced", color: "#86748f", topic_ids: ["advanced"] },
] as Zone[];

describe("buildGraph3DLayout", () => {
  it("returns deterministic finite positions for every topic", () => {
    const first = buildGraph3DLayout(topics, edges, zones);
    const second = buildGraph3DLayout(topics, edges, zones);

    expect([...second.positions]).toEqual([...first.positions]);
    expect(first.positions.size).toBe(topics.length);
    for (const point of first.positions.values()) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
      expect(Number.isFinite(point.z)).toBe(true);
    }
  });

  it("keeps active zones distinct and produces a usable camera radius", () => {
    const layout = buildGraph3DLayout(topics, edges, zones);
    expect(layout.zoneCenters.size).toBe(2);
    expect(layout.zoneCenters.get("foundations")).not.toEqual(layout.zoneCenters.get("advanced-zone"));
    expect(layout.radius).toBeGreaterThanOrEqual(120);
  });

  it("handles an empty graph explicitly", () => {
    const layout = buildGraph3DLayout([], [], []);
    expect(layout.positions.size).toBe(0);
    expect(layout.center).toEqual({ x: 0, y: 0, z: 0 });
    expect(layout.radius).toBe(120);
  });
});
