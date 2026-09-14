import assert from "node:assert/strict";
import { test } from "node:test";
import type { Thread } from "../sidecar/history.ts";
import type { OverlayState } from "../sidecar/ipc.ts";
import type { WoWRequest } from "../sidecar/protocol.ts";
import { continuableThread, finishTurn, overlayState, startTurn, welcome } from "../sidecar/threads.ts";

const request = (id: string, fields: Partial<WoWRequest> = {}): WoWRequest => ({
  id, context: "context", thread: "new", question: `Question ${id}`, subjects: [],
  player: { class: "Druid", spec: "Restoration", level: 90 }, gameVersion: "12.1.0", ...fields,
});
const empty: Thread = { id: "thread", title: "", titleSubjects: [], updatedAt: 0, request: request("first"), turns: [] };

test("requests add thinking turns, and a thread keeps the name of its first request", () => {
  const ore = { type: "item", name: "Ore", link: "item:1", quality: 2, tooltip: [] };
  const named = startTurn(empty, request("first", { subjects: [ore] }));
  assert.equal(named.title, "Ore");
  assert.deepEqual(named.titleSubjects, [{ name: "Ore", type: "item", quality: 2 }]);
  assert.deepEqual(startTurn(named, request("second")).titleSubjects, named.titleSubjects);
  const first = finishTurn(startTurn(empty, request("first")), { status: "answer", text: "Done" });
  assert.equal(first.title, "Question first");
  const second = startTurn(first, request("second", { subjects: [ore] }));
  assert.deepEqual(second.turns, [
    { id: "first", question: "Question first", status: "answer", text: "Done" },
    { id: "second", question: "Question second", status: "thinking", text: "" },
  ]);
  assert.equal(second.title, "Question first");
  assert.deepEqual(empty.turns, []);
});

test("retrying the last request replaces its turn", () => {
  const failed = finishTurn(startTurn(empty, request("first")), { status: "error", text: "Failed" });
  assert.deepEqual(startTurn(failed, request("first")).turns, [{ id: "first", question: "Question first", status: "thinking", text: "" }]);
});

test("the overlay shows a notice first, then the last turn, then the welcome text", () => {
  const answered = finishTurn(startTurn(empty, request("first")), { status: "answer", text: "Done" });
  const notice: OverlayState = { status: "error", title: "Couldn't open the link", text: "Blocked" };
  assert.deepEqual(overlayState({ kind: "thread", thread: answered, notice }), notice);
  assert.deepEqual(overlayState({ kind: "thread", thread: answered }), { status: "answer", title: "Question first", text: "Done" });
  assert.deepEqual(overlayState({ kind: "thread" }), welcome);
});

test("only an unarchived thread on screen with nothing running can continue", () => {
  const thread = startTurn(empty, request("first"));
  assert.equal(continuableThread({ kind: "thread", thread }, false), thread);
  assert.equal(continuableThread({ kind: "thread", thread }, true), undefined);
  assert.equal(continuableThread({ kind: "thread", thread: { ...thread, archivedAt: 1 } }, false), undefined);
  assert.equal(continuableThread({ kind: "history" }, false), undefined);
});
