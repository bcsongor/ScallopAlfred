import assert from "node:assert/strict";
import { test } from "node:test";
import { addon } from "../fixtures/addon.ts";

test("profession snapshots include sparse slots and every expansion's skill line with its own specialisation ranks", () => {
  const game = addon();
  game.execute(`
    function GetProfessions() return 1, nil, nil, 4 end
    function GetProfessionInfo(index)
      if index == 4 then return "Fishing", nil, 30, 100, nil, nil, 356, 5, nil, nil, "Midnight Fishing" end
      return "Alchemy", nil, 75, 100, nil, nil, 171, 6, nil, nil, "Midnight Alchemy"
    end
    C_TradeSkillUI = {
      GetAllProfessionTradeSkillLines = function() return { 2485, 2823, 2906 } end,
      GetProfessionInfoBySkillLineID = function(id)
        professionReads = (professionReads or 0) + 1
        if id == 2485 then
          return { parentProfessionID = 171, professionName = "Classic Alchemy", expansionName = "Classic", skillLevel = 300, maxSkillLevel = 300, skillModifier = 0 }
        end
        if id == 2823 then
          return { parentProfessionID = 171, professionName = "Dragon Isles Alchemy", expansionName = "Dragonflight", skillLevel = 50, maxSkillLevel = 100, skillModifier = 0 }
        end
        return { parentProfessionID = 171, professionName = "Midnight Alchemy", expansionName = "Midnight", skillLevel = 75, maxSkillLevel = 100, skillModifier = 6 }
      end,
    }
    -- Classic has no tree; Dragonflight and Midnight each have their own config, knowledge and paths.
    C_ProfSpecs = {
      GetConfigIDForSkillLine = function(id) return id == 2906 and 42 or id == 2823 and 41 or 0 end,
      GetCurrencyInfoForSkillLine = function(id) return { numAvailable = id == 2906 and 7 or 3 } end,
      GetSpecTabIDsForSkillLine = function(id) return { id == 2906 and 100 or 200 } end,
      GetRootPathForTab = function(tab) return tab == 100 and 10 or 20 end,
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
    assert(professionReads == 3)
  `);
  const snapshot = game.payload().professions;
  assert.equal(snapshot?.capturedAt, 1800000000);
  assert.equal(snapshot?.entries.length, 2);
  const alchemy = snapshot?.entries.find(entry => entry.skillLineID === 171);
  assert.equal(alchemy?.skillLevel, 75);
  assert.equal(alchemy?.maxSkillLevel, 100);
  assert.equal(alchemy?.skillModifier, 6);
  assert.equal(alchemy?.skillLineName, "Midnight Alchemy");
  assert.deepEqual(alchemy?.expansions, [
    { skillLineID: 2485, name: "Classic Alchemy", expansionName: "Classic", skillLevel: 300, maxSkillLevel: 300, skillModifier: 0 },
    {
      skillLineID: 2823, name: "Dragon Isles Alchemy", expansionName: "Dragonflight", skillLevel: 50, maxSkillLevel: 100, skillModifier: 0,
      specialization: { unspentKnowledge: 3, hasStagedChanges: true, paths: [{ id: 20, name: "Path 120", rank: 0, maxRank: 40 }] },
    },
    {
      skillLineID: 2906, name: "Midnight Alchemy", expansionName: "Midnight", skillLevel: 75, maxSkillLevel: 100, skillModifier: 6,
      specialization: {
        unspentKnowledge: 7, hasStagedChanges: true,
        paths: [
          { id: 10, name: "Path 110", rank: 20, maxRank: 40 },
          { id: 11, parentID: 10, name: "Path 111", rank: 0, maxRank: 40 },
          { id: 12, parentID: 10, name: "Path 112", rank: 0, maxRank: 40 },
        ],
      },
    },
  ]);
  assert.deepEqual(snapshot?.entries.find(entry => entry.skillLineID === 356)?.expansions, []);

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
  const skillsOnly = snapshot?.entries.map(entry => ({
    ...entry, expansions: entry.expansions?.map(({ specialization: _, ...skills }) => skills),
  }));
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
  const midnight = () => game.payload().professions?.entries
    .find(entry => entry.skillLineID === 171)?.expansions?.find(line => line.skillLineID === 2906);
  assert.deepEqual(midnight()?.specialization, { paths: [] });

  game.execute(`
    C_ProfSpecs.GetConfigIDForSkillLine = function() error("Not loaded") end
    ScallopAlfred_Ask(); choose("Professions")
    focused:SetText("My points?"); focused.scripts.OnEnterPressed()
  `);
  assert.equal(midnight()?.skillLevel, 75);
  assert.equal(midnight()?.specialization, undefined);
});
