const assert = require("node:assert/strict");
const { test } = require("node:test");
const { launch, request, until } = require("./fixtures/launch.cjs");

test("threads can be browsed, archived and continued after a restart", { timeout: 60000 }, async t => {
  const app = await launch(t);
  await app.waitForStatus("ready");
  for (const [question, context] of [["First thread", "first"], ["Second thread", "second"], ["Newest thread", "newest"]]) {
    await app.copy(request(question, { context }));
    await app.waitForAnswer(`Answer: ${question}`);
  }
  const back = () => app.page.getByRole("button", { name: "Back to threads" });
  const thread = title => app.page.locator(".conversation").filter({ hasText: title });
  const archiveButton = title => app.page.getByRole("button", { name: `Archive thread: ${title}`, exact: true });
  const titles = () => app.page.locator(".conversation-title").allTextContents();

  await back().click();
  await app.waitForStatus("history");
  assert.equal(await app.page.locator("footer").isVisible(), false);
  assert.deepEqual(await titles(), ["Newest thread", "Second thread", "First thread"]);

  // Archived threads move to a read-only section pinned to the bottom.
  await archiveButton("Second thread").click();
  await archiveButton("Second thread").waitFor({ state: "detached" });
  assert.deepEqual(await titles(), ["Newest thread", "First thread"]);
  const archiveBounds = await app.page.locator(".archived-conversations").boundingBox();
  const historyBounds = await app.page.locator("#answer").boundingBox();
  assert.ok(Math.abs(archiveBounds.y + archiveBounds.height - historyBounds.y - historyBounds.height) < 1);
  await app.page.getByRole("region", { name: "Archived threads" }).getByRole("button", { name: "Second thread", exact: true }).click();
  await app.waitForAnswer("Answer: Second thread");
  assert.equal(await app.page.locator("#followup").isVisible(), false);
  assert.equal((await app.trayItem("Retry last question")).enabled, false);
  await app.emit("edit-followup", true);
  assert.equal((await app.window()).focusable, false);

  // History and follow-up sessions survive a restart.
  await app.restart();
  await app.waitForStatus("history");
  assert.equal(await archiveButton("Second thread").count(), 0);
  assert.equal(await app.page.locator(".archived-conversation").filter({ hasText: "Second thread" }).count(), 1);
  await thread("First thread").click();
  await app.waitForAnswer("Answer: First thread");
  await app.page.getByRole("button", { name: "Follow up", exact: true }).click();
  await app.page.getByRole("textbox", { name: "Follow-up question" }).fill("After restarting");
  await app.page.getByRole("textbox", { name: "Follow-up question" }).press("Enter");
  await app.waitForStatus("thinking");

  // Browsing while a reply runs neither redirects the reply nor reorders the list.
  await back().click();
  await thread("Newest thread").click();
  await app.waitForAnswer("Answer: Newest thread");
  await until(async () => !(await app.trayItem("Cancel question")).enabled);
  assert.equal(await app.page.locator("#title").textContent(), "Newest thread");
  await back().click();
  assert.deepEqual(await titles(), ["Newest thread", "First thread"]);
  await thread("First thread").click();
  await app.waitForAnswer("Answer: After restarting");
  assert.equal(await app.page.locator(".turn").count(), 2);
  assert.deepEqual((await app.records()).at(-1).args.slice(-3), ["resume", "session-first", "-"]);

  // A reply can finish while its thread is archived, and the archived thread cannot be continued.
  const subject = { type: "item", name: "Archived while answering", link: "item:123", tooltip: [] };
  await app.copy(request("wait", { context: "archived", subjects: [subject] }));
  await app.waitForStatus("thinking");
  await back().click();
  await archiveButton(subject.name).click();
  await archiveButton(subject.name).waitFor({ state: "detached" });
  await app.page.locator(".archived-conversation").filter({ hasText: subject.name }).click();
  await app.waitForStatus("thinking");
  await app.clickTray("Cancel question");
  await app.waitForAnswer("Question cancelled. Retry from the tray menu when ready.");
  assert.equal(await app.page.locator("#followup").isVisible(), false);
  await app.copy(request("After archiving", { context: "archived", thread: "continue" }));
  await app.waitForAnswer("Answer: After archiving");
  assert.equal(await app.page.locator(".turn").count(), 1);

  // Startup opens the history even when every thread is archived.
  await back().click();
  while (await app.page.locator(".archive-conversation").count()) {
    const button = app.page.locator(".archive-conversation").first();
    const id = await button.getAttribute("data-archive-conversation");
    await button.click();
    await app.page.locator(`[data-archive-conversation="${id}"]`).waitFor({ state: "detached" });
  }
  const archivedCount = await app.page.locator(".archived-conversation").count();
  await app.restart();
  await app.waitForStatus("history");
  assert.equal(await app.page.locator(".conversation").count(), 0);
  assert.equal(await app.page.locator(".archived-conversation").count(), archivedCount);
});
