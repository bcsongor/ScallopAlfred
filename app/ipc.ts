import { z } from "zod";
import type { Config } from "./config.ts";
import type { ArchivedThreadSummary, ThreadSummary, Turn, TitleSubject } from "./history.ts";
import type { LinkIcon } from "./icons.ts";
import { requestSchema } from "./protocol.ts";

export type OverlayState = {
  status: "ready" | Turn["status"];
  title: string;
  /** Shown after the turns: the welcome text, or an error that belongs to no turn. */
  notice?: string;
};

export type ToOverlay = {
  reply: { id: string; html: string };
  thread: {
    /** The thread on screen, which a rename names. Absent on the welcome view. */
    id?: string;
    state: OverlayState;
    titleSubjects?: TitleSubject[];
    turns: (Turn & { html: string | null })[];
    canFollowup: boolean;
    fontSize: number;
  };
  history: { threads: ThreadSummary[]; archived: ArchivedThreadSummary[]; fontSize: number };
  theme: Config["theme"];
  "followup-editor": boolean;
};

const messages = {
  "hide-overlay": z.undefined(),
  "focus-overlay": z.undefined(),
  "show-history": z.undefined(),
  "edit-followup": z.boolean(),
  "submit-followup": requestSchema.shape.question,
  "open-thread": z.string(),
  "archive-thread": z.string(),
  /** An empty title asks Codex to name the thread from its conversation. */
  "rename-thread": z.object({ id: z.string(), title: z.string().trim().max(200) }),
  "resize-height": z.object({ height: z.number(), finished: z.boolean() }),
  "open-link": z.string(),
};

export type FromOverlay = { [K in keyof typeof messages]: z.output<(typeof messages)[K]> };

/** The renderer is untrusted, so the main process validates every message from it. */
export const fromOverlay: { [K in keyof FromOverlay]: z.ZodType<FromOverlay[K]> } = messages;

/** Channels where the overlay waits for a result from the main process. */
export type OverlayRequests = {
  "link-icon": { message: string; result: LinkIcon | undefined };
};

export const overlayRequests: { [K in keyof OverlayRequests]: z.ZodType<OverlayRequests[K]["message"]> } = {
  "link-icon": z.string(),
};

/** Send arguments for a channel: none when it carries no payload. */
export type MessageArgs<T, K extends keyof T> = T[K] extends undefined ? [] : [message: T[K]];
