import { codexSchema } from "../snapshots/codex.ts";
import type { Topic } from "./topic.ts";

export const corrosiveCodex = {
  category: "codex",
  fields: { codex: codexSchema.optional() },
  prompt: "The Corrosive Codex topic supplies codex from the open Codex window. souls counts Corrosive Souls across the Warband, each power costs eight, and powers lists the twelve powers. One power can be active until eight are unlocked, then two. Recommend which power to unlock next for the player's spec when souls allow, and whether the active choice suits the content. Codex powers only work outdoors on the Coiled Isle and in Delves.",
} as const satisfies Topic;
