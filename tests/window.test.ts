import assert from "node:assert/strict";
import { test } from "node:test";
import { launch, request, until } from "./fixtures/launch.ts";

// Operations that take keyboard focus from the game.
const focusOperations = ["show", "focus", "setFocusable"];
const shown = { visible: true, focusable: false, topmost: true, minimized: false };

test("the overlay stays above the game without taking focus", { timeout: 30000 }, async t => {
  const desktop = await launch(t);
  const { page } = desktop;
  await desktop.waitForStatus("ready");
  assert.equal(await page.locator("footer").isVisible(), false);
  assert.deepEqual(await desktop.window(), shown);
  // The page runs model output as HTML, so it must have no Node or Electron access.
  assert.equal(await page.evaluate(() => "require" in window || "process" in window), false);

  // Clicks pass through to the game except over controls.
  const hide = page.getByRole("button", { name: "Hide", exact: true });
  await hide.hover();
  await until(async () => await desktop.ignoresMouse() === false);
  await page.locator("#title").hover();
  await until(async () => await desktop.ignoresMouse() === (process.platform !== "linux"));

  await hide.click();
  await until(async () => !(await desktop.window()).visible);
  await desktop.clickTray("Show overlay");
  assert.deepEqual(await desktop.window(), shown);
  assert.equal(await desktop.skipsTaskbar(), true);

  // Showing an overlay that is already visible keeps its content and raises it without focus.
  const content = await page.locator("#answer").evaluateHandle(element => element.firstChild);
  const raised = await desktop.windowOperations(() => desktop.clickTray("Show overlay"));
  assert.ok(raised.includes("moveTop") && !raised.some(operation => focusOperations.includes(operation)), raised.join());
  assert.equal(await content.evaluate(node => node?.isConnected), true);

  // A visible or minimised overlay can still sit behind the game.
  await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setAlwaysOnTop(false));
  await desktop.clickTray("Show overlay");
  assert.deepEqual(await desktop.window(), shown);
  await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await desktop.clickTray("Show overlay");
  assert.deepEqual(await desktop.window(), shown);
  await hide.click();
  await until(async () => !(await desktop.window()).visible);
  await desktop.clickTrayIcon();
  assert.deepEqual(await desktop.window(), shown);

  // A copied request raises a hidden, minimised or covered overlay without focus.
  await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setAlwaysOnTop(false));
  const copied = await desktop.windowOperations(async () => {
    await desktop.copy(request("Behind the game"));
    await desktop.waitForAnswer("Answer: Behind the game");
  });
  assert.ok(!copied.some(operation => focusOperations.includes(operation)), copied.join());
  assert.deepEqual(await desktop.window(), shown);
  await hide.click();
  await until(async () => !(await desktop.window()).visible);
  await desktop.copy(request("While hidden"));
  await desktop.waitForAnswer("Answer: While hidden");
  assert.deepEqual(await desktop.window(), shown);
  await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await desktop.copy(request("While minimised"));
  await desktop.waitForAnswer("Answer: While minimised");
  assert.deepEqual(await desktop.window(), shown);

  // Hiding a running reply lets it finish without reopening the overlay.
  await desktop.copy(request("wait"));
  await desktop.waitForStatus("thinking");
  await hide.click();
  await until(async () => !(await desktop.window()).visible);
  await desktop.clickTray("Cancel question");
  await desktop.waitForAnswer("Question cancelled. Retry from the tray menu when ready.");
  assert.equal((await desktop.window()).visible, false);
});
