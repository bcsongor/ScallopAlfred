import { achievementSchema } from "../snapshots/achievements.ts";
import type { Topic } from "./topic.ts";

export const selectedAchievement = {
  category: "achievement",
  fields: { achievement: achievementSchema.optional() },
  prompt: "The Selected achievement topic supplies achievement, the one the player has clicked in the Achievements window. Always give the steps to earn it, in the order to do them, even when completed is true; say in one line that it is already done and then answer as usual. Cover where to go, what to kill, collect or complete, and whether it needs a group, a season, a reset or a prerequisite. Use criteria as the checklist where it has any, noting how much is left on the ones that count up. Where it is a step in a meta or has a follow-up, say so. Link it once as [Name](https://www.wowhead.com/achievement=ID) using its id.",
} as const satisfies Topic;
