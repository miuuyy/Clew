import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { renderDisplayText } from "./appUiHelpers";

function renderText(value: string): string {
  return renderToStaticMarkup(<>{renderDisplayText(value)}</>);
}

function visibleMarkup(value: string): string {
  return renderText(value).replace(/\saria-label="[^"]*"/g, "");
}

describe("renderDisplayText", () => {
  it("preserves JSON keys, braces and blank lines in quiz content", () => {
    const html = visibleMarkup('{\n"difficulty": 3,\n\n"confidence": 0.8,\n"kind": "example"\n}');
    expect(html).toContain("difficulty");
    expect(html).toContain("confidence");
    expect(html).toContain("{");
    expect(html).toContain("}");
    expect(html).toContain("<br/><br/>");
  });
  it("renders explicit LaTeX fractions and functions through KaTeX", () => {
    const html = visibleMarkup(String.raw`F(x) = \frac{1}{3e}^{3x} + \frac{5}{3}`);

    expect(html).toContain("richKatex");
    expect(html).toContain("katex");
    expect(html).not.toContain(String.raw`\frac`);
  });

  it("renders math inside natural-language quiz prompts without eating the prose", () => {
    const html = visibleMarkup(String.raw`Знайдіть первісну функції f(x) = e^{3x}, графік якої проходить через точку M(0; 2).`);

    expect(html).toContain("Знайдіть");
    expect(html).toContain(", графік");
    expect(html).toContain("richKatex");
    expect(html).not.toContain("e^{3x}");
  });

  it("renders common trigonometric quiz answers instead of leaking raw commands", () => {
    const html = visibleMarkup(String.raw`F(x) = 2\tan\left(\frac{x}{2}\right) + C`);

    expect(html).toContain("richKatex");
    expect(html).not.toContain(String.raw`\tan`);
    expect(html).not.toContain(String.raw`\frac`);
  });

  it("treats slash between math atoms as division in prose", () => {
    const html = visibleMarkup("Обчисліть x/2 та a/b для заданих значень.");

    expect(html.match(/richKatex/g)?.length).toBe(2);
    expect(html).toContain("Обчисліть");
    expect(html).toContain("та");
    expect(html).not.toContain("x/2");
    expect(html).not.toContain("a/b");
  });

  it("does not render ordinary slash words as math", () => {
    const html = visibleMarkup("Use either and/or in prose, but render 3/5 as math.");

    expect(html).toContain("and/or");
    expect(html).toContain("richKatex");
    expect(html).not.toContain("3/5");
  });

  it("normalizes bare trig function answers before KaTeX rendering", () => {
    const html = renderText("tan alpha = cos alpha / sin alpha");

    expect(html).toContain(String.raw`\tan \alpha = \frac{\cos \alpha}{\sin \alpha}`);
    expect(visibleMarkup("tan alpha = cos alpha / sin alpha")).not.toContain("tan alpha");
  });

  it("normalizes compact trig answers with implicit arguments", () => {
    const alphaHtml = renderText("tanα = cosα/sinα");
    const xHtml = renderText("tanx = cosx/sinx");

    expect(alphaHtml).toContain(String.raw`\tan α = \frac{\cos α}{\sin α}`);
    expect(xHtml).toContain(String.raw`\tan x = \frac{\cos x}{\sin x}`);
  });
});
