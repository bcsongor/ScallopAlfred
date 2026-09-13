import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { openHistory, type Conversation } from "../sidecar/history.ts";
import type { WoWRequest } from "../sidecar/protocol.ts";

const databasePath = (): string => join(mkdtempSync(join(tmpdir(), "scallop-history-")), "conversations.sqlite");

test("history persists sessions, replaces retries and recovers interrupted replies", () => {
  const path = databasePath();
  let history = openHistory(path);
  const request: WoWRequest = {
    id: "request", context: "context", thread: "new", question: "What's this for?",
    subjects: [{ type: "item", name: "Ore", link: "item:123", tooltip: [], tsm: { capturedAt: 1800000000, minBuyoutCopper: 120000 } }],
    player: { class: "Druid", spec: "Restoration", level: 90 }, gameVersion: "12.1.0",
    professions: { capturedAt: 1800000000, entries: [{ name: "Alchemy", skillLineID: 171, skillLevel: 75 }] },
    category: "gear", equipped: [{ type: "item", name: "Ring", link: "item:11", tooltip: [], slot: 11 }],
    talents: { capturedAt: 1800000000, selected: [{ spellID: 774, name: "Rejuvenation", rank: 1 }] },
  };
  const conversation: Conversation = {
    id: "conversation", title: "A 'quoted' title", updatedAt: 0, request,
    session: { context: "context", id: "session-1" },
    turns: [{ id: "request", question: request.question, status: "thinking", text: "" }],
  };
  const saved = history.save(conversation);
  assert.ok(saved.updatedAt > 0);
  assert.equal(conversation.updatedAt, 0);
  history.close();
  history = openHistory(path);
  try {
    const recovered = history.get(conversation.id);
    assert.ok(recovered);
    assert.equal(recovered.turns[0].status, "error");
    assert.match(recovered.turns[0].text, /closed before/);
    assert.deepEqual(recovered.request, request);
    assert.deepEqual(recovered.session, conversation.session);
    history.save({ ...recovered, turns: [{ ...recovered.turns[0], status: "answer", text: "**Keep it**" }] });
    assert.equal(history.get(conversation.id)?.turns.length, 1);
    assert.equal(history.findContext("context")?.turns[0].text, "**Keep it**");
    assert.equal(history.list().length, 1);
    assert.equal(history.list()[0].question, request.question);
    assert.equal(history.findContext("missing"), undefined);
  } finally {
    history.close();
  }
});

test("archives retain messages through reply saves and restart, and list only the latest six", () => {
  const path = databasePath();
  const request: WoWRequest = {
    id: "request", context: "context", thread: "new", question: "Keep this chat?",
    subjects: [], player: { class: "Druid", spec: "Restoration", level: 90 }, gameVersion: "12.1.0",
  };
  const conversation: Conversation = {
    id: "conversation", title: request.question, updatedAt: 1, request,
    turns: [{ id: request.id, question: request.question, status: "answer", text: "Keep the messages." }],
  };
  let history = openHistory(path);
  try {
    history.save(conversation);
    assert.equal(history.archive("missing"), false);
    assert.equal(history.archive(conversation.id), true);
    assert.equal(history.archive(conversation.id), false);
    const archivedAt = history.get(conversation.id)?.archivedAt;
    assert.ok(archivedAt);
    assert.deepEqual(history.list(), []);
    assert.deepEqual(history.listArchived(), [{ id: conversation.id, title: conversation.title }]);
    assert.equal(history.findContext(request.context), undefined);

    const finished: Conversation = { ...conversation, turns: [{ ...conversation.turns[0], text: "The reply finished after archiving." }] };
    assert.equal(history.save(finished).archivedAt, archivedAt);
    history.save({ ...finished, turns: [...finished.turns, { id: "pending", question: "Another question", status: "thinking", text: "" }] });
    history.close();
    history = openHistory(path);
    assert.deepEqual(history.list(), []);
    assert.equal(history.get(conversation.id)?.archivedAt, archivedAt);
    assert.equal(history.findContext(request.context), undefined);
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      const row = database.prepare("SELECT data, archived_at FROM conversations WHERE id = ?").get(conversation.id);
      const stored = JSON.parse(String(row?.data));
      assert.equal(stored.turns[0].text, "The reply finished after archiving.");
      assert.equal(stored.turns[1].status, "error");
      assert.equal(row?.archived_at, archivedAt);
    } finally { database.close(); }

    for (let i = 0; i < 12; i++) history.save({ ...conversation, id: `archive-${i}`, title: `Chat ${i}` });
    const creationOrder = Array.from({ length: 12 }, (_, i) => `archive-${11 - i}`);
    const oldest = history.get("archive-0");
    assert.ok(oldest);
    history.save(oldest);
    assert.deepEqual(history.list().map(chat => chat.id), creationOrder);
    // Archive newest first, so archive time and creation order disagree.
    for (const id of creationOrder) history.archive(id);
    const latest = history.listArchived();
    assert.deepEqual(latest.map(chat => chat.id), creationOrder.slice(0, 6));
    history.save(finished);
    assert.deepEqual(history.listArchived(), latest);
    history.close();
    history = openHistory(path);
    assert.deepEqual(history.listArchived(), latest);
  } finally { history.close(); }
});
