import { z } from "zod";
import { longText, shortText } from "./fields.ts";

/** One option from Blizzard's player choice window, with the state its button showed. */
export const playerChoiceOptionSchema = z.object({
  name: shortText,
  description: longText.optional(),
  active: z.boolean().optional(),
  locked: z.boolean().optional(),
});

export const playerChoiceNotes = "A player choice snapshot, such as codex.powers, lists every option with its description, locked true while it is still to be unlocked and active true for the chosen one; an option neither locked nor active is unlocked and idle.";
