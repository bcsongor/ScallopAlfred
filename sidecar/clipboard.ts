import { setTimeout as delay } from "node:timers/promises";
import { parseRequest, type WoWRequest } from "./protocol.ts";

export type Clipboard = {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
};

export type WatchOptions = {
  signal: AbortSignal;
  /** While this returns true the clipboard is not read, so copies made meanwhile collapse to the latest. */
  paused: () => boolean;
  onInvalid: (error: Error) => void;
  interval?: number;
};

/**
 * Yields requests copied after watching starts, ignoring unrelated text. The clipboard is also not read
 * while the caller handles the previous request. Ends when the signal aborts.
 */
export async function* watchClipboard(clipboard: Clipboard, { signal, paused, onInvalid, interval = 250 }: WatchOptions): AsyncGenerator<WoWRequest, void> {
  let previous = await clipboard.readText().catch(() => "");
  try {
    while (true) {
      await delay(interval, undefined, { signal });
      if (paused()) continue;
      const text = await clipboard.readText().catch(() => previous);
      if (text === previous) continue;
      previous = text;
      try {
        const request = parseRequest(text);
        if (request) yield request;
      } catch (error) {
        onInvalid(error instanceof Error ? error : new Error(String(error)));
      }
    }
  } catch (error) {
    if (!signal.aborted) throw error;
  }
}
