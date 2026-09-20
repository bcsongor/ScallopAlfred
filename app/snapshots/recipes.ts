import { z } from "zod";
import { amount, copper, shortText, whole } from "./fields.ts";
import { itemLink, itemName, itemQuality, tsmSchema } from "./subject.ts";

/** The learned recipes of the one profession window that was open. */
export const recipesSchema = z.object({
  capturedAt: whole,
  professionName: shortText,
  skillLineID: amount.int(),
  skillLevel: amount.optional(),
  maxSkillLevel: amount.optional(),
  entries: z.array(z.object({
    recipeID: whole,
    name: shortText,
    skillUps: whole.optional(),
    craftable: z.boolean().optional(),
    output: z.object({
      link: itemLink,
      name: itemName,
      quality: itemQuality,
      quantityMin: whole.optional(),
      quantityMax: whole.optional(),
      tsm: tsmSchema.optional(),
    }).optional(),
    // Basic reagent slots, ignoring optional and finishing reagents.
    reagents: z.array(z.object({
      itemID: whole,
      name: shortText.optional(),
      quantity: whole,
      marketCopper: copper,
    })).max(12),
  })).max(200),
});

export const recipesNotes = "recipes is the one profession window that was open when the player asked, with professionName, skillLineID, skillLevel, maxSkillLevel and entries of learned recipes. An entry has recipeID, name, skillUps for the skill points the craft would give, craftable when the player holds the reagents now, output with link, name, quality, quantityMin, quantityMax and tsm, and reagents for basic slots as itemID, name, quantity and marketCopper. A quality reagent slot lists one option. A missing recipes field means no profession window was open, so if crafting advice needs it, ask the player to open that profession and copy a new Make gold question.";
