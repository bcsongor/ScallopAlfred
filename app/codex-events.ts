import { z } from "zod";
import type { Notification } from "./codex-connection.ts";

const scope = { threadId: z.string(), turnId: z.string() };
const item = z.object({
  type: z.literal("agentMessage"), id: z.string(), text: z.string(),
  phase: z.enum(["commentary", "final_answer"]).nullish(),
});
const eventSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("turn/started"), params: z.object({ threadId: z.string(), turn: z.object({ id: z.string() }) }) }),
  z.object({ method: z.literal("item/started"), params: z.object({ ...scope, item }) }),
  z.object({ method: z.literal("item/completed"), params: z.object({ ...scope, item }) }),
  z.object({ method: z.literal("item/agentMessage/delta"), params: z.object({ ...scope, itemId: z.string(), delta: z.string() }) }),
  z.object({ method: z.literal("turn/completed"), params: z.object({
    threadId: z.string(),
    turn: z.object({
      id: z.string(), status: z.enum(["completed", "interrupted", "failed"]),
      error: z.object({ message: z.string() }).nullish(),
    }),
  }) }),
]);

export type Run = Readonly<{
  threadId: string;
  turnId?: string;
  message?: Readonly<{ id: string; text: string; completed: boolean }>;
  status?: "completed" | "interrupted" | "failed";
  failure?: string;
}>;

/** Only the active turn's answer reaches the overlay. Tool output and commentary stay out of it. */
export function applyEvent(run: Run, notification: Notification): Run {
  const parsed = eventSchema.safeParse(notification);
  if (!parsed.success || parsed.data.params.threadId !== run.threadId) return run;
  const event = parsed.data;
  const turnId = "turnId" in event.params ? event.params.turnId : event.params.turn.id;
  if (event.method === "turn/started") return run.turnId ? run : { ...run, turnId };
  if (turnId !== run.turnId) return run;
  switch (event.method) {
    case "item/started":
    case "item/completed": {
      const { item } = event.params;
      if (item.phase === "commentary") return run;
      return { ...run, message: { id: item.id, text: item.text, completed: event.method === "item/completed" } };
    }
    case "item/agentMessage/delta":
      return run.message?.id === event.params.itemId && !run.message.completed
        ? { ...run, message: { ...run.message, text: run.message.text + event.params.delta } }
        : run;
    case "turn/completed": return { ...run, status: event.params.turn.status, failure: event.params.turn.error?.message };
  }
}
