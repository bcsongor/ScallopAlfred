import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { watchClipboard, type Clipboard } from "../app/clipboard.ts";
import type { ClipboardMessage } from "../app/protocol.ts";
import { baseRequest, copied as copiedRequest } from "./fixtures/protocol.ts";

const copied = (id: string): string => copiedRequest({ ...baseRequest, id, context: id });

const askedId = (message: ClipboardMessage | void): string | undefined => message?.kind === "ask" ? message.request.id : undefined;

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
  assert.equal(askedId((await copies.next()).value), "after");
  assert.equal(invalid.length, 1);
  controller.abort();
  assert.deepEqual(await copies.next(), { done: true, value: undefined });
});

test("passes the show command through while paused and leaves requests until resumed", async () => {
  let paused = true;
  const { clipboard, reads } = scriptedClipboard("", "SCALLOPALFRED:SHOW", copied("later"));
  const controller = new AbortController();
  const copies = watchClipboard(clipboard, { signal: controller.signal, paused: () => paused, onInvalid: () => {}, interval: 1 });
  assert.deepEqual((await copies.next()).value, { kind: "show" });
  const next = copies.next();
  await delay(30);
  assert.ok(reads() > 3, "keeps checking the clipboard while paused");
  paused = false;
  assert.equal(askedId((await next).value), "later");
  controller.abort();
  await copies.next();
});
