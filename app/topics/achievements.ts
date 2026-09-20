import { z } from "zod";
import { achievementSchema } from "../snapshots/achievements.ts";
import type { Topic } from "./topic.ts";

export const achievements = {
  category: "achievements",
  fields: { achievements: z.array(achievementSchema).max(12).optional() },
  prompt: "The Tracked achievements topic supplies achievements, the ones the player is tracking in the objective tracker. Say what remains for each, cheapest first, and how to get it: where to go, what drops it and whether it needs a group, a season or a reset. Skip criteria already completed except to say how much is left. Where an achievement is a step in a meta or has a follow-up, say so. Link each achievement once as [Name](https://www.wowhead.com/achievement=ID) using its id.",
} as const satisfies Topic;
