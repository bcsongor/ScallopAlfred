import { z } from "zod";
import type { Config } from "./config.ts";
import type { ArchivedConversationSummary, ConversationSummary, ConversationTurn, TitleSubject } from "./history.ts";
import { requestSchema } from "./protocol.ts";

export type OverlayState = {
  status: "ready" | ConversationTurn["status"];
  title: string;
  text: string;
};

export type ToOverlay = {
  thread: {
    state: OverlayState;
    titleSubjects?: TitleSubject[];
    turns: (ConversationTurn & { html: string | null })[];
    canFollowup: boolean;
    fontSize: number;
  };
  history: { conversations: ConversationSummary[]; archived: ArchivedConversationSummary[]; fontSize: number };
  theme: Config["theme"];
  "followup-editor": boolean;
};

const messages = {
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

export type FromOverlay = { [K in keyof typeof messages]: z.output<(typeof messages)[K]> };

/** The renderer is untrusted, so the main process validates every message from it. */
export const fromOverlay: { [K in keyof FromOverlay]: z.ZodType<FromOverlay[K]> } = messages;

/** Channels where the overlay waits for a result from the main process. */
export type OverlayRequests = {
  favicon: { message: string; result: string | undefined };
};

export const overlayRequests: { [K in keyof OverlayRequests]: z.ZodType<OverlayRequests[K]["message"]> } = {
  favicon: z.string(),
};

/** Send arguments for a channel: none when it carries no payload. */
export type MessageArgs<T, K extends keyof T> = T[K] extends undefined ? [] : [message: T[K]];
