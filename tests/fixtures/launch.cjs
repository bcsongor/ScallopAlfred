const assert = require("node:assert/strict");
const { mkdtemp, readFile, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { _electron } = require("playwright");

let sequence = 0;

/** A valid addon request with a fresh ID and context. */
function request(question, fields = {}) {
  sequence++;
  return {
    v: 2, id: `request-${sequence}`, context: `context-${sequence}`, thread: "new", question, subjects: [],
    player: { class: "Druid", spec: "Restoration", level: 90 }, gameVersion: "12.1.0", ...fields,
  };
}

/** Polls until `check` returns a truthy value, for state that changes over IPC. */
async function until(check, message = "Timed out waiting for the desktop app") {
  for (let attempt = 0; attempt < 150; attempt++) {
    const value = await check();
    if (value) return value;
    await delay(20);
  }
  assert.fail(message);
}

/**
 * Launches the desktop app with its own data directory, an in-memory clipboard and a fake Codex,
 * so tests never touch the system clipboard or a model. `restart` keeps the data directory.
 */
async function launch(t, settings) {
  const data = await mkdtemp(join(tmpdir(), "scallop-alfred-test-"));
  if (settings) await writeFile(join(data, "settings.json"), JSON.stringify(settings));
  const env = { ...process.env, SCALLOPALFRED_TEST_DATA: data };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = {
    data,
    desktop: undefined,
    page: undefined,
    async restart() {
      await app.desktop?.close();
      app.desktop = await _electron.launch({ args: ["--experimental-strip-types", join(__dirname, "desktop.cjs")], env });
      app.page = await app.desktop.firstWindow();
    },
    /** Copies a request the way the addon's copy box does. */
    copy: value => app.desktop.evaluate(({ clipboard }, text) => clipboard.writeText(text), "SCALLOPALFRED:" + JSON.stringify(value)),
    clipboard: () => app.desktop.evaluate(({ clipboard }) => clipboard.readText()),
    /** Requests and arguments received by the fake Codex, oldest first. */
    records: async () => (await readFile(join(data, "requests.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line)),
    clickTray: (...labels) => app.desktop.evaluate((_, labels) => {
      let item = { submenu: global.testMenu };
      for (const label of labels) item = item.submenu.items.find(entry => entry.label === label);
      item.click();
    }, labels),
    trayItem: (...labels) => app.desktop.evaluate((_, labels) => {
      let item = { submenu: global.testMenu };
      for (const label of labels) item = item.submenu.items.find(entry => entry.label === label);
      return { enabled: item.enabled, checked: item.checked };
    }, labels),
    window: () => app.desktop.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return { visible: window.isVisible(), focusable: window.isFocusable(), topmost: window.isAlwaysOnTop(), minimized: window.isMinimized() };
    }),
    /** Runs `action` and returns the native window operations it caused. */
    async windowOperations(action) {
      await app.desktop.evaluate(() => { global.testWindowOperations = []; });
      await action();
      return app.desktop.evaluate(() => global.testWindowOperations);
    },
    ignoresMouse: () => app.desktop.evaluate(() => global.testIgnoreMouseEvents),
    /** Sends an IPC message as if the overlay had sent it, bypassing the preload. */
    emit: (channel, message) => app.desktop.evaluate(({ BrowserWindow }, [channel, message]) => {
      BrowserWindow.getAllWindows()[0].webContents.ipc.emit(channel, {}, message);
    }, [channel, message]),
    waitForStatus: status => app.page.waitForFunction(expected => document.body.dataset.status === expected, status),
    waitForAnswer: text => app.page.waitForFunction(
      expected => document.querySelector(".turn:last-child .response")?.textContent.trim() === expected, text,
    ),
  };
  await app.restart();
  t.after(() => app.desktop.close());
  return app;
}

module.exports = { launch, request, until };
