import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runCodex } from "../app/codex.ts";

const fake = join(import.meta.dirname, "fixtures", "codex.ts");
const run = (mode: string, signal = new AbortController().signal) =>
  runCodex({ executable: process.execPath, args: ["--no-warnings", fake, mode], prompt: "Hello", cwd: tmpdir(), signal });

test("a completed turn returns the trimmed answer and its thread", async () => {
  assert.deepEqual(await run("answer"), { text: "Answer to: Hello", threadId: "thread-1" });
});

test("failed or empty turns reject with the reason Codex gave", async () => {
  await assert.rejects(run("failed"), { message: "Usage limit reached" });
  await assert.rejects(run("silent"), /Codex returned no answer/);
});

test("cancelling stops the process and rejects with the cancellation reason", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort("Question cancelled."), 300);
  await assert.rejects(run("hang", controller.signal), { message: "Question cancelled." });
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
