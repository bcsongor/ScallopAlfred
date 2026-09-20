import { z } from "zod";
import { subjectSchema } from "../snapshots/subject.ts";
import { talentsSchema } from "../snapshots/talents.ts";
import type { Topic } from "./topic.ts";

export const greatVault = {
  category: "vault",
  fields: {
    // Every reward on offer this week, items and currencies alike.
    vault: z.array(subjectSchema).max(12).optional(),
    talents: talentsSchema.optional(),
  },
  prompt: "The Great Vault topic supplies vault, every reward on offer this week, with the full equipped set and talents. It lists gear and any alternatives, such as a Nebulous Voidcore or Thalassian Tokens of Merit in place of gear; weigh those against the gear too. Recommend one reward and name the runner-up. Compare each against the equipped item in its slot for the player's spec, counting item level, secondary stats, unique effects and tier set bonuses. Prefer a trinket or weapon that changes the build over a small item level gain, but say when a close call needs a sim.",
} as const satisfies Topic;
