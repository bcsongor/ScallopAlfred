import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPrompt } from "../../app/prompt.ts";
import { parseRequest, type WoWRequest } from "../../app/protocol.ts";
import { addon } from "../fixtures/addon.ts";
import { baseRequest as request, copied, promptRequest } from "../fixtures/protocol.ts";

test("topic menus defer snapshots until submission and gear captures only equipped slots", () => {
  const game = addon();
  game.execute(`
    tooltipHidden = true
    professionReads, inventoryReads, talentReads = 0, 0, 0
    function GetProfessions() professionReads = professionReads + 1 end
    function GetProfessionInfo() end
    function GetInventoryItemLink(_, slot)
      inventoryReads = inventoryReads + 1
      if slot == 2 then return nil end
      if slot == 3 then return secret end
      return "item:" .. slot
    end
    C_ClassTalents = { GetActiveConfigID = function() talentReads = talentReads + 1; return 42 end }
    C_Traits = {
      GetConfigInfo = function() return { treeIDs = { 1, 2 } } end,
      GenerateImportString = function() return "BuildExport" end,
      ConfigHasStagedChanges = function() return false end,
      GetTreeNodes = function() return { 10, 11, 12 } end,
      GetNodeInfo = function(_, id)
        return { activeRank = id == 11 and 0 or 1, activeEntry = { entryID = id } }
      end,
      GetEntryInfo = function(_, id) return { definitionID = id } end,
      GetDefinitionInfo = function(id) return { spellID = id * 10 } end,
    }
    C_Spell.GetSpellName = function(id) return "Talent " .. id end
    for _, topic in ipairs({ "Game mechanics", "Professions", "My gear" }) do
      ScallopAlfred_Ask()
      assert(focused == nil)
      choose(topic)
      assert(focused:GetText() == "")
      assert(professionReads == 0 and inventoryReads == 0 and talentReads == 0)
    end
    focused:SetText("What should I upgrade next?")
    combat = true; focused.scripts.OnEnterPressed()
    assert(professionReads == 0 and inventoryReads == 0 and talentReads == 0)
    combat = false; focused.scripts.OnEnterPressed()
    assert(professionReads == 1 and inventoryReads == 19 and talentReads == 1, professionReads .. "," .. inventoryReads .. "," .. talentReads)
  `);
  const parsed = game.payload();
  assert.equal(parsed.category, "gear");
  assert.deepEqual(parsed.subjects, []);
  assert.equal(parsed.equipped?.length, 17);
  assert.deepEqual(parsed.equipped?.map(item => item.slot), Array.from({ length: 19 }, (_, i) => i + 1).filter(slot => slot !== 2 && slot !== 3));
  assert.deepEqual(parsed.talents, {
    capturedAt: 1800000000, exportString: "BuildExport", hasStagedChanges: false,
    selected: [{ spellID: 100, name: "Talent 100", rank: 1 }, { spellID: 120, name: "Talent 120", rank: 1 }],
  });
  game.execute(`
    inventoryReads, talentReads = 0, 0
    tooltipHidden = false; ScallopAlfred_Ask(); choose("Is it an upgrade?")
    assert(inventoryReads == 19 and talentReads == 1)
  `);
  const upgrade = game.payload();
  assert.equal(upgrade.category, "gear");
  assert.equal(upgrade.subjects[0].link, "item:123");
  assert.deepEqual(upgrade.equipped, parsed.equipped);
  assert.deepEqual(upgrade.talents, parsed.talents);
  game.execute(`
    inventoryReads, talentReads = 0, 0
    tooltipHidden = true; ScallopAlfred_Ask(); choose("Game mechanics")
    focused:SetText("Explain the seasonal system"); focused.scripts.OnEnterPressed()
    assert(inventoryReads == 0 and talentReads == 0)
    tooltipHidden = false; ScallopAlfred_Ask(); choose("What's this for?")
  `);
  assert.equal(game.payload().category, undefined);
  assert.equal(game.payload().talents, undefined);
  assert.deepEqual(game.payload().equipped?.map(item => item.slot), [11, 12]);
});

test("talent scans are bounded and unavailable or restricted talents stay optional", () => {
  const game = addon();
  game.execute(`
    tooltipHidden = true
    C_ClassTalents = { GetActiveConfigID = function() return 42 end }
    nodeReads = 0
    C_Traits = {
      GetConfigInfo = function() return { treeIDs = { 1 } } end,
      GenerateImportString = function() return secret end,
      GetTreeNodes = function() local nodes = {}; for i = 1, 1000 do nodes[i] = i end; return nodes end,
      GetNodeInfo = function() nodeReads = nodeReads + 1; return { activeRank = secret } end,
    }
    ScallopAlfred_Ask(); choose("My gear")
    focused:SetText("My build?"); focused.scripts.OnEnterPressed()
    assert(nodeReads == 256)
  `);
  assert.deepEqual(game.payload().talents?.selected, []);
  assert.equal(game.payload().talents?.exportString, undefined);
  game.execute(`
    C_ClassTalents.GetActiveConfigID = function() error("Not loaded") end
    ScallopAlfred_Ask(); choose("My gear")
    focused:SetText("My gear?"); focused.scripts.OnEnterPressed()
  `);
  assert.equal(game.payload().talents, undefined);
  assert.equal(game.payload().equipped?.length, 19);
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
  assert.throws(() => parseRequest(copied({ ...gear, equipped: [{ ...gear.equipped?.[0], slot: 20 }] })));
  assert.throws(() => parseRequest(copied({ ...gear, talents: { ...gear.talents, selected: Array(129).fill(gear.talents?.selected[0]) } })));
});
