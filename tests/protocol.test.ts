import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { buildPrompt } from "../app/prompt.ts";
import { parseRequest } from "../app/protocol.ts";
import { categories } from "../app/topics/index.ts";
import { read } from "./fixtures/addon.ts";
import { baseRequest as request, copied, promptRequest } from "./fixtures/protocol.ts";

test("parseRequest ignores unrelated text, accepts large requests and rejects malformed or oversized ones", () => {
  assert.equal(parseRequest("ordinary clipboard text"), undefined);
  assert.deepEqual(parseRequest(copied(request)), request);
  // Tooltips can be long; only the overall size cap below limits a request.
  const wordy = { ...request, subjects: [{ ...request.subjects[0], tooltip: Array(80).fill("t".repeat(2000)) }] };
  assert.deepEqual(parseRequest(copied(wordy)), wordy);
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

test("the app accepts exactly the categories the addon's topics send", () => {
  const folder = join(import.meta.dirname, "..", "addon", "Topics");
  const sent = readdirSync(folder).flatMap(file => [...read(`addon/Topics/${file}`).matchAll(/category = "([a-z]+)"/g)].map(match => match[1]));
  assert.deepEqual(new Set(sent), new Set(categories));
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
});
