const assert = require("node:assert/strict");
const { mkdtemp, readFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const { _electron } = require("playwright");

test("desktop clipboard flow, sessions, failures, cancellation and Markdown links", { timeout: 60000 }, async t => {
  const data = await mkdtemp(join(tmpdir(), "scallop-alfred-test-"));
  const env = { ...process.env, SCALLOPALFRED_TEST_DATA: data };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => _electron.launch({ args: ["--experimental-strip-types", join(__dirname, "fixtures", "desktop.cjs")], env });
  let desktop = await launch();
  t.after(() => desktop.close());
  let page = await desktop.firstWindow();
  await page.waitForFunction(() => document.body.dataset.status === "ready");
  assert.equal(await page.locator("#followup").isVisible(), false);
  assert.equal(await page.locator("footer").isVisible(), false);
  await page.screenshot({ path: join(data, "overlay.png") });
  const native = () => desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return { focusable: window.isFocusable(), topmost: window.isAlwaysOnTop(), isolated: window.webContents.getLastWebPreferences().contextIsolation };
  });
  assert.deepEqual(await native(), { focusable: false, topmost: true, isolated: true });
  let sequence = 0;
  const payload = (question, context = "item-1", thread = "new") => ({
    v: 2, id: String(++sequence), context, thread, question, subjects: [],
    player: { class: "Druid", spec: "Restoration", level: 90 }, gameVersion: "12.1.0",
  });
  const copy = async request => desktop.evaluate(async ({ clipboard }, value) => {
    await clipboard.writeText("SCALLOPALFRED:" + JSON.stringify(value));
  }, request);
  const waitForAnswer = text => page.waitForFunction(expected => document.querySelector(".turn:last-child .response")?.textContent.trim() === expected, text);
  const records = async () => (await readFile(join(data, "requests.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  const trayClick = label => desktop.evaluate((_, label) => {
    const item = global.testMenu.items.find(item => item.label === label);
    item.click();
  }, label);

  const visible = () => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());
  const ignoresMouse = () => desktop.evaluate(() => global.testIgnoreMouseEvents);
  const hide = page.getByRole("button", { name: "Hide", exact: true });
  await hide.hover();
  await page.waitForTimeout(50);
  assert.equal(await ignoresMouse(), false);
  await page.locator("#title").hover();
  await page.waitForTimeout(50);
  assert.equal(await ignoresMouse(), process.platform !== "linux");
  await hide.click();
  await page.waitForTimeout(50);
  assert.equal(await visible(), false);
  await trayClick("Show overlay");
  assert.equal(await visible(), true);
  assert.equal(await desktop.evaluate(() => global.testSkipTaskbar), true);
  assert.equal((await native()).focusable, false);

  // Showing an existing window must preserve its content and native focus flags.
  const content = await page.locator("#answer").evaluateHandle(element => element.firstChild);
  await desktop.evaluate(() => { global.testWindowOperations = []; });
  await trayClick("Show overlay");
  assert.deepEqual(await desktop.evaluate(() => global.testWindowOperations), ["moveTop"]);
  assert.equal(await content.evaluate(element => element.isConnected), true);
  await content.dispose();

  // A visible window can still have lost its place above the game.
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setAlwaysOnTop(false));
  await trayClick("Show overlay");
  assert.equal((await native()).topmost, true);
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await trayClick("Show overlay");
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), false);
  assert.equal(await visible(), true);
  await hide.click();
  await desktop.evaluate(() => global.testTray.emit("click"));
  assert.equal(await visible(), true);

  await desktop.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setAlwaysOnTop(false);
    global.testWindowOperations = [];
  });
  const maliciousText = '<img src=x onerror="window.injected=true"> & `whoami`';
  const subjects = [{ type: "spell", name: "Rejuvenation", link: "spell:774", tooltip: ["Heals over time."] }];
  const professions = { capturedAt: 1800000000, entries: [{ name: "Alchemy", skillLineID: 171, skillLevel: 75 }] };
  const talents = { capturedAt: 1800000000, selected: [{ spellID: 774, name: "Rejuvenation", rank: 1 }] };
  await copy({ ...payload(maliciousText), subjects, professions, category: "gear", talents });
  await waitForAnswer('Answer: <img src=x onerror="window.injected=true"> & whoami');
  assert.equal(await page.locator("#followup").isVisible(), true);
  assert.deepEqual(await desktop.evaluate(() => global.testWindowOperations), ["setAlwaysOnTop", "moveTop"]);
  assert.equal((await native()).topmost, true);
  assert.equal(await page.locator("#title").textContent(), "Rejuvenation");
  assert.equal(await page.locator("#answer img").count(), 0);
  assert.equal(await page.locator("#answer code").textContent(), "whoami");
  const firstArgs = (await records())[0].args;
  assert.equal(firstArgs[firstArgs.indexOf("--model") + 1], "gpt-6-astra");
  assert.ok(firstArgs.includes('model_reasoning_effort="medium"'));
  assert.ok(firstArgs.includes('service_tier="fast"'));

  // Exercise the first follow-up after launch, including Enter key-up
  // arriving after submission has removed the editor.
  await page.getByRole("button", { name: "Follow up", exact: true }).click();
  await page.getByRole("textbox", { name: "Follow-up question" }).fill("follow up");
  await desktop.evaluate(() => { global.testWindowOperations = []; });
  await page.keyboard.down("Enter");
  await page.waitForFunction(() => document.body.dataset.status === "thinking");
  assert.equal(await visible(), true);
  assert.deepEqual(await native(), { focusable: true, topmost: true, isolated: true });
  await page.keyboard.up("Enter");
  await waitForAnswer("Answer: follow up");
  assert.equal(await visible(), true);
  assert.deepEqual(await desktop.evaluate(() => global.testWindowOperations), []);
  assert.ok((await records())[1].args.includes("resume"));
  assert.deepEqual((await records())[1].request.professions, professions);
  assert.deepEqual((await records())[1].request.talents, talents);
  assert.equal((await records())[1].request.category, "gear");
  await hide.click();
  assert.equal(await visible(), false);

  await copy(payload("another item", "item-2", "continue"));
  await page.waitForFunction(() => document.body.dataset.status === "thinking");
  assert.equal(await visible(), true);
  assert.equal((await native()).focusable, false);
  await waitForAnswer("Answer: another item");
  assert.ok(!(await records())[2].args.includes("resume"));

  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await copy(payload("fail", "failed-item"));
  await page.waitForFunction(() => document.body.dataset.status === "thinking");
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), false);
  assert.equal(await visible(), true);
  await waitForAnswer("Test failure");
  await copy(payload("recover", "item-2", "continue"));
  await waitForAnswer("Answer: recover");
  assert.ok((await records())[4].args.includes("session-item-2"));

  const wait = payload("wait");
  await copy(wait);
  await page.waitForFunction(() => document.body.dataset.status === "thinking");
  assert.equal(await visible(), true);
  assert.deepEqual(await native(), { focusable: false, topmost: true, isolated: true });
  await hide.click();
  await trayClick("Cancel question");
  await waitForAnswer("Question cancelled. Retry from the tray menu when ready.");
  assert.equal(await visible(), false);
  await copy(payload("after cancellation"));
  await waitForAnswer("Answer: after cancellation");
  assert.equal(await visible(), true);
  assert.equal((await native()).topmost, true);
  await trayClick("Copy answer");
  assert.equal(await desktop.evaluate(async ({ clipboard }) => clipboard.readText()), "Answer: after cancellation");

  const markdown = '**Check the tooltip**\n\n- Compare both slots.\n- Press `Alt+Q` for a new question.\n\n[**Wowhead**](https://www.wowhead.com/) or https://worldofwarcraft.blizzard.com/\n\n[Blocked](javascript:alert%281%29)';
  await copy(payload(markdown));
  await page.waitForSelector('#answer strong');
  assert.equal(await page.locator("#answer li").count(), 2);
  assert.equal(await page.locator("#answer a").count(), 2);
  assert.equal(await page.locator("#answer code").textContent(), "Alt+Q");
  const source = page.getByRole("link", { name: "Wowhead", exact: true });
  await page.waitForFunction(() => document.querySelector("#answer .favicon")?.naturalWidth === 16);
  assert.equal(await page.locator("#answer .favicon").count(), 1);
  assert.deepEqual(await desktop.evaluate(() => global.testIconRequests), [
    "https://www.google.com/s2/favicons?domain=www.wowhead.com&sz=32",
    "https://www.google.com/s2/favicons?domain=worldofwarcraft.blizzard.com&sz=32",
  ]);
  assert.equal(await source.evaluate(element => getComputedStyle(element).textDecorationLine), "none");
  await source.hover();
  await page.waitForTimeout(50);
  assert.equal(await ignoresMouse(), false);
  const overlayUrl = page.url();
  await source.locator("img").click();
  assert.deepEqual(await desktop.evaluate(() => global.testOpenedUrls), ["https://www.wowhead.com/"]);
  assert.equal(page.url(), overlayUrl);
  await desktop.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.ipc.emit("open-link", {}, "file:///C:/Windows/notepad.exe");
  });
  assert.deepEqual(await desktop.evaluate(() => global.testOpenedUrls), ["https://www.wowhead.com/"]);
  await page.locator("#title").hover();
  await page.waitForTimeout(50);
  assert.equal(await ignoresMouse(), process.platform !== "linux");
  await trayClick("Copy answer");
  assert.equal(await desktop.evaluate(async ({ clipboard }) => clipboard.readText()), "Answer: " + markdown);

  const followup = page.getByRole("button", { name: "Follow up", exact: true });
  const question = page.getByRole("textbox", { name: "Follow-up question" });
  const beforeFollowup = (await records()).at(-1).request;
  await followup.click();
  await question.waitFor({ state: "visible" });
  assert.equal((await native()).focusable, true);
  assert.equal(await desktop.evaluate(() => global.testSkipTaskbar), true);
  await page.locator("#title").hover();
  assert.equal(await ignoresMouse(), false);
  await question.fill("  Can you explain that?  ");
  await desktop.evaluate(() => { global.testWindowOperations = []; });
  await question.press("Enter");
  await page.waitForFunction(() => document.body.dataset.status === "thinking");
  assert.equal(await visible(), true);
  assert.deepEqual(await native(), { focusable: true, topmost: true, isolated: true });
  assert.deepEqual(await page.locator(".question").allTextContents(), [markdown, "Can you explain that?"]);
  assert.equal(await page.locator(".turn:last-child .response").textContent(), "Thinking…");
  assert.match(await page.locator(".turn:first-child .response").textContent(), /Check the tooltip/);
  const operations = await desktop.evaluate(() => global.testWindowOperations);
  assert.deepEqual(operations, []);
  await waitForAnswer("Answer: Can you explain that?");
  assert.equal(await page.locator(".turn").count(), 2);
  assert.equal(await visible(), true);
  assert.equal((await native()).focusable, true);
  assert.equal(await desktop.evaluate(() => global.testSkipTaskbar), true);
  const submitted = (await records()).at(-1);
  assert.deepEqual(submitted.request, { ...beforeFollowup, id: submitted.request.id, thread: "continue", question: "Can you explain that?" });
  assert.notEqual(submitted.request.id, beforeFollowup.id);
  assert.ok(submitted.args.includes("resume"));
  assert.equal(await desktop.evaluate(async ({ clipboard }) => clipboard.readText()), "Answer: " + markdown);
  await trayClick("Copy answer");
  assert.equal(await desktop.evaluate(async ({ clipboard }) => clipboard.readText()), "Answer: Can you explain that?");

  await page.locator("#answer").evaluate(element => { element.scrollTop = 0; });
  await trayClick("Show overlay");
  assert.equal(await page.locator("#answer").evaluate(element => element.scrollTop), 0);
  await page.locator(".question").first().hover();
  await page.waitForTimeout(50);
  assert.equal(await ignoresMouse(), false);

  await followup.click();
  await question.fill("fail");
  await question.press("Enter");
  await waitForAnswer("Test failure");
  assert.equal(await page.locator(".turn").count(), 3);
  assert.equal(await page.locator('.turn[data-status="answer"]').count(), 2);
  await trayClick("Retry last question");
  await page.waitForFunction(() => document.body.dataset.status === "thinking");
  await waitForAnswer("Test failure");
  assert.equal(await page.locator(".turn").count(), 3);

  await followup.click();
  await question.waitFor({ state: "visible" });
  const countBeforeInvalid = (await records()).length;
  await desktop.evaluate(({ BrowserWindow }) => {
    const ipc = BrowserWindow.getAllWindows()[0].webContents.ipc;
    for (const text of ["   ", "x".repeat(2001), { question: "Invalid" }]) ipc.emit("submit-followup", {}, text);
  });
  await question.fill("Draft");
  await question.press("Escape");
  await question.waitFor({ state: "hidden" });
  assert.equal((await native()).focusable, true);
  assert.equal((await records()).length, countBeforeInvalid);

  await followup.click();
  await question.waitFor({ state: "visible" });
  assert.equal(await question.inputValue(), "");
  await copy(payload("A new subject", "new-context"));
  await page.waitForTimeout(350);
  assert.equal((await records()).length, countBeforeInvalid);
  await hide.click();
  await question.waitFor({ state: "hidden" });
  assert.equal((await native()).focusable, false);
  await waitForAnswer("Answer: A new subject");
  assert.equal(await page.locator(".turn").count(), 1);
  assert.equal((await records()).at(-1).request.context, "new-context");

  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(380, 640));
  await followup.click();
  await question.fill("Where does it come from?");
  await question.press("Enter");
  await waitForAnswer("Answer: Where does it come from?");
  assert.equal(await page.locator("#title").textContent(), "A new subject");
  await followup.click();
  await question.fill("How does this compare with my equipped item?");
  await page.screenshot({ path: join(data, "overlay.png") });
  t.diagnostic(`Overlay screenshot: ${join(data, "overlay.png")}`);

  const requestCount = (await records()).length;
  await page.getByRole("button", { name: "Back to threads" }).click();
  await page.waitForFunction(() => document.body.dataset.status === "history");
  assert.equal(await page.locator("footer").isVisible(), false);
  assert.ok(await page.locator(".conversation").count() > 2);
  assert.equal(await page.locator(".conversation-title").first().textContent(), "A new subject");
  const chatsBeforeArchive = await page.locator(".conversation").count();
  const archiveChat = page.getByRole("button", { name: "Archive thread: another item", exact: true });
  await archiveChat.click();
  await archiveChat.waitFor({ state: "detached" });
  assert.equal(await page.locator(".conversation").count(), chatsBeforeArchive - 1);
  assert.equal(await page.locator("body").getAttribute("data-status"), "history");
  const archivedChat = page.getByRole("region", { name: "Archived threads" }).getByRole("button", { name: "another item", exact: true });
  assert.equal(await archivedChat.textContent(), "another item");
  assert.equal(await archivedChat.locator("*").count(), 0);
  assert.equal(await archivedChat.evaluate(element => getComputedStyle(element).color), "rgb(153, 153, 153)");
  assert.equal(await page.locator("#answer > :last-child").getAttribute("class"), "archived-conversations");
  const archiveBounds = await page.locator(".archived-conversations").boundingBox();
  const historyBounds = await page.locator("#answer").boundingBox();
  assert.ok(Math.abs(archiveBounds.y + archiveBounds.height - historyBounds.y - historyBounds.height) < 1);
  await page.locator(".active-conversations").evaluate(element => { element.scrollTop = element.scrollHeight; });
  assert.ok(await page.locator(".active-conversations").evaluate(element => element.scrollTop > 0));
  assert.deepEqual(await page.locator(".archived-conversations").boundingBox(), archiveBounds);
  await archivedChat.click();
  await waitForAnswer("Answer: recover");
  assert.equal(await page.locator("#followup").isVisible(), false);
  assert.equal(await desktop.evaluate(() => global.testMenu.items.find(item => item.label === "Retry last question").enabled), false);
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.ipc.emit("edit-followup", {}, true));
  assert.equal(await page.locator("#followup-form").isVisible(), false);
  await page.getByRole("button", { name: "Back to threads" }).click();
  await page.locator(".conversation").filter({ hasText: "Rejuvenation" }).click();
  await waitForAnswer("Answer: follow up");
  assert.equal(await page.locator(".turn").count(), 2);
  assert.equal((await records()).length, requestCount);
  assert.equal((await readFile(join(data, "conversations.sqlite"))).subarray(0, 16).toString(), "SQLite format 3\0");

  await desktop.close();
  desktop = await launch();
  page = await desktop.firstWindow();
  await page.waitForFunction(() => document.body.dataset.status === "history");
  assert.equal(await page.getByRole("button", { name: "Archive thread: another item", exact: true }).count(), 0);
  assert.equal(await page.locator(".archived-conversation").filter({ hasText: "another item" }).count(), 1);
  await page.locator(".conversation").filter({ hasText: "Rejuvenation" }).click();
  await waitForAnswer("Answer: follow up");
  assert.equal(await page.locator(".turn").count(), 2);
  await page.getByRole("button", { name: "Follow up", exact: true }).click();
  await page.getByRole("textbox", { name: "Follow-up question" }).fill("After restarting");
  await page.getByRole("textbox", { name: "Follow-up question" }).press("Enter");
  await page.waitForFunction(() => document.body.dataset.status === "thinking");
  await page.getByRole("button", { name: "Back to threads" }).click();
  await page.locator(".conversation").filter({ hasText: "A new subject" }).click();
  await waitForAnswer("Answer: Where does it come from?");
  await page.waitForTimeout(800);
  assert.equal(await page.locator("#title").textContent(), "A new subject");
  assert.equal(await visible(), true);
  await page.getByRole("button", { name: "Back to threads" }).click();
  assert.equal(await page.locator(".conversation-title").first().textContent(), "A new subject");
  await page.screenshot({ path: join(data, "history.png") });
  await page.locator(".conversation").filter({ hasText: "Rejuvenation" }).click();
  await waitForAnswer("Answer: After restarting");
  assert.equal(await page.locator(".turn").count(), 3);
  assert.ok((await records()).at(-1).args.includes("session-item-1"));
  assert.equal((await records()).length, requestCount + 1);
  await page.getByRole("button", { name: "Back to threads" }).click();
  await page.locator(".conversation").filter({ hasText: "Check the tooltip" }).click();
  await page.waitForFunction(() => document.querySelector("#answer .favicon")?.naturalWidth === 16);
  assert.ok(!(await desktop.evaluate(() => global.testIconRequests)).some(url => url.includes("www.wowhead.com")));

  const iconChecks = await desktop.evaluate(async () => {
    const icon = global.testCreateFavicons();
    const cached = await icon("https://www.wowhead.com/another-page?private=1");
    const invalid = await Promise.all([
      icon("file:///C:/private.ico"), icon("javascript:alert(1)"), icon(null),
      icon("https://invalid.example/"), icon("https://oversized.example/"), icon("https://offline.example/"),
      icon("https://missing.example/a"), icon("https://missing.example/b"),
    ]);
    return { cached, failed: invalid.every(value => value === undefined), requests: global.testIconRequests };
  });
  assert.ok(iconChecks.cached.startsWith("data:image/png;base64,"));
  assert.equal(iconChecks.failed, true);
  assert.equal(iconChecks.requests.filter(url => url.includes("missing.example")).length, 1);
  assert.ok(!iconChecks.requests.some(url => url.includes("private") || url.includes("wowhead")));

  // A reply may finish while its archived thread is open for reading.
  await copy({ ...payload("wait", "archived-context"), subjects: [{ type: "item", name: "Archived while answering", link: "item:123", tooltip: [] }] });
  await page.waitForFunction(() => document.body.dataset.status === "thinking");
  await page.getByRole("button", { name: "Back to threads" }).click();
  const pendingChat = page.getByRole("button", { name: "Archive thread: Archived while answering", exact: true });
  await pendingChat.click();
  await pendingChat.waitFor({ state: "detached" });
  await page.locator(".archived-conversation").filter({ hasText: "Archived while answering" }).click();
  await page.waitForFunction(() => document.body.dataset.status === "thinking");
  await trayClick("Cancel question");
  await waitForAnswer("Question cancelled. Retry from the tray menu when ready.");
  assert.equal(await page.locator("#followup").isVisible(), false);
  await copy(payload("After archiving a chat", "archived-context", "continue"));
  await waitForAnswer("Answer: After archiving a chat");
  assert.ok(!(await records()).at(-1).args.includes("resume"));
  assert.equal(await page.locator(".turn").count(), 1);
  await page.getByRole("button", { name: "Back to threads" }).click();
  assert.equal(await page.getByRole("button", { name: "Archive thread: Archived while answering", exact: true }).count(), 0);
  assert.equal(await page.locator(".archived-conversation").first().textContent(), "Archived while answering");
  await page.locator(".archived-conversations").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(data, "archives.png") });
  t.diagnostic(`Archive screenshot: ${join(data, "archives.png")}`);

  // Startup must show the history even when every remaining chat is archived.
  while (await page.locator(".archive-conversation").count()) {
    const first = page.locator(".archive-conversation").first();
    const id = await first.getAttribute("data-archive-conversation");
    await first.click();
    await page.locator(`[data-archive-conversation="${id}"]`).waitFor({ state: "detached" });
  }
  const archivedCount = await page.locator(".archived-conversation").count();
  assert.ok(archivedCount > 0 && archivedCount <= 10);
  await desktop.close();
  desktop = await launch();
  page = await desktop.firstWindow();
  await page.waitForFunction(() => document.body.dataset.status === "history");
  assert.equal(await page.locator(".conversation").count(), 0);
  assert.equal(await page.locator(".archived-conversation").count(), archivedCount);
  const archiveOnlyBounds = await page.locator(".archived-conversations").boundingBox();
  const archiveOnlyHistory = await page.locator("#answer").boundingBox();
  assert.ok(Math.abs(archiveOnlyBounds.y + archiveOnlyBounds.height - archiveOnlyHistory.y - archiveOnlyHistory.height) < 1);
  await page.locator(".archived-conversation").last().click();
  await page.waitForFunction(() => document.body.dataset.status !== "history");
  t.diagnostic(`History screenshot: ${join(data, "history.png")}`);
});
