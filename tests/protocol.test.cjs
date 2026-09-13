const assert = require("node:assert/strict");
const { test } = require("node:test");
const { parseRequest } = require("../sidecar/protocol.ts");
const { buildPrompt, codexArguments } = require("../sidecar/codex.ts");

const request = {
  v: 2, id: "copy-1", context: "item-1", thread: "new", question: "What's this for?",
  player: { class: "Druid", spec: "Restoration", level: 90 }, gameVersion: "12.1.0",
  subjects: [{ type: "item", name: 'Ring "of" stars', link: "item:123", tooltip: ["Line one\nLine two"] }],
  equipped: [],
};

test("only valid, bounded addon payloads cross the clipboard boundary", () => {
  assert.equal(parseRequest("ordinary clipboard text"), undefined);
  assert.deepEqual(parseRequest("SCALLOPALFRED:" + JSON.stringify(request)), request);
  for (const input of ["{broken", JSON.stringify({ ...request, v: 1 }), JSON.stringify({ ...request, player: {} }), JSON.stringify({ ...request, subjects: Array(9).fill(request.subjects[0]) }), "x".repeat(64_000)]) {
    assert.throws(() => parseRequest("SCALLOPALFRED:" + input));
  }
});

test("resume is restricted to the same conversation context", () => {
  const session = { context: "item-1", id: "session-1" };
  assert.ok(!codexArguments(request, "", session).includes("resume"));
  assert.deepEqual(codexArguments({ ...request, thread: "continue" }, "", session).slice(-3), ["resume", "session-1", "-"]);
  assert.ok(!codexArguments({ ...request, thread: "continue", context: "item-2" }, "", session).includes("resume"));
});

test("profession snapshots stay optional and bounded", () => {
  const profession = {
    name: "Alchemy", skillLineID: 171, skillLevel: 75, maxSkillLevel: 100,
    specialization: { skillLineID: 2906, unspentKnowledge: 0, paths: [] },
  };
  const parse = entries => parseRequest("SCALLOPALFRED:" + JSON.stringify({ ...request, professions: { capturedAt: 1800000000, entries } }));
  assert.deepEqual(parse([profession]).professions.entries, [profession]);
  assert.throws(() => parse(Array(6).fill(profession)));
  assert.throws(() => parse([{ ...profession, skillLevel: -1 }]));
  assert.throws(() => parse([{ ...profession, specialization: { ...profession.specialization, unspentKnowledge: "unknown" } }]));
});

test("gear topics retain bounded slot and talent data", () => {
  const gear = {
    ...request, category: "gear", equipped: [{ ...request.subjects[0], slot: 11 }],
    talents: { capturedAt: 1800000000, selected: [{ spellID: 774, name: "Rejuvenation", rank: 1 }] },
  };
  const parse = value => parseRequest("SCALLOPALFRED:" + JSON.stringify(value));
  assert.deepEqual(parse(gear), gear);
  const prompt = buildPrompt(parse(gear));
  assert.deepEqual(JSON.parse(prompt.slice(prompt.lastIndexOf("\n{") + 1)), gear);
  assert.throws(() => parse({ ...gear, category: "invalid" }));
  assert.throws(() => parse({ ...gear, equipped: [{ ...gear.equipped[0], slot: 20 }] }));
  assert.throws(() => parse({ ...gear, talents: { ...gear.talents, selected: Array(129).fill(gear.talents.selected[0]) } }));
});

test("TSM snapshots survive validation and reach the prompt with explicit units", () => {
  const tsm = {
    capturedAt: 1800000000, minBuyoutCopper: 120000, regionMarketAvgCopper: 150000,
    regionSaleAvgCopper: 135000, saleRate: 0.025, vendorSellCopper: 250,
  };
  const withPrices = prices => ({ ...request, subjects: [{ ...request.subjects[0], tsm: prices }] });
  const parsed = parseRequest("SCALLOPALFRED:" + JSON.stringify(withPrices(tsm)));
  assert.deepEqual(parsed.subjects[0].tsm, tsm);
  const prompt = buildPrompt(parsed);
  assert.deepEqual(JSON.parse(prompt.slice(prompt.lastIndexOf("\n{") + 1)), parsed);
  assert.match(prompt, /10,000 copper = 1 gold/);
  assert.match(prompt, /not a live quote/);
  for (const invalid of [{ ...tsm, saleRate: 2 }, { ...tsm, minBuyoutCopper: -1 }, { ...tsm, capturedAt: "today" }]) {
    assert.throws(() => parseRequest("SCALLOPALFRED:" + JSON.stringify(withPrices(invalid))));
  }
});

test("shell metacharacters remain prompt data, and resumed runs retain restrictions", () => {
  const hostile = { ...request, question: '$(touch owned); `whoami` & "quoted"\nnext line' };
  const args = codexArguments({ ...hostile, thread: "continue" }, "test-model", { context: "item-1", id: "session-1" });
  assert.ok(!args.some(argument => argument.includes("touch")));
  assert.ok(args.includes("read-only"));
  assert.ok(args.includes('approval_policy="never"'));
  assert.ok(args.includes("features.shell_tool=false"));
  assert.ok(args.includes("--ignore-user-config"));
  assert.ok(args.includes('model_reasoning_effort="medium"'));
  assert.ok(args.includes('service_tier="fast"'));
  const prompt = buildPrompt(hostile);
  assert.deepEqual(JSON.parse(prompt.slice(prompt.lastIndexOf("\n{") + 1)), hostile);
});
