const { app, BrowserWindow, clipboard, nativeImage, shell, Tray } = require("electron");
const { join } = require("node:path");
const { existsSync, writeFileSync } = require("node:fs");
const childProcess = require("node:child_process");

// Test requests must never reach a live overlay through the system clipboard.
let clipboardText = "";
clipboard.readText = async () => clipboardText;
clipboard.writeText = async text => { clipboardText = text; };

// Favicon tests must not contact the network.
global.testIconRequests = [];
global.fetch = async input => {
  const url = new URL(input);
  global.testIconRequests.push(url.href);
  if (url.origin !== "https://www.google.com" || url.pathname !== "/s2/favicons") throw new Error("Unexpected icon provider");
  const domain = url.searchParams.get("domain");
  if (domain === "www.wowhead.com") return new Response(nativeImage.createFromPath(join(__dirname, "../../assets/scallop.jpg")).toPNG());
  if (domain === "oversized.example") return new Response(Buffer.alloc(256 * 1024 + 1));
  if (domain === "invalid.example") return new Response("Not an image");
  if (domain === "offline.example") throw new Error("Offline");
  return new Response(null, { status: 404 });
};

global.testOpenedUrls = [];
global.testWindowOperations = [];
for (const method of ["show", "showInactive", "restore", "setAlwaysOnTop", "setFocusable", "hide", "focus", "blur", "moveTop"]) {
  const original = BrowserWindow.prototype[method];
  BrowserWindow.prototype[method] = function (...args) {
    global.testWindowOperations.push(method);
    return original.apply(this, args);
  };
}
const setSkipTaskbar = BrowserWindow.prototype.setSkipTaskbar;
BrowserWindow.prototype.setSkipTaskbar = function (skip) {
  global.testWindowOperations.push("setSkipTaskbar");
  global.testSkipTaskbar = skip;
  return setSkipTaskbar.call(this, skip);
};
shell.openExternal = async url => { global.testOpenedUrls.push(url); };

app.setPath("userData", process.env.SCALLOPALFRED_TEST_DATA);
const settingsPath = join(app.getPath("userData"), "settings.json");
if (!existsSync(settingsPath)) writeFileSync(settingsPath, JSON.stringify({ codexPath: process.execPath, height: 360 }));
const spawn = childProcess.spawn;
const setContextMenu = Tray.prototype.setContextMenu;
const setIgnoreMouseEvents = BrowserWindow.prototype.setIgnoreMouseEvents;
BrowserWindow.prototype.setIgnoreMouseEvents = function (ignore, options) {
  global.testIgnoreMouseEvents = ignore;
  return setIgnoreMouseEvents.call(this, ignore, options);
};
Tray.prototype.setContextMenu = function (menu) {
  global.testTray = this;
  global.testMenu = menu;
  return setContextMenu.call(this, menu);
};
childProcess.spawn = (_file, args, options) => spawn(process.execPath, [join(__dirname, "codex.cjs"), ...args], {
  ...options, env: { ...options.env, ELECTRON_RUN_AS_NODE: "1" },
});
require("node:module").syncBuiltinESMExports();
void import("../../sidecar/favicons.ts").then(({ createFavicons }) => {
  global.testCreateFavicons = () => createFavicons(join(app.getPath("userData"), "favicons"));
  return import("../../sidecar/main.ts");
});
