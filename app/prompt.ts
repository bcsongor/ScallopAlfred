import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WoWRequest } from "./protocol.ts";
import { snapshotNotes } from "./snapshots/index.ts";
import { topicPrompts } from "./topics/index.ts";

// The general rules, with placeholders for the day, the data notes and the topic paragraphs.
const template = readFileSync(join(import.meta.dirname, "prompt.md"), "utf8").trimEnd();

/** The full prompt for a request: the rules, then the request as JSON. */
export function buildPrompt(request: WoWRequest): string {
  // Replacer functions, so a `$` in the notes is never read as a replacement pattern.
  const rules = template
    .replace("{{date}}", () => new Date().toISOString().slice(0, 10))
    .replace("{{snapshots}}", () => snapshotNotes.join("\n"))
    .replace("{{topics}}", () => topicPrompts.join("\n"));
  return `${rules}\n\n${JSON.stringify(request)}`;
}
