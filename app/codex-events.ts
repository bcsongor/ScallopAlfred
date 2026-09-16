import { z } from "zod";
import type { Notification } from "./codex-connection.ts";

const scope = { threadId: z.string(), turnId: z.string() };
const agentMessage = z.object({
  type: z.literal("agentMessage"), id: z.string(), text: z.string(),
  phase: z.enum(["commentary", "final_answer"]).nullish(),
});
const webSearch = z.object({
  type: z.literal("webSearch"), id: z.string(), query: z.string().nullish(),
  action: z.object({ type: z.string(), url: z.string().nullish() }).nullish(),
});
// Other item types only need to parse, so their events are recognised and ignored.
const otherItem = z.object({ type: z.string(), id: z.string() }).transform(({ id }) => ({ type: "other" as const, id }));
const item = z.union([agentMessage, webSearch, otherItem]);
const eventSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("turn/started"), params: z.object({ threadId: z.string(), turn: z.object({ id: z.string() }) }) }),
  z.object({ method: z.literal("item/started"), params: z.object({ ...scope, item }) }),
  z.object({ method: z.literal("item/completed"), params: z.object({ ...scope, item }) }),
  z.object({ method: z.literal("item/agentMessage/delta"), params: z.object({ ...scope, itemId: z.string(), delta: z.string() }) }),
  z.object({ method: z.literal("item/reasoning/summaryTextDelta"), params: z.object({ ...scope, itemId: z.string(), summaryIndex: z.number(), delta: z.string() }) }),
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
  /** Codex's remarks between tool calls, which describe what it is about to do. */
  commentary?: Readonly<{ id: string; text: string }>;
  /** The reasoning summary part being written. Its first line is a headline for the step. */
  reasoning?: Readonly<{ id: string; part: number; text: string }>;
  /** One line describing what Codex is doing right now. */
  activity?: string;
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
      const completed = event.method === "item/completed";
      if (item.type === "webSearch") return withActivity(run, describeSearch(item, completed));
      if (item.type !== "agentMessage") return run;
      if (item.phase === "commentary") return withActivity({ ...run, commentary: item }, headline(item.text));
      return withActivity({ ...run, message: { id: item.id, text: item.text, completed } }, "Writing the reply");
    }
    case "item/agentMessage/delta": {
      const { itemId, delta } = event.params;
      if (run.message?.id === itemId && !run.message.completed) {
        return { ...run, message: { ...run.message, text: run.message.text + delta } };
      }
      if (run.commentary?.id !== itemId) return run;
      const commentary = { id: itemId, text: run.commentary.text + delta };
      return withActivity({ ...run, commentary }, headline(commentary.text));
    }
    case "item/reasoning/summaryTextDelta": {
      const { itemId, summaryIndex, delta } = event.params;
      const continues = run.reasoning?.id === itemId && run.reasoning.part === summaryIndex;
      const reasoning = { id: itemId, part: summaryIndex, text: (continues ? run.reasoning.text : "") + delta };
      return withActivity({ ...run, reasoning }, headline(reasoning.text));
    }
    case "turn/completed": return { ...run, status: event.params.turn.status, failure: event.params.turn.error?.message };
  }
}

function withActivity(run: Run, activity: string | undefined): Run {
  return activity ? { ...run, activity } : run;
}

function describeSearch({ query, action }: z.infer<typeof webSearch>, completed: boolean): string {
  const url = action?.url ? URL.parse(action.url) : undefined;
  if (url && (action?.type === "openPage" || action?.type === "findInPage")) return `${completed ? "Read" : "Reading"} ${url.hostname}`;
  const verb = completed ? "Searched" : "Searching";
  return query ? `${verb} the web for “${query}”` : `${verb} the web`;
}

/** The first line of a remark or summary, without Markdown emphasis, cut to one line's worth. */
function headline(text: string): string | undefined {
  const line = text.split("\n").map(part => part.replace(/[*_#`]/g, "").trim()).find(Boolean);
  return line?.slice(0, 120);
}
