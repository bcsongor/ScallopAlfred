import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown } from "../app/markdown.ts";

test("Markdown cannot embed HTML, images or application links", () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n![image](https://example.com/image.png)\n\n[script](javascript:alert%281%29) [encoded](jav&#x61;script:alert%281%29) [file](file:///C:/Windows/notepad.exe)');
  assert.doesNotMatch(html, /<(script|img)\b/i);
  assert.doesNotMatch(html, /href="(?:javascript|file|data):/i);
  assert.match(html, /&lt;script&gt;/);
});

test("money written as gold, silver and copper gets coin icons", () => {
  const coin = (name: string) => `<img class="coin" src="../assets/${name}.gif" alt=" ${name}">`;
  assert.equal(renderMarkdown("Sell for 1,234g 56s 7c each."), `<p>Sell for <span class="money">1,234${coin("gold")} 56${coin("silver")} 7${coin("copper")}</span> each.</p>
`);
  assert.equal(renderMarkdown("**About 120g**"), `<p><strong>About <span class="money">120${coin("gold")}</span></strong></p>
`);
  assert.equal(renderMarkdown("Costs 5g 3c."), `<p>Costs <span class="money">5${coin("gold")} 3${coin("copper")}</span>.</p>
`);
  // Seconds, decimals, identifiers and code stay text.
  for (const text of ["Cast in 2s 5c", "1.5g", "x120g", "120gold", "`120g`"]) assert.doesNotMatch(renderMarkdown(text), /class="money"/);
});
