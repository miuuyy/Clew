import React from "react";
import katex from "katex";

import type { TopicAnchorPoint } from "../components/GraphCanvas";
import type { GraphEnvelope } from "./types";

export type ManualLayoutPositions = Record<string, { x: number; y: number }>;

export type PopoverPosition = {
  left: number;
  top: number;
  side: "left" | "right";
};

export function samePopoverPosition(
  current: PopoverPosition | null,
  next: PopoverPosition | null,
): boolean {
  if (current === next) return true;
  if (!current || !next) return false;
  return current.side === next.side && Math.abs(current.left - next.left) < 0.75 && Math.abs(current.top - next.top) < 0.75;
}

export function shouldKeepCurrentAnchor(current: TopicAnchorPoint | null, next: TopicAnchorPoint | null): boolean {
  if (!current || !next) return false;
  return (
    current.side === next.side &&
    Math.abs(current.x - next.x) < 8 &&
    Math.abs(current.y - next.y) < 8
  );
}

export function shouldCommitAnchorUpdate(
  current: TopicAnchorPoint | null,
  next: TopicAnchorPoint | null,
  elapsedMs: number,
): boolean {
  if (!next) return true;
  if (!current) return true;
  if (current.side !== next.side) return true;
  const dx = Math.abs(current.x - next.x);
  const dy = Math.abs(current.y - next.y);
  const majorShift = dx > 28 || dy > 28;
  const mediumShift = dx > 10 || dy > 10;
  if (majorShift) return true;
  if (mediumShift && elapsedMs > 120) return true;
  return elapsedMs > 260;
}

export function formatDateLabel(value: string | null | undefined): string {
  if (!value) return "n/a";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "n/a";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function requiredCorrectAnswers(passThreshold: number, questionCount: number): number {
  return Math.min(questionCount, Math.max(1, Math.ceil(passThreshold * questionCount - 1e-9)));
}

export function readManualLayoutPositions(graph: GraphEnvelope | null): ManualLayoutPositions | null {
  if (!graph) return null;
  if (graph.metadata?.manual_layout_version !== 2) return null;
  const raw = graph.metadata?.manual_layout_positions;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const positions: ManualLayoutPositions = {};
  for (const [topicId, point] of Object.entries(raw)) {
    if (!point || typeof point !== "object" || Array.isArray(point)) continue;
    const x = Number((point as { x?: unknown }).x);
    const y = Number((point as { y?: unknown }).y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    positions[topicId] = { x, y };
  }
  return Object.keys(positions).length > 0 ? positions : null;
}

const GREEK_WORD_SOURCE = String.raw`(?:alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega)`;
const GREEK_CHAR_SOURCE = String.raw`α-ωΑ-Ω`;
const GREEK_WORD_RE = new RegExp(String.raw`(?<!\\)\b${GREEK_WORD_SOURCE}\b`, "gi");
const CYRILLIC_RE = /[А-Яа-яІіЇїЄєҐґ]/;
const LATEX_FUNCTION_SOURCE = String.raw`(?:arctg|arctan|arcsin|arccos|tg|tan|cot|cos|sin|ln|log|sec|csc)`;
const BARE_LATEX_FUNCTION_RE = new RegExp(String.raw`(?<!\\)\b(${LATEX_FUNCTION_SOURCE})\b\s*`, "g");
const COMPACT_LATEX_FUNCTION_RE = new RegExp(String.raw`(?<!\\)\b(${LATEX_FUNCTION_SOURCE})(${GREEK_WORD_SOURCE}|\\[A-Za-z]+|[A-Za-z]|[${GREEK_CHAR_SOURCE}])\b`, "gi");
const MATH_ATOM_SOURCE = String.raw`(?:\\(?:tan|cot|cos|sin|ln|log|arctan|arcsin|arccos|sec|csc)\s*)?(?:\\[A-Za-z]+|[A-Za-z]|[${GREEK_CHAR_SOURCE}]|\d+(?:\.\d+)?)(?:_\{[^{}]+\}|_[A-Za-z0-9]+|\^\{[^{}]+\}|\^[A-Za-z0-9]+)?`;
const MATH_SLASH_TOKEN_RE = new RegExp(String.raw`(?<![\w/])${MATH_ATOM_SOURCE}\s*/\s*${MATH_ATOM_SOURCE}(?![\w/])`);
const LATEX_DELIMITED_MATH_RE = /(\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g;
const INLINE_LATEX_MATH_RE = new RegExp(
  String.raw`(?:[A-Za-z][A-Za-z0-9']*\s*)?\(?[A-Za-z]\)?\s*\([^)]*\)\s*=\s*[A-Za-z0-9\\{}()[\]\s+\-*/^_=.'∞√]+` +
    "|" +
    String.raw`\\(?:frac|dfrac|tfrac|cfrac|sqrt|tan|tg|cot|cos|sin|ln|log|arctan|arctg|arcsin|arccos|sec|csc)\b[A-Za-z0-9\\{}()[\]\s+\-*/^_=.'∞√]*` +
    "|" +
    MATH_SLASH_TOKEN_RE.source,
  "g",
);
const SIMPLE_SLASH_EXPRESSION_RE = new RegExp(`^\\s*(${MATH_SLASH_TOKEN_RE.source})\\s*$`);

function normalizeKatexExpression(value: string): string {
  const trimmed = normalizeKatexExpressionSyntax(value.trim());
  const slashMatch = trimmed.match(SIMPLE_SLASH_EXPRESSION_RE);
  if (slashMatch) {
    const [numerator, denominator] = slashMatch[1].split(/\s*\/\s*/, 2);
    return String.raw`\frac{${normalizeKatexAtom(numerator)}}{${normalizeKatexAtom(denominator)}}`;
  }
  return trimmed
    .replace(/\\tg\b/g, "\\tan")
    .replace(/\\arctg\b/g, "\\arctan")
    .replace(/√\(([^()]+)\)/g, "\\sqrt{$1}")
    .replace(/∞/g, "\\infty")
    .replace(MATH_SLASH_TOKEN_RE, (token) => {
      const [numerator, denominator] = token.split(/\s*\/\s*/, 2);
      return String.raw`\frac{${normalizeKatexAtom(numerator)}}{${normalizeKatexAtom(denominator)}}`;
    })
    .replace(/\^\(([^()]+)\)/g, "^{$1}")
    .replace(/_\(([^()]+)\)/g, "_{$1}")
    .replace(/\\left\s*/g, "\\left")
    .replace(/\\right\s*/g, "\\right");
}

function normalizeKatexAtom(value: string): string {
  return normalizeKatexExpressionSyntax(value.trim());
}

function normalizeKatexExpressionSyntax(value: string): string {
  return normalizeKatexFunctions(value).replace(GREEK_WORD_RE, (token) => `\\${token.toLowerCase()}`);
}

function normalizeKatexFunctions(value: string): string {
  const withCompactCalls = value.replace(COMPACT_LATEX_FUNCTION_RE, (_, name: string, argument: string) => {
    const normalizedName = name.toLowerCase();
    const command = normalizedName === "tg" ? "tan" : normalizedName === "arctg" ? "arctan" : normalizedName;
    return `\\${command} ${argument}`;
  });
  return withCompactCalls.replace(BARE_LATEX_FUNCTION_RE, (_, name: string) => {
    if (name === "tg") return "\\tan ";
    if (name === "arctg") return "\\arctan ";
    return `\\${name} `;
  });
}

function stripMathDelimiters(value: string): string {
  if ((value.startsWith("$$") && value.endsWith("$$")) || (value.startsWith("$") && value.endsWith("$"))) {
    return value.replace(/^\$\$?|\$\$?$/g, "");
  }
  if ((value.startsWith("\\(") && value.endsWith("\\)")) || (value.startsWith("\\[") && value.endsWith("\\]"))) {
    return value.slice(2, -2);
  }
  return value;
}

function shouldRenderWholePartAsMath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || CYRILLIC_RE.test(trimmed)) return false;
  if (!/(\\[A-Za-z]+|[=^_]|√|∞)/.test(trimmed) && !SIMPLE_SLASH_EXPRESSION_RE.test(trimmed)) return false;
  return new RegExp(String.raw`^[A-Za-z0-9${GREEK_CHAR_SOURCE}\\{}()[\]\s+\-*/^_=.,'∞√]+$`).test(trimmed);
}

function renderKatexExpression(expression: string, key: string): React.ReactNode {
  const normalized = normalizeKatexExpression(expression);
  const html = katex.renderToString(normalized, {
    displayMode: false,
    errorColor: "#fca5a5",
    output: "html",
    strict: "ignore",
    throwOnError: false,
    trust: false,
  });
  return (
    <span
      key={key}
      className="richKatex"
      aria-label={normalized}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function renderUndelimitedMathText(text: string, keyPrefix: string): React.ReactNode[] {
  if (!text) return [];
  if (shouldRenderWholePartAsMath(text)) {
    const leading = text.match(/^\s*/)?.[0] ?? "";
    const trailing = text.match(/\s*$/)?.[0] ?? "";
    const trimmed = text.trim();
    return [
      leading,
      renderKatexExpression(trimmed, `${keyPrefix}-math-whole`),
      trailing,
    ].filter((node) => node !== "");
  }

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(INLINE_LATEX_MATH_RE)) {
    const expression = match[0];
    const index = match.index ?? 0;
    const trimmed = expression.trim();
    if (!trimmed || index < cursor) continue;
    if (index > cursor) nodes.push(text.slice(cursor, index));
    nodes.push(renderKatexExpression(trimmed, `${keyPrefix}-math-${index}`));
    cursor = index + expression.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes.length > 0 ? nodes : [text];
}

function renderInlineMathText(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(LATEX_DELIMITED_MATH_RE)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > cursor) {
      nodes.push(...renderUndelimitedMathText(text.slice(cursor, index), `${keyPrefix}-plain-${cursor}`));
    }
    nodes.push(renderKatexExpression(stripMathDelimiters(token), `${keyPrefix}-delimited-${index}`));
    cursor = index + token.length;
  }
  if (cursor < text.length) {
    nodes.push(...renderUndelimitedMathText(text.slice(cursor), `${keyPrefix}-plain-${cursor}`));
  }
  return nodes.length > 0 ? nodes : [text];
}

export function renderDisplayText(value: string): React.ReactNode {
  const lines = value.split("\n");
  return lines.map((line, lineIndex) => {
    const parts = line.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*)/g).filter(Boolean);
    return (
      <React.Fragment key={`line-${lineIndex}`}>
        {parts.map((part, partIndex) => {
          if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
            return (
              <strong key={`part-${lineIndex}-${partIndex}`} className="chatEmphasis">
                {renderInlineMathText(part.slice(2, -2), `strong-${lineIndex}-${partIndex}`)}
              </strong>
            );
          }
          if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
            return (
              <strong key={`part-${lineIndex}-${partIndex}`} className="chatEmphasis">
                {renderInlineMathText(part.slice(1, -1), `em-${lineIndex}-${partIndex}`)}
              </strong>
            );
          }
          return <React.Fragment key={`part-${lineIndex}-${partIndex}`}>{renderInlineMathText(part, `plain-${lineIndex}-${partIndex}`)}</React.Fragment>;
        })}
        {lineIndex < lines.length - 1 ? <br /> : null}
      </React.Fragment>
    );
  });
}

export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const trimmed = raw.trim();
    const candidate =
      /^https?:\/\//i.test(trimmed) || /^[a-z][a-z0-9+\-.]*:/i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`;
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}


export function computePopoverPosition(
  anchor: TopicAnchorPoint | null,
  shell: HTMLDivElement | null,
  popover: HTMLDivElement | null,
): PopoverPosition | null {
  if (!anchor || !shell) return null;
  const shellRect = shell.getBoundingClientRect();
  const popoverWidth = popover?.offsetWidth ?? 380;
  const popoverHeight = popover?.offsetHeight ?? 320;
  const gap = 18;
  const margin = 16;

  let left = anchor.side === "left" ? anchor.x - popoverWidth - gap : anchor.x + gap;
  let top = anchor.y - popoverHeight / 2;

  left = Math.max(margin, Math.min(shellRect.width - popoverWidth - margin, left));
  top = Math.max(margin, Math.min(shellRect.height - popoverHeight - margin, top));

  return { left, top, side: anchor.side };
}

export function makeMessageId(): string {
  return `msg_${Math.random().toString(36).slice(2, 10)}`;
}
