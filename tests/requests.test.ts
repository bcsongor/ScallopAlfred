import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { launch, request, until } from "./fixtures/launch.ts";

test("copied requests start threads, and follow-ups resume the same Codex session", { timeout: 30000 }, async t => {
  const desktop = await launch(t);
  const { page } = desktop;
  await desktop.waitForStatus("ready");

  const hostile = '<img src=x onerror="window.injected=true"> & `whoami`';
  await desktop.copy(request(hostile, {
    context: "rejuvenation", category: "gear",
    subjects: [{ type: "spell", name: "Rejuvenation", link: "spell:774", tooltip: ["Heals over time."] }],
    professions: { capturedAt: 1800000000, entries: [{ name: "Alchemy", skillLineID: 171, skillLevel: 75 }] },
    talents: { capturedAt: 1800000000, selected: [{ spellID: 774, name: "Rejuvenation", rank: 1 }] },
  }));
  await desktop.waitForAnswer('Answer: <img src=x onerror="window.injected=true"> & whoami');
  assert.equal(await page.locator("#title").textContent(), "Rejuvenation");
  assert.equal(await page.locator("#answer img").count(), 0);
  assert.equal(await page.locator("#answer code").textContent(), "whoami");

  // Clicking the reply takes focus so Enter opens the editor. Submitting on key-down must survive the key-up arriving after it closes.
  const followup = page.getByRole("button", { name: "Follow up", exact: true });
  const question = page.getByRole("textbox", { name: "Follow-up question" });
  const focused = await desktop.windowOperations(() => page.locator(".response").click());
  assert.ok(focused.includes("focus"));
  await page.keyboard.press("Enter");
  await question.waitFor({ state: "visible" });
  await question.fill("  Can you explain that?  ");
  assert.equal((await desktop.window()).focusable, true);
  const submitted = await desktop.windowOperations(async () => {
    await page.keyboard.down("Enter");
    await desktop.waitForStatus("thinking");
    await page.keyboard.up("Enter");
    await desktop.waitForAnswer("Answer: Can you explain that?");
  });
  // Closing the editor leaves focus and window order alone.
  assert.deepEqual(submitted, []);
  assert.deepEqual(await page.locator(".question").allTextContents(), [hostile, "Can you explain that?"]);
  const [original, resumed] = await desktop.codexCalls();
  assert.equal(original.session, undefined);
  assert.deepEqual(resumed.request, { ...original.request, id: resumed.request.id, thread: "continue", question: "Can you explain that?" });
  assert.notEqual(resumed.request.id, original.request.id);
  assert.deepEqual(resumed.session, { context: "rejuvenation", id: "session-rejuvenation" });
  await desktop.clickTray("Copy answer");
  assert.equal(await desktop.clipboard(), "Answer: Can you explain that?");

  // A retry replaces the failed reply instead of adding a turn.
  await followup.click();
  await question.fill("fail");
  await question.press("Enter");
  await desktop.waitForAnswer("Test failure");
  const beforeRetry = (await desktop.codexCalls()).length;
  await desktop.clickTray("Retry last question");
  await until(async () => (await desktop.codexCalls()).length === beforeRetry + 1);
  await desktop.waitForAnswer("Test failure");
  assert.equal(await page.locator(".turn").count(), 3);
  assert.equal(await page.locator('.turn[data-status="answer"]').count(), 2);

  // Invalid follow-ups are ignored, Escape discards the draft and Enter reopens the editor.
  const callCount = (await desktop.codexCalls()).length;
  await followup.click();
  const sendButton = page.getByRole("button", { name: "Send", exact: true });
  assert.equal(await sendButton.isDisabled(), true);
  await question.fill("   ");
  assert.equal(await sendButton.isDisabled(), true);
  for (const text of ["   ", "x".repeat(2001), { question: "Invalid" }]) await desktop.emit("submit-followup", text);
  await question.fill("Draft");
  assert.equal(await sendButton.isDisabled(), false);
  await question.press("Escape");
  await question.waitFor({ state: "hidden" });
  await page.keyboard.press("Enter");
  await question.waitFor({ state: "visible" });
  assert.equal(await question.inputValue(), "");
  assert.equal((await desktop.codexCalls()).length, callCount);

  // A copied request waits while the player types, then starts a new thread.
  await desktop.copy(request("A new subject"));
  await delay(300); // Longer than one clipboard poll.
  assert.equal((await desktop.codexCalls()).length, callCount);
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await desktop.waitForAnswer("Answer: A new subject");
  assert.equal((await desktop.window()).focusable, false);
  assert.equal(await page.locator(".turn").count(), 1);

  // A copied continue request resumes only a thread with the same context.
  await desktop.copy(request("Another item", { context: "item-2", thread: "continue" }));
  await desktop.waitForAnswer("Answer: Another item");
  assert.equal((await desktop.codexCalls()).at(-1)?.session, undefined);
  await desktop.copy(request("fail"));
  await desktop.waitForAnswer("Test failure");
  await desktop.copy(request("Recover", { context: "item-2", thread: "continue" }));
  await desktop.waitForAnswer("Answer: Recover");
  assert.deepEqual((await desktop.codexCalls()).at(-1)?.session, { context: "item-2", id: "session-item-2" });

  // A follow-up copied from the game continues the thread on screen and keeps its title.
  const ring = { type: "item", name: "Ring", link: "item:11", tooltip: [] };
  const turnsBefore = await page.locator(".turn").count();
  await desktop.copy(request("Is this ring better?", { thread: "followup", subjects: [ring] }));
  await desktop.waitForAnswer("Answer: Is this ring better?");
  assert.equal(await page.locator(".turn").count(), turnsBefore + 1);
  assert.equal(await page.locator("#title").textContent(), "Another item");
  const resumedFromGame = (await desktop.codexCalls()).at(-1);
  assert.equal(resumedFromGame?.request.thread, "continue");
  assert.deepEqual(resumedFromGame?.session, { context: "item-2", id: "session-item-2" });

  // From the thread list there is nothing to continue, so it starts a new thread.
  await page.getByRole("button", { name: "Back to threads" }).click();
  await desktop.waitForStatus("history");
  await desktop.copy(request("From the thread list", { thread: "followup" }));
  await desktop.waitForAnswer("Answer: From the thread list");
  assert.equal(await page.locator(".turn").count(), 1);
  assert.equal((await desktop.codexCalls()).at(-1)?.session, undefined);
});
