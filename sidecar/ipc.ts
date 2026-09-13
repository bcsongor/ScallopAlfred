import { z } from "zod";
import type { Config } from "./config.ts";
import type { ArchivedConversationSummary, ConversationSummary } from "./history.ts";
import { requestSchema, type ConversationTurn, type OverlayState } from "./protocol.ts";

/** Messages from the main process to the overlay, keyed by channel. */
export type MainMessages = {
  thread: {
    state: OverlayState;
    turns: (ConversationTurn & { html: string | null })[];
    canFollowup: boolean;
    fontSize: number;
  };
  history: { conversations: ConversationSummary[]; archived: ArchivedConversationSummary[]; fontSize: number };
  theme: Config["theme"];
  "followup-editor": boolean;
};

const schemas = {
  "hide-overlay": z.undefined(),
  "show-history": z.undefined(),
  "edit-followup": z.boolean(),
  "submit-followup": requestSchema.shape.question,
  "open-conversation": z.string(),
  "archive-conversation": z.string(),
  "resize-height": z.object({ height: z.number(), finished: z.boolean() }),
  "hover-control": z.boolean(),
  "open-link": z.string(),
};

/** Messages from the overlay to the main process, keyed by channel. */
export type OverlayMessages = { [K in keyof typeof schemas]: z.output<(typeof schemas)[K]> };

/** The renderer is untrusted, so the main process validates every overlay message. */
export const overlayMessages: { [K in keyof OverlayMessages]: z.ZodType<OverlayMessages[K]> } = schemas;

/** Send arguments for a channel: none when it carries no payload. */
export type MessageArgs<T, K extends keyof T> = T[K] extends undefined ? [] : [message: T[K]];
