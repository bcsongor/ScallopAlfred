import assert from "node:assert/strict";
import { test } from "node:test";
import { launch, request, until } from "./fixtures/launch.ts";

test("threads can be browsed, archived and continued after a restart", { timeout: 60000 }, async t => {
  const desktop = await launch(t);
  await desktop.waitForStatus("ready");
  for (const [question, context] of [["First thread", "first"], ["Second thread", "second"], ["Newest thread", "newest"]]) {
    await desktop.copy(request(question, { context }));
    await desktop.waitForAnswer(`Answer: ${question}`);
  }
  const back = () => desktop.page.getByRole("button", { name: "Back to threads" });
  const thread = (title: string) => desktop.page.locator(".conversation").filter({ hasText: title });
  const archiveButton = (title: string) => desktop.page.getByRole("button", { name: `Archive thread: ${title}`, exact: true });
  const titles = () => desktop.page.locator(".conversation-title").allTextContents();

  await back().click();
  await desktop.waitForStatus("history");
  assert.equal(await desktop.page.locator("footer").isVisible(), false);
  assert.deepEqual(await titles(), ["Newest thread", "Second thread", "First thread"]);

  // Archived threads move to a read-only section pinned to the bottom.
  await archiveButton("Second thread").click();
  await archiveButton("Second thread").waitFor({ state: "detached" });
  assert.deepEqual(await titles(), ["Newest thread", "First thread"]);
  const archiveBounds = await desktop.page.locator(".archived-conversations").boundingBox();
  const historyBounds = await desktop.page.locator("#answer").boundingBox();
  assert.ok(archiveBounds && historyBounds);
  assert.ok(Math.abs(archiveBounds.y + archiveBounds.height - historyBounds.y - historyBounds.height) < 1);
  await desktop.page.getByRole("region", { name: "Archived threads" }).getByRole("button", { name: "Second thread", exact: true }).click();
  await desktop.waitForAnswer("Answer: Second thread");
  assert.equal(await desktop.page.locator("#followup").isVisible(), false);
  assert.equal((await desktop.trayItem("Retry last question")).enabled, false);
  await desktop.emit("edit-followup", true);
  assert.equal((await desktop.window()).focusable, false);

  // History and follow-up sessions survive a restart.
  await desktop.restart();
  await desktop.waitForStatus("history");
  assert.equal(await archiveButton("Second thread").count(), 0);
  assert.equal(await desktop.page.locator(".archived-conversation").filter({ hasText: "Second thread" }).count(), 1);
  await thread("First thread").click();
  await desktop.waitForAnswer("Answer: First thread");
  await desktop.page.getByRole("button", { name: "Follow up", exact: true }).click();
  await desktop.page.getByRole("textbox", { name: "Follow-up question" }).fill("After restarting");
  await desktop.page.getByRole("textbox", { name: "Follow-up question" }).press("Enter");
  await desktop.waitForStatus("thinking");

  // Browsing while a reply runs neither redirects the reply nor reorders the list.
  await back().click();
  await thread("Newest thread").click();
  await desktop.waitForAnswer("Answer: Newest thread");
  await until(async () => !(await desktop.trayItem("Cancel question")).enabled);
  assert.equal(await desktop.page.locator("#title").textContent(), "Newest thread");
  await back().click();
  assert.deepEqual(await titles(), ["Newest thread", "First thread"]);
  await thread("First thread").click();
  await desktop.waitForAnswer("Answer: After restarting");
  assert.equal(await desktop.page.locator(".turn").count(), 2);
  assert.deepEqual((await desktop.codexCalls()).at(-1)?.session, { context: "first", id: "session-first" });

  // A reply can finish while its thread is archived, and the archived thread cannot be continued.
  const subject = { type: "item", name: "Archived while answering", link: "item:123", tooltip: [] };
  await desktop.copy(request("wait", { context: "archived", subjects: [subject] }));
  await desktop.waitForStatus("thinking");
  await back().click();
  await archiveButton(subject.name).click();
  await archiveButton(subject.name).waitFor({ state: "detached" });
  await desktop.page.locator(".archived-conversation").filter({ hasText: subject.name }).click();
  await desktop.waitForStatus("thinking");
  await desktop.clickTray("Cancel question");
  await desktop.waitForAnswer("Question cancelled. Retry from the tray menu when ready.");
  assert.equal(await desktop.page.locator("#followup").isVisible(), false);
  await desktop.copy(request("After archiving", { context: "archived", thread: "continue" }));
  await desktop.waitForAnswer("Answer: After archiving");
  assert.equal(await desktop.page.locator(".turn").count(), 1);

  // Startup opens the history even when every thread is archived.
  await back().click();
  while (await desktop.page.locator(".archive-conversation").count()) {
    const button = desktop.page.locator(".archive-conversation").first();
    const id = await button.getAttribute("data-archive-conversation");
    await button.click();
    await desktop.page.locator(`[data-archive-conversation="${id}"]`).waitFor({ state: "detached" });
  }
  const archivedCount = await desktop.page.locator(".archived-conversation").count();
  await desktop.restart();
  await desktop.waitForStatus("history");
  assert.equal(await desktop.page.locator(".conversation").count(), 0);
  assert.equal(await desktop.page.locator(".archived-conversation").count(), archivedCount);
});
