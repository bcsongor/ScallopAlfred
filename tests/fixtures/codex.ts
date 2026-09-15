// A stdio App Server stand-in. It stays alive until the client closes it.
import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import type { ServerRequests } from "../../app/codex.ts";
import { errorMessage } from "../../app/errors.ts";

type Request = { [K in keyof ServerRequests]: { id: number; method: K; params: ServerRequests[K] } }[keyof ServerRequests]
  | { method: "initialized" };

const emit = (event: object): void => { process.stdout.write(`${JSON.stringify(event)}\n`); };
const mode = process.argv[2];
const scope = { threadId: "thread-1", turnId: "turn-1" };
const item = { type: "agentMessage", id: "answer-1", phase: "final_answer", text: "" };
const event = (method: string, params: object): void => emit({ method, params: { ...scope, ...params } });
let initialised = false;

async function respond(request: Request): Promise<void> {
  switch (request.method) {
    case "initialize":
      assert.equal(request.params.clientInfo.name, "scallop_alfred");
      emit({ id: request.id, result: { userAgent: "test" } });
      break;
    case "initialized":
      initialised = true;
      break;
    case "config/read":
      emit({ id: request.id, result: { config: mode === "invalid-config" ? null : { mcp_servers: { example: { enabled: true } } } } });
      break;
    case "thread/start":
    case "thread/resume": {
      const { id, method, params } = request;
      assert.ok(initialised);
      assert.equal(params.approvalPolicy, "never");
      assert.equal(params.sandbox, "read-only");
      assert.equal(params.config["mcp_servers.example.enabled"], false);
      if (mode === "resume") {
        assert.equal(method, "thread/resume");
        assert.ok("threadId" in params);
        assert.equal(params.threadId, "thread-1");
        assert.equal(params.model, "test-model");
      }
      if (mode === "rpc-error") emit({ id, error: { code: -1, message: "Unknown thread" } });
      else emit({ id, result: { thread: { id: "thread-1" } } });
      break;
    }
    case "turn/start": {
      const { id, params } = request;
      if (mode === "junk") process.stdout.write("not JSON\n");
      assert.equal(params.threadId, "thread-1");
      assert.equal(params.effort, "medium");
      const prompt = params.input[0]?.text ?? "";
      if (mode !== "early") emit({ id, result: { turn: { id: "turn-1" } } });
      event("turn/started", { turn: { id: "turn-1" } });
      if (mode === "hang") break;
      if (mode === "close") process.exit(1);
      if (mode === "interaction") {
        emit({ id: "approval-1", method: "item/commandExecution/requestApproval", params: scope });
        break;
      }
      if (mode === "failed") {
        event("turn/completed", { turn: { id: "turn-1", status: "failed", error: { message: "Usage limit reached" } } });
        break;
      }
      if (mode !== "silent") {
        event("item/started", { item: { ...item, id: "commentary-1", phase: "commentary" } });
        event("item/agentMessage/delta", { itemId: "commentary-1", delta: "Searching the web" });
        event("item/completed", { item: { ...item, id: "commentary-1", phase: "commentary", text: "Searching the web" } });
        event("item/started", { item });
        event("item/agentMessage/delta", { itemId: item.id, delta: "Answer to: " });
        if (mode === "stream") await delay(100);
        event("item/agentMessage/delta", { itemId: item.id, delta: prompt });
        event("item/agentMessage/delta", { threadId: "other-thread", itemId: item.id, delta: "wrong thread" });
        event("item/agentMessage/delta", { turnId: "old-turn", itemId: item.id, delta: "wrong turn" });
        event("item/completed", { item: { type: "webSearch", id: "search-1" } });
        const text = mode === "environment"
          ? JSON.stringify({ openai: process.env.OPENAI_API_KEY ?? null, codex: process.env.CODEX_API_KEY ?? null })
          : `  Answer to: ${prompt}  `;
        event("item/completed", { item: { ...item, text } });
      }
      event("turn/completed", { turn: { id: "turn-1", status: "completed", error: null } });
      if (mode === "early") emit({ id, result: { turn: { id: "turn-1" } } });
      break;
    }
  }
}

for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line) as Request;
  try {
    await respond(request);
  } catch (error) {
    if (!("id" in request)) throw error;
    emit({ id: request.id, error: { code: -32603, message: errorMessage(error) } });
  }
}
