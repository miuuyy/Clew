import { describe, expect, it } from "vitest";

import type { Edge, Topic } from "./types";
import { computeRootTopicIds } from "./graph";

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
