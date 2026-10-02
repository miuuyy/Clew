import { parseDocument } from "yaml";
import type { Edge, GraphExportPackagePayload, Topic, Zone } from "./types";

type FrontmatterValue = string | string[];
class FrontmatterError extends Error {}

export type ObsidianVaultEntry = {
  path: string;
  content: string;
};

export type ObsidianImportOptions = {
  vaultName: string;
  graphTitle: string;
  subject: string;
  language: "en" | "uk" | "ru";
  relation: Edge["relation"];
  useFoldersAsZones: boolean;
  autofillDescriptions: boolean;
  createArtifactsFromNotes: boolean;
  createPlaceholderTopics: boolean;
};

export type ObsidianImportIssue = {
  code: string;
  level: "error" | "warning";
  message: string;
};

export type ObsidianImportPreview = {
  package: GraphExportPackagePayload | null;
  noteCount: number;
  topicCount: number;
  edgeCount: number;
  zoneCount: number;
  unresolvedLinkCount: number;
  issues: ObsidianImportIssue[];
};

type ParsedNoteLink = {
  target: string;
  relation: Edge["relation"] | null;
};

type ParsedNote = {
  id: string;
  path: string;
  folderPath: string;
  title: string;
  slug: string;
  description: string;
  body: string;
  aliases: string[];
  tags: string[];
  links: ParsedNoteLink[];
  placeholder: boolean;
};

type ParsedNoteResult = {
  note: ParsedNote;
  issues: ObsidianImportIssue[];
};

const ZONE_COLORS = [
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#10b981",
  "#ec4899",
  "#eab308",
  "#6366f1",
  "#ef4444",
] as const;

const INTERNAL_LINK_RE = /!?\[\[([^[\]]+)\]\]/g;
const MARKDOWN_LINK_RE = /\[[^\]]*]\(([^)]+)\)/g;
const RELATION_SUFFIX_RE = /^\s*::\s*([a-z_]+)\b/i;
const SUPPORTED_RELATIONS = new Set<Edge["relation"]>(["requires", "supports", "bridges", "extends", "reviews"]);

export function buildObsidianImportPreview(
  entries: ObsidianVaultEntry[],
  options: ObsidianImportOptions,
): ObsidianImportPreview {
  const issues: ObsidianImportIssue[] = [];
  const markdownEntries = entries
    .map((entry) => ({
      path: normalizeVaultPath(entry.path),
      content: entry.content,
    }))
    .filter((entry) => isMarkdownNotePath(entry.path))
    .filter((entry) => !isIgnoredVaultPath(entry.path));

  if (markdownEntries.length === 0) {
    return {
      package: null,
      noteCount: 0,
      topicCount: 0,
      edgeCount: 0,
      zoneCount: 0,
      unresolvedLinkCount: 0,
      issues: [
        {
          code: "no_markdown_notes",
          level: "error",
          message: "No Markdown notes were found in the selected Obsidian vault.",
        },
      ],
    };
  }

  const parsedNotes: ParsedNoteResult[] = [];
  const seenPaths = new Set<string>();
  const seenIds = new Set<string>();
  for (const entry of markdownEntries) {
    if (seenPaths.has(entry.path)) {
      issues.push({ code: "duplicate_note_path", level: "error", message: `Duplicate note path: ${entry.path}.` });
      continue;
    }
    seenPaths.add(entry.path);
    try {
      const parsed = parseNote(entry, options.autofillDescriptions, options.createArtifactsFromNotes);
      if (seenIds.has(parsed.note.id)) {
        issues.push({ code: "note_id_collision", level: "error", message: `Two note paths produce the same topic ID. Rename ${entry.path} before importing.` });
        continue;
      }
      seenIds.add(parsed.note.id);
      parsedNotes.push(parsed);
    } catch (cause) {
      if (!(cause instanceof FrontmatterError)) throw cause;
      issues.push({ code: "invalid_frontmatter", level: "error", message: `${entry.path}: ${cause.message}` });
    }
  }
  const notes = parsedNotes.map((result) => result.note);
  issues.push(...parsedNotes.flatMap((result) => result.issues));
  const notesByPath = new Map<string, ParsedNote>();
  const notesByBaseName = new Map<string, ParsedNote[]>();

  const addLookupKey = (key: string, note: ParsedNote) => {
    if (!key) return;
    const existing = notesByBaseName.get(key) ?? [];
    if (existing.includes(note)) return;
    existing.push(note);
    notesByBaseName.set(key, existing);
  };

  for (const note of notes) {
    notesByPath.set(note.path, note);
    const baseName = stripMdExtension(note.path).split("/").at(-1) ?? note.title;
    addLookupKey(normalizeLookupKey(baseName), note);
    addLookupKey(normalizeLookupKey(note.title), note);
    for (const alias of note.aliases) {
      addLookupKey(normalizeLookupKey(alias), note);
    }
  }

  const topics = new Map<string, Topic>();
  for (const note of notes) {
    topics.set(note.id, noteToTopic(note, options.createArtifactsFromNotes));
  }

  const edgeIds = new Set<string>();
  const edges: Edge[] = [];
  const unresolvedLinks = new Set<string>();

  for (const note of notes) {
    for (const link of note.links) {
      const resolved = resolveInternalLink(link.target, note.path, notesByPath, notesByBaseName);
      if (resolved.error) {
        issues.push({
          code: resolved.error === "ambiguous" ? "ambiguous_link" : "unresolved_link",
          level: resolved.error === "ambiguous" ? "error" : "warning",
          message:
            resolved.error === "ambiguous"
              ? `Ambiguous Obsidian link "${link.target}" in ${note.path}. Use a path-qualified link before import.`
              : `Unresolved Obsidian link "${link.target}" in ${note.path}.`,
        });
      }

      let target = resolved.note;
      if (!target && options.createPlaceholderTopics) {
        target = makePlaceholderNote(link.target, options.autofillDescriptions, options.createArtifactsFromNotes, dirname(note.path));
        if (!topics.has(target.id)) {
          topics.set(target.id, noteToTopic(target, options.createArtifactsFromNotes));
        }
      }
      if (!target) {
        unresolvedLinks.add(link.target);
        continue;
      }

      const relation = link.relation ?? options.relation;
      const edgeId = `obsidian-edge-${stableHash(`${note.id}:${target.id}:${relation}`)}`;
      if (edgeIds.has(edgeId) || note.id === target.id) continue;
      edgeIds.add(edgeId);
      edges.push({
        id: edgeId,
        source_topic_id: note.id,
        target_topic_id: target.id,
        relation,
        rationale: `Imported from Obsidian link in ${note.title}.`,
      });
    }
  }

  const zones = options.useFoldersAsZones ? buildZones([...topics.values()], notes, options.vaultName) : [];
  const graphTitle = options.graphTitle.trim() || options.vaultName.trim() || "Obsidian import";
  const subject = options.subject.trim() || graphTitle;

  const errorCount = issues.filter((issue) => issue.level === "error").length;
  const packagePayload =
    errorCount === 0
      ? buildPackage(graphTitle, subject, options, [...topics.values()], edges, zones)
      : null;

  return {
    package: packagePayload,
    noteCount: markdownEntries.length,
    topicCount: topics.size,
    edgeCount: edges.length,
    zoneCount: zones.length,
    unresolvedLinkCount: unresolvedLinks.size,
    issues,
  };
}

function buildPackage(
  graphTitle: string,
  subject: string,
  options: ObsidianImportOptions,
  topics: Topic[],
  edges: Edge[],
  zones: Zone[],
): GraphExportPackagePayload {
  const exportedAt = new Date().toISOString();
  return {
    kind: "mapmind_graph_export",
    version: 1,
    exported_at: exportedAt,
    source_graph_id: `obsidian-${stableHash(options.vaultName || graphTitle)}`,
    title: graphTitle,
    include_progress: false,
    graph: {
      graph_id: `obsidian-${stableHash(`${graphTitle}:${subject}`)}`,
      subject,
      title: graphTitle,
      language: options.language,
      version: 1,
      topics,
      edges,
      zones,
      quiz_attempts: [],
      metadata: {
        import_source: "obsidian",
        vault_name: options.vaultName,
        relation: options.relation,
        folders_as_zones: options.useFoldersAsZones,
        autofilled_descriptions: options.autofillDescriptions,
        created_placeholder_topics: options.createPlaceholderTopics,
        created_note_artifacts: options.createArtifactsFromNotes,
      },
    },
  };
}

function buildZones(topics: Topic[], notes: ParsedNote[], vaultName: string): Zone[] {
  const notesById = new Map(notes.map((note) => [note.id, note]));
  const zonesByFolder = new Map<string, string[]>();
  for (const topic of topics) {
    const note = notesById.get(topic.id);
    if (!note || !note.folderPath) continue;
    const members = zonesByFolder.get(note.folderPath) ?? [];
    members.push(topic.id);
    zonesByFolder.set(note.folderPath, members);
  }

  return [...zonesByFolder.entries()].map(([folderPath, topicIds], index) => ({
    id: `obsidian-zone-${stableHash(folderPath)}`,
    title: folderPath || vaultName,
    kind: "obsidian_folder",
    color: ZONE_COLORS[index % ZONE_COLORS.length],
    intensity: 0.46,
    topic_ids: topicIds,
  }));
}

function noteToTopic(note: ParsedNote, includeArtifact: boolean): Topic {
  return {
    id: note.id,
    title: note.title,
    slug: note.slug,
    description: note.description,
    difficulty: 0,
    estimated_minutes: 0,
    level: 0,
    state: "not_started",
    zones: [],
    resources: [],
    artifacts:
      includeArtifact && note.body.trim()
        ? [
            {
              id: `obsidian-artifact-${stableHash(note.path)}`,
              title: "Imported Obsidian note",
              kind: "obsidian_note",
              body: note.body.trim(),
              created_at: new Date().toISOString(),
            },
          ]
        : [],
    metadata: {
      source: "obsidian",
      relative_path: note.path,
      aliases: note.aliases,
      tags: note.tags,
      placeholder: note.placeholder,
    },
  };
}

function parseNote(entry: ObsidianVaultEntry, autofillDescriptions: boolean, createArtifactsFromNotes: boolean): ParsedNoteResult {
  const { body, frontmatter } = parseFrontmatter(entry.content);
  const title = stripMdExtension(entry.path).split("/").at(-1) ?? entry.path;
  const folderPath = dirname(entry.path);
  const aliases = normalizeStringArray(frontmatter.aliases);
  const tags = normalizeStringArray(frontmatter.tags);
  const cleanBody = body.trim();
  const description = autofillDescriptions ? deriveDescription(cleanBody) : "";
  const explicitRelationLinks = extractExplicitRelationEntries(frontmatter, entry.path);
  const wikilinks = extractWikilinks(cleanBody, entry.path);
  const markdownLinks = extractMarkdownInternalLinks(cleanBody, entry.path);

  return {
    note: {
      id: `obsidian-topic-${stableHash(entry.path)}`,
      path: entry.path,
      folderPath,
      title,
      slug: makeUnicodeSlug(title),
      description,
      body: createArtifactsFromNotes ? cleanBody : "",
      aliases,
      tags,
      links: [...explicitRelationLinks.links, ...wikilinks.links, ...markdownLinks.links],
      placeholder: false,
    },
    issues: [...explicitRelationLinks.issues, ...wikilinks.issues, ...markdownLinks.issues],
  };
}

function makePlaceholderNote(rawLink: string, autofillDescriptions: boolean, createArtifactsFromNotes: boolean, sourceFolderPath?: string): ParsedNote {
  const target = normalizeLinkTarget(rawLink);
  const title = stripMdExtension(target.split("/").at(-1) ?? target) || "Missing note";
  const folderPath = sourceFolderPath || dirname(target);
  const placeholderBody = "";
  return {
    id: `obsidian-topic-${stableHash(`placeholder:${target}`)}`,
    path: target,
    folderPath,
    title,
    slug: makeUnicodeSlug(title),
    description: autofillDescriptions ? `Placeholder created from unresolved Obsidian link: ${title}` : "",
    body: createArtifactsFromNotes ? placeholderBody : "",
    aliases: [],
    tags: [],
    links: [],
    placeholder: true,
  };
}

function resolveInternalLink(
  rawLink: string,
  sourcePath: string,
  notesByPath: Map<string, ParsedNote>,
  notesByBaseName: Map<string, ParsedNote[]>,
): { note: ParsedNote | null; error: "unresolved" | "ambiguous" | null } {
  const target = normalizeLinkTarget(rawLink);
  if (!target) return { note: null, error: "unresolved" };

  const directCandidates = new Set<string>();
  directCandidates.add(normalizeVaultPath(`${stripMdExtension(target)}.md`));
  directCandidates.add(normalizeVaultPath(target));
  if (target.includes("/")) {
    const relativeFromSource = normalizeVaultPath(joinPath(dirname(sourcePath), target));
    directCandidates.add(relativeFromSource.endsWith(".md") ? relativeFromSource : `${relativeFromSource}.md`);
  }

  for (const candidate of directCandidates) {
    const note = notesByPath.get(candidate);
    if (note) return { note, error: null };
  }

  const basenameKey = normalizeLookupKey(stripMdExtension(target).split("/").at(-1) ?? target);
  const basenameMatches = notesByBaseName.get(basenameKey) ?? [];
  if (basenameMatches.length === 1) {
    return { note: basenameMatches[0], error: null };
  }
  if (basenameMatches.length > 1) {
    return { note: null, error: "ambiguous" };
  }
  return { note: null, error: "unresolved" };
}

function parseFrontmatter(content: string): { body: string; frontmatter: Record<string, FrontmatterValue> } {
  const normalized = content.replace(/^\uFEFF/, "");
  if (!/^---[ \t]*\r?\n/.test(normalized)) return { body: normalized, frontmatter: {} };
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(normalized);
  if (!match) throw new FrontmatterError("Frontmatter has no closing delimiter.");
  const document = parseDocument(match[1], { uniqueKeys: true });
  if (document.errors.length) throw new FrontmatterError(`Invalid YAML frontmatter: ${document.errors[0].message}`);
  let parsed: unknown;
  try { parsed = document.toJS({ maxAliasCount: 100 }); }
  catch { throw new FrontmatterError("Frontmatter contains excessive YAML aliases."); }
  if (parsed !== null && (typeof parsed !== "object" || Array.isArray(parsed))) {
    throw new FrontmatterError("Frontmatter must be a YAML mapping.");
  }
  const frontmatter: Record<string, FrontmatterValue> = {};
  for (const key of ["aliases", "tags", "mapmind_relations", "mapmind_edges"]) {
    const value = (parsed as Record<string, unknown> | null)?.[key];
    if (value == null) continue;
    if (typeof value !== "string" && (!Array.isArray(value) || !value.every((item) => typeof item === "string"))) {
      throw new FrontmatterError(`${key} must be a string or a list of strings.`);
    }
    frontmatter[key] = value as FrontmatterValue;
  }
  return { body: normalized.slice(match[0].length), frontmatter };
}

function cleanupFrontmatterScalar(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function normalizeStringArray(value: FrontmatterValue | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  return value
    .split(",")
    .map((item) => cleanupFrontmatterScalar(item))
    .filter(Boolean);
}

function extractWikilinks(body: string, notePath: string): { links: ParsedNoteLink[]; issues: ObsidianImportIssue[] } {
  const links: ParsedNoteLink[] = [];
  const issues: ObsidianImportIssue[] = [];
  for (const match of body.matchAll(INTERNAL_LINK_RE)) {
    const target = match[1]?.trim();
    if (!target) continue;
    const relationResult = parseRelationSuffix(body.slice((match.index ?? 0) + match[0].length), notePath, target);
    if (relationResult.relation) {
      links.push({ target, relation: relationResult.relation });
    } else {
      links.push({ target, relation: null });
    }
    if (relationResult.issue) issues.push(relationResult.issue);
  }
  return { links, issues };
}

function extractMarkdownInternalLinks(body: string, notePath: string): { links: ParsedNoteLink[]; issues: ObsidianImportIssue[] } {
  const links: ParsedNoteLink[] = [];
  const issues: ObsidianImportIssue[] = [];
  for (const match of body.matchAll(MARKDOWN_LINK_RE)) {
    const target = match[1]?.trim();
    if (!target) continue;
    if (isExternalUrl(target) || target.startsWith("#")) continue;
    if (!target.endsWith(".md") && !target.includes("/")) continue;
    const relationResult = parseRelationSuffix(body.slice((match.index ?? 0) + match[0].length), notePath, target);
    links.push({ target, relation: relationResult.relation });
    if (relationResult.issue) issues.push(relationResult.issue);
  }
  return { links, issues };
}

function extractExplicitRelationEntries(
  frontmatter: Record<string, FrontmatterValue>,
  notePath: string,
): { links: ParsedNoteLink[]; issues: ObsidianImportIssue[] } {
  const entries = [
    ...normalizeStringArray(frontmatter.mapmind_relations),
    ...normalizeStringArray(frontmatter.mapmind_edges),
  ];
  const links: ParsedNoteLink[] = [];
  const issues: ObsidianImportIssue[] = [];

  for (const entry of entries) {
    const parsed = parseExplicitRelationEntry(entry);
    if (!parsed) {
      issues.push({
        code: "invalid_relation_annotation",
        level: "error",
        message: `Invalid Clew relation entry "${entry}" in ${notePath}. Use requires::[[Target]] or [[Target]]::requires.`,
      });
      continue;
    }
    links.push(parsed);
  }

  return { links, issues };
}

function parseExplicitRelationEntry(entry: string): ParsedNoteLink | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  const relationFirst = trimmed.match(/^([a-z_]+)\s*::\s*(.+)$/i);
  if (relationFirst) {
    const relation = normalizeRelationName(relationFirst[1]);
    if (!relation) return null;
    return { target: relationFirst[2].trim(), relation };
  }
  const targetFirst = trimmed.match(/^(.+?)\s*::\s*([a-z_]+)$/i);
  if (!targetFirst) return null;
  const relation = normalizeRelationName(targetFirst[2]);
  if (!relation) return null;
  return { target: targetFirst[1].trim(), relation };
}

function parseRelationSuffix(
  trailingText: string,
  notePath: string,
  target: string,
): { relation: Edge["relation"] | null; issue: ObsidianImportIssue | null } {
  const match = trailingText.match(RELATION_SUFFIX_RE);
  if (!match) return { relation: null, issue: null };
  const relation = normalizeRelationName(match[1] ?? "");
  if (relation) return { relation, issue: null };
  return {
    relation: null,
    issue: {
      code: "invalid_relation_annotation",
      level: "error",
      message: `Invalid relation annotation on Obsidian link "${target}" in ${notePath}.`,
    },
  };
}

function normalizeRelationName(value: string): Edge["relation"] | null {
  const normalized = value.trim().toLowerCase() as Edge["relation"];
  return SUPPORTED_RELATIONS.has(normalized) ? normalized : null;
}

function normalizeLinkTarget(rawTarget: string): string {
  let target = rawTarget.trim();
  if (target.startsWith("!")) target = target.slice(1).trim();
  if (target.startsWith("[[") && target.endsWith("]]")) target = target.slice(2, -2).trim();
  if (target.includes("|")) target = target.split("|", 1)[0].trim();
  if (target.includes("#")) target = target.split("#", 1)[0].trim();
  if (target.includes("^")) target = target.split("^", 1)[0].trim();
  target = target.replace(/^<|>$/g, "");
  return normalizeVaultPath(target);
}

function deriveDescription(body: string): string {
  const candidate = body
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .find((block) => Boolean(block) && !block.startsWith("[[") && !block.startsWith("![[") && block.length > 24);
  if (!candidate) return "";
  const singleLine = candidate.replace(/\r?\n+/g, " ").replace(/\s+/g, " ").trim();
  return singleLine.length > 280 ? `${singleLine.slice(0, 277).trimEnd()}...` : singleLine;
}

function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/{2,}/g, "/").trim();
}

function isMarkdownNotePath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

function isIgnoredVaultPath(path: string): boolean {
  const segments = normalizeVaultPath(path).split("/");
  return segments.some((segment) => segment.startsWith("."));
}

function dirname(path: string): string {
  const normalized = normalizeVaultPath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

function stripMdExtension(path: string): string {
  return path.replace(/\.md$/i, "");
}

function normalizeLookupKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "-");
}

function joinPath(left: string, right: string): string {
  const leftParts = left ? normalizeVaultPath(left).split("/") : [];
  const rightParts = normalizeVaultPath(right).split("/");
  const merged = [...leftParts];
  for (const part of rightParts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      merged.pop();
      continue;
    }
    merged.push(part);
  }
  return merged.join("/");
}

function isExternalUrl(value: string): boolean {
  return /^[a-z]+:\/\//i.test(value);
}

function makeUnicodeSlug(value: string): string {
  const slug = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `note-${stableHash(value)}`;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
