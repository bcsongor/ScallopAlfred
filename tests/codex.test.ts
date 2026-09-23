import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ZodError } from "zod";
import { cleanTitle, codexArguments, resumableSession, runCodex, titlePrompt } from "../app/codex.ts";
import { baseRequest as request } from "./fixtures/protocol.ts";

const fake = join(import.meta.dirname, "fixtures", "codex.ts");
const run = (mode: string, options: Partial<Parameters<typeof runCodex>[0]> = {}) => runCodex({
  executable: process.execPath,
  args: ["--no-warnings", fake, mode],
  cwd: tmpdir(),
  prompt: "Hello",
  signal: new AbortController().signal,
  ...options,
});

test("a completed turn returns the trimmed answer and its thread", async () => {
  assert.deepEqual(await run("answer"), { text: "Answer to: Hello", threadId: "thread-1" });
});

test("failed turns report the reason Codex gave", async () => {
  await assert.rejects(run("failed"), { message: "Usage limit reached" });
});

test("completed turns without an answer reject", async () => {
  await assert.rejects(run("silent"), /Codex returned no answer/);
});

test("cancelling stops the process and rejects with the cancellation reason", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort("Question cancelled."), 300);
  await assert.rejects(run("hang", { signal: controller.signal }), { message: "Question cancelled." });
});

test("answer text arrives before completion, excluding commentary and unrelated events", async () => {
  let snapshots: readonly string[] = [];
  const answer = await run("stream", { onText: text => { snapshots = [...snapshots, text]; } });
  assert.deepEqual(snapshots, ["Answer to: ", "Answer to: Hello", "  Answer to: Hello  "]);
  assert.equal(answer.text, "Answer to: Hello");
});

test("activity follows web searches, reasoning headlines and commentary, but never the answer", async () => {
  let activities: readonly string[] = [];
  await run("stream", { onActivity: activity => { activities = [...activities, activity]; } });
  assert.deepEqual(activities, [
    "Searching the web for “ring upgrades”",
    "Checking",
    "Checking stats",
    "Searching the web",
    "Writing the reply",
    "Searched the web",
    "Writing the reply",
  ]);
});

test("cancellation during streaming stops the unfinished answer", async () => {
  const controller = new AbortController();
  await assert.rejects(run("stream", {
    signal: controller.signal,
    onText: text => { if (text) controller.abort("Stopped mid-answer"); },
  }), { message: "Stopped mid-answer" });
});

test("notifications arriving before the turn/start response are retained", async () => {
  assert.equal((await run("early")).text, "Answer to: Hello");
});

test("resuming supplies the session and configured model", async () => {
  assert.equal((await run("resume", { threadId: "thread-1", model: "test-model" })).threadId, "thread-1");
});

test("RPC errors retain their message and server error details", async () => {
  await assert.rejects(run("rpc-error"), { message: "Unknown thread", cause: { code: -1, message: "Unknown thread" } });
});

test("unsupported interactions reject instead of waiting for approval", async () => {
  await assert.rejects(run("interaction"), /unsupported interaction/);
});

test("an unexpected process exit rejects the unfinished turn", async () => {
  await assert.rejects(run("close"), /stopped before completing/);
});

test("a missing executable preserves the process error", async () => {
  await assert.rejects(run("answer", { executable: join(tmpdir(), "missing-scallop-codex.exe") }), /ENOENT/);
});

test("non-JSON stdout diagnostics do not interrupt a reply", async () => {
  assert.equal((await run("junk")).text, "Answer to: Hello");
});

test("invalid responses preserve Zod's validation error", async () => {
  await assert.rejects(run("invalid-config"), ZodError);
});

test("errors from the text callback reach the caller unchanged", async () => {
  const error = new TypeError("Could not render the reply");
  await assert.rejects(run("stream", { onText: () => { throw error; } }), actual => actual === error);
});

test("title prompts carry the questions and answers but skip failed replies", () => {
  const prompt = titlePrompt([
    { question: "Is Ore worth keeping?", status: "answer", text: "Keep it." },
    { question: "And now?", status: "error", text: "Timed out" },
  ]);
  assert.match(prompt, /Question: Is Ore worth keeping\?\n\nAnswer: Keep it\.\n\nQuestion: And now\?$/);
  assert.doesNotMatch(prompt, /Timed out/);
});

test("titles keep the first line of the reply without quotes, Markdown or trailing punctuation", () => {
  assert.equal(cleanTitle('\n  **"Ore prices and crafting".**  \nA second line'), "Ore prices and crafting");
  assert.equal(cleanTitle("# Selling Ore!"), "Selling Ore");
  assert.equal(cleanTitle("x".repeat(100)).length, 80);
  assert.throws(() => cleanTitle('""'), /no title/);
});

test("Codex runs without API keys, so it uses the player's login", async t => {
  process.env.OPENAI_API_KEY = "key";
  process.env.CODEX_API_KEY = "key";
  t.after(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.CODEX_API_KEY;
  });
  const { text } = await run("environment");
  assert.deepEqual(JSON.parse(text), { openai: null, codex: null });
});

test("runs keep the read-only sandbox with approvals and tools off", () => {
  for (const argument of ['sandbox_mode="read-only"', 'approval_policy="never"', "features.shell_tool=false", "features.apps=false", "features.plugins=false", "features.hooks=false"]) {
    assert.ok(codexArguments.includes(argument), argument);
  }
});

test("resume is restricted to the same thread context", () => {
  const session = { context: "item-1", id: "session-1" };
  assert.equal(resumableSession(request, session), undefined);
  assert.deepEqual(resumableSession({ ...request, thread: "continue" }, session), session);
  assert.equal(resumableSession({ ...request, thread: "continue", context: "item-2" }, session), undefined);
});
