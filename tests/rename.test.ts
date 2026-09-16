import assert from "node:assert/strict";
import { test } from "node:test";
import { launch, request } from "./fixtures/launch.ts";

test("double-clicking the title renames the thread, and an empty title asks Codex for one", { timeout: 30000 }, async t => {
  const desktop = await launch(t);
  const { page } = desktop;
  const heading = page.locator("#title");
  const editor = page.getByRole("textbox", { name: "Thread title" });
  await desktop.waitForStatus("ready");

  const ring = { type: "item", name: "Epic ring", link: "item:1", quality: 4, tooltip: [] };
  await desktop.copy(request("Is it good?", { context: "epic", subjects: [ring] }));
  await desktop.waitForAnswer("Answer: Is it good?");

  // Escape drops the edit, and an unchanged title sends nothing.
  await heading.dblclick();
  assert.equal(await editor.inputValue(), "Epic ring");
  assert.equal((await desktop.window()).focusable, true);
  await editor.fill("Dropped");
  await editor.press("Escape");
  assert.equal(await heading.textContent(), "Epic ring");
  assert.equal(await editor.isVisible(), false);

  // Enter renames the thread. The new title is plain text, so it loses the item's quality colour.
  await heading.dblclick();
  await editor.fill("  Ring upgrade?  ");
  await editor.press("Enter");
  await page.locator("#title", { hasText: "Ring upgrade?" }).waitFor();
  assert.equal(await page.locator('#title [data-quality="4"]').count(), 0);
  await page.getByRole("button", { name: "Back to threads" }).click();
  await desktop.waitForStatus("history");
  assert.deepEqual(await page.locator(".thread-title").allTextContents(), ["Ring upgrade?"]);
  await page.locator(".thread").click();
  await desktop.waitForAnswer("Answer: Is it good?");

  // Clicking away keeps a typed title. An empty title asks Codex to name the thread from its turns.
  await heading.dblclick();
  await editor.fill("Kept on blur");
  await page.locator(".response").click();
  await page.locator("#title", { hasText: "Kept on blur" }).waitFor();
  await heading.dblclick();
  await editor.fill("");
  await editor.press("Enter");
  await page.locator("#title .naming").waitFor();
  await page.locator("#title", { hasText: "Named: Is it good?" }).waitFor();

  // The title survives a follow-up that continues the thread, and a restart.
  await page.getByRole("button", { name: "Follow up", exact: true }).click();
  await page.getByRole("textbox", { name: "Follow-up question" }).fill("More?");
  await page.getByRole("textbox", { name: "Follow-up question" }).press("Enter");
  await desktop.waitForAnswer("Answer: More?");
  assert.equal(await heading.textContent(), "Named: Is it good?");
  await desktop.restart();
  await desktop.waitForStatus("history");
  assert.deepEqual(await desktop.page.locator(".thread-title").allTextContents(), ["Named: Is it good?"]);

  // A naming failure shows a notice, and a thinking thread cannot be renamed.
  await desktop.copy(request("unnameable", { context: "unnameable" }));
  await desktop.waitForAnswer("Answer: unnameable");
  await desktop.page.locator("#title").dblclick();
  await desktop.page.getByRole("textbox", { name: "Thread title" }).fill("");
  await desktop.page.getByRole("textbox", { name: "Thread title" }).press("Enter");
  await desktop.page.locator("#title", { hasText: "Couldn't name the thread" }).waitFor();
  assert.match(await desktop.page.locator(".notice").innerText(), /No title for this one/);
  await desktop.copy(request("wait", { context: "wait" }));
  await desktop.waitForStatus("thinking");
  await desktop.page.locator("#title").dblclick();
  assert.equal(await desktop.page.getByRole("textbox", { name: "Thread title" }).isVisible(), false);
});
