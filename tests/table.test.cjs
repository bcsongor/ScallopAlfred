const assert = require("node:assert/strict");
const { mkdtemp } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const { _electron } = require("playwright");
const { renderMarkdown } = require("../sidecar/markdown.ts");

test("tables keep words intact and scroll wide content within the overlay", { timeout: 30000 }, async t => {
  const data = await mkdtemp(join(tmpdir(), "scallop-table-"));
  const env = { ...process.env, SCALLOPALFRED_TEST_DATA: data };
  delete env.ELECTRON_RUN_AS_NODE;
  const desktop = await _electron.launch({ args: ["--experimental-strip-types", join(__dirname, "fixtures/desktop.cjs")], env });
  t.after(() => desktop.close());
  const page = await desktop.firstWindow();
  await page.waitForFunction(() => document.body.dataset.status === "ready");
  const table = `For the tree's **four choice nodes**, my practical defaults would be:

| Choice | Reason |
| --- | --- |
| **Spectral Shipping** | Additional flight destinations make travelling easier. |
| **Spiritual Succession** | Recovery from death outside the Vaults; choose **Surge Seniority** instead if you mainly farm Curse Surges. |
| **Swift Steps** | More gusts for navigating the Vaults. |
| **Egg Specialist** | Faster egg destruction; take **Egg Evasion** if bursts are killing you. |`;
  const render = async text => desktop.evaluate(({ BrowserWindow }, { text, html }) => {
    BrowserWindow.getAllWindows()[0].webContents.send("overlay", { status: "answer", title: "Altar choices", text }, 14,
      [{ id: "table", question: "How shall I use the altar?", status: "answer", text, html }], false);
  }, { text, html: renderMarkdown(text) });
  await render(table);
  await page.locator("table").waitFor();
  for (const theme of ["WoWhead", "Original"]) {
    await desktop.evaluate(({ BrowserWindow }, label) => {
      BrowserWindow.getAllWindows()[0].setSize(380, 800);
      global.testMenu.items.find(item => item.label === "Theme").submenu.items.find(item => item.label === label).click();
    }, theme);
    await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, theme.toLowerCase());
    await page.screenshot({ path: join(data, `${theme.toLowerCase()}-table.png`) });
    const brokenWords = await page.locator("table").evaluate(element => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const broken = [];
      while (walker.nextNode()) {
        for (const match of walker.currentNode.textContent.matchAll(/\S+/g)) {
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

  await render("| Item | Source | Notes |\n| --- | --- | --- |\n| UnusuallyLongUnbrokenItemName | AnotherLongUnbrokenSourceName | Keep this item. |");
  await page.getByRole("cell", { name: "UnusuallyLongUnbrokenItemName", exact: true }).waitFor();
  assert.equal(await page.locator("table").evaluate(element => element.scrollWidth > element.clientWidth), true);
  assert.equal(await page.locator("#answer").evaluate(element => element.scrollWidth > element.clientWidth), false);
  await page.locator("table").hover();
  await page.waitForTimeout(50);
  assert.equal(await desktop.evaluate(() => global.testIgnoreMouseEvents), false);
  await page.mouse.wheel(300, 0);
  await page.waitForFunction(() => document.querySelector("table").scrollLeft > 0);
  t.diagnostic(`Table screenshots: ${data}`);
});
