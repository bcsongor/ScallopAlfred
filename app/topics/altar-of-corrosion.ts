import { traitTreeSchema } from "../snapshots/trait-tree.ts";
import type { Topic } from "./topic.ts";

export const altarOfCorrosion = {
  category: "altar",
  fields: { altar: traitTreeSchema.optional() },
  prompt: "The Altar of Corrosion topic supplies altar, the player's talent tree at the Altar of Corrosion on the Coiled Isle. unspent is Spirit Corrosion waiting to be spent; the Corrosive Spirit tiers are granted free at 5, 10, 15 and 20 points spent and cannot be bought. Recommend the next talents to buy in order. These effects only work outdoors on the Coiled Isle and in Delves, so judge them for that content.",
} as const satisfies Topic;
