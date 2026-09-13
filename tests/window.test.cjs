const assert = require("node:assert/strict");
const { test } = require("node:test");
const { launch, request, until } = require("./fixtures/launch.cjs");

// Operations that take keyboard focus from the game.
const focusOperations = ["show", "focus", "setFocusable"];
const shown = { visible: true, focusable: false, topmost: true, minimized: false };

test("the overlay stays above the game without taking focus", { timeout: 30000 }, async t => {
  const app = await launch(t);
  const { page } = app;
  await app.waitForStatus("ready");
  assert.equal(await page.locator("footer").isVisible(), false);
  assert.deepEqual(await app.window(), shown);
  assert.equal(await app.desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().contextIsolation), true);

  // Clicks pass through to the game except over controls.
  const hide = page.getByRole("button", { name: "Hide", exact: true });
  await hide.hover();
  await until(async () => await app.ignoresMouse() === false);
  await page.locator("#title").hover();
  await until(async () => await app.ignoresMouse() === (process.platform !== "linux"));

  await hide.click();
  await until(async () => !(await app.window()).visible);
  await app.clickTray("Show overlay");
  assert.deepEqual(await app.window(), shown);
  assert.equal(await app.desktop.evaluate(() => global.testSkipTaskbar), true);

  // Showing an overlay that is already visible keeps its content and raises it without focus.
  const content = await page.locator("#answer").evaluateHandle(element => element.firstChild);
  const raised = await app.windowOperations(() => app.clickTray("Show overlay"));
  assert.ok(raised.includes("moveTop") && !raised.some(operation => focusOperations.includes(operation)), raised.join());
  assert.equal(await content.evaluate(node => node.isConnected), true);

  // A visible or minimised overlay can still sit behind the game.
  await app.desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setAlwaysOnTop(false));
  await app.clickTray("Show overlay");
  assert.deepEqual(await app.window(), shown);
  await app.desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await app.clickTray("Show overlay");
  assert.deepEqual(await app.window(), shown);
  await hide.click();
  await until(async () => !(await app.window()).visible);
  await app.desktop.evaluate(() => global.testTray.emit("click"));
  assert.deepEqual(await app.window(), shown);

  // A copied request raises a hidden, minimised or covered overlay without focus.
  await app.desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setAlwaysOnTop(false));
  const copied = await app.windowOperations(async () => {
    await app.copy(request("Behind the game"));
    await app.waitForAnswer("Answer: Behind the game");
  });
  assert.ok(!copied.some(operation => focusOperations.includes(operation)), copied.join());
  assert.deepEqual(await app.window(), shown);
  await hide.click();
  await until(async () => !(await app.window()).visible);
  await app.copy(request("While hidden"));
  await app.waitForAnswer("Answer: While hidden");
  assert.deepEqual(await app.window(), shown);
  await app.desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await app.copy(request("While minimised"));
  await app.waitForAnswer("Answer: While minimised");
  assert.deepEqual(await app.window(), shown);

  // Hiding a running reply lets it finish without reopening the overlay.
  await app.copy(request("wait"));
  await app.waitForStatus("thinking");
  await hide.click();
  await until(async () => !(await app.window()).visible);
  await app.clickTray("Cancel question");
  await app.waitForAnswer("Question cancelled. Retry from the tray menu when ready.");
  assert.equal((await app.window()).visible, false);
});
