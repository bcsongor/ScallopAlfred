import assert from "node:assert/strict";
import { test } from "node:test";
import { launch, request, until } from "./fixtures/launch.ts";

const googleFavicons = (url: string): boolean => url.startsWith("https://www.google.com");

test("answers render Markdown with external source links and cached icons", { timeout: 30000 }, async t => {
  const desktop = await launch(t);
  await desktop.waitForStatus("ready");
  const markdown = "**Check the tooltip**\n\n- Compare both slots.\n- Press `Alt+Q` for a new question.\n\n"
    + "[**Wowhead**](https://www.wowhead.com/) or https://worldofwarcraft.blizzard.com/\n\n"
    + "[Hearty Feast](https://www.wowhead.com/item=228721/hearty-feast) beats [Missing](https://www.wowhead.com/item=999)\n\n"
    + "[Blocked](javascript:alert%281%29)";
  await desktop.copy(request(markdown));
  const { page } = desktop;
  await page.waitForSelector("#answer strong");
  assert.equal(await page.locator("#answer li").count(), 2);
  assert.equal(await page.locator("#answer a").count(), 4);
  assert.equal(await page.locator("#answer code").textContent(), "Alt+Q");
  await page.waitForFunction(() => {
    const icons = [...document.querySelectorAll<HTMLImageElement>("#answer .link-icon")];
    return icons.length === 2 && icons.every(icon => icon.naturalWidth === 16);
  });

  // An item link shows the item's own icon and quality; an unresolvable one shows neither.
  const feast = page.getByRole("link", { name: "Hearty Feast" });
  assert.equal(await feast.getAttribute("data-quality"), "4");
  assert.equal(await feast.locator("img.link-icon").count(), 1);
  const missing = page.getByRole("link", { name: "Missing" });
  assert.equal(await missing.getAttribute("data-quality"), null);
  assert.equal(await missing.locator("img").count(), 0);

  // Only the hostname, or the item ID, ever reaches a provider: one tooltip per item and no icon for the missing one.
  await until(async () => (await desktop.iconRequests()).length === 5, "Timed out waiting for the icon requests");
  const requests = await desktop.iconRequests();
  assert.deepEqual(requests.filter(googleFavicons).sort(), [
    "https://www.google.com/s2/favicons?domain=worldofwarcraft.blizzard.com&sz=32",
    "https://www.google.com/s2/favicons?domain=www.wowhead.com&sz=32",
  ]);
  assert.deepEqual(requests.filter(url => !googleFavicons(url)).sort(), [
    "https://nether.wowhead.com/tooltip/item/228721?dataEnv=1&locale=0",
    "https://nether.wowhead.com/tooltip/item/999?dataEnv=1&locale=0",
    "https://wow.zamimg.com/images/wow/icons/small/inv_misc_food_legion_feast.jpg",
  ]);

  // Links open in the browser, never in the overlay, and only web URLs leave the app.
  const source = page.getByRole("link", { name: "Wowhead", exact: true });
  const overlayUrl = page.url();
  await source.locator("img").click();
  await until(async () => (await desktop.openedUrls()).length === 1);
  await desktop.emit("open-link", "file:///C:/Windows/notepad.exe");
  assert.deepEqual(await desktop.openedUrls(), ["https://www.wowhead.com/"]);
  assert.equal(page.url(), overlayUrl);
  await desktop.clickTray("Copy answer");
  assert.equal(await desktop.clipboard(), `Answer: ${markdown}`);

  // Saved threads reuse cached icons after a restart, including the item icon.
  await desktop.restart();
  await desktop.waitForStatus("history");
  await desktop.page.locator(".thread").first().click();
  await desktop.page.waitForFunction(() => {
    const icons = [...document.querySelectorAll<HTMLImageElement>("#answer .link-icon")];
    return icons.length === 2 && icons.every(icon => icon.naturalWidth === 16);
  });
  // Only successes are cached, so the missing item and the hostname without a favicon are fetched again.
  await until(async () => (await desktop.iconRequests()).some(url => url.includes("blizzard.com")));
  const afterRestart = await desktop.iconRequests();
  assert.ok(!afterRestart.some(url => url.includes("228721") || url.includes("zamimg.com") || url.includes("domain=www.wowhead.com")));

  const icons = await desktop.app.evaluate(async () => {
    const icon = harness.createIcons();
    const cached = await icon("https://www.wowhead.com/another-page?private=1");
    const localised = await icon("https://de.wowhead.com/item=228721");
    const failed = await Promise.all([
      icon("file:///C:/private.ico"), icon("javascript:alert(1)"), icon(null),
      icon("https://invalid.example/"), icon("https://oversized.example/"), icon("https://offline.example/"),
      icon("https://missing.example/a"), icon("https://missing.example/b"),
      icon("https://www.wowhead.com/item=5"),
    ]);
    return { cached, localised, failed: failed.every(value => value === undefined), requests: harness.iconRequests };
  });
  assert.match(icons.cached?.icon ?? "", /^data:image\/png;base64,/);
  assert.equal(icons.cached?.quality, undefined);
  // Item icons are cached by ID, so another locale's link resolves without a further tooltip request.
  assert.match(icons.localised?.icon ?? "", /^data:image\/png;base64,/);
  assert.equal(icons.localised?.quality, 4);
  assert.equal(icons.failed, true);
  // Failures are shared per key, and nothing beyond the hostname or the item's digits reaches a provider.
  assert.equal(icons.requests.filter(url => url.includes("missing.example")).length, 1);
  assert.equal(icons.requests.filter(url => url.includes("228721")).length, 0);
  assert.ok(!icons.requests.some(url => url.includes("private") || url.includes("another-page")));
});
