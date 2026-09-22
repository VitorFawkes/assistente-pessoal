import React from "react";
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./md";

test("numbered items separated by blank lines retain one ordered list", () => {
  const html = renderToStaticMarkup(<Markdown text={"1. Manhã: pensar.\n\n2. Durante o dia: retomar.\n\n\n3. Fim do dia: concluir."} />);
  expect(html.match(/<ol(?:\s|>)/g)).toHaveLength(1);
  expect(html.match(/<li(?:\s|>)/g)).toHaveLength(3);
  expect(html).toContain("<li>Manhã: pensar.</li><li>Durante o dia: retomar.</li><li>Fim do dia: concluir.</li>");
});

test("a paragraph between numbered items ends the previous list", () => {
  const html = renderToStaticMarkup(<Markdown text={"1. Primeira lista.\n\nUm parágrafo separado.\n\n1. Segunda lista."} />);
  expect(html.match(/<ol(?:\s|>)/g)).toHaveLength(2);
  expect(html).toMatch(/<\/ol><p\b[^>]*>Um parágrafo separado\.<\/p><ol\b/);
});

test("ordered list items preserve emphasis and escape raw HTML", () => {
  const html = renderToStaticMarkup(<Markdown text={"1. **Manhã:** <script>alert(1)</script>\n\n2. *Fim:* `próximo passo` & revisão."} />);
  expect(html).toContain("<strong>Manhã:</strong> &lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).toContain("<em>Fim:</em>");
  expect(html).toMatch(/<code\b[^>]*>próximo passo<\/code> &amp; revisão\./);
  expect(html).not.toContain("<script>");
});
