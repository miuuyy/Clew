from __future__ import annotations

import json
import re
from collections import defaultdict, deque
from datetime import datetime, timezone

from app.models.api import ObsidianExportFile, ObsidianExportOptions, ObsidianGraphExportPackage
from app.models.domain import Edge, StudyGraph, Topic, Zone


INVALID_PATH_CHARS_RE = re.compile(r'[\\/:*?"<>|]+')
WHITESPACE_RE = re.compile(r"\s+")


def build_obsidian_export_package(
    graph: StudyGraph,
    *,
    title: str,
    include_progress: bool,
    options: ObsidianExportOptions,
) -> ObsidianGraphExportPackage:
    folder_name = _sanitize_path_segment(title, fallback="Clew Export")
    zones_by_id = {zone.id: zone for zone in graph.zones}
    topics_by_id = {topic.id: topic for topic in graph.topics}
    topic_basenames = _build_topic_basenames(graph.topics)

    files = [
        ObsidianExportFile(path="README.md", body=_build_readme(graph, title=title, include_progress=include_progress, zones_by_id=zones_by_id)),
    ]

    for topic in graph.topics:
        primary_zone = _primary_zone_for_topic(topic, zones_by_id=zones_by_id, graph_zones=graph.zones)
        folder_parts: list[str] = []
        if options.use_folders_as_zones and primary_zone is not None:
            folder_parts.append(_sanitize_path_segment(primary_zone.title, fallback=primary_zone.id))
        path = "/".join([*folder_parts, f"{topic_basenames[topic.id]}.md"]) if folder_parts else f"{topic_basenames[topic.id]}.md"
        files.append(
            ObsidianExportFile(
                path=path,
                body=_build_topic_markdown(
                    topic,
                    graph=graph,
                    include_progress=include_progress,
                    options=options,
                    zones_by_id=zones_by_id,
                    topics_by_id=topics_by_id,
                    topic_basenames=topic_basenames,
                ),
            )
        )

    return ObsidianGraphExportPackage(
        exported_at=datetime.now(timezone.utc).isoformat(),
        source_graph_id=graph.graph_id,
        title=title,
        include_progress=include_progress,
        folder_name=folder_name,
        file_count=len(files),
        files=files,
    )


def _build_readme(
    graph: StudyGraph,
    *,
    title: str,
    include_progress: bool,
    zones_by_id: dict[str, Zone],
) -> str:
    closed_count = sum(1 for topic in graph.topics if topic.state in {"solid", "mastered"})
    lines = [
        f"# {title}",
        "",
        "Exported from Clew for Obsidian.",
        "",
        "## Graph summary",
        f"- Subject: {graph.subject}",
        f"- Language: {graph.language}",
        f"- Topics: {len(graph.topics)}",
        f"- Edges: {len(graph.edges)}",
        f"- Zones: {len(graph.zones)}",
    ]
    if include_progress:
        lines.append(f"- Closed topics: {closed_count}")
    if graph.zones:
        lines.extend(["", "## Zones"])
        for zone in graph.zones:
            lines.append(f"- {zone.title} ({len(zone.topic_ids)} topics)")
    orphan_topics = [topic.title for topic in graph.topics if not _primary_zone_for_topic(topic, zones_by_id=zones_by_id, graph_zones=graph.zones)]
    if orphan_topics:
        lines.extend(["", "## Topics without primary zone"])
        lines.extend(f"- {label}" for label in orphan_topics)
    return "\n".join(lines).strip() + "\n"


def _build_topic_markdown(
    topic: Topic,
    *,
    graph: StudyGraph,
    include_progress: bool,
    options: ObsidianExportOptions,
    zones_by_id: dict[str, Zone],
    topics_by_id: dict[str, Topic],
    topic_basenames: dict[str, str],
) -> str:
    outgoing_edges = [edge for edge in graph.edges if edge.source_topic_id == topic.id]
    incoming_edges = [edge for edge in graph.edges if edge.target_topic_id == topic.id]
    frontmatter_lines = _build_frontmatter(
        topic,
        include_progress=include_progress,
        outgoing_edges=outgoing_edges,
        zones_by_id=zones_by_id,
        topics_by_id=topics_by_id,
    )

    sections = [f"# {topic.title}"]
    if options.include_descriptions and topic.description.strip():
        sections.extend(["", topic.description.strip()])

    if include_progress:
        sections.extend(
            [
                "",
                "## Study metadata",
                f"- Level: {topic.level}",
                f"- Estimated minutes: {topic.estimated_minutes}",
                f"- State: {topic.state}",
            ]
        )
    elif topic.level or topic.estimated_minutes:
        sections.extend(
            [
                "",
                "## Study metadata",
                f"- Level: {topic.level}",
                f"- Estimated minutes: {topic.estimated_minutes}",
            ]
        )

    sections.extend(
        _build_relation_sections(
            topic_id=topic.id,
            graph=graph,
            outgoing_edges=outgoing_edges,
            topics_by_id=topics_by_id,
            topic_basenames=topic_basenames,
        )
    )

    if options.include_resources and topic.resources:
        sections.extend(["", "## Resources"])
        for resource in topic.resources:
            sections.append(f"- [{resource.label}]({resource.url})")

    if options.include_artifacts and topic.artifacts:
        sections.extend(["", "## Artifacts"])
        for artifact in topic.artifacts:
            sections.extend(["", f"### {artifact.title}", artifact.body.strip() or "_Empty artifact body._"])

    body = "\n".join(sections).strip()
    return f"{frontmatter_lines}\n{body}\n"


def _build_frontmatter(
    topic: Topic,
    *,
    include_progress: bool,
    outgoing_edges: list[Edge],
    zones_by_id: dict[str, Zone],
    topics_by_id: dict[str, Topic],
) -> str:
    lines = [
        "---",
        f"mapmind_topic_id: {_yaml_string(topic.id)}",
        f"mapmind_slug: {_yaml_string(topic.slug)}",
        f"mapmind_level: {topic.level}",
        f"mapmind_estimated_minutes: {topic.estimated_minutes}",
    ]
    if include_progress:
        lines.append(f"mapmind_state: {_yaml_string(topic.state)}")
    zone_titles = [zones_by_id[zone_id].title for zone_id in topic.zones if zone_id in zones_by_id]
    if zone_titles:
        lines.append("mapmind_zones:")
        lines.extend(f"  - {_yaml_string(label)}" for label in zone_titles)
    else:
        lines.append("mapmind_zones: []")
    if outgoing_edges:
        lines.append("mapmind_relations:")
        for edge in outgoing_edges:
            target = topics_by_id.get(edge.target_topic_id)
            lines.append(f"  - relation: {_yaml_string(edge.relation)}")
            lines.append(f"    target_topic_id: {_yaml_string(edge.target_topic_id)}")
            lines.append(f"    target_title: {_yaml_string(target.title if target is not None else edge.target_topic_id)}")
            if edge.rationale.strip():
                lines.append(f"    rationale: {_yaml_string(edge.rationale.strip())}")
    else:
        lines.append("mapmind_relations: []")
    lines.append("---")
    return "\n".join(lines)


def _build_relation_sections(
    *,
    topic_id: str,
    graph: StudyGraph,
    outgoing_edges: list[Edge],
    topics_by_id: dict[str, Topic],
    topic_basenames: dict[str, str],
) -> list[str]:
    lines: list[str] = []
    outgoing_by_relation: dict[str, list[Edge]] = defaultdict(list)
    for edge in outgoing_edges:
        outgoing_by_relation[edge.relation].append(edge)

    prerequisite_lines = _build_full_prerequisite_lines(
        topic_id=topic_id,
        graph=graph,
        topics_by_id=topics_by_id,
        topic_basenames=topic_basenames,
    )
    if prerequisite_lines:
        lines.extend(["", "## Requires", *prerequisite_lines])

    for relation in ["requires", "supports", "bridges", "extends", "reviews"]:
        if relation == "requires":
            continue
        edges = outgoing_by_relation.get(relation, [])
        if not edges:
            continue
        lines.extend(["", f"## {_titleize_relation(relation)}"])
        for edge in edges:
            target = topics_by_id.get(edge.target_topic_id)
            if target is None:
                continue
            line = f"- [[{topic_basenames[target.id]}]]"
            if edge.rationale.strip():
                line += f" — {edge.rationale.strip()}"
            lines.append(line)

    return lines


def _build_full_prerequisite_lines(
    *,
    topic_id: str,
    graph: StudyGraph,
    topics_by_id: dict[str, Topic],
    topic_basenames: dict[str, str],
) -> list[str]:
    parent_map: dict[str, list[str]] = defaultdict(list)
    for edge in graph.edges:
        if edge.relation != "requires":
            continue
        parent_map[edge.target_topic_id].append(edge.source_topic_id)
    queue = deque((parent_id, [parent_id]) for parent_id in parent_map.get(topic_id, []))
    seen: set[str] = set()
    lines: list[str] = []

    while queue:
        current_id, path = queue.popleft()
        if current_id in seen:
            continue
        seen.add(current_id)
        current_topic = topics_by_id.get(current_id)
        if current_topic is None:
            continue
        line = f"- [[{topic_basenames[current_id]}]]"
        if len(path) > 1:
            via_links = " -> ".join(
                f"[[{topic_basenames[node_id]}]]"
                for node_id in path[:-1]
                if node_id in topic_basenames
            )
            if via_links:
                line += f" via {via_links}"
        lines.append(line)

        for parent_id in parent_map.get(current_id, []):
            if parent_id in seen:
                continue
            queue.append((parent_id, [*path, parent_id]))

    return lines


def _build_topic_basenames(topics: list[Topic]) -> dict[str, str]:
    title_groups: dict[str, list[Topic]] = defaultdict(list)
    for topic in topics:
        title_groups[topic.title].append(topic)

    basenames: dict[str, str] = {}
    for title, grouped_topics in title_groups.items():
        if len(grouped_topics) == 1:
            topic = grouped_topics[0]
            basenames[topic.id] = _sanitize_path_segment(title, fallback=topic.slug or topic.id)
            continue
        for topic in grouped_topics:
            basenames[topic.id] = _sanitize_path_segment(f"{title} ({topic.slug or topic.id})", fallback=topic.id)
    used = {"readme"}
    for basename in basenames.values():
        key = basename.casefold()
        if key in used:
            raise ValueError(f"Obsidian export filenames collide: {basename}. Rename the conflicting topics before exporting.")
        used.add(key)
    return basenames


def _primary_zone_for_topic(topic: Topic, *, zones_by_id: dict[str, Zone], graph_zones: list[Zone]) -> Zone | None:
    for zone_id in topic.zones:
        zone = zones_by_id.get(zone_id)
        if zone is not None:
            return zone
    for zone in graph_zones:
        if topic.id in zone.topic_ids:
            return zone
    return None


def _sanitize_path_segment(value: str, *, fallback: str) -> str:
    cleaned = INVALID_PATH_CHARS_RE.sub(" ", value).strip()
    cleaned = WHITESPACE_RE.sub(" ", cleaned)
    if not cleaned:
        cleaned = WHITESPACE_RE.sub(" ", INVALID_PATH_CHARS_RE.sub(" ", fallback)).strip()
    if not cleaned or cleaned in {".", ".."}:
        raise ValueError("Obsidian export requires a valid filename or directory name.")
    return cleaned[:120]


def _titleize_relation(relation: str) -> str:
    return relation.title()


def _yaml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)
