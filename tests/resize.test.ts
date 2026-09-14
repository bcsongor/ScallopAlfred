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
    return Math.min(900, area.y + area.height - current.y);
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
