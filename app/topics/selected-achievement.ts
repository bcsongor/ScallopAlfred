import { achievementSchema } from "../snapshots/achievements.ts";
import type { Topic } from "./topic.ts";

export const selectedAchievement = {
  category: "achievement",
  fields: { achievement: achievementSchema.optional() },
  prompt: "The Selected achievement topic supplies achievement, the one the player has clicked in the Achievements window. When completed is true, lead with who earned it and cover what it unlocks or leads on to, not how to earn it. Otherwise say what remains, cheapest first, and how to get it: where to go, what drops it and whether it needs a group, a season or a reset. Cover completed criteria only to say how much is left. Where it is a step in a meta or has a follow-up, say so. Link it once as [Name](https://www.wowhead.com/achievement=ID) using its id.",
} as const satisfies Topic;
