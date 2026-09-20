import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPrompt } from "../../app/prompt.ts";
import { parseRequest } from "../../app/protocol.ts";
import { addon } from "../fixtures/addon.ts";
import { baseRequest as request, copied, promptRequest } from "../fixtures/protocol.ts";

test("Selected achievement shows while one is picked in the window and sends its criteria", () => {
  const game = addon();
  game.execute(`
    tooltipHidden = true; ScallopAlfred_Ask()
    assert(not pcall(choose, "Selected achievement"))
    achievementData = {
      [1234] = {
        name = "|cffffffffGlory of the Raider|r", points = 25, description = "Complete the raid feats.",
        reward = "Reward: Drake", earnedBy = "Aeloria", criteria = {
          { name = "Share the Love", completed = true },
          { name = "Dwarfageddon", quantity = 3, required = 10 },
          -- A single-step criterion keeps no counts, and an unreadable one is dropped.
          { name = "Lumberjacked", quantity = 0, required = 1 },
          { name = secret },
        },
      },
    }
    -- A window with nothing selected reports 0.
    achievementWindow = 0
    ScallopAlfred_Ask()
    assert(not pcall(choose, "Selected achievement"))
    achievementWindow = 1234
    ScallopAlfred_Ask(); choose("Selected achievement")
  `);
  const parsed = game.payload();
  assert.equal(parsed.category, "achievement");
  assert.equal(parsed.question, "How do I earn the achievement I've selected?");
  assert.deepEqual(parsed.achievement, {
    id: 1234, name: "Glory of the Raider", points: 25, description: "Complete the raid feats.",
    reward: "Reward: Drake", earnedBy: "Aeloria",
    criteria: [
      { name: "Share the Love", completed: true },
      { name: "Dwarfageddon", quantity: 3, required: 10 },
      { name: "Lumberjacked" },
    ],
  });
  assert.deepEqual(parsed.equipped, []);
  assert.equal(parsed.talents, undefined);
  assert.deepEqual(promptRequest(buildPrompt(parsed)), parsed);

  // Closing the window takes the topic away, even though the selection survives inside it.
  game.execute(`
    achievementWindow = nil
    ScallopAlfred_Ask()
    assert(not pcall(choose, "Selected achievement"))
  `);
});

test("criteria scans are bounded and an unreadable achievement stays optional", () => {
  const game = addon();
  game.execute(`
    tooltipHidden = true
    criteriaReads = 0
    achievementData = { [1] = { name = "Busy" } }
    function GetAchievementNumCriteria() return 500 end
    function GetAchievementCriteriaInfo(_, index)
      criteriaReads = criteriaReads + 1
      return "Criterion " .. index
    end
    achievementWindow = 1
    ScallopAlfred_Ask(); choose("Selected achievement")
    assert(criteriaReads == 40, criteriaReads)
  `);
  assert.equal(game.payload().achievement?.criteria.length, 40);

  // The window offers the topic, so a reader that cannot answer leaves the field out instead.
  game.execute(`
    function GetAchievementInfo() error("Not loaded") end
    ScallopAlfred_Ask(); choose("Selected achievement")
  `);
  assert.equal(game.payload().achievement, undefined);
});

test("achievement snapshots are bounded", () => {
  const achievement = { id: 1234, name: "Glory of the Raider", criteria: [{ name: "Share the Love", completed: true }] };
  assert.deepEqual(parseRequest(copied({ ...request, category: "achievement", achievement }))?.achievement, achievement);
  assert.throws(() => parseRequest(copied({
    ...request,
    achievement: { ...achievement, criteria: Array(41).fill(achievement.criteria[0]) },
  })));
});
