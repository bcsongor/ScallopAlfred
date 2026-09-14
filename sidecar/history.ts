import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { z } from "zod";
import { requestSchema } from "./protocol.ts";

const conversationTurnSchema = z.object({
  id: z.string(),
  question: z.string(),
  status: z.enum(["thinking", "answer", "error"]),
  text: z.string(),
});

const titleSubjectSchema = z.object({ name: z.string(), type: z.string().optional(), quality: z.number().int().optional() });

const conversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  // The subjects the thread was named after, so titles can show items in their quality colour.
  titleSubjects: z.array(titleSubjectSchema),
  updatedAt: z.number(),
  archivedAt: z.number().optional(),
  request: requestSchema,
  session: z.object({ context: z.string(), id: z.string() }).optional(),
  turns: z.array(conversationTurnSchema).min(1),
});

const summarySchema = conversationSchema.pick({ id: true, title: true, titleSubjects: true, updatedAt: true })
  .extend({ question: z.string() });
const archivedSummarySchema = conversationSchema.pick({ id: true, title: true });

export type TitleSubject = z.infer<typeof titleSubjectSchema>;
export type ConversationTurn = z.infer<typeof conversationTurnSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationSummary = z.infer<typeof summarySchema>;
export type ArchivedConversationSummary = z.infer<typeof archivedSummarySchema>;

type Row = Record<string, SQLOutputValue>;

// Times are Unix milliseconds.
const schema = `
  CREATE TABLE IF NOT EXISTS threads (
    -- Creation order. Unlike an implicit rowid, it survives VACUUM, so replies and archiving never reorder lists.
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    session_id TEXT,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER,
    -- The latest request with its game data, which retries and follow-ups send again.
    request TEXT NOT NULL CHECK (json_valid(request)),
    context TEXT NOT NULL AS (request ->> '$.context')
  ) STRICT;
  CREATE INDEX IF NOT EXISTS threads_context ON threads(context);

  CREATE TABLE IF NOT EXISTS turns (
    thread_id TEXT NOT NULL REFERENCES threads(id),
    position INTEGER NOT NULL,
    request_id TEXT NOT NULL,
    question TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('thinking', 'answer', 'error')),
    text TEXT NOT NULL,
    PRIMARY KEY (thread_id, position)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS turns_thinking ON turns(thread_id) WHERE status = 'thinking';

  CREATE TABLE IF NOT EXISTS title_subjects (
    thread_id TEXT NOT NULL REFERENCES threads(id),
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT,
    quality INTEGER,
    PRIMARY KEY (thread_id, position)
  ) STRICT, WITHOUT ROWID;
`;

// Pre-release builds kept each thread as one JSON row in conversations.sqlite.
const fromConversations = `
  INSERT INTO threads (seq, id, title, session_id, updated_at, archived_at, request)
    SELECT rowid, id, title,
      CASE WHEN data ->> '$.session.context' = data ->> '$.request.context' THEN data ->> '$.session.id' END,
      updated_at, nullif(archived_at, 0), data -> '$.request'
    FROM conversations;
  INSERT INTO turns (thread_id, position, request_id, question, status, text)
    SELECT conversations.id, turn.key,
      turn.value ->> '$.id', turn.value ->> '$.question', turn.value ->> '$.status', turn.value ->> '$.text'
    FROM conversations, json_each(data, '$.turns') AS turn;
  INSERT INTO title_subjects (thread_id, position, name, type, quality)
    SELECT conversations.id, subject.key, subject.value ->> '$.name', subject.value ->> '$.type', subject.value ->> '$.quality'
    FROM conversations, json_each(data, '$.titleSubjects') AS subject;
  DROP TABLE conversations;
`;

/** Runs `work` in a transaction, rolling back if it throws. */
function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function openHistory(path: string) {
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON");
    transaction(db, () => {
      db.exec(schema);
      if (db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'conversations'").get()) {
        db.exec(fromConversations);
      }
    });
  } catch (error) {
    db.close();
    throw error;
  }

  // Saves never touch archived_at, so a reply that finishes after archiving leaves the thread archived.
  const upsertThread = db.prepare(`INSERT INTO threads (id, title, session_id, updated_at, request) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET title = excluded.title, session_id = excluded.session_id,
      updated_at = excluded.updated_at, request = excluded.request
    RETURNING archived_at AS archivedAt`);
  const deleteTurns = db.prepare("DELETE FROM turns WHERE thread_id = ?");
  const insertTurn = db.prepare("INSERT INTO turns (thread_id, position, request_id, question, status, text) VALUES (?, ?, ?, ?, ?, ?)");
  const deleteTitleSubjects = db.prepare("DELETE FROM title_subjects WHERE thread_id = ?");
  const insertTitleSubject = db.prepare("INSERT INTO title_subjects (thread_id, position, name, type, quality) VALUES (?, ?, ?, ?, ?)");
  const archive = db.prepare("UPDATE threads SET archived_at = ? WHERE id = ? AND archived_at IS NULL");
  const threadColumns = "id, title, updated_at AS updatedAt, archived_at AS archivedAt, session_id AS sessionId, context, request";
  const selectThread = db.prepare(`SELECT ${threadColumns} FROM threads WHERE id = ?`);
  const selectContext = db.prepare(`SELECT ${threadColumns} FROM threads
    WHERE context = ? AND archived_at IS NULL ORDER BY updated_at DESC, seq DESC LIMIT 1`);
  const selectTurns = db.prepare("SELECT request_id AS id, question, status, text FROM turns WHERE thread_id = ? ORDER BY position");
  const selectTitleSubjects = db.prepare("SELECT name, type, quality FROM title_subjects WHERE thread_id = ? ORDER BY position");
  const summaries = db.prepare(`SELECT id, title, updated_at AS updatedAt,
    (SELECT question FROM turns WHERE thread_id = threads.id AND position = 0) AS question
    FROM threads WHERE archived_at IS NULL ORDER BY seq DESC`);
  const archivedSummaries = db.prepare("SELECT id, title FROM threads WHERE archived_at IS NOT NULL ORDER BY seq DESC LIMIT 6");

  // Replies still thinking at startup were cut off when the app last closed.
  db.prepare("UPDATE turns SET status = 'error', text = ? WHERE status = 'thinking'")
    .run("Scallop Alfred closed before this reply finished. Retry from the tray menu.");

  const titleSubjectsOf = (threadId: string) => selectTitleSubjects.all(threadId)
    .map(({ name, type, quality }) => ({
      name,
      ...(type === null ? {} : { type }),
      ...(quality === null ? {} : { quality }),
    }));

  function read(row: Row | undefined): Conversation | undefined {
    if (!row) return undefined;
    const { archivedAt, sessionId, context, request, ...thread } = row;
    const id = z.string().parse(thread.id);
    return conversationSchema.parse({
      ...thread,
      ...(archivedAt === null ? {} : { archivedAt }),
      ...(sessionId === null ? {} : { session: { context, id: sessionId } }),
      request: JSON.parse(z.string().parse(request)),
      titleSubjects: titleSubjectsOf(id),
      turns: selectTurns.all(id),
    });
  }

  function save(conversation: Conversation): Conversation {
    const { id, title, titleSubjects, request, session, turns } = conversation;
    const updatedAt = Date.now();
    // A session only resumes requests with its context, and every request in a thread shares one.
    const sessionId = session?.context === request.context ? session.id : null;
    const archivedAt = transaction(db, () => {
      const row = upsertThread.get(id, title, sessionId, updatedAt, JSON.stringify(request));
      deleteTurns.run(id);
      turns.forEach((turn, position) => {
        insertTurn.run(id, position, turn.id, turn.question, turn.status, turn.text);
      });
      deleteTitleSubjects.run(id);
      titleSubjects.forEach(({ name, type, quality }, position) => {
        insertTitleSubject.run(id, position, name, type ?? null, quality ?? null);
      });
      return z.number().nullable().parse(row?.archivedAt);
    });
    return {
      ...conversation,
      session: sessionId === null ? undefined : session,
      updatedAt,
      archivedAt: archivedAt ?? undefined,
    };
  }

  return {
    save,
    /** Returns false when the thread is missing or already archived. */
    archive: (id: string): boolean => archive.run(Date.now(), id).changes > 0,
    get: (id: string): Conversation | undefined => read(selectThread.get(id)),
    findContext: (context: string): Conversation | undefined => read(selectContext.get(context)),
    list: (): ConversationSummary[] => summaries.all().map(row => {
      const id = z.string().parse(row.id);
      return summarySchema.parse({ ...row, titleSubjects: titleSubjectsOf(id) });
    }),
    listArchived: (): ArchivedConversationSummary[] => archivedSummaries.all().map(row => archivedSummarySchema.parse(row)),
    close: () => db.close(),
  };
}
