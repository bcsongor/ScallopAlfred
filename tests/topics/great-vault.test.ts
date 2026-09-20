import assert from "node:assert/strict";
import { test } from "node:test";
import { addon } from "../fixtures/addon.ts";

test("Great Vault shows once rewards roll and sends unlocked items and currencies with the full equipped set", () => {
  const game = addon();
  game.execute(`
    tooltipHidden = true; ScallopAlfred_Ask()
    assert(not pcall(choose, "Great Vault"))
    vaultActivities = {
      { progress = 1, threshold = 1, rewards = { { itemDBID = 7 } } },
      { progress = 0, threshold = 1, rewards = { { itemDBID = 8 } } },
      { progress = 3, threshold = 3, rewards = { { type = 1, id = 3 }, { type = 2, id = 3418 }, { itemDBID = 9 } } },
    }
    ScallopAlfred_Ask(); choose("Great Vault")
  `);
  const request = game.payload();
  assert.equal(request.category, "vault");
  assert.equal(request.question, "Which Great Vault reward should I pick?");
  assert.deepEqual(request.vault?.map(option => option.link), ["item:7", "currency:3418", "item:9"]);
  assert.equal(request.equipped?.length, 19);
  assert.deepEqual(request.subjects, []);
});
