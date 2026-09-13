const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const { test } = require("node:test");
const { launch, request, until } = require("./fixtures/launch.cjs");

test("copied requests start threads, and follow-ups resume the same Codex session", { timeout: 30000 }, async t => {
  const app = await launch(t);
  const { page } = app;
  await app.waitForStatus("ready");

  const hostile = '<img src=x onerror="window.injected=true"> & `whoami`';
  await app.copy(request(hostile, {
    context: "rejuvenation", category: "gear",
    subjects: [{ type: "spell", name: "Rejuvenation", link: "spell:774", tooltip: ["Heals over time."] }],
    professions: { capturedAt: 1800000000, entries: [{ name: "Alchemy", skillLineID: 171, skillLevel: 75 }] },
    talents: { capturedAt: 1800000000, selected: [{ spellID: 774, name: "Rejuvenation", rank: 1 }] },
  }));
  await app.waitForAnswer('Answer: <img src=x onerror="window.injected=true"> & whoami');
  assert.equal(await page.locator("#title").textContent(), "Rejuvenation");
  assert.equal(await page.locator("#answer img").count(), 0);
  assert.equal(await page.locator("#answer code").textContent(), "whoami");
  const [first] = await app.records();
  assert.equal(first.args[first.args.indexOf("--model") + 1], "gpt-6-astra");

  // The editor takes focus. Submitting on key-down must survive the key-up arriving after it closes.
  const followup = page.getByRole("button", { name: "Follow up", exact: true });
  const question = page.getByRole("textbox", { name: "Follow-up question" });
  await followup.click();
  await question.fill("  Can you explain that?  ");
  assert.equal((await app.window()).focusable, true);
  await until(async () => await app.ignoresMouse() === false);
  const submitted = await app.windowOperations(async () => {
    await page.keyboard.down("Enter");
    await app.waitForStatus("thinking");
    await page.keyboard.up("Enter");
    await app.waitForAnswer("Answer: Can you explain that?");
  });
  // Closing the editor leaves focus and window order alone.
  assert.deepEqual(submitted, []);
  assert.deepEqual(await page.locator(".question").allTextContents(), [hostile, "Can you explain that?"]);
  const [original, resumed] = await app.records();
  assert.deepEqual(resumed.request, { ...original.request, id: resumed.request.id, thread: "continue", question: "Can you explain that?" });
  assert.notEqual(resumed.request.id, original.request.id);
  assert.deepEqual(resumed.args.slice(-3), ["resume", "session-rejuvenation", "-"]);
  await app.clickTray("Copy answer");
  assert.equal(await app.clipboard(), "Answer: Can you explain that?");

  // A retry replaces the failed reply instead of adding a turn.
  await followup.click();
  await question.fill("fail");
  await question.press("Enter");
  await app.waitForAnswer("Test failure");
  const beforeRetry = (await app.records()).length;
  await app.clickTray("Retry last question");
  await until(async () => (await app.records()).length === beforeRetry + 1);
  await app.waitForAnswer("Test failure");
  assert.equal(await page.locator(".turn").count(), 3);
  assert.equal(await page.locator('.turn[data-status="answer"]').count(), 2);

  // Invalid follow-ups are ignored, and Escape discards the draft.
  const requestCount = (await app.records()).length;
  await followup.click();
  for (const text of ["   ", "x".repeat(2001), { question: "Invalid" }]) await app.emit("submit-followup", text);
  await question.fill("Draft");
  await question.press("Escape");
  await question.waitFor({ state: "hidden" });
  await followup.click();
  assert.equal(await question.inputValue(), "");
  assert.equal((await app.records()).length, requestCount);

  // A copied request waits while the player types, then starts a new thread.
  await app.copy(request("A new subject"));
  await delay(300); // Longer than one clipboard poll.
  assert.equal((await app.records()).length, requestCount);
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await app.waitForAnswer("Answer: A new subject");
  assert.equal((await app.window()).focusable, false);
  assert.equal(await page.locator(".turn").count(), 1);

  // A copied continue request resumes only a thread with the same context.
  await app.copy(request("Another item", { context: "item-2", thread: "continue" }));
  await app.waitForAnswer("Answer: Another item");
  assert.ok(!(await app.records()).at(-1).args.includes("resume"));
  await app.copy(request("fail"));
  await app.waitForAnswer("Test failure");
  await app.copy(request("Recover", { context: "item-2", thread: "continue" }));
  await app.waitForAnswer("Answer: Recover");
  assert.deepEqual((await app.records()).at(-1).args.slice(-3), ["resume", "session-item-2", "-"]);
});
