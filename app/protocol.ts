import { z } from "zod";

const requestPrefix = "SCALLOPALFRED:";

const copper = z.number().nonnegative().max(Number.MAX_SAFE_INTEGER).optional();
const whole = z.number().int().nonnegative();
const tsmSchema = z.object({
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

const itemName = z.string().min(1).max(256);
const itemLink = z.string().min(1).max(2048);
const itemQuality = z.number().int().min(0).max(8).optional();

const subjectSchema = z.object({
  type: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/).max(64),
  name: itemName,
  link: itemLink,
  quality: itemQuality,
  tooltip: z.array(z.string().max(2048)).max(80),
  tsm: tsmSchema.optional(),
});

const professionNumber = z.number().nonnegative().max(Number.MAX_SAFE_INTEGER);
const professionsSchema = z.object({
  capturedAt: whole,
  entries: z.array(z.object({
    name: z.string().max(256),
    skillLineID: professionNumber.int(),
    skillLineName: z.string().max(256).optional(),
    skillLevel: professionNumber.optional(),
    maxSkillLevel: professionNumber.optional(),
    skillModifier: professionNumber.optional(),
    expansions: z.array(z.object({
      skillLineID: professionNumber.int(),
      name: z.string().max(256).optional(),
      expansionName: z.string().max(256).optional(),
      skillLevel: professionNumber.optional(),
      maxSkillLevel: professionNumber.optional(),
      skillModifier: professionNumber.optional(),
    })).max(32).optional(),
    specialization: z.object({
      skillLineID: professionNumber.int(),
      unspentKnowledge: professionNumber.optional(),
      hasStagedChanges: z.boolean().optional(),
      paths: z.array(z.object({
        id: professionNumber.int(),
        parentID: professionNumber.int().optional(),
        name: z.string().max(256).optional(),
        rank: professionNumber,
        maxRank: professionNumber,
      })).max(128),
    }).optional(),
  })).max(5),
});

const inventorySchema = z.object({
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

const recipesSchema = z.object({
  capturedAt: whole,
  professionName: z.string().max(256),
  skillLineID: professionNumber.int(),
  skillLevel: professionNumber.optional(),
  maxSkillLevel: professionNumber.optional(),
  // Learned recipes from the open profession window only.
  entries: z.array(z.object({
    recipeID: whole,
    name: z.string().max(256),
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
      name: z.string().max(256).optional(),
      quantity: whole,
      marketCopper: copper,
    })).max(12),
  })).max(200),
});

export const requestSchema = z.object({
  id: z.string().min(1).max(128),
  context: z.string().min(1).max(128),
  thread: z.enum(["new", "continue", "followup"]),
  question: z.string().trim().min(1).max(2000),
  category: z.enum(["mechanics", "professions", "gear", "gold"]).optional(),
  player: z.object({
    class: z.string().max(64),
    spec: z.string().max(64),
    level: z.number().int().min(1).max(1000),
    itemLevel: z.number().int().nonnegative().max(10_000).optional(),
  }),
  gameVersion: z.string().max(64),
  subjects: z.array(subjectSchema).max(8),
  equipped: z.array(subjectSchema.extend({ type: z.literal("item"), slot: z.number().int().min(1).max(19).optional() })).max(19).optional(),
  professions: professionsSchema.optional(),
  inventory: inventorySchema.optional(),
  recipes: recipesSchema.optional(),
  talents: z.object({
    capturedAt: whole,
    exportString: z.string().max(4096).optional(),
    hasStagedChanges: z.boolean().optional(),
    selected: z.array(z.object({
      spellID: z.number().int().positive(),
      name: z.string().max(256).optional(),
      rank: z.number().int().positive(),
    })).max(128),
  }).optional(),
});

export type WoWRequest = z.infer<typeof requestSchema>;

export function parseRequest(text: string): WoWRequest | undefined {
  if (!text.startsWith(requestPrefix)) return undefined;
  if (text.length > 512_000) throw new Error("The copied request is too large. Try fewer links or a shorter question.");
  try {
    return requestSchema.parse(JSON.parse(text.slice(requestPrefix.length)));
  } catch {
    throw new Error("Invalid Scallop Alfred request. Reload WoW's UI and restart the desktop app, then copy the question again.");
  }
}
