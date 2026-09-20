import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPrompt } from "../../app/prompt.ts";
import { parseRequest } from "../../app/protocol.ts";
import { addon } from "../fixtures/addon.ts";
import { baseRequest as request, copied, promptRequest } from "../fixtures/protocol.ts";

test("Tracked achievements shows while the tracker has any and sends their criteria", () => {
  const game = addon();
  game.execute(`
    tooltipHidden = true; ScallopAlfred_Ask()
    assert(not pcall(choose, "Tracked achievements"))
    achievementData = {
      [1234] = {
        name = "|cffffffffGlory of the Raider|r", points = 25, description = "Complete the raid feats.",
        reward = "Reward: Drake", criteria = {
          { name = "Share the Love", completed = true },
          { name = "Dwarfageddon", quantity = 3, required = 10 },
          -- A single-step criterion keeps no counts, and an unreadable one is dropped.
          { name = "Lumberjacked", quantity = 0, required = 1 },
          { name = secret },
        },
      },
      [5678] = { name = "Explore Azeroth", completed = true, criteria = {} },
    }
    trackedAchievements = { 1234, 5678, 9999 }
    ScallopAlfred_Ask(); choose("Tracked achievements")
  `);
  const parsed = game.payload();
  assert.equal(parsed.category, "achievements");
  assert.equal(parsed.question, "How do I finish the achievements I'm tracking?");
  // An unknown ID drops out rather than blocking the question.
  assert.deepEqual(parsed.achievements, [
    {
      id: 1234, name: "Glory of the Raider", points: 25, description: "Complete the raid feats.",
      reward: "Reward: Drake",
      criteria: [
        { name: "Share the Love", completed: true },
        { name: "Dwarfageddon", quantity: 3, required: 10 },
        { name: "Lumberjacked" },
      ],
    },
    { id: 5678, name: "Explore Azeroth", completed: true, criteria: [] },
  ]);
  assert.deepEqual(parsed.equipped, []);
  assert.equal(parsed.talents, undefined);
  assert.deepEqual(promptRequest(buildPrompt(parsed)), parsed);

  // Untracking everything takes the topic away again.
  game.execute(`
    trackedAchievements = {}
    ScallopAlfred_Ask()
    assert(not pcall(choose, "Tracked achievements"))
  `);
});

test("achievement scans are bounded and unreadable achievements stay optional", () => {
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
    trackedAchievements = {}
    for id = 1, 20 do trackedAchievements[id] = 1 end
    ScallopAlfred_Ask(); choose("Tracked achievements")
    assert(criteriaReads == 12 * 40, criteriaReads)
  `);
  assert.equal(game.payload().achievements?.length, 12);
  assert.equal(game.payload().achievements?.[0]?.criteria.length, 40);

  // Tracking is what offers the topic, so a reader that cannot answer leaves the field out instead.
  game.execute(`
    function GetAchievementInfo() error("Not loaded") end
    trackedAchievements = { 1 }
    ScallopAlfred_Ask(); choose("Tracked achievements")
  `);
  assert.equal(game.payload().achievements, undefined);
});

test("achievement snapshots are bounded", () => {
  const achievement = { id: 1234, name: "Glory of the Raider", criteria: [{ name: "Share the Love", completed: true }] };
  const achievements = [achievement];
  assert.deepEqual(parseRequest(copied({ ...request, category: "achievements", achievements }))?.achievements, achievements);
  assert.throws(() => parseRequest(copied({ ...request, achievements: Array(13).fill(achievement) })));
  assert.throws(() => parseRequest(copied({
    ...request,
    achievements: [{ ...achievement, criteria: Array(41).fill(achievement.criteria[0]) }],
  })));
});
