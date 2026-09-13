import { z } from "zod";

const requestPrefix = "SCALLOPALFRED:";

const copper = z.number().nonnegative().max(Number.MAX_SAFE_INTEGER).optional();
const tsmSchema = z.object({
  capturedAt: z.number().int().nonnegative(),
  minBuyoutCopper: copper,
  regionMarketAvgCopper: copper,
  regionSaleAvgCopper: copper,
  saleRate: z.number().min(0).max(1).optional(),
  vendorSellCopper: copper,
});

const subjectSchema = z.object({
  type: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/).max(64),
  name: z.string().min(1).max(256),
  link: z.string().min(1).max(2048),
  tooltip: z.array(z.string().max(2048)).max(80),
  tsm: tsmSchema.optional(),
});

const professionNumber = z.number().nonnegative().max(Number.MAX_SAFE_INTEGER);
const professionsSchema = z.object({
  capturedAt: z.number().int().nonnegative(),
  entries: z.array(z.object({
    name: z.string().max(256),
    skillLineID: professionNumber.int(),
    skillLineName: z.string().max(256).optional(),
    skillLevel: professionNumber.optional(),
    maxSkillLevel: professionNumber.optional(),
    skillModifier: professionNumber.optional(),
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

export const requestSchema = z.object({
  v: z.literal(2),
  id: z.string().min(1).max(128),
  context: z.string().min(1).max(128),
  thread: z.enum(["new", "continue"]),
  question: z.string().trim().min(1).max(2000),
  category: z.enum(["mechanics", "professions", "gear"]).optional(),
  player: z.object({
    class: z.string().max(64),
    spec: z.string().max(64),
    level: z.number().int().min(1).max(1000),
  }),
  gameVersion: z.string().max(64),
  subjects: z.array(subjectSchema).max(8),
  equipped: z.array(subjectSchema.extend({ type: z.literal("item"), slot: z.number().int().min(1).max(19).optional() })).max(19).optional(),
  professions: professionsSchema.optional(),
  talents: z.object({
    capturedAt: z.number().int().nonnegative(),
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

export const conversationTurnSchema = z.object({
  id: z.string(),
  question: z.string(),
  status: z.enum(["thinking", "answer", "error"]),
  text: z.string(),
});

export type ConversationTurn = z.infer<typeof conversationTurnSchema>;

export type OverlayState = {
  status: "ready" | ConversationTurn["status"];
  title: string;
  text: string;
};

/** Unrelated clipboard contents never become a request. */
export function parseRequest(text: string): WoWRequest | undefined {
  if (!text.startsWith(requestPrefix)) return undefined;
  if (text.length > 64_000) throw new Error("The copied request is too large. Try fewer links or a shorter question.");
  try {
    return requestSchema.parse(JSON.parse(text.slice(requestPrefix.length)));
  } catch {
    throw new Error("Invalid Scallop Alfred request. Reload WoW's UI and restart the desktop app, then copy the question again.");
  }
}
