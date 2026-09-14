import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { watchClipboard, type Clipboard } from "../app/clipboard.ts";

const copied = (id: string): string => `SCALLOPALFRED:${JSON.stringify({
  id, context: id, thread: "new", question: "Hi", subjects: [],
  player: { class: "Druid", spec: "Restoration", level: 90 }, gameVersion: "12.1.0",
})}`;

/** Returns each value in turn from successive reads, then keeps returning the last. */
function scriptedClipboard(...values: string[]) {
  let reads = 0;
  const clipboard: Clipboard = {
    readText: async () => values[Math.min(reads++, values.length - 1)],
    writeText: async () => {},
  };
  return { clipboard, reads: () => reads };
}

test("yields requests copied after watching starts and reports invalid ones", async () => {
  const { clipboard } = scriptedClipboard(copied("before"), copied("before"), "unrelated", "SCALLOPALFRED:{broken", copied("after"));
  const controller = new AbortController();
  const invalid: string[] = [];
  const copies = watchClipboard(clipboard, { signal: controller.signal, paused: () => false, onInvalid: error => invalid.push(error.message), interval: 1 });
  assert.equal((await copies.next()).value?.id, "after");
  assert.equal(invalid.length, 1);
  controller.abort();
  assert.deepEqual(await copies.next(), { done: true, value: undefined });
});

test("does not read the clipboard while paused", async () => {
  let paused = true;
  const { clipboard, reads } = scriptedClipboard("", copied("later"));
  const controller = new AbortController();
  const copies = watchClipboard(clipboard, { signal: controller.signal, paused: () => paused, onInvalid: () => {}, interval: 1 });
  const next = copies.next();
  await delay(30);
  assert.equal(reads(), 1);
  paused = false;
  assert.equal((await next).value?.id, "later");
  controller.abort();
  await copies.next();
});
