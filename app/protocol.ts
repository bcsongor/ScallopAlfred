import { z } from "zod";
import { equippedSchema } from "./snapshots/equipment.ts";
import { professionsSchema } from "./snapshots/professions.ts";
import { subjectSchema } from "./snapshots/subject.ts";
import { categories, topicFields } from "./topics/index.ts";

const requestPrefix = "SCALLOPALFRED:";

/** The addon's minimap button copies this, followed by a fresh ID, to bring back a hidden overlay. */
const showPrefix = "SCALLOPALFRED:SHOW";

export const isShowCommand = (text: string): boolean => text.startsWith(showPrefix);

export const requestSchema = z.object({
  id: z.string().min(1).max(128),
  context: z.string().min(1).max(128),
  thread: z.enum(["new", "continue", "followup"]),
  question: z.string().trim().min(1).max(2000),
  category: z.enum(categories).optional(),
  player: z.object({
    name: z.string().max(64).optional(),
    class: z.string().max(64),
    spec: z.string().max(64),
    level: z.number().int().min(1).max(1000),
    itemLevel: z.number().int().nonnegative().max(10_000).optional(),
  }),
  gameVersion: z.string().max(64),
  subjects: z.array(subjectSchema).max(8),
  // Every request may carry the slots its subjects could replace and the player's profession skills.
  equipped: equippedSchema.optional(),
  professions: professionsSchema.optional(),
  ...topicFields,
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

export type ClipboardMessage = { kind: "show" } | { kind: "ask"; request: WoWRequest };

/** Recognises the show command or a request. Throws for a request that doesn't validate. */
export function parseClipboard(text: string): ClipboardMessage | undefined {
  if (isShowCommand(text)) return { kind: "show" };
  const request = parseRequest(text);
  return request && { kind: "ask", request };
}
