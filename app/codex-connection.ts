import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";

const message = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number().optional(), message: z.string() }).optional(),
});
type Message = z.infer<typeof message>;

export type Notification = { method: string; params?: unknown };

export type Connection<Requests> = {
  notifications: ReadableStream<Notification>;
  request<Method extends keyof Requests & string>(method: Method, params: Requests[Method]): Promise<unknown>;
  notify(method: string): void;
  close(): Promise<void>;
};

/** Codex may print diagnostics on stdout between JSON lines. */
function parseMessage(line: string): Message | undefined {
  try {
    return message.parse(JSON.parse(line));
  } catch {
    return undefined;
  }
}

/**
 * JSON-RPC over the child's stdio. Replies settle their request, notifications queue for the
 * reader, and a process failure rejects everything at once.
 */
export function connect<Requests>(child: ChildProcessWithoutNullStreams): Connection<Requests> {
  const replies = new Map<number, PromiseWithResolvers<unknown>>();
  const lines = createInterface({ input: child.stdout });
  const exited = new Promise<void>(resolve => child.once("close", () => resolve()));
  let sequence = 0;
  let stderr = "";
  let failure: Error | undefined;
  const send = (payload: object): void => { child.stdin.write(`${JSON.stringify(payload)}\n`); };
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-1500); });

  const notifications = new ReadableStream<Notification>({
    start(controller) {
      const fail = (error: Error): void => {
        if (failure) return;
        failure = error;
        lines.close();
        for (const reply of replies.values()) reply.reject(error);
        replies.clear();
        controller.error(error);
      };
      const receive = ({ id, method, params, result, error }: Message): void => {
        if (method && id !== undefined) {
          send({ id, error: { code: -32601, message: "Scallop Alfred does not support interactive requests." } });
          fail(new Error(`Codex requested an unsupported interaction: ${method}`));
        } else if (method) {
          controller.enqueue({ method, params });
        } else if (typeof id === "number") {
          const reply = replies.get(id);
          replies.delete(id);
          if (error) reply?.reject(new Error(error.message, { cause: error }));
          else reply?.resolve(result);
        }
      };
      child.once("error", fail);
      child.stdin.on("error", fail);
      child.stdout.on("error", fail);
      child.once("close", () => fail(new Error(stderr.trim() || "Codex stopped before completing the reply.")));
      lines.on("line", line => {
        const parsed = parseMessage(line);
        if (parsed) receive(parsed);
      });
    },
    cancel: () => lines.close(),
  });

  return {
    notifications,
    notify: method => send({ method }),
    request(method, params) {
      if (failure) return Promise.reject(failure);
      const id = ++sequence;
      const reply = Promise.withResolvers<unknown>();
      replies.set(id, reply);
      send({ id, method, params });
      return reply.promise;
    },
    async close() {
      lines.close();
      // EOF lets Codex flush its session. An unresponsive process gets one second.
      child.stdin.end();
      const forceExit = setTimeout(() => child.kill("SIGKILL"), 1000);
      await exited;
      clearTimeout(forceExit);
    },
  };
}
