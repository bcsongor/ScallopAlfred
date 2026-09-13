import { app, BrowserWindow, clipboard, dialog, Menu, nativeImage, screen, shell, Tray } from "electron";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { askCodex } from "./codex.ts";
import { loadConfig, saveAppearance, type Config } from "./config.ts";
import { parseRequest, requestSchema, type OverlayState, type WoWRequest } from "./protocol.ts";
import { renderMarkdown, webUrl } from "./markdown.ts";
import { openHistory, type Conversation } from "./history.ts";
import { createFavicons } from "./favicons.ts";

const iconPath = join(import.meta.dirname, "..", "assets", "scallop.jpg");

app.setName("Scallop Alfred");
// Chromium's visibility animation can flash transparent windows on Windows.
if (process.platform === "win32") app.commandLine.appendSwitch("wm-window-animations-disabled");
if (!app.requestSingleInstanceLock()) app.quit();
else void app.whenReady().then(start).catch((error: unknown) => {
  dialog.showErrorBox("Scallop Alfred", error instanceof Error ? error.message : String(error));
  app.quit();
});

async function start(): Promise<void> {
  const settingsPath = join(app.getPath("userData"), "settings.json");
  const workspace = join(app.getPath("userData"), "workspace");
  await mkdir(workspace, { recursive: true });
  const config = await loadConfig(settingsPath);
  const history = openHistory(join(app.getPath("userData"), "conversations.sqlite"));
  const window = createOverlay(config);
  const favicon = createFavicons(join(app.getPath("userData"), "favicons"));
  window.webContents.ipc.handle("favicon", (_event, target: unknown) => favicon(target));
  let state: OverlayState = {
    status: "ready",
    title: "Ask about World of Warcraft",
    text: "Press Alt+Q in WoW to ask a question. Hover a tooltip first or Shift-click a link into the question box, then copy the request.",
  };
  let active: AbortController | undefined;
  let conversation: Conversation | undefined;
  let running: Conversation | undefined;
  let viewingHistory = false;
  let followupRequest: WoWRequest | undefined;
  let previousClipboard = await clipboard.readText().catch(() => "");
  let pollTimer: NodeJS.Timeout | undefined;
  let quitting = false;
  let clickThrough = process.platform !== "linux";
  let overControl = false;
  let dismissed = false;
  let savingAppearance = Promise.resolve();
  const seen = new Set<string>();

  function show(next = state, reveal = true): void {
    state = next;
    if (viewingHistory) window.webContents.send("history", history.list(), config.fontSize, history.listArchived());
    else {
      const turns = conversation?.turns.map(turn => ({ ...turn, html: turn.status === "answer" ? renderMarkdown(turn.text) : null })) ?? [];
      window.webContents.send("overlay", state, config.fontSize, turns, !!conversation && !conversation.archivedAt && !active);
    }
    if (reveal) {
      dismissed = false;
      if (!window.isVisible()) window.showInactive();
      // Check after showing: a visible window may still have lost its topmost flag.
      if (!window.isAlwaysOnTop()) window.setAlwaysOnTop(true);
    }
    refreshMenu();
  }

  function hide(): void {
    dismissed = true;
    window.hide();
    editFollowup();
    window.setFocusable(false);
    window.setSkipTaskbar(true);
  }

  // Tray actions and new clipboard questions must raise even a window reported as visible.
  function showOverlay(): void {
    dismissed = false;
    if (window.isMinimized()) window.restore();
    if (!window.isVisible()) window.showInactive();
    if (!window.isAlwaysOnTop()) window.setAlwaysOnTop(true);
    window.moveTop();
  }

  // Forward mouse movement so controls and links stay clickable above the game.
  function updateMouseEvents(): void {
    window.setIgnoreMouseEvents(clickThrough && !overControl && !followupRequest, { forward: true });
  }

  // Keep the displayed context fixed while the player types.
  function editFollowup(request?: WoWRequest): void {
    if (followupRequest === request) return;
    followupRequest = request;
    updateMouseEvents();
    if (request) {
      window.setFocusable(true);
      // Electron changes taskbar visibility with focusability on Windows.
      window.setSkipTaskbar(true);
      window.focus();
    }
    // Closing the editor must not activate another application or reorder windows.
    window.webContents.send("edit-followup", !!request);
    if (!request) show(state, false);
  }

  window.webContents.ipc.on("edit-followup", (_event, editing: unknown) => {
    if (editing === false) editFollowup();
    else if (editing === true && conversation && !conversation.archivedAt && !viewingHistory && !active) editFollowup(conversation.request);
  });
  window.webContents.ipc.on("submit-followup", (_event, text: unknown) => {
    const question = requestSchema.shape.question.safeParse(text);
    if (!followupRequest || active || !question.success) return;
    const request = { ...followupRequest, id: randomUUID(), thread: "continue" as const, question: question.data };
    void answer(request);
  });

  window.webContents.ipc.on("show-history", () => {
    editFollowup();
    viewingHistory = true;
    show(state, false);
  });
  window.webContents.ipc.on("open-conversation", (_event, id: unknown) => {
    if (typeof id !== "string") return;
    const stored = history.get(id);
    const saved = stored && running?.id === id ? running : stored;
    if (!saved) return;
    editFollowup();
    conversation = saved;
    viewingHistory = false;
    const turn = saved.turns.at(-1)!;
    show({ status: turn.status, title: saved.title, text: turn.text }, false);
  });
  window.webContents.ipc.on("archive-conversation", (_event, id: unknown) => {
    if (typeof id !== "string" || !viewingHistory) return;
    try {
      const saved = history.get(id);
      if (!saved || saved.archivedAt) return;
      history.archive(id);
      const archivedAt = history.get(id)!.archivedAt;
      if (conversation?.id === id) conversation.archivedAt = archivedAt;
      if (running?.id === id) running.archivedAt = archivedAt;
      show(state, false);
    } catch (error) {
      dialog.showErrorBox("Couldn't archive the thread", error instanceof Error ? error.message : String(error));
    }
  });

  window.webContents.ipc.on("hide-overlay", hide);
  window.webContents.ipc.on("resize-height", (_event, height: unknown, finished: unknown) => {
    if (typeof height !== "number" || !Number.isFinite(height) || typeof finished !== "boolean") return;
    const bounds = window.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const next = Math.min(Math.max(320, Math.round(height)), 900, area.y + area.height - bounds.y);
    // setSize can retain the previous minimum height on a non-resizable window.
    window.setBounds({ ...bounds, height: next });
    if (finished) savingAppearance = savingAppearance.then(() => saveAppearance(settingsPath, { height: next })).catch((error: unknown) => {
      show({ status: "error", title: "Couldn’t save the height", text: error instanceof Error ? error.message : String(error) }, false);
    });
  });
  window.webContents.ipc.on("hover-control", (_event, hovered: unknown) => {
    overControl = hovered === true;
    updateMouseEvents();
  });
  window.webContents.ipc.on("open-link", (_event, target: unknown) => {
    const url = webUrl(target);
    if (url) void shell.openExternal(url).catch((error: Error) => {
      show({ status: "error", title: "Couldn’t open the link", text: error.message });
    });
  });
  updateMouseEvents();

  async function answer(request: WoWRequest): Promise<void> {
    if (active) return;
    editFollowup();
    if (conversation?.archivedAt) conversation = undefined;
    if (request.id !== conversation?.request.id && (request.thread === "new" || request.context !== conversation?.request.context)) {
      conversation = request.thread === "continue" ? history.findContext(request.context) : undefined;
    }
    conversation ??= { id: randomUUID(), title: "", updatedAt: Date.now(), request, turns: [] };
    const current = conversation;
    const turns = current.turns;
    let turn = turns.at(-1);
    if (turn?.id !== request.id) {
      turn = { id: request.id, question: request.question, status: "thinking", text: "" };
      turns.push(turn);
    } else {
      turn.status = "thinking";
      turn.text = "";
    }
    current.request = request;
    current.title = request.subjects.map(subject => subject.name).join(", ") || turns[0]?.question || request.question;
    viewingHistory = false;
    try { history.save(current); }
    catch (error) {
      turn.status = "error";
      turn.text = `Couldn’t save the question: ${error instanceof Error ? error.message : String(error)}`;
      show({ status: "error", title: current.title, text: turn.text });
      return;
    }
    running = current;
    active = new AbortController();
    const controller = active;
    const timeout = setTimeout(
      () => controller.abort("The request timed out. Retry from the tray menu."),
      config.timeoutSeconds * 1000,
    );
    show({ status: "thinking", title: current.title, text: request.question });
    try {
      const result = await askCodex(request, config, workspace, controller.signal, current.session);
      current.session = result.session;
      turn.status = "answer";
      turn.text = result.text;
    } catch (error) {
      turn.status = "error";
      turn.text = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timeout);
      active = undefined;
      running = undefined;
      if (!quitting) {
        let text = turn.text;
        let status = turn.status;
        try { history.save(current); }
        catch (error) {
          status = "error";
          text = `Couldn’t save the reply: ${error instanceof Error ? error.message : String(error)}`;
        }
        show(conversation === current ? { status, title: current.title, text } : state, !dismissed);
      }
    }
  }

  // Await each run before polling again. If several requests are copied meanwhile,
  // only the one still on the clipboard is considered when Codex finishes.
  async function poll(): Promise<void> {
    try {
      if (active || followupRequest) return;
      const text = await clipboard.readText().catch(() => undefined);
      if (text === undefined || text === previousClipboard || quitting || active || followupRequest) return;
      previousClipboard = text;
      const request = parseRequest(text);
      if (!request || seen.has(request.id)) return;
      seen.add(request.id);
      const oldest = seen.values().next().value;
      if (seen.size > 128 && oldest) seen.delete(oldest);
      showOverlay();
      await answer(request);
    } catch (error) {
      if (!quitting) show({ status: "error", title: "Couldn’t read the request", text: error instanceof Error ? error.message : String(error) });
    } finally {
      if (!quitting) pollTimer = setTimeout(() => void poll(), 250);
    }
  }

  const tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }));
  tray.setToolTip("Scallop Alfred");
  tray.on("click", showOverlay);

  function setTheme(theme: Config["theme"]): void {
    if (config.theme === theme) return;
    config.theme = theme;
    window.webContents.send("theme", theme);
    refreshMenu();
    savingAppearance = savingAppearance.then(() => saveAppearance(settingsPath, { theme })).catch((error: unknown) => {
      dialog.showErrorBox("Couldn't save the theme", error instanceof Error ? error.message : String(error));
    });
  }

  function refreshMenu(): void {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Show overlay", click: showOverlay },
      { label: "Theme", submenu: [
        { label: "Original", type: "radio", checked: config.theme === "original", click: () => setTheme("original") },
        { label: "WoWhead", type: "radio", checked: config.theme === "wowhead", click: () => setTheme("wowhead") },
      ] },
      { label: "Click-through", type: "checkbox", checked: clickThrough, enabled: process.platform !== "linux", click: (item) => {
        clickThrough = item.checked;
        updateMouseEvents();
      } },
      { label: "Copy answer", enabled: !viewingHistory && state.status === "answer", click: () => { void clipboard.writeText(state.text); } },
      { label: "Retry last question", enabled: !!conversation && !conversation.archivedAt && !viewingHistory && !active, click: () => { if (conversation && !conversation.archivedAt) void answer(conversation.request); } },
      { label: "Cancel question", enabled: !!active, click: () => active?.abort("Question cancelled. Retry from the tray menu when ready.") },
      { type: "separator" },
      { label: "Open settings", click: () => { void shell.openPath(settingsPath); } },
      { label: "Quit", click: () => app.quit() },
    ]));
  }

  refreshMenu();
  app.on("second-instance", showOverlay);
  app.on("before-quit", () => {
    quitting = true;
    clearTimeout(pollTimer);
    active?.abort("Scallop Alfred closed.");
    tray.destroy();
  });
  app.on("will-quit", () => history.close());
  await window.loadFile(join(import.meta.dirname, "overlay.html"));
  window.webContents.send("theme", config.theme);
  if (process.platform === "darwin") app.dock?.hide();
  viewingHistory = history.list().length > 0 || history.listArchived().length > 0;
  show();
  void poll();
}

function createOverlay(config: Config): BrowserWindow {
  const area = screen.getPrimaryDisplay().workArea;
  const requested = {
    x: config.x ?? area.x + area.width - config.width - 24,
    y: config.y ?? area.y + 80,
    width: config.width,
    height: config.height,
  };
  const display = screen.getDisplayMatching(requested).workArea;
  const width = Math.min(config.width, display.width);
  const height = Math.min(config.height, display.height);
  const window = new BrowserWindow({
    width, height,
    icon: iconPath,
    x: Math.max(display.x, Math.min(requested.x, display.x + display.width - width)),
    y: Math.max(display.y, Math.min(requested.y, display.y + display.height - height)),
    show: false, frame: false, transparent: true, resizable: false,
    focusable: false, alwaysOnTop: true, skipTaskbar: true,
    webPreferences: { preload: join(import.meta.dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  if (process.platform === "darwin") window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  return window;
}
