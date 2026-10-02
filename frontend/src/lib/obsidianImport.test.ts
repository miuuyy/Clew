import { describe, expect, it } from "vitest";

import { buildObsidianImportPreview, type ObsidianImportOptions } from "./obsidianImport";

const baseOptions: ObsidianImportOptions = {
  vaultName: "organise",
  graphTitle: "organise",
  subject: "organise",
  language: "en",
  relation: "bridges",
  useFoldersAsZones: true,
  autofillDescriptions: true,
  createArtifactsFromNotes: false,
  createPlaceholderTopics: false,
};

describe("buildObsidianImportPreview", () => {
  it("preserves quoted YAML commas and recognizes Windows line endings", () => {
    const preview = buildObsidianImportPreview([
      { path: "a.md", content: "\uFEFF---\r\naliases: [\"First, second\"]\r\n---\r\nA note" },
      { path: "b.md", content: "[[First, second]]" },
    ], baseOptions);
    expect(preview.package).not.toBeNull();
    expect(preview.edgeCount).toBe(1);
    expect(preview.package?.graph.topics[0].metadata?.aliases).toEqual(["First, second"]);
  });
  it.each(["aliases: [broken", "aliases: [1, 2]", "mapmind_edges: {}", "aliases: A\naliases: B"])("rejects invalid frontmatter: %s", (frontmatter) => {
    const preview = buildObsidianImportPreview([{ path: "a.md", content: `---\n${frontmatter}\n---\nBody` }], baseOptions);
    expect(preview.package).toBeNull();
    expect(preview.issues).toContainEqual(expect.objectContaining({ code: "invalid_frontmatter", level: "error" }));
  });
  it("rejects duplicate normalized note paths without silently replacing content", () => {
    const preview = buildObsidianImportPreview([{ path: "folder/a.md", content: "One" }, { path: "folder\\a.md", content: "Two" }], baseOptions);
    expect(preview.package).toBeNull();
    expect(preview.issues[0].code).toBe("duplicate_note_path");
  });
  it("imports markdown notes with wikilinks and folder zones", () => {
    const preview = buildObsidianImportPreview(
      [
        { path: "projects/mapmind.md", content: "Clew note\n\n[[projects/importer]]" },
        { path: "projects/importer.md", content: "Importer note" },
      ],
      baseOptions,
    );

    expect(preview.package).not.toBeNull();
    expect(preview.topicCount).toBe(2);
    expect(preview.edgeCount).toBe(1);
    expect(preview.zoneCount).toBe(1);
    expect(preview.issues).toHaveLength(0);
  });

  it("fails closed on ambiguous basename links", () => {
    const preview = buildObsidianImportPreview(
      [
        { path: "projects/alpha.md", content: "[[shared]]" },
        { path: "a/shared.md", content: "" },
        { path: "b/shared.md", content: "" },
      ],
      baseOptions,
    );

    expect(preview.package).toBeNull();
    expect(preview.issues.some((issue) => issue.code === "ambiguous_link" && issue.level === "error")).toBe(true);
  });

  it("can create placeholder topics for missing notes", () => {
    const preview = buildObsidianImportPreview(
      [{ path: "topic.md", content: "[[missing note]]" }],
      { ...baseOptions, createPlaceholderTopics: true },
    );

    expect(preview.package).not.toBeNull();
    expect(preview.topicCount).toBe(2);
    expect(preview.edgeCount).toBe(1);
    expect(preview.issues.some((issue) => issue.code === "unresolved_link")).toBe(true);
  });

  it("strips aliases and heading fragments from obsidian links", () => {
    const preview = buildObsidianImportPreview(
      [
        { path: "a.md", content: "[[folder/b#Heading|Alias]]" },
        { path: "folder/b.md", content: "Real note body with enough words to become the description paragraph for import." },
      ],
      baseOptions,
    );

    expect(preview.package).not.toBeNull();
    expect(preview.edgeCount).toBe(1);
    expect(preview.issues).toHaveLength(0);
  });

  it("uses explicit inline relation annotations instead of the fallback relation", () => {
    const preview = buildObsidianImportPreview(
      [
        { path: "roadmap.md", content: "[[foundation]]::requires\n[[context]]" },
        { path: "foundation.md", content: "Base note" },
        { path: "context.md", content: "Context note" },
      ],
      baseOptions,
    );

    expect(preview.package).not.toBeNull();
    expect(preview.package?.graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: "requires" }),
        expect.objectContaining({ relation: "bridges" }),
      ]),
    );
  });

  it("imports typed frontmatter relations when present", () => {
    const preview = buildObsidianImportPreview(
      [
        {
          path: "topic.md",
          content: [
            "---",
            "mapmind_relations:",
            "  - requires::[[foundation]]",
            '  - "[[practice]]::reviews"',
            "---",
            "",
            "Topic body",
          ].join("\n"),
        },
        { path: "foundation.md", content: "Foundation note" },
        { path: "practice.md", content: "Practice note" },
      ],
      baseOptions,
    );

    expect(preview.package).not.toBeNull();
    expect(preview.package?.graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target_topic_id: expect.any(String), relation: "requires" }),
        expect.objectContaining({ target_topic_id: expect.any(String), relation: "reviews" }),
      ]),
    );
  });

  it("fails closed on invalid explicit relation annotations", () => {
    const preview = buildObsidianImportPreview(
      [
        { path: "topic.md", content: "[[foundation]]::teleports" },
        { path: "foundation.md", content: "Foundation note" },
      ],
      baseOptions,
    );

    expect(preview.package).toBeNull();
    expect(preview.issues.some((issue) => issue.code === "invalid_relation_annotation" && issue.level === "error")).toBe(true);
  });
});
