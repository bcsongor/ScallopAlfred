import { z } from "zod";
import { subjectSchema } from "./subject.ts";

/** Worn items with their WoW inventory slot IDs: the full set for gear questions, comparison slots otherwise. */
export const equippedSchema = z.array(subjectSchema.extend({
  type: z.literal("item"),
  slot: z.number().int().min(1).max(19).optional(),
})).max(19);

export const equipmentNotes = "For gear questions, equipped contains available items from the full equipped set, with WoW inventory slot IDs. Other questions may include only comparison slots. Missing slots are unknown.";
