import assert from "node:assert/strict";
import { test } from "node:test";
import { launch, until } from "./fixtures/launch.ts";

test("dragging the header moves the window, keeps it on screen and saves it", { timeout: 30000 }, async t => {
  const desktop = await launch(t, { width: 380, height: 360, x: 300, y: 200 });
  await desktop.waitForStatus("ready");
  const bounds = () => desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  const initial = await bounds();

  // The brand is the part of the header that isn't a button.
  const brand = await desktop.page.locator(".brand").boundingBox();
  assert.ok(brand);
  const x = brand.x + brand.width / 2;
  const y = brand.y + brand.height / 2;
  await desktop.page.mouse.move(x, y);
  await desktop.page.mouse.down();
  await desktop.page.mouse.move(x + 50, y + 40, { steps: 8 });
  await desktop.page.mouse.up();
  await until(async () => (await desktop.settings()).y !== initial.y, "the position was never saved");
  const dragged = await bounds();
  assert.ok(dragged.x > initial.x && dragged.y > initial.y, `the window stayed at ${dragged.x},${dragged.y}`);
  assert.equal(dragged.width, initial.width);
  assert.equal(dragged.height, initial.height);
  const saved = await desktop.settings();
  assert.deepEqual({ x: saved.x, y: saved.y }, { x: dragged.x, y: dragged.y });

  // A position past the display's edge pulls the whole window back onto it.
  await desktop.emit("move-overlay", { x: -10000, y: -10000, finished: true });
  const area = await desktop.app.evaluate(({ screen, BrowserWindow }) =>
    screen.getDisplayMatching(BrowserWindow.getAllWindows()[0].getBounds()).workArea);
  await until(async () => (await desktop.settings()).x === area.x, "the clamped position was never saved");
  assert.deepEqual(await bounds(), { ...initial, x: area.x, y: area.y });

  for (const x of [null, "500", NaN, Infinity]) await desktop.emit("move-overlay", { x, y: 0, finished: true });
  assert.deepEqual(await bounds(), { ...initial, x: area.x, y: area.y });

  await desktop.restart();
  await desktop.waitForStatus("ready");
  assert.deepEqual(await bounds(), { ...initial, x: area.x, y: area.y });
});
