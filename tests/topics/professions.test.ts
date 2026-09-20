import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPrompt } from "../../app/prompt.ts";
import { parseRequest } from "../../app/protocol.ts";
import { addon } from "../fixtures/addon.ts";
import { baseRequest as request, copied, promptRequest } from "../fixtures/protocol.ts";

test("profession snapshots include sparse slots, every expansion's skill line and displayed specialisation ranks", () => {
  const game = addon();
  game.execute(`
    function GetProfessions() return 1, nil, nil, 4 end
    function GetProfessionInfo(index)
      if index == 4 then return "Fishing", nil, 30, 100, nil, nil, 356, 5, nil, nil, "Midnight Fishing" end
      return "Alchemy", nil, 75, 100, nil, nil, 171, 6, nil, nil, "Midnight Alchemy"
    end
    C_TradeSkillUI = {
      GetAllProfessionTradeSkillLines = function() return { 999, 2906 } end,
      GetProfessionInfoBySkillLineID = function(id)
        professionReads = (professionReads or 0) + 1
        if id == 999 then
          return { parentProfessionID = 171, professionName = "Khaz Algar Alchemy", expansionName = "Khaz Algar", skillLevel = 50, maxSkillLevel = 100, skillModifier = 0 }
        end
        return { parentProfessionID = 171, professionName = "Midnight Alchemy", expansionName = "Midnight", skillLevel = 75, maxSkillLevel = 100, skillModifier = 6 }
      end,
    }
    C_ProfSpecs = {
      GetConfigIDForSkillLine = function(id) assert(id == 2906); return 42 end,
      GetCurrencyInfoForSkillLine = function() return { numAvailable = 7 } end,
      GetSpecTabIDsForSkillLine = function() return { 100 } end,
      GetRootPathForTab = function() return 10 end,
      GetChildrenForPath = function(id) return id == 10 and { 11, 12 } or {} end,
      GetUnlockEntryForPath = function(id) return id + 100 end,
    }
    C_Traits = {
      ConfigHasStagedChanges = function() return true end,
      GetNodeInfo = function(_, id)
        return { currentRank = id == 10 and 21 or 0, maxRanks = 41 }
      end,
      GetEntryInfo = function(_, id) return { maxRanks = 1, definitionID = id } end,
      GetDefinitionInfo = function(id) return { overrideName = "Path " .. id } end,
    }
    tooltipHidden = true; ScallopAlfred_Ask(); choose("Professions")
    focused:SetText("Where should I put my next profession points?"); focused.scripts.OnEnterPressed()
    assert(professionReads == 2)
  `);
  const parsed = game.payload();
  const snapshot = parsed.professions;
  assert.equal(snapshot?.capturedAt, 1800000000);
  assert.equal(snapshot?.entries.length, 2);
  const alchemy = snapshot?.entries.find(entry => entry.skillLineID === 171);
  assert.equal(alchemy?.skillLevel, 75);
  assert.equal(alchemy?.maxSkillLevel, 100);
  assert.equal(alchemy?.skillModifier, 6);
  assert.equal(alchemy?.skillLineName, "Midnight Alchemy");
  assert.deepEqual(alchemy?.expansions, [
    { skillLineID: 999, name: "Khaz Algar Alchemy", expansionName: "Khaz Algar", skillLevel: 50, maxSkillLevel: 100, skillModifier: 0 },
    { skillLineID: 2906, name: "Midnight Alchemy", expansionName: "Midnight", skillLevel: 75, maxSkillLevel: 100, skillModifier: 6 },
  ]);
  assert.deepEqual(snapshot?.entries.find(entry => entry.skillLineID === 356)?.expansions, []);
  assert.equal(alchemy?.specialization?.skillLineID, 2906);
  assert.equal(alchemy?.specialization?.unspentKnowledge, 7);
  assert.equal(alchemy?.specialization?.hasStagedChanges, true);
  assert.deepEqual(alchemy?.specialization?.paths, [
    { id: 10, name: "Path 110", rank: 20, maxRank: 40 },
    { id: 11, parentID: 10, name: "Path 111", rank: 0, maxRank: 40 },
    { id: 12, parentID: 10, name: "Path 112", rank: 0, maxRank: 40 },
  ]);
  const prompted = promptRequest(buildPrompt(parsed)) as { professions: unknown };
  assert.deepEqual(prompted.professions, snapshot);

  game.execute(`
    professionReads, specializationReads, childLineReads = 0, 0, 0
    local getLines = C_TradeSkillUI.GetAllProfessionTradeSkillLines
    C_TradeSkillUI.GetAllProfessionTradeSkillLines = function()
      childLineReads = childLineReads + 1; return getLines()
    end
    local getConfig = C_ProfSpecs.GetConfigIDForSkillLine
    C_ProfSpecs.GetConfigIDForSkillLine = function(id)
      specializationReads = specializationReads + 1; return getConfig(id)
    end
  `);
  const skillsOnly = snapshot?.entries.map(({ specialization: _, ...skills }) => skills);
  for (const action of ["Game mechanics", "My gear", "What's this for?", "Is it an upgrade?", "Keep, sell or disenchant?", "Where does it drop?", "Custom question"]) {
    const topic = action === "Game mechanics" || action === "My gear";
    game.execute(`
      tooltipHidden = ${topic}; ScallopAlfred_Ask(); choose("${action}")
      ${topic || action === "Custom question" ? 'focused:SetText("A question"); focused.scripts.OnEnterPressed()' : ""}
      assert(specializationReads == 0)
    `);
    assert.deepEqual(game.payload().professions?.entries, skillsOnly);
  }

  game.execute(`
    C_ProfSpecs.GetCurrencyInfoForSkillLine = function() return { numAvailable = secret } end
    C_Traits.GetNodeInfo = function() return nil end
    C_Traits.ConfigHasStagedChanges = function() return secret end
    tooltipHidden = true; ScallopAlfred_Ask(); choose("Professions")
    focused:SetText("My points?"); focused.scripts.OnEnterPressed()
  `);
  const partial = game.payload().professions?.entries.find(entry => entry.skillLineID === 171);
  assert.equal(partial?.specialization?.unspentKnowledge, undefined);
  assert.equal(partial?.specialization?.hasStagedChanges, undefined);
  assert.deepEqual(partial?.specialization?.paths, []);

  game.execute(`
    C_ProfSpecs.GetConfigIDForSkillLine = function() error("Not loaded") end
    ScallopAlfred_Ask(); choose("Professions")
    focused:SetText("My points?"); focused.scripts.OnEnterPressed()
  `);
  const unavailable = game.payload().professions?.entries.find(entry => entry.skillLineID === 171);
  assert.equal(unavailable?.skillLevel, 75);
  assert.equal(unavailable?.specialization, undefined);
});

test("profession snapshots stay optional and bounded", () => {
  const profession = {
    name: "Alchemy", skillLineID: 171, skillLevel: 75, maxSkillLevel: 100,
    expansions: [{ skillLineID: 2906, name: "Midnight Alchemy", expansionName: "Midnight", skillLevel: 75, maxSkillLevel: 100 }],
    specialization: { skillLineID: 2906, unspentKnowledge: 0, paths: [] },
  };
  const parse = (entries: unknown[]) => parseRequest(copied({ ...request, professions: { capturedAt: 1800000000, entries } }));
  assert.deepEqual(parse([profession])?.professions?.entries, [profession]);
  assert.throws(() => parse(Array(6).fill(profession)));
  assert.throws(() => parse([{ ...profession, skillLevel: -1 }]));
  assert.throws(() => parse([{ ...profession, expansions: Array(33).fill(profession.expansions[0]) }]));
  assert.throws(() => parse([{ ...profession, specialization: { ...profession.specialization, unspentKnowledge: "unknown" } }]));
});
