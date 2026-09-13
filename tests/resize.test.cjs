const assert = require("node:assert/strict");
const { mkdtemp, readFile, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const { _electron } = require("playwright");

test("bottom handle resizes only height, clamps dragging and persists settings", { timeout: 30000 }, async t => {
  const data = await mkdtemp(join(tmpdir(), "scallop-resize-"));
  const settingsPath = join(data, "settings.json");
  await writeFile(settingsPath, JSON.stringify({ width: 380, height: 360, x: 100, y: 100, fontSize: 16 }));
  const env = { ...process.env, SCALLOPALFRED_TEST_DATA: data };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => _electron.launch({ args: ["--experimental-strip-types", join(__dirname, "fixtures/desktop.cjs")], env });
  let desktop = await launch();
  t.after(() => desktop.close());
  let page = await desktop.firstWindow();
  await page.waitForFunction(() => document.body.dataset.status === "ready");
  const bounds = () => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  const initial = await bounds();
  const settings = async () => JSON.parse(await readFile(settingsPath, "utf8"));
  async function drag(distance, expected) {
    const handle = page.locator("#resize-height");
    const rect = await handle.boundingBox();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    await page.mouse.move(x, y);
    await page.waitForTimeout(50);
    assert.equal(await desktop.evaluate(() => global.testIgnoreMouseEvents), false);
    await page.mouse.down();
    await page.mouse.move(x, y + distance, { steps: 8 });
    await page.waitForFunction(height => window.innerHeight === height, expected, { timeout: 3000 });
    assert.equal(await desktop.evaluate(() => global.testIgnoreMouseEvents), false);
    await page.mouse.up();
    await page.waitForTimeout(100);
    assert.deepEqual(await bounds(), { ...initial, height: expected });
    assert.equal((await settings()).height, expected);
  }
  await drag(120, 480);
  await drag(-300, 320);
  const maximum = await desktop.evaluate(({ screen, BrowserWindow }) => {
    const bounds = BrowserWindow.getAllWindows()[0].getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    return Math.min(900, area.y + area.height - bounds.y);
  });
  await drag(1000, maximum);
  await page.locator("#title").hover();
  await page.waitForTimeout(50);
  assert.equal(await desktop.evaluate(() => global.testIgnoreMouseEvents), process.platform !== "linux");
  await desktop.evaluate(({ BrowserWindow }) => {
    const ipc = BrowserWindow.getAllWindows()[0].webContents.ipc;
    for (const height of [null, "500", NaN, Infinity]) ipc.emit("resize-height", {}, { height, finished: true });
  });
  assert.equal((await bounds()).height, maximum);
  assert.equal((await settings()).fontSize, 16);
  assert.deepEqual(await desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return { visible: window.isVisible(), topmost: window.isAlwaysOnTop(), focusable: window.isFocusable() };
  }), { visible: true, topmost: true, focusable: false });
  await desktop.close();
  desktop = await launch();
  page = await desktop.firstWindow();
  await page.waitForFunction(() => document.body.dataset.status === "ready");
  assert.deepEqual(await bounds(), { ...initial, height: maximum });
});
