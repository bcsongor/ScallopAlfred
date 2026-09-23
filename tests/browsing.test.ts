import assert from "node:assert/strict";
import { test } from "node:test";
import { launch, request, until } from "./fixtures/launch.ts";

test("threads can be browsed, archived and continued after a restart", { timeout: 60000 }, async t => {
  const desktop = await launch(t);
  await desktop.waitForStatus("ready");

  // Item names in thread titles keep their in-game quality colour.
  const ring = { type: "item", name: "Epic ring", link: "item:1", quality: 4, tooltip: [] };
  await desktop.copy(request("Is it good?", { context: "epic", subjects: [ring] }));
  await desktop.waitForAnswer("Answer: Is it good?");
  assert.equal(await desktop.page.locator('#title [data-quality="4"]').textContent(), "Epic ring");

  for (const [question, context] of [["First thread", "first"], ["Second thread", "second"], ["Newest thread", "newest"]]) {
    await desktop.copy(request(question, { context }));
    await desktop.waitForAnswer(`Answer: ${question}`);
  }
  const back = () => desktop.page.getByRole("button", { name: "Back to threads" });
  const thread = (title: string) => desktop.page.locator(".thread").filter({ hasText: title });
  const archiveButton = (title: string) => desktop.page.getByRole("button", { name: `Archive thread: ${title}`, exact: true });
  const titles = () => desktop.page.locator(".thread-title").allTextContents();
  const archivedHeader = () => desktop.page.getByRole("region", { name: "Archived threads" }).getByRole("button", { name: /^Archived \(\d+\)$/ });

  await back().click();
  await desktop.waitForStatus("history");
  assert.equal(await desktop.page.locator("footer").isVisible(), false);
  assert.deepEqual(await titles(), ["Newest thread", "Second thread", "First thread", "Epic ring"]);
  assert.equal(await desktop.page.locator('.thread-title [data-quality="4"]').textContent(), "Epic ring");

  // Archived threads move to a read-only section pinned to the bottom, collapsed until opened.
  await archiveButton("Second thread").click();
  await archiveButton("Second thread").waitFor({ state: "detached" });
  assert.deepEqual(await titles(), ["Newest thread", "First thread", "Epic ring"]);
  const archiveBounds = await desktop.page.locator(".archived-threads").boundingBox();
  const historyBounds = await desktop.page.locator("#answer").boundingBox();
  assert.ok(archiveBounds && historyBounds);
  assert.ok(Math.abs(archiveBounds.y + archiveBounds.height - historyBounds.y - historyBounds.height) < 1);
  assert.equal(await archivedHeader().textContent(), "Archived (1)");
  assert.equal(await desktop.page.locator(".archived-thread").count(), 0);
  await archivedHeader().click();
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
  await archivedHeader().click();
  assert.equal(await desktop.page.locator(".archived-thread").filter({ hasText: "Second thread" }).count(), 1);
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
  assert.deepEqual(await titles(), ["Newest thread", "First thread", "Epic ring"]);
  await thread("First thread").click();
  await desktop.waitForAnswer("Answer: After restarting");
  assert.equal(await desktop.page.locator(".turn").count(), 2);
  assert.deepEqual((await desktop.codexCalls()).at(-1)?.session, { context: "first", id: "session-first" });

  // A reply can finish while its thread is archived, and the archived thread cannot be followed up.
  const subject = { type: "item", name: "Archived while answering", link: "item:123", tooltip: [] };
  await desktop.copy(request("wait", { context: "archived", subjects: [subject] }));
  await desktop.waitForStatus("thinking");
  await back().click();
  await archiveButton(subject.name).click();
  await archiveButton(subject.name).waitFor({ state: "detached" });
  await desktop.page.locator(".archived-thread").filter({ hasText: subject.name }).click();
  await desktop.waitForStatus("thinking");
  await desktop.clickTray("Cancel question");
  await desktop.waitForAnswer("Question cancelled. Retry from the tray menu when ready.");
  assert.equal(await desktop.page.locator("#followup").isVisible(), false);

  // Startup opens the history even when every thread is archived.
  await back().click();
  for (let i = 0; i < 3; i++) {
    await desktop.copy(request(`Extra thread ${i}`, { context: `extra-${i}` }));
    await desktop.waitForAnswer(`Answer: Extra thread ${i}`);
  }
  await back().click();
  while (await desktop.page.locator(".archive-thread").count()) {
    const button = desktop.page.locator(".archive-thread").first();
    const id = await button.getAttribute("data-archive-thread");
    await button.click();
    await desktop.page.locator(`[data-archive-thread="${id}"]`).waitFor({ state: "detached" });
  }
  await desktop.restart();
  await desktop.waitForStatus("history");
  assert.equal(await desktop.page.locator(".thread").count(), 0);
  assert.equal(await archivedHeader().textContent(), "Archived (8)");

  // Opening the section shows five threads at a time. Collapsing it starts over.
  const more = () => desktop.page.getByRole("button", { name: /^Show \d+ more$/ });
  await archivedHeader().click();
  assert.equal(await desktop.page.locator(".archived-thread").count(), 5);
  assert.equal(await more().textContent(), "Show 3 more");
  await more().click();
  assert.equal(await desktop.page.locator(".archived-thread").count(), 8);
  assert.equal(await more().count(), 0);
  await archivedHeader().click();
  assert.equal(await desktop.page.locator(".archived-thread").count(), 0);
  await archivedHeader().click();
  assert.equal(await desktop.page.locator(".archived-thread").count(), 5);

  // Deleting an archived thread removes it from the list, and it stays gone after a restart.
  await desktop.page.getByRole("button", { name: "Delete thread: Extra thread 2", exact: true }).click();
  await desktop.page.getByRole("button", { name: "Delete thread: Extra thread 2", exact: true }).waitFor({ state: "detached" });
  assert.equal(await archivedHeader().textContent(), "Archived (7)");
  assert.equal(await desktop.page.locator(".archived-thread").filter({ hasText: "Extra thread 2" }).count(), 0);

  // Unarchiving puts a thread back in the list, where it can be followed up again.
  await desktop.page.getByRole("button", { name: "Unarchive thread: Extra thread 1", exact: true }).click();
  await thread("Extra thread 1").waitFor();
  assert.equal(await archivedHeader().textContent(), "Archived (6)");
  await thread("Extra thread 1").click();
  await desktop.waitForAnswer("Answer: Extra thread 1");
  assert.equal(await desktop.page.locator("#followup").isVisible(), true);
  await desktop.restart();
  await desktop.waitForStatus("history");
  assert.deepEqual(await titles(), ["Extra thread 1"]);
  assert.equal(await archivedHeader().textContent(), "Archived (6)");
});
