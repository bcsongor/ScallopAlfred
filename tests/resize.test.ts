import assert from "node:assert/strict";
import { test } from "node:test";
import { launch, until } from "./fixtures/launch.ts";

test("the bottom handle resizes only the height, within limits, and saves it", { timeout: 30000 }, async t => {
  const desktop = await launch(t, { width: 380, height: 360, x: 100, y: 100, fontSize: 16 });
  await desktop.waitForStatus("ready");
  const bounds = () => desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  const initial = await bounds();

  async function drag(distance: number, expected: number): Promise<void> {
    const handle = await desktop.page.locator("#resize-height").boundingBox();
    assert.ok(handle);
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await desktop.page.mouse.move(x, y);
    await desktop.page.mouse.down();
    await desktop.page.mouse.move(x, y + distance, { steps: 8 });
    await desktop.page.waitForFunction(height => window.innerHeight === height, expected, { timeout: 3000 });
    await desktop.page.mouse.up();
    await until(async () => (await desktop.settings()).height === expected);
    assert.deepEqual(await bounds(), { ...initial, height: expected });
  }

  await drag(120, 480);
  await drag(-300, 320);
  const maximum = await desktop.app.evaluate(({ screen, BrowserWindow }) => {
    const current = BrowserWindow.getAllWindows()[0].getBounds();
    const area = screen.getDisplayMatching(current).workArea;
    return Math.min(1600, area.y + area.height - current.y);
  });
  await drag(1000, maximum);

  for (const height of [null, "500", NaN, Infinity]) await desktop.emit("resize-height", { height, finished: true });
  assert.equal((await bounds()).height, maximum);
  assert.equal((await desktop.settings()).fontSize, 16);
  assert.deepEqual(await desktop.window(), { visible: true, focusable: false, topmost: true, minimized: false });

  await desktop.restart();
  await desktop.waitForStatus("ready");
  assert.deepEqual(await bounds(), { ...initial, height: maximum });
});

test("the left handle resizes the width leftwards, keeping the right edge", { timeout: 30000 }, async t => {
  const desktop = await launch(t, { width: 380, height: 360, x: 700, y: 100 });
  await desktop.waitForStatus("ready");
  const bounds = () => desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  const initial = await bounds();
  const right = initial.x + initial.width;

  // Dragging the handle away from the window widens it. The window moves as it grows, so the
  // pointer path only has to prove the direction; the exact arithmetic is checked over IPC below.
  const handle = await desktop.page.locator("#resize-width").boundingBox();
  assert.ok(handle);
  await desktop.page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await desktop.page.mouse.down();
  await desktop.page.mouse.move(handle.x - 40, handle.y + handle.height / 2, { steps: 8 });
  await desktop.page.waitForFunction(from => window.innerWidth > from, initial.width, { timeout: 3000 });
  await desktop.page.mouse.up();
  const dragged = await bounds();
  assert.ok(dragged.width > initial.width, `width ${dragged.width} did not grow from ${initial.width}`);
  assert.equal(dragged.x + dragged.width, right, "the right edge moved");
  assert.equal(dragged.y, initial.y);
  assert.equal(dragged.height, initial.height);
  await until(async () => (await desktop.settings()).width === dragged.width);
  assert.equal((await desktop.settings()).x, dragged.x);

  /** Applies a width the way the handle does, then waits for it to be saved. */
  async function setWidth(width: number, expected: number): Promise<void> {
    await desktop.emit("resize-width", { width, finished: true });
    await until(async () => {
      const saved = await desktop.settings();
      return saved.width === expected && saved.x === right - expected;
    }, `width never settled at ${expected}`);
    assert.deepEqual(await bounds(), { ...initial, width: expected, x: right - expected });
  }

  // The left edge takes the whole change, so the right edge stays put at every size.
  await setWidth(580, 580);
  await setWidth(300, 300);
  await setWidth(100, 280);
  const maximum = await desktop.app.evaluate(({ screen, BrowserWindow }) => {
    const current = BrowserWindow.getAllWindows()[0].getBounds();
    const area = screen.getDisplayMatching(current).workArea;
    return Math.min(1600, current.x + current.width - area.x);
  });
  await setWidth(5000, maximum);

  for (const width of [null, "500", NaN, Infinity]) await desktop.emit("resize-width", { width, finished: true });
  assert.deepEqual(await bounds(), { ...initial, width: maximum, x: right - maximum });

  // The width and the position it implies both survive a restart, so the right edge returns.
  await desktop.restart();
  await desktop.waitForStatus("ready");
  assert.deepEqual(await bounds(), { ...initial, width: maximum, x: right - maximum });
});
