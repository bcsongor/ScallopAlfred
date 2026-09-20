import { talentsSchema } from "../snapshots/talents.ts";
import type { Topic } from "./topic.ts";

// Gear questions carry the full equipped set in the shared equipped field, plus the active talents.
export const gear = {
  category: "gear",
  fields: { talents: talentsSchema.optional() },
} as const satisfies Topic;
