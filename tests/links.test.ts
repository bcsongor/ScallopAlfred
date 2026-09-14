import assert from "node:assert/strict";
import { test } from "node:test";
import { launch, request, until } from "./fixtures/launch.ts";

test("answers render Markdown with external source links and cached favicons", { timeout: 30000 }, async t => {
  const desktop = await launch(t);
  await desktop.waitForStatus("ready");
  const markdown = "**Check the tooltip**\n\n- Compare both slots.\n- Press `Alt+Q` for a new question.\n\n"
    + "[**Wowhead**](https://www.wowhead.com/) or https://worldofwarcraft.blizzard.com/\n\n[Blocked](javascript:alert%281%29)";
  await desktop.copy(request(markdown));
  const { page } = desktop;
  await page.waitForSelector("#answer strong");
  assert.equal(await page.locator("#answer li").count(), 2);
  assert.equal(await page.locator("#answer a").count(), 2);
  assert.equal(await page.locator("#answer code").textContent(), "Alt+Q");
  await page.waitForFunction(() => document.querySelector<HTMLImageElement>("#answer .favicon")?.naturalWidth === 16);
  assert.equal(await page.locator("#answer .favicon").count(), 1);
  assert.deepEqual(await desktop.iconRequests(), [
    "https://www.google.com/s2/favicons?domain=www.wowhead.com&sz=32",
    "https://www.google.com/s2/favicons?domain=worldofwarcraft.blizzard.com&sz=32",
  ]);

  // Links open in the browser, never in the overlay, and only web URLs leave the app.
  const source = page.getByRole("link", { name: "Wowhead", exact: true });
  await source.hover();
  await until(async () => await desktop.ignoresMouse() === false);
  const overlayUrl = page.url();
  await source.locator("img").click();
  await until(async () => (await desktop.openedUrls()).length === 1);
  await desktop.emit("open-link", "file:///C:/Windows/notepad.exe");
  assert.deepEqual(await desktop.openedUrls(), ["https://www.wowhead.com/"]);
  assert.equal(page.url(), overlayUrl);
  await desktop.clickTray("Copy answer");
  assert.equal(await desktop.clipboard(), `Answer: ${markdown}`);

  // Saved threads reuse cached icons after a restart.
  await desktop.restart();
  await desktop.waitForStatus("history");
  await desktop.page.locator(".thread").first().click();
  await desktop.page.waitForFunction(() => document.querySelector<HTMLImageElement>("#answer .favicon")?.naturalWidth === 16);
  assert.ok(!(await desktop.iconRequests()).some(url => url.includes("www.wowhead.com")));

  const icons = await desktop.app.evaluate(async () => {
    const icon = harness.createFavicons();
    const cached = await icon("https://www.wowhead.com/another-page?private=1");
    const failed = await Promise.all([
      icon("file:///C:/private.ico"), icon("javascript:alert(1)"), icon(null),
      icon("https://invalid.example/"), icon("https://oversized.example/"), icon("https://offline.example/"),
      icon("https://missing.example/a"), icon("https://missing.example/b"),
    ]);
    return { cached, failed: failed.every(value => value === undefined), requests: harness.iconRequests };
  });
  assert.match(icons.cached ?? "", /^data:image\/png;base64,/);
  assert.equal(icons.failed, true);
  // Failures are shared per hostname, and only the hostname reaches the provider.
  assert.equal(icons.requests.filter(url => url.includes("missing.example")).length, 1);
  assert.ok(!icons.requests.some(url => url.includes("private") || url.includes("wowhead")));
});
