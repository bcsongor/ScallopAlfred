import assert from "node:assert/strict";
import { test } from "node:test";
import { addon } from "../fixtures/addon.ts";

test("Corrosive Codex shows while its window is open and lists every power as its buttons show them", () => {
  const game = addon();
  game.execute(`
    tooltipHidden = true; ScallopAlfred_Ask()
    assert(not pcall(choose, "Corrosive Codex"))
    C_Item.GetItemCount = function(id, bank, uses, reagents, warband)
      assert(id == 273000 and bank and warband)
      return 9
    end
    C_PlayerChoice = { GetCurrentPlayerChoiceInfo = function()
      return { questionText = "Pick a card", options = { { header = "Fortune", buttons = { { text = "Any" } } } } }
    end }
    ScallopAlfred_Ask()
    assert(not pcall(choose, "Corrosive Codex"))
    C_PlayerChoice.GetCurrentPlayerChoiceInfo = function()
      return { questionText = "Unlock powerful gifts by offering Corrosive Souls.", options = { { header = "Corrosive Codex", buttons = {
        { text = "Viperine Grasp", disabled = true, showCheckmark = false, tooltip = "Viperine Grasp|n|cffffd100Pulls|r.\\r\\n\\r\\nMore.|n|n" },
        { text = "|A:activities-icon-lock:22:17:0:0|a Virulent Mucus", disabled = false, showCheckmark = false, tooltip = "" },
        { text = "|A:common-icon-checkmark:16:16:0:0|a Plague of Corrosion", disabled = false, showCheckmark = false },
      } } } }
    end
    ScallopAlfred_Ask(); choose("Corrosive Codex")
  `);
  const parsed = game.payload();
  assert.equal(parsed.category, "codex");
  assert.equal(parsed.question, "Which Corrosive Codex power should I unlock or equip next?");
  assert.deepEqual(parsed.codex, {
    capturedAt: 1800000000, souls: 9,
    powers: [
      { name: "Viperine Grasp", description: "Pulls.\n\nMore." },
      { name: "Virulent Mucus", locked: true },
      { name: "Plague of Corrosion", active: true },
    ],
  });
  assert.equal(parsed.altar, undefined);
});
