import type { WoWRequest } from "../../app/protocol.ts";

/** The smallest request the app accepts. */
export const baseRequest: WoWRequest = {
  id: "copy-1", context: "item-1", thread: "new", question: "What's this for?",
  player: { class: "Druid", spec: "Restoration", level: 90, itemLevel: 310 }, gameVersion: "12.1.0",
  subjects: [{ type: "item", name: 'Ring "of" stars', link: "item:123", tooltip: ["Line one\nLine two"] }],
  equipped: [],
};

/** The clipboard text the addon would produce for a request. */
export const copied = (value: unknown): string => `SCALLOPALFRED:${JSON.stringify(value)}`;

/** The request JSON a prompt ends with. */
export const promptRequest = (prompt: string): unknown => JSON.parse(prompt.slice(prompt.lastIndexOf("\n{") + 1));
