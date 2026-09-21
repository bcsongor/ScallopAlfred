import assert from "node:assert/strict";
import { test } from "node:test";
import { browseUrl } from "../app/address.ts";

test("the address bar accepts web addresses and nothing else", () => {
  // A scheme is added where it is missing, and the URL is normalised the way the browser will load it.
  assert.equal(browseUrl("x.com"), "https://x.com/");
  assert.equal(browseUrl("  x.com/csongorbokay  "), "https://x.com/csongorbokay");
  assert.equal(browseUrl("www.wowhead.com/item=228721"), "https://www.wowhead.com/item=228721");
  assert.equal(browseUrl("http://127.0.0.1:8080/page?q=1"), "http://127.0.0.1:8080/page?q=1");
  assert.equal(browseUrl("https://x.com/home#latest"), "https://x.com/home#latest");

  // Anything that isn't a web address stays out, so the pane can't be pointed at the local disk.
  for (const input of ["", "   ", "how do I gear up", "localhost:3000", "javascript:alert(1)", "file:///C:/Windows", "data:text/html,<b>x", "about:blank"]) {
    assert.equal(browseUrl(input), undefined, input);
  }
});
