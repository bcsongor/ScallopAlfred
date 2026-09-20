import { inventorySchema } from "../snapshots/inventory.ts";
import { recipesSchema } from "../snapshots/recipes.ts";
import type { Topic } from "./topic.ts";

export const gold = {
  category: "gold",
  fields: { inventory: inventorySchema.optional(), recipes: recipesSchema.optional() },
  prompt: `The Make gold topic supplies inventory and recipes, and the same specialisation details the Professions topic gets.
Answer a gold question as a ranked list, biggest opportunity first, measured in gold the player can expect. Lead with the single largest one and its rough value. Five actions or fewer, and only actions worth the player's time; skip a category with nothing worthwhile rather than covering it. Roll small sales into one line with a total instead of tabling every stack. Candidates are stacks to sell now, crafts with margin, reagents worth buying below market, and farming or daily routines that suit the player's professions, level and item level, verified with web search for the current patch. Judge a craft by the output's marketCopper or regionSaleAvgCopper times quantity against reagent cost, prefer craftingCopper when it is present, and weigh saleRate. State margins in gold, rounded. Give the snapshot caveat once, not per item. Never invent a price, and say when an item has no TSM data. Bound items cannot be sold on the auction house. Recommend nothing that needs live auction house access, because TSM values are snapshots from capturedAt.`,
} as const satisfies Topic;
