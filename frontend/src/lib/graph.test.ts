import { describe, expect, it } from "vitest";

import type { Edge, Topic, GraphEnvelope } from "./types";
import { computeRootTopicIds, computeFocusData } from "./graph";

const topics = [
  { id: "foundation" },
  { id: "dependent" },
  { id: "independent" },
] as Topic[];

describe("computeRootTopicIds", () => {
  it("marks only topics without prerequisite parents as starting topics", () => {
    const edges = [
      {
        id: "requires-dependent",
        source_topic_id: "foundation",
        target_topic_id: "dependent",
        relation: "requires",
        rationale: "",
      },
      {
        id: "related-independent",
        source_topic_id: "dependent",
        target_topic_id: "independent",
        relation: "related",
        rationale: "",
      },
    ] as Edge[];

    expect([...computeRootTopicIds({ topics, edges })]).toEqual(["foundation", "independent"]);
  });
});

describe("prerequisite focus", () => {
  const edge = (source: string, target: string): Edge => ({ id: `${source}-${target}`, source_topic_id: source, target_topic_id: target, relation: "requires", rationale: "" });
  it("keeps longest dependency layers and frontier edges for shared paths", () => {
    const graph = { topics: [
      { id: "a", title: "A", state: "solid" }, { id: "b", title: "B", state: "solid" },
      { id: "c", title: "C", state: "learning" }, { id: "d", title: "D", state: "not_started" }
    ], edges: [edge("a", "b"), edge("a", "c"), edge("b", "c"), edge("c", "d"), edge("a", "d")] } as GraphEnvelope;
    const result = computeFocusData(graph, "d");
    expect(result.pathLayers.map(layer => layer.map(topic => topic.id))).toEqual([["a"], ["b"], ["c"], ["d"]]);
    expect([...result.frontierEdgeIds]).toEqual(["a-c", "b-c"]);
    expect(result.ancestorIds).toEqual(new Set(["a", "b", "c"]));
  });
  it("handles an empty graph, unrelated edges and a long chain without recursion", () => {
    expect(computeFocusData(null, null).pathLayers).toEqual([]);
    const graph = { topics: Array.from({ length: 3000 }, (_, i) => ({ id: String(i), title: String(i), state: "not_started" })),
      edges: Array.from({ length: 2999 }, (_, i) => edge(String(i), String(i + 1))) } as GraphEnvelope;
    expect(computeFocusData(graph, "2999").pathLayers).toHaveLength(3000);
  });
  it("does not loop forever on an invalid imported cycle", () => {
    const graph = { topics: [{ id: "a" }, { id: "b" }], edges: [edge("a", "b"), edge("b", "a")] } as GraphEnvelope;
    expect(computeFocusData(graph, "b").pathLayers).toEqual([]);
  });
});
