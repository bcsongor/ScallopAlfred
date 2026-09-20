import type { z } from "zod";

/**
 * A button in the addon's menu, mirrored on this side: the category it sends, the request fields it adds
 * and the paragraph that tells Codex what to do with them.
 */
export type Topic = {
  readonly category: string;
  readonly fields: z.ZodRawShape;
  readonly prompt?: string;
};
