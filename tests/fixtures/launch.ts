import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { _electron, type ElectronApplication, type Page } from "playwright";
import type { Config } from "../../app/config.ts";
import type { WoWRequest } from "../../app/protocol.ts";
import type { CodexCall } from "./harness.ts";

type WindowState = { visible: boolean; focusable: boolean; topmost: boolean; minimized: boolean };

let sequence = 0;

/** A valid addon request with a fresh ID and context. */
export function request(question: string, fields: Partial<WoWRequest> = {}): WoWRequest {
  sequence++;
  return {
    id: `request-${sequence}`, context: `context-${sequence}`, thread: "new", question, subjects: [],
    player: { class: "Druid", spec: "Restoration", level: 90 }, gameVersion: "12.1.0", ...fields,
  };
}

/** Polls until `check` returns a truthy value, for state that changes over IPC. */
export async function until<T>(check: () => T | Promise<T>, message = "Timed out waiting for the desktop app"): Promise<T> {
  for (let attempt = 0; attempt < 150; attempt++) {
    const value = await check();
    if (value) return value;
    await delay(20);
  }
  assert.fail(message);
}

/**
 * Launches the real app with fake ports from `desktop.ts` and its own data directory, so tests never touch
 * the system clipboard or a model. `restart` keeps the data directory.
 */
export async function launch(t: TestContext, settings?: Partial<Config>) {
  const data = await mkdtemp(join(tmpdir(), "scallop-alfred-test-"));
  if (settings) await writeFile(join(data, "settings.json"), JSON.stringify(settings));
  const inherited = Object.entries(process.env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE");
  const env = { ...Object.fromEntries(inherited), SCALLOPALFRED_TEST_DATA: data };
  const open = async (): Promise<{ app: ElectronApplication; page: Page }> => {
    const app = await _electron.launch({ args: ["--experimental-strip-types", join(import.meta.dirname, "desktop.ts")], env });
    return { app, page: await app.firstWindow() };
  };
  let session = await open();
  t.after(() => session.app.close());

  return {
    get app(): ElectronApplication { return session.app; },
    get page(): Page { return session.page; },
    async restart(): Promise<void> {
      await session.app.close();
      session = await open();
    },
    /** Copies a request the way the addon's copy box does. */
    copy: (value: WoWRequest) => session.app.evaluate((_electron, text) => { harness.clipboard = text; }, `SCALLOPALFRED:${JSON.stringify(value)}`),
    clipboard: () => session.app.evaluate(() => harness.clipboard),
    codexCalls: (): Promise<CodexCall[]> => session.app.evaluate(() => harness.codexCalls),
    iconRequests: () => session.app.evaluate(() => harness.iconRequests),
    openedUrls: () => session.app.evaluate(() => harness.openedUrls),
    skipsTaskbar: () => session.app.evaluate(() => harness.skipsTaskbar),
    clickTray: (...labels: string[]) => session.app.evaluate((_electron, labels) => { harness.trayItem(labels).click?.(); }, labels),
    trayItem: (...labels: string[]) => session.app.evaluate((_electron, labels) => {
      const { enabled, checked } = harness.trayItem(labels);
      return { enabled, checked };
    }, labels),
    clickTrayIcon: () => session.app.evaluate(() => harness.clickTrayIcon()),
    window: (): Promise<WindowState> => session.app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return { visible: window.isVisible(), focusable: window.isFocusable(), topmost: window.isAlwaysOnTop(), minimized: window.isMinimized() };
    }),
    /** Runs `action` and returns the window operations it caused. */
    async windowOperations(action: () => Promise<unknown>): Promise<string[]> {
      await session.app.evaluate(() => { harness.windowOperations = []; });
      await action();
      return session.app.evaluate(() => harness.windowOperations);
    },
    /** Sends an IPC message as if the overlay had sent it, bypassing the preload and its types. */
    emit: (channel: string, message: unknown) => session.app.evaluate(({ BrowserWindow }, { channel, message }) => {
      BrowserWindow.getAllWindows()[0].webContents.ipc.emit(channel, {}, message);
    }, { channel, message }),
    settings: (): Promise<Partial<Config>> => readFile(join(data, "settings.json"), "utf8").then(text => JSON.parse(text)).catch(() => ({})),
    waitForStatus: (status: string) => session.page.waitForFunction(expected => document.body.dataset.status === expected, status),
    waitForAnswer: (text: string) => session.page.waitForFunction(
      expected => document.querySelector(".turn:last-child .response")?.textContent?.trim() === expected, text,
    ),
  };
}
