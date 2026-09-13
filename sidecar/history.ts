import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { requestSchema } from "./protocol.ts";

const conversationTurnSchema = z.object({
  id: z.string(),
  question: z.string(),
  status: z.enum(["thinking", "answer", "error"]),
  text: z.string(),
});

const conversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.number(),
  archivedAt: z.number().optional(),
  request: requestSchema,
  session: z.object({ context: z.string(), id: z.string() }).optional(),
  turns: z.array(conversationTurnSchema).min(1),
});

const summarySchema = conversationSchema.pick({ id: true, title: true, updatedAt: true })
  .extend({ question: z.string() });
const archivedSummarySchema = conversationSchema.pick({ id: true, title: true });

export type ConversationTurn = z.infer<typeof conversationTurnSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationSummary = z.infer<typeof summarySchema>;
export type ArchivedConversationSummary = z.infer<typeof archivedSummarySchema>;

export function openHistory(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL,
      data TEXT NOT NULL CHECK (json_valid(data)), archived_at INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    CREATE INDEX IF NOT EXISTS conversations_updated ON conversations(updated_at DESC);
  `);
  // Saves never touch archived_at, so a reply that finishes after archiving leaves the thread archived.
  const upsert = db.prepare(`INSERT INTO conversations (id, title, updated_at, data) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, updated_at=excluded.updated_at, data=excluded.data
    RETURNING archived_at AS archivedAt`);
  const select = db.prepare("SELECT data, archived_at AS archivedAt FROM conversations WHERE id = ?");
  const archive = db.prepare("UPDATE conversations SET archived_at = ? WHERE id = ? AND archived_at = 0");
  // Row IDs follow thread creation, so replies and archiving never reorder the lists.
  const summaries = db.prepare(`SELECT id, title, updated_at AS updatedAt,
    json_extract(data, '$.turns[0].question') AS question FROM conversations WHERE archived_at = 0 ORDER BY rowid DESC`);
  const archivedSummaries = db.prepare(`SELECT id, title FROM conversations
    WHERE archived_at > 0 ORDER BY rowid DESC LIMIT 10`);
  const context = db.prepare(`SELECT data, archived_at AS archivedAt FROM conversations
    WHERE archived_at = 0 AND json_extract(data, '$.request.context') = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1`);
  const interrupted = db.prepare(`SELECT data, archived_at AS archivedAt FROM conversations WHERE EXISTS (
    SELECT 1 FROM json_each(data, '$.turns') WHERE json_extract(value, '$.status') = 'thinking'
  )`);

  function parse(row: Record<string, unknown>): Conversation {
    return conversationSchema.parse({ ...JSON.parse(z.string().parse(row.data)), archivedAt: row.archivedAt });
  }

  function save(conversation: Conversation): Conversation {
    const stored = { ...conversation, updatedAt: Date.now() };
    const row = upsert.get(stored.id, stored.title, stored.updatedAt, JSON.stringify(stored));
    return { ...stored, archivedAt: z.number().parse(row?.archivedAt) };
  }

  // Replies still thinking at startup were cut off when the app last closed.
  for (const conversation of interrupted.all().map(parse)) {
    save({
      ...conversation,
      turns: conversation.turns.map((turn): ConversationTurn => turn.status === "thinking"
        ? { ...turn, status: "error", text: "Scallop Alfred closed before this reply finished. Retry from the tray menu." }
        : turn),
    });
  }

  return {
    save,
    /** Returns false when the thread is missing or already archived. */
    archive: (id: string): boolean => archive.run(Date.now(), id).changes > 0,
    get: (id: string): Conversation | undefined => {
      const row = select.get(id);
      return row && parse(row);
    },
    findContext: (id: string): Conversation | undefined => {
      const row = context.get(id);
      return row && parse(row);
    },
    list: (): ConversationSummary[] => summaries.all().map(row => summarySchema.parse(row)),
    listArchived: (): ArchivedConversationSummary[] => archivedSummaries.all().map(row => archivedSummarySchema.parse(row)),
    close: () => db.close(),
  };
}
