import { z } from "zod";
import { longText, shortText, whole } from "./fields.ts";

/** A tree from Blizzard's generic trait window, every node included, bought or not. */
export const traitTreeSchema = z.object({
  capturedAt: whole,
  unspent: whole.optional(),
  spent: whole.optional(),
  hasStagedChanges: z.boolean().optional(),
  nodes: z.array(z.object({
    id: whole,
    rank: whole,
    maxRank: whole.optional(),
    available: z.boolean().optional(),
    // Prerequisites met, whether or not the player has points to spend.
    reachable: z.boolean().optional(),
    // A choice node's entries are alternatives; a tiered node's are its ranks.
    choice: z.boolean().optional(),
    entries: z.array(z.object({
      name: shortText,
      description: longText.optional(),
      selected: z.boolean().optional(),
    })).max(8),
  })).max(64),
});

export const traitTreeNotes = "A trait tree snapshot, such as altar, lists every node in nodes with rank and maxRank, reachable when its prerequisites are met so it is next in line once points are available, available false while a prerequisite or discovery still gates it, and entries with name and description. A node with choice true offers its entries as alternatives and selected marks the pick; otherwise several entries are one per rank. unspent and spent count its points.";
