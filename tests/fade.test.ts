import assert from "node:assert/strict";
import { test } from "node:test";
import { launch, until } from "./fixtures/launch.ts";

test("the fade box fades the window while the pointer is elsewhere, and is saved", { timeout: 30000 }, async t => {
  const desktop = await launch(t, { width: 380, height: 360, x: 100, y: 100 });
  // Windows keeps opacity as a byte, so it reads back rounded.
  const opacity = () => desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getOpacity())
    .then(value => Math.round(value * 100) / 100);
  // Stands in for the real pointer, which the person running the tests may be moving.
  const point = (inside: boolean) => desktop.app.evaluate(({ BrowserWindow, screen }, inside) => {
    const { x, y } = BrowserWindow.getAllWindows()[0].getBounds();
    const pointer = inside ? { x: x + 20, y: y + 20 } : { x: x - 20, y };
    screen.getCursorScreenPoint = () => pointer;
  }, inside);
  const fadeBox = () => desktop.page.locator("#fade");

  await desktop.waitForStatus("ready");
  await point(false);
  assert.equal(await fadeBox().isChecked(), false);
  assert.equal(await opacity(), 1);

  await fadeBox().click();
  await until(async () => (await desktop.settings()).fade === true, "the fade setting was never saved");
  await until(async () => await opacity() === 0.6, "the window never faded");
  await point(true);
  await until(async () => await opacity() === 1, "the window never came back under the pointer");

  await desktop.restart();
  await desktop.waitForStatus("ready");
  await point(false);
  assert.equal(await fadeBox().isChecked(), true);
  await until(async () => await opacity() === 0.6, "the saved setting never faded the window");

  await fadeBox().click();
  await until(async () => (await desktop.settings()).fade === false, "turning fading off was never saved");
  assert.equal(await opacity(), 1);
});
