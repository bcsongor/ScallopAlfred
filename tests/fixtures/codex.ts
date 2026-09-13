// A stand-in for `codex exec --json`. The first argument picks how it behaves.
import { text } from "node:stream/consumers";

const emit = (event: object): void => { process.stdout.write(`${JSON.stringify(event)}\n`); };
const prompt = await text(process.stdin);

emit({ type: "thread.started", thread_id: "thread-1" });
switch (process.argv[2]) {
  case "answer":
    process.stdout.write("not JSON\n");
    emit({ type: "item.completed", item: { type: "agent_message", text: `  Answer to: ${prompt}  ` } });
    emit({ type: "turn.completed" });
    break;
  case "failed":
    emit({ type: "turn.failed", error: { message: "Usage limit reached" } });
    process.exitCode = 1;
    break;
  case "silent":
    emit({ type: "turn.completed" });
    break;
  case "environment":
    emit({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify({ openai: process.env.OPENAI_API_KEY ?? null, codex: process.env.CODEX_API_KEY ?? null }) } });
    emit({ type: "turn.completed" });
    break;
  case "hang":
    setInterval(() => {}, 1000);
    break;
}
