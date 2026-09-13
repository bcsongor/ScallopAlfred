const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { openHistory } = require("../sidecar/history.ts");

test("history persists sessions, replaces retries and recovers interrupted replies", () => {
  const path = join(mkdtempSync(join(tmpdir(), "scallop-history-")), "conversations.sqlite");
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
    assert.equal(history.get("' OR 1=1 --"), undefined);
    assert.equal(history.findContext("missing"), undefined);
  } finally {
    history.close();
  }
});

test("archives retain messages through migration, reply saves and restart, and list only the latest ten", () => {
  const path = join(mkdtempSync(join(tmpdir(), "scallop-history-")), "conversations.sqlite");
  const request = {
    v: 2, id: "request", context: "context", thread: "new", question: "Keep this chat?",
    subjects: [], player: { class: "Druid", spec: "Restoration", level: 90 }, gameVersion: "12.1.0",
  };
  const conversation = {
    id: "conversation", title: request.question, updatedAt: 1, request,
    turns: [{ id: request.id, question: request.question, status: "answer", text: "Keep the messages." }],
  };
  // Start with the schema used before chats could be hidden.
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE conversations (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL,
    data TEXT NOT NULL CHECK (json_valid(data))
  ) STRICT`);
  legacy.prepare("INSERT INTO conversations VALUES (?, ?, ?, ?)").run(
    conversation.id, conversation.title, conversation.updatedAt, JSON.stringify(conversation),
  );
  legacy.close();

  let history = openHistory(path);
  try {
    assert.deepEqual(history.get(conversation.id), { ...conversation, archivedAt: 0 });
    assert.equal(history.list().length, 1);
    history.archive("' OR 1=1 --");
    assert.equal(history.list().length, 1);
    history.archive(conversation.id);
    assert.deepEqual(history.list(), []);
    const archivedAt = history.get(conversation.id).archivedAt;
    assert.ok(archivedAt > 0);
    assert.deepEqual(history.listArchived(), [{ id: conversation.id, title: conversation.title }]);
    assert.equal(history.findContext(request.context), undefined);

    const stored = new DatabaseSync(path, { readOnly: true });
    try {
      const row = stored.prepare("SELECT data, archived_at FROM conversations WHERE id = ?").get(conversation.id);
      assert.deepEqual(JSON.parse(row.data), conversation);
      assert.equal(row.archived_at, archivedAt);
    } finally { stored.close(); }

    conversation.turns[0].text = "The reply finished after archiving.";
    history.save(conversation);
    assert.deepEqual(history.list(), []);
    conversation.turns.push({ id: "pending", question: "Another question", status: "thinking", text: "" });
    history.save(conversation);
    history.close();
    history = openHistory(path);
    assert.deepEqual(history.list(), []);
    assert.equal(history.get(conversation.id).archivedAt, archivedAt);
    assert.equal(history.get(conversation.id).turns[0].text, conversation.turns[0].text);
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
      const chat = { ...conversation, id: `archive-${i}`, title: `Chat ${i}` };
      history.save(chat);
    }
    const creationOrder = Array.from({ length: 12 }, (_, i) => `archive-${11 - i}`);
    history.save(history.get("archive-0"));
    assert.deepEqual(history.list().map(chat => chat.id), creationOrder);
    // Archive newest first, so archive time and creation order disagree.
    for (const id of creationOrder) history.archive(id);
    const latest = history.listArchived();
    assert.deepEqual(latest.map(chat => chat.id), creationOrder.slice(0, 10));
    // Neither another archive click nor a late reply changes the archive order.
    history.archive(conversation.id);
    history.save(conversation);
    assert.deepEqual(history.listArchived(), latest);
    assert.ok(history.get("archive-0"));
    assert.deepEqual(history.list(), []);
    history.close();
    history = openHistory(path);
    assert.deepEqual(history.listArchived(), latest);
  } finally { history.close(); }
});

test("previously hidden chats migrate into readable archives", () => {
  const path = join(mkdtempSync(join(tmpdir(), "scallop-history-")), "conversations.sqlite");
  const request = {
    v: 2, id: "old", context: "old-context", thread: "new", question: "Old question",
    subjects: [], player: { class: "Druid", spec: "Restoration", level: 90 }, gameVersion: "12.1.0",
  };
  const conversation = {
    id: "old-chat", title: "Old chat", updatedAt: 1234, request,
    turns: [{ id: request.id, question: request.question, status: "answer", text: "Old answer" }],
  };
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE conversations (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL,
    data TEXT NOT NULL CHECK (json_valid(data)), hidden INTEGER NOT NULL DEFAULT 0
  ) STRICT`);
  legacy.prepare("INSERT INTO conversations VALUES (?, ?, ?, ?, 1)").run(
    conversation.id, conversation.title, conversation.updatedAt, JSON.stringify(conversation),
  );
  legacy.close();
  const history = openHistory(path);
  try {
    assert.deepEqual(history.list(), []);
    assert.deepEqual(history.listArchived(), [{ id: conversation.id, title: conversation.title }]);
    assert.deepEqual(history.get(conversation.id), { ...conversation, archivedAt: 1234 });
    assert.equal(history.findContext(request.context), undefined);
  } finally { history.close(); }
});
