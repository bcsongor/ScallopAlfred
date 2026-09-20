import { z } from "zod";
import { copper, whole } from "./fields.ts";

export const tsmSchema = z.object({
  capturedAt: whole,
  minBuyoutCopper: copper,
  regionMarketAvgCopper: copper,
  regionSaleAvgCopper: copper,
  saleRate: z.number().min(0).max(1).optional(),
  vendorSellCopper: copper,
  marketCopper: copper,
  destroyCopper: copper,
  craftingCopper: copper,
});

export const itemName = z.string().min(1).max(256);
export const itemLink = z.string().min(1).max(2048);
export const itemQuality = z.number().int().min(0).max(8).optional();

/** Anything the player can ask about: an item, spell, quest, currency, achievement or NPC. */
export const subjectSchema = z.object({
  type: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/).max(64),
  name: itemName,
  link: itemLink,
  quality: itemQuality,
  tooltip: z.array(z.string().max(2048)).max(80),
  tsm: tsmSchema.optional(),
});

export const subjectNotes = `For any item with tsm data, whether a subject, an inventory item or a recipe output, use it for selling advice. Monetary fields are per-item copper: 10,000 copper = 1 gold.
minBuyoutCopper is the lowest listed price in TSM's last snapshot, not a live quote. regionMarketAvgCopper averages regional listing-based market values; regionSaleAvgCopper averages reported regional sales and purchases. marketCopper is TSM's realm market value, destroyCopper the value of disenchanting, prospecting or milling the item, and craftingCopper the cost to craft it from TSM's known reagent prices.
saleRate is a 0–1 historical auction sale rate, not a guaranteed sale probability or daily volume. Compare with vendorSellCopper when available. Missing values are unknown, not zero.
capturedAt is when the addon read TSM, not when TSM refreshed its prices. Follow-ups reuse this snapshot; do not describe it as current or invent a disenchant value.`;
