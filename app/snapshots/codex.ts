import { z } from "zod";
import { whole } from "./fields.ts";
import { playerChoiceOptionSchema } from "./player-choice.ts";

/** The open Corrosive Codex: its powers as the player choice shows them, and the souls that unlock more. */
export const codexSchema = z.object({
  capturedAt: whole,
  // Corrosive Souls across the Warband; each power costs eight.
  souls: whole.optional(),
  powers: z.array(playerChoiceOptionSchema).max(12),
});
