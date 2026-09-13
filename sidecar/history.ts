import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { conversationTurnSchema, requestSchema } from "./protocol.ts";

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

export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationSummary = z.infer<typeof summarySchema>;
const archivedSummarySchema = conversationSchema.pick({ id: true, title: true });
export type ArchivedConversationSummary = z.infer<typeof archivedSummarySchema>;

/** Each snapshot is one atomic write, including the session needed for follow-ups. */
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
  const columns = db.prepare("PRAGMA table_info(conversations)").all();
  if (!columns.some(column => column.name === "archived_at")) {
    if (columns.some(column => column.name === "hidden")) {
      db.exec(`ALTER TABLE conversations RENAME COLUMN hidden TO archived_at;
        UPDATE conversations SET archived_at = updated_at WHERE archived_at = 1`);
    } else db.exec("ALTER TABLE conversations ADD COLUMN archived_at INTEGER NOT NULL DEFAULT 0");
  }
  // Reply completion and recovery must preserve when a chat was archived.
  const upsert = db.prepare(`INSERT INTO conversations (id, title, updated_at, data) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, updated_at=excluded.updated_at, data=excluded.data`);
  const select = db.prepare("SELECT data, archived_at AS archivedAt FROM conversations WHERE id = ?");
  const archive = db.prepare("UPDATE conversations SET archived_at = ? WHERE id = ? AND archived_at = 0");
  // Rows are inserted when threads are created; updates and archiving keep that order.
  const summaries = db.prepare(`SELECT id, title, updated_at AS updatedAt,
    json_extract(data, '$.turns[0].question') AS question FROM conversations WHERE archived_at = 0 ORDER BY rowid DESC`);
  const archivedSummaries = db.prepare(`SELECT id, title FROM conversations
    WHERE archived_at > 0 ORDER BY rowid DESC LIMIT 10`);
  const context = db.prepare(`SELECT data, archived_at AS archivedAt FROM conversations
    WHERE archived_at = 0 AND json_extract(data, '$.request.context') = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1`);

  function read(row: Record<string, unknown> | undefined): Conversation | undefined {
    return row ? conversationSchema.parse({ ...JSON.parse(z.string().parse(row.data)), archivedAt: row.archivedAt }) : undefined;
  }

  function save(conversation: Conversation): void {
    conversation.updatedAt = Date.now();
    upsert.run(conversation.id, conversation.title, conversation.updatedAt, JSON.stringify(conversation));
  }

  // A process exit must not leave an old conversation displaying "Thinking…" forever.
  for (const row of db.prepare(`SELECT data, archived_at AS archivedAt FROM conversations WHERE EXISTS (
    SELECT 1 FROM json_each(data, '$.turns') WHERE json_extract(value, '$.status') = 'thinking'
  )`).all()) {
    const conversation = read(row)!;
    for (const turn of conversation.turns) {
      if (turn.status === "thinking") {
        turn.status = "error";
        turn.text = "Scallop Alfred closed before this reply finished. Retry from the tray menu.";
      }
    }
    save(conversation);
  }

  return {
    save,
    archive: (id: string): void => { archive.run(Date.now(), id); },
    get: (id: string) => read(select.get(id)),
    findContext: (id: string) => read(context.get(id)),
    list: (): ConversationSummary[] => summaries.all().map(row => summarySchema.parse(row)),
    listArchived: (): ArchivedConversationSummary[] => archivedSummaries.all().map(row => archivedSummarySchema.parse(row)),
    close: () => db.close(),
  };
}
