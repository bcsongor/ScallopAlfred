import assert from "node:assert/strict";
import { test } from "node:test";
import { launch, request, until } from "./fixtures/launch.ts";

test("streaming renders safe Markdown and preserves the reader's position", { timeout: 15000 }, async t => {
  const desktop = await launch(t);
  const { page } = desktop;
  const update = (text: string) => desktop.app.evaluate((_electron, text) => harness.stream?.update(text), text);
  await desktop.waitForStatus("ready");
  await desktop.copy(request("stream"));
  await desktop.waitForStatus("thinking");
  // A status line shows what Codex is doing and how long it has taken, until the reply finishes.
  const progress = page.getByRole("status");
  assert.equal(await progress.locator(".activity").textContent(), "Thinking…");
  assert.match(await progress.locator(".elapsed").innerText(), /^\d+s$/);
  await desktop.app.evaluate(() => harness.stream?.activity("Searching the web for “rings”"));
  await progress.locator(".activity", { hasText: "Searching the web for “rings”" }).waitFor();
  await update("**Par");
  await desktop.waitForAnswer("**Par");
  assert.equal(await progress.count(), 1);
  assert.equal((await desktop.trayItem("Copy answer")).enabled, false);
  assert.equal(await page.getByRole("button", { name: "Follow up", exact: true }).isVisible(), false);

  await page.locator(".question").evaluate(node => node.setAttribute("data-preserved", "yes"));
  await update('**Partial** <img src=x onerror="alert(1)">');
  await page.locator(".response strong").waitFor();
  assert.equal(await page.locator(".response img").count(), 0);
  assert.equal(await page.locator(".question").getAttribute("data-preserved"), "yes");

  const long = Array.from({ length: 40 }, (_, index) => `Paragraph ${index}`).join("\n\n");
  await update(long);
  await page.getByText("Paragraph 39", { exact: true }).waitFor();
  assert.ok(await page.locator(".response p:last-child .fresh").count() > 0, "the newest text fades in");
  assert.ok(await page.locator(".fresh").count() > 1, "earlier reveals keep fading across renders");
  const distance = () => page.locator("#answer").evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight);
  assert.ok(await distance() < 24);
  await page.locator("#answer").evaluate(node => { node.scrollTop = 0; });
  await update(`${long}\n\nAnother paragraph`);
  await page.getByText("Another paragraph", { exact: true }).waitFor();
  assert.equal(await page.locator("#answer").evaluate(node => node.scrollTop), 0);
  // Closing "**Done*" shrinks the rendered text. The fade has to cope, or the final render never shows the button.
  await update(`${long}\n\nAnother paragraph\n\n**Done**`);
  await page.locator(".response strong", { hasText: "Done" }).waitFor();
  await desktop.app.evaluate(() => harness.stream?.finish());
  await page.getByRole("button", { name: "Follow up", exact: true }).waitFor({ state: "visible" });
  assert.equal(await progress.count(), 0);
});

test("drafts survive navigation and completed answers survive hiding and restart", { timeout: 15000 }, async t => {
  const desktop = await launch(t);
  const { page } = desktop;
  const update = (text: string) => desktop.app.evaluate((_electron, text) => harness.stream?.update(text), text);
  await desktop.waitForStatus("ready");
  await desktop.copy(request("stream"));
  await desktop.waitForStatus("thinking");
  await page.getByRole("button", { name: "Back to threads" }).click();
  await desktop.waitForStatus("history");
  await update("**Still streaming**");
  await desktop.app.evaluate(() => harness.stream?.activity("Reading wowhead.com"));
  assert.equal(await page.locator("body").getAttribute("data-status"), "history");
  await page.locator("button.thread").click();
  await desktop.waitForAnswer("Still streaming");
  // Opening the running thread restores its status line as well as its draft.
  assert.equal(await page.getByRole("status").locator(".activity").textContent(), "Reading wowhead.com");
  const operations = await desktop.windowOperations(async () => {
    await page.getByRole("button", { name: "Hide", exact: true }).click();
    await update("**Finished answer**");
    // Hidden Chromium windows pause animation frames, which waitForFunction uses by default.
    await until(async () => (await page.locator(".response").textContent())?.trim() === "Finished answer");
    await desktop.app.evaluate(() => harness.stream?.finish());
    await until(async () => await page.locator("body").getAttribute("data-status") === "answer");
  });
  assert.ok(!operations.includes("show") && !operations.includes("focus") && !operations.includes("moveTop"));
  assert.equal((await desktop.window()).visible, false);
  await desktop.clickTray("Copy answer");
  assert.equal(await desktop.clipboard(), "**Finished answer**");
  await desktop.restart();
  await desktop.waitForStatus("history");
  await desktop.page.locator("button.thread").click();
  await desktop.waitForAnswer("Finished answer");
});

test("cancellation replaces the unfinished draft and ignores late updates", { timeout: 15000 }, async t => {
  const desktop = await launch(t);
  await desktop.waitForStatus("ready");
  await desktop.copy(request("stream"));
  await desktop.waitForStatus("thinking");
  await desktop.app.evaluate(() => harness.stream?.update("Partial answer"));
  await desktop.waitForAnswer("Partial answer");
  await desktop.clickTray("Cancel question");
  await desktop.waitForStatus("error");
  await desktop.app.evaluate(() => { harness.stream?.update("Late answer"); harness.stream?.finish(); });
  assert.match(await desktop.page.locator(".response").innerText(), /cancelled/);
  assert.equal((await desktop.trayItem("Retry last question")).enabled, true);
});
