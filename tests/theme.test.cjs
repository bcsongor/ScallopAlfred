const assert = require("node:assert/strict");
const { mkdtemp, readFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { test } = require("node:test");
const { _electron } = require("playwright");

test("themes switch without replacing a thread or draft and persist alongside height", { timeout: 30000 }, async t => {
  const data = await mkdtemp(join(tmpdir(), "scallop-theme-"));
  const env = { ...process.env, SCALLOPALFRED_TEST_DATA: data };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => _electron.launch({ args: ["--experimental-strip-types", join(__dirname, "fixtures/desktop.cjs")], env });
  let desktop = await launch();
  t.after(() => desktop.close());
  let page = await desktop.firstWindow();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "original");
  await desktop.evaluate(async ({ clipboard }) => {
    await clipboard.writeText("SCALLOPALFRED:" + JSON.stringify({
      v: 2, id: "theme-preview", context: "theme-preview", thread: "new",
      question: "## Choosing your next upgrade\n\nCompare **item level** and useful stats before replacing your gear.\n\n- Keep your strongest secondary stats.\n- Check [Wowhead](https://www.wowhead.com/) for item details.\n\nUse `Alt+Q` to ask about another item.",
      subjects: [{ type: "item", name: "Choosing your next upgrade", link: "item:123", tooltip: [] }],
      player: { class: "Druid", spec: "Restoration", level: 90 }, gameVersion: "12.1.0",
    }));
  });
  await page.waitForFunction(() => document.body.dataset.status === "answer");
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(380, 640));
  await page.getByRole("button", { name: "Follow up", exact: true }).click();
  const draft = page.getByRole("textbox", { name: "Follow-up question" });
  await draft.fill("Does this suit my current build?");
  const content = await page.locator(".turn").evaluateHandle(element => element);
  await page.locator("#answer").evaluate(element => { element.scrollTop = 0; });
  await desktop.evaluate(({ BrowserWindow }) => {
    global.testWindowOperations = [];
    // These saves share one queue so neither setting overwrites the other.
    BrowserWindow.getAllWindows()[0].webContents.ipc.emit("resize-height", {}, 640, true);
    global.testMenu.items.find(item => item.label === "Theme").submenu.items.find(item => item.label === "WoWhead").click();
  });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "wowhead");
  assert.equal(await draft.inputValue(), "Does this suit my current build?");
  assert.equal(await content.evaluate(element => element.isConnected), true);
  await content.dispose();
  assert.equal(await page.locator("#answer").evaluate(element => element.scrollTop), 0);
  const headerBounds = await page.locator(".overlay-heading").boundingBox();
  const viewportBounds = await page.locator("#answer").boundingBox();
  const firstMessage = page.locator(".question").first();
  const messageBounds = await firstMessage.boundingBox();
  const topSpacing = messageBounds.y - viewportBounds.y;
  assert.ok(topSpacing >= 10, "The first message must clear the header shadow");
  assert.ok(Math.abs(viewportBounds.y - headerBounds.y - headerBounds.height) < 1, "The scroll viewport must touch the header");
  await page.locator("#answer").evaluate((element, distance) => { element.scrollTop = distance; }, topSpacing);
  assert.ok(Math.abs((await firstMessage.boundingBox()).y - viewportBounds.y) < 1, "The spacing must scroll with the message");
  await page.locator("#answer").evaluate(element => { element.scrollTop = 0; });
  assert.deepEqual(await desktop.evaluate(() => global.testWindowOperations), []);
  assert.equal(await page.locator("#title").evaluate(element => getComputedStyle(element).color), "rgb(255, 209, 0)");
  assert.equal(await page.locator("main").evaluate(element => getComputedStyle(element).backgroundColor), "rgb(24, 24, 24)");
  assert.match(await page.locator("body").evaluate(element => getComputedStyle(element).fontFamily), /Arial/);

  async function savedTheme(expected) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const settings = await readFile(join(data, "settings.json"), "utf8").then(JSON.parse).catch(() => undefined);
      if (settings?.theme === expected && settings.height === 640) return settings;
      await delay(20);
    }
    assert.fail("The theme and height were not saved together");
  }
  assert.equal((await savedTheme("wowhead")).fontSize, 14);
  await page.screenshot({ path: join(data, "wowhead-thread.png") });
  await page.getByRole("button", { name: "Back to threads" }).click();
  await page.screenshot({ path: join(data, "wowhead-history.png") });
  await desktop.close();
  desktop = await launch();
  page = await desktop.firstWindow();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "wowhead");
  assert.equal(await desktop.evaluate(() => global.testMenu.items.find(item => item.label === "Theme").submenu.items.find(item => item.label === "WoWhead").checked), true);
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await desktop.evaluate(() => global.testMenu.items.find(item => item.label === "Theme").submenu.items.find(item => item.label === "Original").click());
  await page.waitForFunction(() => document.documentElement.dataset.theme === "original");
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  assert.match(await page.locator("body").evaluate(element => getComputedStyle(element).fontFamily), /Berkeley Mono/);
  await savedTheme("original");
  t.diagnostic(`WoWhead thread screenshot: ${join(data, "wowhead-thread.png")}`);
  t.diagnostic(`WoWhead history screenshot: ${join(data, "wowhead-history.png")}`);
});
