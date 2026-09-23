import assert from "node:assert/strict";
import { test } from "node:test";
import { addon } from "../fixtures/addon.ts";

test("Make gold adds specialisations, grouped stacks and the open profession's recipes", () => {
  const game = addon();
  game.execute(`
    tooltipHidden = true; money = 987654; itemQuality = 3
    local flux = "|cffa335ee|Hitem:200123::::::::90|h[Algari Flux]|h|r"
    bags = {
      [0] = {
        { hyperlink = flux, stackCount = 3, isBound = true },
        false,
        { hyperlink = "|Hitem:5|h[Odd rock]|h", stackCount = secret },
      },
      [6] = { { hyperlink = flux, stackCount = 5 } },
    }
    tsmData = {
      prices = {
        ["i:200123"] = { DBMarket = 12000, Destroy = 3000, Crafting = 9000 },
        ["i:211879"] = { DBMarket = 45000 },
        ["i:210796"] = { DBMarket = 1500 },
        ["i:123"] = { DBMarket = 777 },
      },
      auctions = { ["i:200123"] = 4 },
      mails = { ["i:200123"] = 2 },
    }
    function GetProfessions() return 1 end
    function GetProfessionInfo() return "Alchemy", nil, 75, 100, nil, nil, 171, 6, nil, nil, "Midnight Alchemy" end
    C_TradeSkillUI.GetAllProfessionTradeSkillLines = function() return { 2906 } end
    C_TradeSkillUI.GetProfessionInfoBySkillLineID = function()
      return { parentProfessionID = 171, professionName = "Midnight Alchemy", skillLevel = 75, maxSkillLevel = 100 }
    end
    C_ProfSpecs = {
      GetConfigIDForSkillLine = function() return 42 end,
      GetCurrencyInfoForSkillLine = function() return { numAvailable = 7 } end,
      GetSpecTabIDsForSkillLine = function() return { 100 } end,
      GetRootPathForTab = function() return 10 end,
      GetChildrenForPath = function() return {} end,
      GetUnlockEntryForPath = function(id) return id + 100 end,
    }
    C_Traits = {
      ConfigHasStagedChanges = function() return false end,
      GetNodeInfo = function() return { currentRank = 21, maxRanks = 41 } end,
      GetEntryInfo = function(_, id) return { maxRanks = 1, definitionID = id } end,
      GetDefinitionInfo = function(id) return { overrideName = "Path " .. id } end,
    }
    tradeSkillReady = true
    professionWindow = { professionName = "Midnight Alchemy", professionID = 2906, skillLevel = 75, maxSkillLevel = 100 }
    recipeIDs = { 101, 102 }
    recipes = {
      [101] = {
        name = "Algari Healing Potion", learned = true, craftable = true, numSkillUps = 1,
        link = "|cffffffff|Hitem:211879::::::::90|h[Algari Healing Potion]|h|r",
        schematic = { quantityMin = 1, quantityMax = 3, reagentSlotSchematics = {
          { reagentType = Enum.CraftingReagentType.Basic, quantityRequired = 2,
            reagents = { { itemID = 210796 }, { itemID = 210797 } } },
          { reagentType = Enum.CraftingReagentType.Finishing, quantityRequired = 1,
            reagents = { { itemID = 210800 } } },
        } },
      },
      [102] = { name = "Forgotten Draught", learned = false },
    }
    ScallopAlfred_Ask(); choose("Make gold")
  `);
  const parsed = game.payload();
  assert.equal(parsed.category, "gold");
  assert.equal(parsed.question, "How should I make gold with what I have?");
  assert.deepEqual(parsed.professions?.entries[0].specialization?.paths, [{ id: 10, name: "Path 110", rank: 20, maxRank: 40 }]);
  assert.equal(parsed.inventory?.capturedAt, 1800000000);
  assert.equal(parsed.inventory?.moneyCopper, 987654);
  assert.equal(parsed.inventory?.bankIncluded, true);
  assert.equal(parsed.inventory?.warbankIncluded, false);
  assert.deepEqual(parsed.inventory?.items.find(item => item.link === "item:200123::::::::90"), {
    link: "item:200123::::::::90", name: "Algari Flux", quality: 3, bound: true,
    count: { bags: 3, bank: 5, warbank: 0 }, auctionCount: 4, mailCount: 2,
    tsm: { capturedAt: 1800000000, marketCopper: 12000, destroyCopper: 3000, craftingCopper: 9000 },
  });
  // A restricted stack size still leaves the item on the list, just without its count.
  assert.deepEqual(parsed.inventory?.items.find(item => item.link === "item:5")?.count, { bags: 0, bank: 0, warbank: 0 });
  assert.equal(parsed.recipes?.professionName, "Midnight Alchemy");
  assert.equal(parsed.recipes?.skillLineID, 2906);
  assert.equal(parsed.recipes?.skillLevel, 75);
  assert.deepEqual(parsed.recipes?.entries, [{
    recipeID: 101, name: "Algari Healing Potion", skillUps: 1, craftable: true,
    output: {
      link: "item:211879::::::::90", name: "Algari Healing Potion", quality: 3, quantityMin: 1, quantityMax: 3,
      tsm: { capturedAt: 1800000000, marketCopper: 45000 },
    },
    reagents: [{ itemID: 210796, name: "Equipped 210796", quantity: 2, marketCopper: 1500 }],
  }]);

  // Without a profession window the recipes drop, and everything else still copies.
  game.execute(`
    tradeSkillReady = false
    ScallopAlfred_Ask(); choose("Make gold")
  `);
  assert.equal(game.payload().recipes, undefined);
  assert.equal(game.payload().inventory?.moneyCopper, 987654);

  for (const topic of ["Game mechanics", "Professions", "My gear"]) {
    game.execute(`ScallopAlfred_Ask(); choose("${topic}"); focused:SetText("A question"); focused.scripts.OnEnterPressed()`);
    assert.equal(game.payload().inventory, undefined);
    assert.equal(game.payload().recipes, undefined);
  }

  game.execute('tooltipHidden = false; ScallopAlfred_Ask(); choose("Keep, sell or disenchant?")');
  assert.equal(game.payload().subjects[0].tsm?.marketCopper, 777);
  assert.equal(game.payload().inventory, undefined);
});
