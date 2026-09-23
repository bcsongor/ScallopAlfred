import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { openHistory, type Thread, type Turn } from "../app/history.ts";
import type { WoWRequest } from "../app/protocol.ts";

const databasePath = (): string => join(mkdtempSync(join(tmpdir(), "scallop-history-")), "threads.sqlite");

const sample: Thread = {
  id: "thread", title: "Ore", titleSubjects: [{ name: "Ore", type: "item", quality: 2 }], updatedAt: 100,
  request: {
    id: "request", context: "context", thread: "new", question: "Keep it?", subjects: [],
    player: { class: "Druid", spec: "Restoration", level: 90 }, gameVersion: "12.1.0",
  },
  session: { context: "context", id: "session" },
  turns: [{ id: "request", question: "Keep it?", status: "answer", text: "Keep it." }],
};

test("failed saves roll back the thread and its turns together", () => {
  const history = openHistory(databasePath());
  try {
    history.save(sample);
    const before = history.get(sample.id);
    assert.throws(() => history.save({
      ...sample, title: "Changed", turns: [{ ...sample.turns[0], status: "invalid" as Turn["status"] }],
    }), /CHECK constraint/);
    assert.deepEqual(history.get(sample.id), before);
    history.save({ ...sample, turns: [...sample.turns, { id: "followup", question: "More?", status: "answer", text: "Yes." }] });
    assert.deepEqual(history.get(sample.id)?.turns.map(turn => turn.id), ["request", "followup"]);
  } finally { history.close(); }
});

test("renaming drops the title subjects and outlasts saves of the thread's old copy", () => {
  const history = openHistory(databasePath());
  try {
    history.save(sample);
    const renamed = history.rename(sample.id, "Ore prices");
    assert.equal(renamed?.title, "Ore prices");
    assert.deepEqual(renamed?.titleSubjects, []);
    assert.equal(history.list()[0].title, "Ore prices");
    // A reply that started under the old name saves the stale thread and gets the stored title back.
    const saved = history.save({ ...sample, turns: [...sample.turns, { id: "later", question: "More?", status: "answer", text: "Yes." }] });
    assert.equal(saved.title, "Ore prices");
    assert.deepEqual(saved.titleSubjects, []);
    assert.equal(history.get(sample.id)?.title, "Ore prices");
    assert.equal(history.rename("missing", "Nothing"), undefined);
    history.archive(sample.id);
    assert.equal(history.rename(sample.id, "Archived"), undefined);
    assert.equal(history.get(sample.id)?.title, "Ore prices");
  } finally { history.close(); }
});

test("deleting hides an archived thread from every query but keeps its rows", () => {
  const path = databasePath();
  let history = openHistory(path);
  try {
    history.save(sample);
    assert.equal(history.delete(sample.id), false, "unarchived threads cannot be deleted");
    assert.equal(history.unarchive(sample.id), false, "only archived threads can be unarchived");
    history.archive(sample.id);
    assert.equal(history.unarchive(sample.id), true);
    assert.equal(history.list().length, 1);
    history.archive(sample.id);
    assert.equal(history.delete(sample.id), true);
    assert.equal(history.delete(sample.id), false);
    assert.equal(history.unarchive(sample.id), false, "deleted threads stay deleted");
    assert.equal(history.get(sample.id), undefined);
    assert.deepEqual(history.list(), []);
    assert.deepEqual(history.listArchived(), []);
    // A reply finishing after deletion saves without resurrecting the thread.
    history.save({ ...sample, turns: [{ ...sample.turns[0], text: "Late reply" }] });
    assert.equal(history.get(sample.id), undefined);
    history.close();
    history = openHistory(path);
    assert.deepEqual(history.listArchived(), []);
    const db = new DatabaseSync(path);
    try {
      assert.equal(db.prepare("SELECT count(*) AS turns FROM turns WHERE thread_id = ?").get(sample.id)?.turns, 1);
      assert.ok(db.prepare("SELECT deleted_at FROM threads WHERE id = ?").get(sample.id)?.deleted_at);
    } finally { db.close(); }
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
  const thread: Thread = {
    id: "thread", title: "A 'quoted' title", titleSubjects: [{ name: "Ore", type: "item", quality: 2 }], updatedAt: 0, request,
    session: { context: "context", id: "session-1" },
    turns: [{ id: "request", question: request.question, status: "thinking", text: "" }],
  };
  const saved = history.save(thread);
  assert.ok(saved.updatedAt > 0);
  assert.equal(thread.updatedAt, 0);
  history.close();
  history = openHistory(path);
  try {
    const recovered = history.get(thread.id);
    assert.ok(recovered);
    assert.equal(recovered.turns[0].status, "error");
    assert.match(recovered.turns[0].text, /closed before/);
    assert.deepEqual(recovered.request, request);
    assert.deepEqual(recovered.session, thread.session);
    history.save({ ...recovered, turns: [{ ...recovered.turns[0], status: "answer", text: "**Keep it**" }] });
    assert.equal(history.get(thread.id)?.turns.length, 1);
    assert.equal(history.get(thread.id)?.turns[0].text, "**Keep it**");
    assert.equal(history.list().length, 1);
    assert.equal(history.list()[0].question, request.question);
    assert.deepEqual(history.list()[0].titleSubjects, [{ name: "Ore", type: "item", quality: 2 }]);
    history.save({ ...recovered, id: "plain", titleSubjects: [] });
    assert.deepEqual(history.list().find(summary => summary.id === "plain")?.titleSubjects, []);
  } finally {
    history.close();
  }
});

test("archives retain messages through reply saves and restart, and list newest first", () => {
  const path = databasePath();
  const request: WoWRequest = {
    id: "request", context: "context", thread: "new", question: "Keep this chat?",
    subjects: [], player: { class: "Druid", spec: "Restoration", level: 90 }, gameVersion: "12.1.0",
  };
  const thread: Thread = {
    id: "thread", title: request.question, titleSubjects: [], updatedAt: 1, request,
    turns: [{ id: request.id, question: request.question, status: "answer", text: "Keep the messages." }],
  };
  let history = openHistory(path);
  try {
    history.save(thread);
    assert.equal(history.archive("missing"), false);
    assert.equal(history.archive(thread.id), true);
    assert.equal(history.archive(thread.id), false);
    const archivedAt = history.get(thread.id)?.archivedAt;
    assert.ok(archivedAt);
    assert.deepEqual(history.list(), []);
    assert.deepEqual(history.listArchived(), [{ id: thread.id, title: thread.title }]);

    const finished: Thread = { ...thread, turns: [{ ...thread.turns[0], text: "The reply finished after archiving." }] };
    assert.equal(history.save(finished).archivedAt, archivedAt);
    history.save({ ...finished, turns: [...finished.turns, { id: "pending", question: "Another question", status: "thinking", text: "" }] });
    history.close();
    history = openHistory(path);
    assert.deepEqual(history.list(), []);
    assert.equal(history.get(thread.id)?.archivedAt, archivedAt);
    const stored = history.get(thread.id);
    assert.equal(stored?.turns[0].text, "The reply finished after archiving.");
    assert.equal(stored?.turns[1].status, "error");
    assert.equal(stored?.archivedAt, archivedAt);

    for (let i = 0; i < 12; i++) history.save({ ...thread, id: `archive-${i}`, title: `Chat ${i}` });
    const creationOrder = Array.from({ length: 12 }, (_, i) => `archive-${11 - i}`);
    const oldest = history.get("archive-0");
    assert.ok(oldest);
    history.save(oldest);
    assert.deepEqual(history.list().map(chat => chat.id), creationOrder);
    // Archive newest first, so archive time and creation order disagree.
    for (const id of creationOrder) history.archive(id);
    const latest = history.listArchived();
    assert.deepEqual(latest.map(chat => chat.id), [...creationOrder, thread.id]);
    history.save(finished);
    assert.deepEqual(history.listArchived(), latest);
    history.close();
    history = openHistory(path);
    assert.deepEqual(history.listArchived(), latest);
  } finally { history.close(); }
});
