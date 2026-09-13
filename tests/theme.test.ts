import assert from "node:assert/strict";
import { test } from "node:test";
import { launch, request, until } from "./fixtures/launch.ts";

test("themes switch without replacing the thread or draft, and persist alongside height", { timeout: 30000 }, async t => {
  const desktop = await launch(t);
  const themeApplied = (theme: string) => desktop.page.waitForFunction(expected => document.documentElement.dataset.theme === expected, theme);
  await themeApplied("original");
  await desktop.copy(request("Which upgrade next?"));
  await desktop.waitForStatus("answer");
  await desktop.page.getByRole("button", { name: "Follow up", exact: true }).click();
  const draft = desktop.page.getByRole("textbox", { name: "Follow-up question" });
  await draft.fill("Does this suit my current build?");
  const turn = await desktop.page.locator(".turn").evaluateHandle(element => element);

  // Theme and height saves share a queue, so neither overwrites the other.
  const operations = await desktop.windowOperations(async () => {
    await desktop.emit("resize-height", { height: 640, finished: true });
    await desktop.clickTray("Theme", "WoWhead");
    await themeApplied("wowhead");
  });
  assert.deepEqual(operations, []);
  // Wowhead's page background.
  assert.equal(await desktop.page.locator("main").evaluate(element => getComputedStyle(element).backgroundColor), "rgb(16, 16, 16)");
  assert.equal(await draft.inputValue(), "Does this suit my current build?");
  assert.equal(await turn.evaluate(node => node.isConnected), true);
  await until(async () => {
    const saved = await desktop.settings();
    return saved.theme === "wowhead" && saved.height === 640;
  });

  // The saved theme applies on launch, and switching while hidden keeps the overlay hidden.
  await desktop.restart();
  await themeApplied("wowhead");
  assert.equal((await desktop.trayItem("Theme", "WoWhead")).checked, true);
  await desktop.page.getByRole("button", { name: "Hide", exact: true }).click();
  await until(async () => !(await desktop.window()).visible);
  await desktop.clickTray("Theme", "Original");
  await themeApplied("original");
  assert.equal((await desktop.window()).visible, false);
  await until(async () => (await desktop.settings()).theme === "original");
});
