import { z } from "zod";
import { longText, shortText, whole } from "./fields.ts";

/** One achievement with the criteria that decide whether it is finished. */
export const achievementSchema = z.object({
  id: whole,
  name: shortText,
  description: longText.optional(),
  points: whole.optional(),
  completed: z.boolean().optional(),
  reward: longText.optional(),
  criteria: z.array(z.object({
    name: shortText,
    completed: z.boolean().optional(),
    // Present only on criteria that count up; a plain checklist line has neither.
    quantity: whole.optional(),
    required: whole.optional(),
  })).max(40),
});

export const achievementNotes = "An achievement carries its criteria, each completed when done, with quantity against required on the ones that count up. A criterion without those two is a single step, done or not. completed on the achievement itself means any character on the account earned it, so say when the player's own character still has it to do.";
