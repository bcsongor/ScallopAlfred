const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { join } = require("node:path");
const { test } = require("node:test");
const { launch, until } = require("./fixtures/launch.cjs");

test("the bottom handle resizes only the height, within limits, and saves it", { timeout: 30000 }, async t => {
  const app = await launch(t, { width: 380, height: 360, x: 100, y: 100, fontSize: 16 });
  await app.waitForStatus("ready");
  const bounds = () => app.desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  const settings = () => readFile(join(app.data, "settings.json"), "utf8").then(JSON.parse).catch(() => ({}));
  const initial = await bounds();

  async function drag(distance, expected) {
    const handle = await app.page.locator("#resize-height").boundingBox();
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await app.page.mouse.move(x, y);
    await until(async () => await app.ignoresMouse() === false);
    await app.page.mouse.down();
    await app.page.mouse.move(x, y + distance, { steps: 8 });
    await app.page.waitForFunction(height => window.innerHeight === height, expected, { timeout: 3000 });
    // The drag keeps mouse input after the pointer leaves the handle.
    assert.equal(await app.ignoresMouse(), false);
    await app.page.mouse.up();
    await until(async () => (await settings()).height === expected);
    assert.deepEqual(await bounds(), { ...initial, height: expected });
  }

  await drag(120, 480);
  await drag(-300, 320);
  const maximum = await app.desktop.evaluate(({ screen, BrowserWindow }) => {
    const bounds = BrowserWindow.getAllWindows()[0].getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    return Math.min(900, area.y + area.height - bounds.y);
  });
  await drag(1000, maximum);
  await app.page.locator("#title").hover();
  await until(async () => await app.ignoresMouse() === (process.platform !== "linux"));

  for (const height of [null, "500", NaN, Infinity]) await app.emit("resize-height", { height, finished: true });
  assert.equal((await bounds()).height, maximum);
  assert.equal((await settings()).fontSize, 16);
  assert.deepEqual(await app.window(), { visible: true, focusable: false, topmost: true, minimized: false });

  await app.restart();
  await app.waitForStatus("ready");
  assert.deepEqual(await bounds(), { ...initial, height: maximum });
});
