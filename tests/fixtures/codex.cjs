const { appendFileSync } = require("node:fs");
const { join } = require("node:path");
let prompt = "";
process.stdin.setEncoding("utf8").on("data", chunk => { prompt += chunk; });
process.stdin.on("end", () => {
  const request = JSON.parse(prompt.slice(prompt.lastIndexOf("\n{") + 1));
  const args = process.argv.slice(2);
  appendFileSync(join(process.env.SCALLOPALFRED_TEST_DATA, "requests.jsonl"), JSON.stringify({ request, args }) + "\n");
  const emit = event => process.stdout.write(JSON.stringify(event) + "\n");
  emit({ type: "thread.started", thread_id: "session-" + request.context });
  if (request.question === "fail") {
    emit({ type: "turn.failed", error: { message: "Test failure" } });
    process.exitCode = 1;
    return;
  }
  setTimeout(() => {
    const line = JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Answer: " + request.question } });
    process.stdout.write(line.slice(0, 20));
    setTimeout(() => {
      process.stdout.write(line.slice(20) + "\n");
      emit({ type: "turn.completed" });
    }, 20);
  }, request.question === "wait" ? 10000 : request.thread === "continue" ? 500 : 100);
});
