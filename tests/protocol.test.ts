import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPrompt, codexArguments } from "../sidecar/codex.ts";
import { parseRequest, type WoWRequest } from "../sidecar/protocol.ts";

const request: WoWRequest = {
  id: "copy-1", context: "item-1", thread: "new", question: "What's this for?",
  player: { class: "Druid", spec: "Restoration", level: 90 }, gameVersion: "12.1.0",
  subjects: [{ type: "item", name: 'Ring "of" stars', link: "item:123", tooltip: ["Line one\nLine two"] }],
  equipped: [],
};
const copied = (value: unknown): string => `SCALLOPALFRED:${JSON.stringify(value)}`;
const promptRequest = (prompt: string): unknown => JSON.parse(prompt.slice(prompt.lastIndexOf("\n{") + 1));

test("parseRequest ignores unrelated text and rejects malformed or oversized requests", () => {
  assert.equal(parseRequest("ordinary clipboard text"), undefined);
  assert.deepEqual(parseRequest(copied(request)), request);
  assert.equal(parseRequest(copied({ ...request, thread: "followup" }))?.thread, "followup");
  const epic = { ...request, subjects: [{ ...request.subjects[0], quality: 4 }] };
  assert.deepEqual(parseRequest(copied(epic)), epic);
  assert.throws(() => parseRequest(copied({ ...request, subjects: [{ ...request.subjects[0], quality: 9 }] })));
  for (const text of [
    "SCALLOPALFRED:{broken",
    copied({ ...request, player: {} }),
    copied({ ...request, subjects: Array(9).fill(request.subjects[0]) }),
    `SCALLOPALFRED:${"x".repeat(64_000)}`,
  ]) {
    assert.throws(() => parseRequest(text));
  }
});

test("resume is restricted to the same conversation context", () => {
  const session = { context: "item-1", id: "session-1" };
  assert.ok(!codexArguments(request, "", session).includes("resume"));
  assert.deepEqual(codexArguments({ ...request, thread: "continue" }, "", session).slice(-3), ["resume", "session-1", "-"]);
  assert.ok(!codexArguments({ ...request, thread: "continue", context: "item-2" }, "", session).includes("resume"));
});

test("runs keep the read-only sandbox, disabled tools and explicit model settings", () => {
  const args = codexArguments({ ...request, thread: "continue" }, "test-model", { context: "item-1", id: "session-1" });
  for (const argument of ["read-only", 'approval_policy="never"', "features.shell_tool=false", "--ignore-user-config", 'model_reasoning_effort="medium"', 'service_tier="fast"']) {
    assert.ok(args.includes(argument), argument);
  }
  assert.equal(args[args.indexOf("--model") + 1], "test-model");
});

test("profession snapshots stay optional and bounded", () => {
  const profession = {
    name: "Alchemy", skillLineID: 171, skillLevel: 75, maxSkillLevel: 100,
    specialization: { skillLineID: 2906, unspentKnowledge: 0, paths: [] },
  };
  const parse = (entries: unknown[]) => parseRequest(copied({ ...request, professions: { capturedAt: 1800000000, entries } }));
  assert.deepEqual(parse([profession])?.professions?.entries, [profession]);
  assert.throws(() => parse(Array(6).fill(profession)));
  assert.throws(() => parse([{ ...profession, skillLevel: -1 }]));
  assert.throws(() => parse([{ ...profession, specialization: { ...profession.specialization, unspentKnowledge: "unknown" } }]));
});

test("gear topics retain bounded slot and talent data", () => {
  const gear: WoWRequest = {
    ...request, category: "gear", equipped: [{ ...request.subjects[0], type: "item", slot: 11 }],
    talents: { capturedAt: 1800000000, selected: [{ spellID: 774, name: "Rejuvenation", rank: 1 }] },
  };
  const parsed = parseRequest(copied(gear));
  assert.deepEqual(parsed, gear);
  assert.ok(parsed);
  assert.deepEqual(promptRequest(buildPrompt(parsed)), gear);
  assert.throws(() => parseRequest(copied({ ...gear, category: "invalid" })));
  assert.throws(() => parseRequest(copied({ ...gear, equipped: [{ ...gear.equipped?.[0], slot: 20 }] })));
  assert.throws(() => parseRequest(copied({ ...gear, talents: { ...gear.talents, selected: Array(129).fill(gear.talents?.selected[0]) } })));
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
  for (const invalid of [{ ...tsm, saleRate: 2 }, { ...tsm, minBuyoutCopper: -1 }, { ...tsm, capturedAt: "today" }]) {
    assert.throws(() => parseRequest(copied(withPrices(invalid))));
  }
});
