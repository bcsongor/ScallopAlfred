import { z } from "zod";
import { copper, whole } from "./fields.ts";
import { itemLink, itemName, itemQuality, tsmSchema } from "./subject.ts";

/** Gold on hand and every stack the player could see, grouped by item link. */
export const inventorySchema = z.object({
  capturedAt: whole,
  moneyCopper: copper,
  bankIncluded: z.boolean(),
  warbankIncluded: z.boolean(),
  // One entry per distinct link, so stacks spread across bags, bank and Warband bank collapse into a single row.
  items: z.array(z.object({
    link: itemLink,
    name: itemName,
    quality: itemQuality,
    bound: z.boolean().optional(),
    count: z.object({ bags: whole, bank: whole, warbank: whole }),
    auctionCount: whole.optional(),
    mailCount: whole.optional(),
    tsm: tsmSchema.optional(),
  })).max(600),
});

export const inventoryNotes = "inventory has moneyCopper for gold on hand and items grouped by item link, each with count.bags, count.bank and count.warbank, optional bound for soulbound and similar items, optional auctionCount and mailCount from TSM, and tsm prices. When bankIncluded or warbankIncluded is false the addon could not read that container, because WoW only exposes bank contents while the bank window is open, so those counts are unknown, not zero.";
