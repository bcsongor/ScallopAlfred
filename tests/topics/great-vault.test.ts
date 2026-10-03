import assert from "node:assert/strict";
import { test } from "node:test";
import { addon } from "../fixtures/addon.ts";

// Progress counts the current week, so an unlocked slot from last week can already be below its threshold.
test("Great Vault shows while its window offers rewards and sends every rewarded item and currency with the full equipped set", () => {
  const game = addon();
  game.execute(`
    tooltipHidden = true; vaultWindow = true; ScallopAlfred_Ask()
    assert(not pcall(choose, "Great Vault"))
    vaultActivities = {
      { progress = 1, threshold = 1, rewards = { { itemDBID = 7 } } },
      { progress = 0, threshold = 1, rewards = { { itemDBID = 8 } } },
      { progress = 0, threshold = 4, rewards = {} },
      { progress = 3, threshold = 3, rewards = { { type = 1, id = 3 }, { type = 2, id = 3418 }, { itemDBID = 9 } } },
    }
    -- Unclaimed rewards wait all week, so they alone don't mean the player is choosing.
    vaultWindow = false; ScallopAlfred_Ask()
    assert(not pcall(choose, "Great Vault"))
    vaultWindow = true; ScallopAlfred_Ask(); choose("Great Vault")
  `);
  const request = game.payload();
  assert.equal(request.category, "vault");
  assert.equal(request.question, "Which Great Vault reward should I pick?");
  assert.deepEqual(request.vault?.map(option => option.link), ["item:7", "item:8", "currency:3418", "item:9"]);
  assert.equal(request.equipped?.length, 19);
  assert.deepEqual(request.subjects, []);
});
