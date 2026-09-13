const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { openHistory } = require("../sidecar/history.ts");

const databasePath = () => join(mkdtempSync(join(tmpdir(), "scallop-history-")), "conversations.sqlite");

test("history persists sessions, replaces retries and recovers interrupted replies", () => {
  const path = databasePath();
  let history = openHistory(path);
  const request = {
    v: 2, id: "request", context: "context", thread: "new", question: "What's this for?",
    subjects: [{ type: "item", name: "Ore", link: "item:123", tooltip: [], tsm: { capturedAt: 1800000000, minBuyoutCopper: 120000 } }],
    player: { class: "Druid", spec: "Restoration", level: 90 }, gameVersion: "12.1.0",
    professions: { capturedAt: 1800000000, entries: [{ name: "Alchemy", skillLineID: 171, skillLevel: 75 }] },
    category: "gear", equipped: [{ type: "item", name: "Ring", link: "item:11", tooltip: [], slot: 11 }],
    talents: { capturedAt: 1800000000, selected: [{ spellID: 774, name: "Rejuvenation", rank: 1 }] },
  };
  const conversation = {
    id: "conversation", title: "A 'quoted' title", updatedAt: 0, request,
    session: { context: "context", id: "session-1" },
    turns: [{ id: "request", question: request.question, status: "thinking", text: "" }],
  };
  history.save(conversation);
  history.close();
  history = openHistory(path);
  try {
    const saved = history.get(conversation.id);
    assert.equal(saved.turns[0].status, "error");
    assert.match(saved.turns[0].text, /closed before/);
    assert.deepEqual(saved.request, request);
    assert.deepEqual(saved.session, conversation.session);
    saved.turns[0].status = "answer";
    saved.turns[0].text = "**Keep it**";
    history.save(saved);
    assert.equal(history.get(saved.id).turns.length, 1);
    assert.equal(history.findContext("context").turns[0].text, "**Keep it**");
    assert.equal(history.list().length, 1);
    assert.equal(history.list()[0].question, request.question);
    assert.equal(history.findContext("missing"), undefined);
  } finally {
    history.close();
  }
});

test("archives retain messages through reply saves and restart, and list only the latest ten", () => {
  const path = databasePath();
  const request = {
    v: 2, id: "request", context: "context", thread: "new", question: "Keep this chat?",
    subjects: [], player: { class: "Druid", spec: "Restoration", level: 90 }, gameVersion: "12.1.0",
  };
  const conversation = {
    id: "conversation", title: request.question, updatedAt: 1, request,
    turns: [{ id: request.id, question: request.question, status: "answer", text: "Keep the messages." }],
  };
  let history = openHistory(path);
  try {
    history.save(conversation);
    assert.equal(history.list().length, 1);
    assert.equal(history.archive("missing"), undefined);
    const archivedAt = history.archive(conversation.id);
    assert.ok(archivedAt > 0);
    assert.equal(history.archive(conversation.id), undefined);
    assert.deepEqual(history.list(), []);
    assert.equal(history.get(conversation.id).archivedAt, archivedAt);
    assert.deepEqual(history.listArchived(), [{ id: conversation.id, title: conversation.title }]);
    assert.equal(history.findContext(request.context), undefined);

    conversation.turns[0].text = "The reply finished after archiving.";
    history.save(conversation);
    assert.deepEqual(history.list(), []);
    conversation.turns.push({ id: "pending", question: "Another question", status: "thinking", text: "" });
    history.save(conversation);
    history.close();
    history = openHistory(path);
    assert.deepEqual(history.list(), []);
    assert.equal(history.get(conversation.id).archivedAt, archivedAt);
    assert.equal(history.findContext(request.context), undefined);
    const recovered = new DatabaseSync(path, { readOnly: true });
    try {
      const row = recovered.prepare("SELECT data, archived_at FROM conversations WHERE id = ?").get(conversation.id);
      const saved = JSON.parse(row.data);
      assert.equal(saved.turns[0].text, "The reply finished after archiving.");
      assert.equal(saved.turns[1].status, "error");
      assert.equal(row.archived_at, archivedAt);
    } finally { recovered.close(); }

    for (let i = 0; i < 12; i++) {
      history.save({ ...conversation, id: `archive-${i}`, title: `Chat ${i}` });
    }
    const creationOrder = Array.from({ length: 12 }, (_, i) => `archive-${11 - i}`);
    history.save(history.get("archive-0"));
    assert.deepEqual(history.list().map(chat => chat.id), creationOrder);
    // Archive newest first, so archive time and creation order disagree.
    for (const id of creationOrder) history.archive(id);
    const latest = history.listArchived();
    assert.deepEqual(latest.map(chat => chat.id), creationOrder.slice(0, 10));
    // A late reply does not change the archive order.
    history.save(conversation);
    assert.deepEqual(history.listArchived(), latest);
    assert.ok(history.get("archive-0"));
    history.close();
    history = openHistory(path);
    assert.deepEqual(history.listArchived(), latest);
  } finally { history.close(); }
});
