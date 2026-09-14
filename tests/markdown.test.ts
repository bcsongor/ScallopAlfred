import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown, webUrl } from "../app/markdown.ts";

test("external links only accept complete HTTP and HTTPS URLs", () => {
  assert.equal(webUrl("https://www.wowhead.com/item=123"), "https://www.wowhead.com/item=123");
  assert.equal(webUrl("http://example.com"), "http://example.com/");
  for (const value of [null, {}, "", "/local", "//example.com", "javascript:alert(1)", "data:text/html,test", "file:///C:/Windows/notepad.exe", "ms-settings:display"]) {
    assert.equal(webUrl(value), undefined);
  }
});

test("Markdown cannot embed HTML, images or application links", () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n![image](https://example.com/image.png)\n\n[script](javascript:alert%281%29) [encoded](jav&#x61;script:alert%281%29) [file](file:///C:/Windows/notepad.exe)');
  assert.doesNotMatch(html, /<(script|img)\b/i);
  assert.doesNotMatch(html, /href="(?:javascript|file|data):/i);
  assert.match(html, /&lt;script&gt;/);
});
