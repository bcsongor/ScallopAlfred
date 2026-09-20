import { z } from "zod";
import { shortText, whole } from "./fields.ts";

/** The active class talent build. */
export const talentsSchema = z.object({
  capturedAt: whole,
  exportString: z.string().max(4096).optional(),
  hasStagedChanges: z.boolean().optional(),
  selected: z.array(z.object({
    spellID: z.number().int().positive(),
    name: shortText.optional(),
    rank: z.number().int().positive(),
  })).max(128),
});

export const talentsNotes = "talents.selected lists active talent spells and ranks; exportString is an optional build reference, not a simulation result. Use the captured talents for advice, flag staged changes, and do not invent DPS or healing gains.";
