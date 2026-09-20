import { z } from "zod";

/** A non-negative integer, such as a count or a Unix time. */
export const whole = z.number().int().nonnegative();
/** A non-negative number the game reported, bounded so it survives JSON. */
export const amount = z.number().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** A per-item copper price, absent when unknown. */
export const copper = amount.optional();
export const shortText = z.string().max(256);
export const longText = z.string().max(1024);
