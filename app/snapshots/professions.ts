import { z } from "zod";
import { amount, shortText, whole } from "./fields.ts";

/** Every profession's skills for each expansion, with each expansion's specialisation tree when a topic asked for it. */
export const professionsSchema = z.object({
  capturedAt: whole,
  entries: z.array(z.object({
    name: shortText,
    skillLineID: amount.int(),
    skillLineName: shortText.optional(),
    skillLevel: amount.optional(),
    maxSkillLevel: amount.optional(),
    skillModifier: amount.optional(),
    expansions: z.array(z.object({
      skillLineID: amount.int(),
      name: shortText.optional(),
      expansionName: shortText.optional(),
      skillLevel: amount.optional(),
      maxSkillLevel: amount.optional(),
      skillModifier: amount.optional(),
      specialization: z.object({
        unspentKnowledge: amount.optional(),
        hasStagedChanges: z.boolean().optional(),
        paths: z.array(z.object({
          id: amount.int(),
          parentID: amount.int().optional(),
          name: shortText.optional(),
          rank: amount,
          maxRank: amount,
        })).max(128),
      }).optional(),
    })).max(32).optional(),
  })).max(5),
});

export const professionsNotes = `Basic profession skills accompany every question; detailed allocations come only with the Professions and Make gold topics. If allocation details are needed in another conversation, ask the player to copy a new question through Professions. For professions, use the supplied skillLineName to identify the current expansion; expansions lists every expansion's skill line for that profession, so use it for legacy content. Each line carries its own specialization, and expansions before Dragonflight have none, so read a tree and its knowledge only from the expansion the question is about. skillLevel and maxSkillLevel are profession skill, skillModifier is bonus skill, and unspentKnowledge is that expansion's available specialisation knowledge. These are different quantities.
Specialisation paths contain the displayed rank and maxRank, excluding unlock ranks; parentID identifies the parent path. hasStagedChanges means the allocation includes uncommitted edits. Do not treat a missing profession, path or knowledge value as zero or as proof it is unlearned. If needed data is missing, ask the player to open that profession's Specializations tab and copy a new question, or provide the missing values.
Profession and TSM data are snapshots from capturedAt, not live character access. Follow-ups reuse them; after points are spent or skills change, request a fresh copy when it matters. Recommend next points based on the existing allocation and goal, and verify any prerequisites or refund restrictions before giving that advice.`;
