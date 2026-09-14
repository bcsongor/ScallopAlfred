import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { openHistory, type Conversation } from "../sidecar/history.ts";
import type { WoWRequest } from "../sidecar/protocol.ts";

const databasePath = (): string => join(mkdtempSync(join(tmpdir(), "scallop-history-")), "conversations.sqlite");

const sample: Conversation = {
  id: "thread", title: "Ore", titleSubjects: [{ name: "Ore", type: "item", quality: 2 }], updatedAt: 100,
  request: {
    id: "request", context: "context", thread: "new", question: "Keep it?", subjects: [],
    player: { class: "Druid", spec: "Restoration", level: 90 }, gameVersion: "12.1.0",
  },
  session: { context: "context", id: "session" },
  turns: [{ id: "request", question: "Keep it?", status: "answer", text: "Keep it." }],
};

type LegacyConversation = Omit<Conversation, "titleSubjects"> & {
  titleSubjects?: Conversation["titleSubjects"];
};

/** Writes the schema used before threads and turns had separate tables. */
function legacyDatabase(path: string, conversations: LegacyConversation[]): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL,
        data TEXT NOT NULL CHECK (json_valid(data)), archived_at INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE INDEX conversations_updated ON conversations(updated_at DESC);
    `);
    const insert = db.prepare("INSERT INTO conversations VALUES (?, ?, ?, ?, ?)");
    for (const conversation of conversations) {
      insert.run(conversation.id, conversation.title, conversation.updatedAt, JSON.stringify(conversation), conversation.archivedAt ?? 0);
    }
  } finally { db.close(); }
}

test("legacy history migrates in place, preserving titles, sessions, archives and creation order", () => {
  const path = databasePath();
  const { titleSubjects: _, ...plain } = { ...sample, id: "plain", updatedAt: 300 };
  legacyDatabase(path, [
    plain,
    { ...sample, titleSubjects: [{ name: "Ore", quality: 2 }, { name: "Quest", type: "quest" }] },
    { ...sample, id: "archived", archivedAt: 400, turns: [...sample.turns, { id: "pending", question: "More?", status: "thinking", text: "" }] },
    { ...sample, id: "mismatch", session: { context: "other", id: "wrong-session" } },
  ]);
  let history = openHistory(path);
  try {
    assert.deepEqual(history.get("plain"), { ...plain, titleSubjects: [] });
    assert.deepEqual(history.get("thread")?.titleSubjects, [{ name: "Ore", quality: 2 }, { name: "Quest", type: "quest" }]);
    assert.deepEqual(history.get("thread")?.session, sample.session);
    assert.equal(history.get("mismatch")?.session, undefined);
    assert.equal(history.findContext("context")?.id, "plain");
    assert.equal(history.get("archived")?.archivedAt, 400);
    assert.equal(history.get("archived")?.turns[1].status, "error");
    assert.deepEqual(history.listArchived(), [{ id: "archived", title: "Ore" }]);
    const order = ["mismatch", "thread", "plain"];
    assert.deepEqual(history.list().map(thread => thread.id), order);
    history.save({ ...plain, titleSubjects: [] });
    history.close();
    const db = new DatabaseSync(path);
    try {
      assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'conversations'").get(), undefined);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      db.exec("VACUUM");
    } finally { db.close(); }
    history = openHistory(path);
    assert.deepEqual(history.list().map(thread => thread.id), order);
    assert.equal(history.get("archived")?.archivedAt, 400);
    assert.equal(history.get("thread")?.turns[0].text, "Keep it.");
  } finally { history.close(); }
});

test("a failed migration leaves the legacy history intact and can be retried", () => {
  const path = databasePath();
  legacyDatabase(path, [sample, { ...sample, id: "invalid", titleSubjects: [{ name: "Ore", quality: 2.5 }] }]);
  assert.throws(() => openHistory(path), /INTEGER/);
  const db = new DatabaseSync(path);
  try {
    assert.equal(db.prepare("SELECT count(*) AS count FROM conversations").get()?.count, 2);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'threads'").get(), undefined);
    const original = db.prepare("SELECT data FROM conversations WHERE id = ?").get(sample.id);
    assert.deepEqual(JSON.parse(String(original?.data)), sample);
    db.prepare("UPDATE conversations SET data = ? WHERE id = 'invalid'").run(JSON.stringify({ ...sample, id: "invalid" }));
  } finally { db.close(); }
  const history = openHistory(path);
  try { assert.equal(history.list().length, 2); } finally { history.close(); }
});

test("failed saves roll back the thread, turns and title subjects together", () => {
  const history = openHistory(databasePath());
  try {
    history.save(sample);
    const before = history.get(sample.id);
    assert.throws(() => history.save({
      ...sample, title: "Changed", titleSubjects: [{ name: "Invalid", type: "item", quality: 2.5 }],
      turns: [{ ...sample.turns[0], text: "Changed" }],
    }), /INTEGER/);
    assert.deepEqual(history.get(sample.id), before);
    history.save({ ...sample, turns: [...sample.turns, { id: "followup", question: "More?", status: "answer", text: "Yes." }] });
    assert.deepEqual(history.get(sample.id)?.turns.map(turn => turn.id), ["request", "followup"]);
  } finally { history.close(); }
});

test("saving a session for another context never makes it resumable", () => {
  const history = openHistory(databasePath());
  try {
    const saved = history.save({ ...sample, session: { id: "wrong-session", context: "other" } });
    assert.equal(saved.session, undefined);
    assert.equal(history.get(sample.id)?.session, undefined);
  } finally { history.close(); }
});

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
    id: "conversation", title: "A 'quoted' title", titleSubjects: [{ name: "Ore", type: "item", quality: 2 }], updatedAt: 0, request,
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
    assert.deepEqual(history.list()[0].titleSubjects, [{ name: "Ore", type: "item", quality: 2 }]);
    history.save({ ...recovered, id: "plain", titleSubjects: [] });
    assert.deepEqual(history.list().find(summary => summary.id === "plain")?.titleSubjects, []);
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
    id: "conversation", title: request.question, titleSubjects: [], updatedAt: 1, request,
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
    const stored = history.get(conversation.id);
    assert.equal(stored?.turns[0].text, "The reply finished after archiving.");
    assert.equal(stored?.turns[1].status, "error");
    assert.equal(stored?.archivedAt, archivedAt);

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
