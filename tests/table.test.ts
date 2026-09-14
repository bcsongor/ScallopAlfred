import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown } from "../app/markdown.ts";
import { launch } from "./fixtures/launch.ts";

test("tables keep words intact and scroll wide content within the overlay", { timeout: 30000 }, async t => {
  const desktop = await launch(t);
  const { page } = desktop;
  await desktop.waitForStatus("ready");
  const render = (text: string) => desktop.app.evaluate(({ BrowserWindow }, { text, html }) => {
    BrowserWindow.getAllWindows()[0].webContents.send("thread", {
      state: { status: "answer", title: "Altar choices" }, fontSize: 14, canFollowup: false,
      turns: [{ id: "table", question: "How shall I use the altar?", status: "answer", text, html }],
    });
  }, { text, html: renderMarkdown(text) });

  await render(`For the tree's **four choice nodes**, my practical defaults would be:

| Choice | Reason |
| --- | --- |
| **Spectral Shipping** | Additional flight destinations make travelling easier. |
| **Spiritual Succession** | Recovery from death outside the Vaults; choose **Surge Seniority** instead if you mainly farm Curse Surges. |
| **Swift Steps** | More gusts for navigating the Vaults. |
| **Egg Specialist** | Faster egg destruction; take **Egg Evasion** if bursts are killing you. |`);
  await page.locator("table").waitFor();
  for (const theme of ["WoWhead", "Original"]) {
    await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(380, 800));
    await desktop.clickTray("Theme", theme);
    await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, theme.toLowerCase());
    const brokenWords = await page.locator("table").evaluate(element => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const broken: string[] = [];
      while (walker.nextNode()) {
        for (const match of (walker.currentNode.textContent ?? "").matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(walker.currentNode, match.index);
          range.setEnd(walker.currentNode, match.index + match[0].length);
          if (range.getClientRects().length > 1) broken.push(match[0]);
        }
      }
      return broken;
    });
    assert.deepEqual(brokenWords, [], `${theme} splits table words across lines`);
    assert.equal(await page.locator("table").evaluate(element => element.scrollWidth > element.clientWidth), false);
  }

  // Unbreakable content scrolls inside the table.
  await render("| Item | Source | Notes |\n| --- | --- | --- |\n| UnusuallyLongUnbrokenItemName | AnotherLongUnbrokenSourceName | Keep this item. |");
  await page.getByRole("cell", { name: "UnusuallyLongUnbrokenItemName", exact: true }).waitFor();
  assert.equal(await page.locator("table").evaluate(element => element.scrollWidth > element.clientWidth), true);
  assert.equal(await page.locator("#answer").evaluate(element => element.scrollWidth > element.clientWidth), false);
  await page.locator("table").hover();
  await page.mouse.wheel(300, 0);
  await page.waitForFunction(() => (document.querySelector("table")?.scrollLeft ?? 0) > 0);
});
