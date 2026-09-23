import { setTimeout as delay } from "node:timers/promises";
import { isShowCommand, parseClipboard, type ClipboardMessage } from "./protocol.ts";

export type Clipboard = {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
};

type WatchOptions = {
  signal: AbortSignal;
  /** While this returns true requests are left on the clipboard, so copies made meanwhile collapse to the latest. */
  paused: () => boolean;
  onInvalid: (error: unknown) => void;
  interval?: number;
};

/**
 * Yields messages copied after watching starts, ignoring unrelated text. Requests wait while paused and only
 * the latest is seen afterwards; the show command comes through straight away. Ends when the signal aborts.
 */
export async function* watchClipboard(clipboard: Clipboard, { signal, paused, onInvalid, interval = 250 }: WatchOptions): AsyncGenerator<ClipboardMessage, void> {
  let previous = await clipboard.readText().catch(() => "");
  try {
    while (true) {
      await delay(interval, undefined, { signal });
      const text = await clipboard.readText().catch(() => previous);
      if (text === previous) continue;
      if (paused() && !isShowCommand(text)) continue;
      previous = text;
      try {
        const message = parseClipboard(text);
        if (message) yield message;
      } catch (error) {
        onInvalid(error);
      }
    }
  } catch (error) {
    if (!signal.aborted) throw error;
  }
}
