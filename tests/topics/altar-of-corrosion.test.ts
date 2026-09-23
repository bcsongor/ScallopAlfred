import assert from "node:assert/strict";
import { test } from "node:test";
import { addon } from "../fixtures/addon.ts";

test("Altar of Corrosion shows while its window is open and sends the whole tree", () => {
  const game = addon();
  game.execute(`
    tooltipHidden = true; ScallopAlfred_Ask()
    assert(not pcall(choose, "Altar of Corrosion"))
    C_Traits = {
      GetConfigIDByTreeID = function(tree) assert(tree == 1191); return 77 end,
      ConfigHasStagedChanges = function() return false end,
      GetTreeCurrencyInfo = function(config, tree) assert(config == 77 and tree == 1191); return { { quantity = 3, spent = 12 } } end,
      GetTreeNodes = function() return { 110465, 110444, 110499 } end,
      GetNodeInfo = function(_, id)
        if id == 110465 then
          return { type = 0, activeRank = 1, maxRanks = 1, entryIDs = { 1 }, activeEntry = { entryID = 1 }, isAvailable = true, canPurchaseRank = false, isVisible = true }
        end
        if id == 110444 then return { type = 2, activeRank = 0, maxRanks = 1, entryIDs = { 2, 3 }, isAvailable = false, canPurchaseRank = true, isVisible = true } end
        return { isVisible = false }
      end,
      GetEntryInfo = function(_, id) return { definitionID = id * 10 } end,
      GetDefinitionInfo = function(id)
        if id == 10 then return { overrideName = "Venomous Hunt", spellID = 1307823 } end
        if id == 20 then return { overrideName = "Swift Steps", overrideDescription = "|cff00ff00Move|r\\r\\nfaster." } end
        return { overrideName = secret, spellID = 0 }
      end,
    }
    C_Spell.GetSpellDescription = function(id) return "Spell " .. id end
    GenericTraitFrame = { IsShown = function() return true end, GetTalentTreeID = function() return 1191 end }
    ScallopAlfred_Ask(); choose("Altar of Corrosion")
  `);
  const parsed = game.payload();
  assert.equal(parsed.category, "altar");
  assert.equal(parsed.question, "What should I unlock next at the Altar of Corrosion?");
  assert.deepEqual(parsed.altar, {
    capturedAt: 1800000000, unspent: 3, spent: 12, hasStagedChanges: false,
    nodes: [
      { id: 110465, rank: 1, maxRank: 1, available: true, reachable: false, entries: [{ name: "Venomous Hunt", description: "Spell 1307823", selected: true }] },
      { id: 110444, rank: 0, maxRank: 1, available: false, reachable: true, choice: true, entries: [{ name: "Swift Steps", description: "Move\nfaster." }] },
    ],
  });
  assert.deepEqual(parsed.equipped, []);
  assert.equal(parsed.talents, undefined);
  assert.equal(parsed.codex, undefined);

  // Another tree in the same window does not count.
  game.execute(`
    GenericTraitFrame.GetTalentTreeID = function() return 672 end
    ScallopAlfred_Ask()
    assert(not pcall(choose, "Altar of Corrosion"))
  `);
});
