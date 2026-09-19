import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantMarkdown } from "./AssistantMarkdown";

describe("native assistant Markdown", () => {
  it("renders prose, lists, code and mathematical notation", () => {
    const html = renderToStaticMarkup(<AssistantMarkdown content={'Hello **learner**.\n\n- Item\n\n```python\nprint(1)\n```\n\n$x^2$'} />);
    expect(html).toContain("<strong>learner</strong>");
    expect(html).toContain("<li>Item</li>");
    expect(html).toContain('class="language-python"');
    expect(html).toContain('class="katex"');
  });
  it("keeps model text from injecting HTML or executable links", () => {
    const html = renderToStaticMarkup(<AssistantMarkdown content={'<script>alert(1)</script>\n\n[unsafe](javascript:alert)\n\n[reference](https://example.org)'} />);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
