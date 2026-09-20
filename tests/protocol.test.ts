import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { codexArguments, resumableSession } from "../app/codex.ts";
import { buildPrompt } from "../app/prompt.ts";
import { parseRequest } from "../app/protocol.ts";
import { categories } from "../app/topics/index.ts";
import { read } from "./fixtures/addon.ts";
import { baseRequest as request, copied, promptRequest } from "./fixtures/protocol.ts";

test("parseRequest ignores unrelated text and rejects malformed or oversized requests", () => {
  assert.equal(parseRequest("ordinary clipboard text"), undefined);
  assert.deepEqual(parseRequest(copied(request)), request);
  assert.equal(parseRequest(copied({ ...request, thread: "followup" }))?.thread, "followup");
  const epic = { ...request, subjects: [{ ...request.subjects[0], quality: 4 }] };
  assert.deepEqual(parseRequest(copied(epic)), epic);
  assert.throws(() => parseRequest(copied({ ...request, subjects: [{ ...request.subjects[0], quality: 9 }] })));
  assert.throws(() => parseRequest(copied({ ...request, category: "invalid" })));
  for (const text of [
    "SCALLOPALFRED:{broken",
    copied({ ...request, player: {} }),
    copied({ ...request, subjects: Array(9).fill(request.subjects[0]) }),
    `SCALLOPALFRED:${"x".repeat(512_000)}`,
  ]) {
    assert.throws(() => parseRequest(text));
  }
});

test("requests above the old 64 KB ceiling still parse", () => {
  const wordy = { ...request, subjects: [{ ...request.subjects[0], tooltip: Array(80).fill("t".repeat(2000)) }] };
  const text = copied(wordy);
  assert.ok(text.length > 64_000);
  assert.deepEqual(parseRequest(text), wordy);
});

test("the app accepts exactly the categories the addon's topics send", () => {
  const folder = join(import.meta.dirname, "..", "Addon", "Topics");
  const sent = readdirSync(folder).flatMap(file => [...read(`Addon/Topics/${file}`).matchAll(/category = "([a-z]+)"/g)].map(match => match[1]));
  assert.deepEqual(new Set(sent), new Set(categories));
});

test("resume is restricted to the same thread context", () => {
  const session = { context: "item-1", id: "session-1" };
  assert.equal(resumableSession(request, session), undefined);
  assert.deepEqual(resumableSession({ ...request, thread: "continue" }, session), session);
  assert.equal(resumableSession({ ...request, thread: "continue", context: "item-2" }, session), undefined);
});

test("runs keep the read-only sandbox, disabled tools and explicit model settings", () => {
  const args = codexArguments;
  for (const argument of ["app-server", "stdio://", 'sandbox_mode="read-only"', 'approval_policy="never"', "features.shell_tool=false", "features.apps=false", "features.plugins=false", "features.hooks=false", 'model_reasoning_effort="medium"', 'service_tier="fast"']) {
    assert.ok(args.includes(argument), argument);
  }
});

test("TSM snapshots survive validation and reach the prompt with explicit units", () => {
  const tsm = {
    capturedAt: 1800000000, minBuyoutCopper: 120000, regionMarketAvgCopper: 150000,
    regionSaleAvgCopper: 135000, saleRate: 0.025, vendorSellCopper: 250,
  };
  const withPrices = (prices: object) => ({ ...request, subjects: [{ ...request.subjects[0], tsm: prices }] });
  const parsed = parseRequest(copied(withPrices(tsm)));
  assert.ok(parsed);
  assert.deepEqual(parsed.subjects[0].tsm, tsm);
  const prompt = buildPrompt(parsed);
  assert.deepEqual(promptRequest(prompt), parsed);
  assert.match(prompt, /10,000 copper = 1 gold/);
  assert.match(prompt, /not a live quote/);
  assert.doesNotMatch(prompt, /\{\{/);
  for (const invalid of [{ ...tsm, saleRate: 2 }, { ...tsm, minBuyoutCopper: -1 }, { ...tsm, capturedAt: "today" }]) {
    assert.throws(() => parseRequest(copied(withPrices(invalid))));
  }
});
