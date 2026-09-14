// Electron entry point for desktop tests: the real app with fake ports.
import { app, nativeImage } from "electron";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { startApp } from "../../app/app.ts";
import type { Ask } from "../../app/codex.ts";
import { createFavicons } from "../../app/favicons.ts";
import type { SystemTray, TrayItem } from "../../app/tray.ts";

const data = process.env.SCALLOPALFRED_TEST_DATA;
if (!data) throw new Error("Set SCALLOPALFRED_TEST_DATA to a temporary directory.");
app.setPath("userData", data);
const settingsPath = join(data, "settings.json");
if (!existsSync(settingsPath)) writeFileSync(settingsPath, JSON.stringify({ height: 360 }));

const scallop = nativeImage.createFromPath(join(import.meta.dirname, "..", "..", "assets", "scallop.jpg")).toPNG();
let menu: TrayItem[] = [];
let trayClick = (): void => {};

globalThis.harness = {
  clipboard: "",
  codexCalls: [],
  iconRequests: [],
  openedUrls: [],
  windowOperations: [],
  ignoresMouse: false,
  skipsTaskbar: false,
  trayItem(labels) {
    let items = menu;
    let found: TrayItem | undefined;
    for (const label of labels) {
      found = items.find(item => item.label === label);
      items = found?.submenu ?? [];
    }
    if (!found) throw new Error(`No tray item: ${labels.join(" > ")}`);
    return found;
  },
  clickTrayIcon: () => trayClick(),
  createFavicons: () => createFavicons(join(data, "favicons"), fetchIcon),
};

// Favicon lookups never reach the network.
async function fetchIcon(input: string | URL | Request): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input);
  harness.iconRequests.push(url.href);
  if (url.origin !== "https://www.google.com" || url.pathname !== "/s2/favicons") throw new Error("Unexpected icon provider");
  switch (url.searchParams.get("domain")) {
    case "www.wowhead.com": return new Response(new Uint8Array(scallop));
    case "oversized.example": return new Response(new Uint8Array(256 * 1024 + 1));
    case "invalid.example": return new Response("Not an image");
    case "offline.example": throw new Error("Offline");
    default: return new Response(null, { status: 404 });
  }
}

// "fail" fails at once and "wait" takes ten seconds. Follow-ups take longer than new questions.
const ask: Ask = async (request, { signal, session }) => {
  harness.codexCalls.push({ request, session });
  if (request.question === "fail") throw new Error("Test failure");
  const wait = request.question === "wait" ? 10_000 : request.thread === "continue" ? 500 : 100;
  await delay(wait, undefined, { signal }).catch(() => {
    throw new Error(String(signal.reason));
  });
  return { text: `Answer: ${request.question}`, session: { context: request.context, id: `session-${request.context}` } };
};

const tray: SystemTray = {
  setMenu: items => { menu = items; },
  onClick: listener => { trayClick = listener; },
  destroy: () => {},
};

// Record the window calls tests assert on. Arguments pass through unchanged, because Electron rejects explicit undefined.
app.on("browser-window-created", (_event, window) => {
  const record = (operation: string): void => { harness.windowOperations.push(operation); };
  const show = window.show.bind(window);
  window.show = () => { record("show"); show(); };
  const focus = window.focus.bind(window);
  window.focus = () => { record("focus"); focus(); };
  const moveTop = window.moveTop.bind(window);
  window.moveTop = () => { record("moveTop"); moveTop(); };
  const setFocusable = window.setFocusable.bind(window);
  window.setFocusable = focusable => { record("setFocusable"); setFocusable(focusable); };
  const setAlwaysOnTop = window.setAlwaysOnTop.bind(window);
  window.setAlwaysOnTop = (...args) => { record("setAlwaysOnTop"); setAlwaysOnTop(...args); };
  const setIgnoreMouseEvents = window.setIgnoreMouseEvents.bind(window);
  window.setIgnoreMouseEvents = (...args) => { harness.ignoresMouse = args[0]; setIgnoreMouseEvents(...args); };
  const setSkipTaskbar = window.setSkipTaskbar.bind(window);
  window.setSkipTaskbar = skip => { harness.skipsTaskbar = skip; setSkipTaskbar(skip); };
});

void app.whenReady().then(() => startApp({
  userData: data,
  clipboard: {
    readText: async () => harness.clipboard,
    writeText: async text => { harness.clipboard = text; },
  },
  tray,
  createCodex: () => ask,
  fetch: fetchIcon,
  openExternal: async url => { harness.openedUrls.push(url); },
}));
