const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { join } = require("node:path");
const { test } = require("node:test");
const { launch, request, until } = require("./fixtures/launch.cjs");

test("themes switch without replacing the thread or draft, and persist alongside height", { timeout: 30000 }, async t => {
  const app = await launch(t);
  const settings = () => readFile(join(app.data, "settings.json"), "utf8").then(JSON.parse).catch(() => ({}));
  const themeApplied = theme => app.page.waitForFunction(expected => document.documentElement.dataset.theme === expected, theme);
  await themeApplied("original");
  await app.copy(request("Which upgrade next?"));
  await app.waitForStatus("answer");
  await app.page.getByRole("button", { name: "Follow up", exact: true }).click();
  const draft = app.page.getByRole("textbox", { name: "Follow-up question" });
  await draft.fill("Does this suit my current build?");
  const turn = await app.page.locator(".turn").evaluateHandle(element => element);

  // Theme and height saves share a queue, so neither overwrites the other.
  const operations = await app.windowOperations(async () => {
    await app.emit("resize-height", { height: 640, finished: true });
    await app.clickTray("Theme", "WoWhead");
    await themeApplied("wowhead");
  });
  assert.deepEqual(operations, []);
  // Wowhead's page background.
  assert.equal(await app.page.locator("main").evaluate(element => getComputedStyle(element).backgroundColor), "rgb(16, 16, 16)");
  assert.equal(await draft.inputValue(), "Does this suit my current build?");
  assert.equal(await turn.evaluate(node => node.isConnected), true);
  await until(async () => {
    const saved = await settings();
    return saved.theme === "wowhead" && saved.height === 640;
  });

  // The saved theme applies on launch, and switching while hidden keeps the overlay hidden.
  await app.restart();
  await themeApplied("wowhead");
  assert.equal((await app.trayItem("Theme", "WoWhead")).checked, true);
  await app.page.getByRole("button", { name: "Hide", exact: true }).click();
  await until(async () => !(await app.window()).visible);
  await app.clickTray("Theme", "Original");
  await themeApplied("original");
  assert.equal((await app.window()).visible, false);
  await until(async () => (await settings()).theme === "original");
});
