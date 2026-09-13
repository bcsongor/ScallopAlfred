import { app, clipboard, dialog, Menu, nativeImage, shell, Tray } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { askCodex } from "./codex.ts";
import { loadConfig, saveAppearance, type Config } from "./config.ts";
import { createFavicons } from "./favicons.ts";
import { openHistory, type Conversation } from "./history.ts";
import { renderMarkdown, webUrl } from "./markdown.ts";
import { createOverlay } from "./overlay.ts";
import { parseRequest, type OverlayState, type WoWRequest } from "./protocol.ts";

const iconPath = join(import.meta.dirname, "..", "assets", "scallop.jpg");

app.setName("Scallop Alfred");
// Chromium's visibility animation can flash transparent windows on Windows.
if (process.platform === "win32") app.commandLine.appendSwitch("wm-window-animations-disabled");
if (!app.requestSingleInstanceLock()) app.quit();
else void app.whenReady().then(start).catch((error: unknown) => {
  dialog.showErrorBox("Scallop Alfred", errorMessage(error));
  app.quit();
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function start(): Promise<void> {
  const userData = app.getPath("userData");
  const settingsPath = join(userData, "settings.json");
  const workspace = join(userData, "workspace");
  await mkdir(workspace, { recursive: true });
  const config = await loadConfig(settingsPath);
  const history = openHistory(join(userData, "conversations.sqlite"));
  const overlay = createOverlay(config, iconPath);
  const favicon = createFavicons(join(userData, "favicons"));
  overlay.window.webContents.ipc.handle("favicon", (_event, target: unknown) => favicon(target));
  const tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }));
  tray.setToolTip("Scallop Alfred");
  tray.on("click", overlay.raise);

  let state: OverlayState = {
    status: "ready",
    title: "Ask about World of Warcraft",
    text: "Press Alt+Q in WoW to ask a question. Hover a tooltip first or Shift-click a link into the question box, then copy the request.",
  };
  /** The thread on screen when the history list is not showing. */
  let conversation: Conversation | undefined;
  let viewingHistory = false;
  /** The single Codex run. Its thread may differ from the one on screen. */
  let active: { controller: AbortController; conversation: Conversation } | undefined;
  /** Set while the follow-up editor is open, so the thread cannot change while the player types. */
  let followupRequest: WoWRequest | undefined;
  let previousClipboard = await clipboard.readText().catch(() => "");
  let pollTimer: NodeJS.Timeout | undefined;
  let quitting = false;
  let savingSettings = Promise.resolve();

  /** The open thread, when it accepts a follow-up or retry. */
  function continuableThread(): Conversation | undefined {
    return conversation && !conversation.archivedAt && !viewingHistory && !active ? conversation : undefined;
  }

  function render(next = state, reveal = true): void {
    state = next;
    if (viewingHistory) {
      overlay.send("history", { conversations: history.list(), archived: history.listArchived(), fontSize: config.fontSize });
    } else {
      overlay.send("thread", {
        state,
        turns: conversation?.turns.map(turn => ({ ...turn, html: turn.status === "answer" ? renderMarkdown(turn.text) : null })) ?? [],
        canFollowup: !!continuableThread(),
        fontSize: config.fontSize,
      });
    }
    if (reveal) overlay.reveal();
    refreshMenu();
  }

  function editFollowup(request?: WoWRequest): void {
    if (followupRequest === request) return;
    followupRequest = request;
    overlay.setEditing(!!request);
    overlay.send("followup-editor", !!request);
    // Closing the editor must not activate another application or reorder windows.
    if (!request) render(state, false);
  }

  // Theme and height saves share a queue so neither overwrites the other.
  function saveSettings(changes: Partial<Pick<Config, "height" | "theme">>): void {
    savingSettings = savingSettings.then(() => saveAppearance(settingsPath, changes)).catch((error: unknown) => {
      dialog.showErrorBox("Couldn't save settings", errorMessage(error));
    });
  }

  function setTheme(theme: Config["theme"]): void {
    if (config.theme === theme) return;
    config.theme = theme;
    overlay.send("theme", theme);
    refreshMenu();
    saveSettings({ theme });
  }

  overlay.listen("edit-followup", editing => {
    const thread = continuableThread();
    if (!editing) editFollowup();
    else if (thread) editFollowup(thread.request);
  });
  overlay.listen("submit-followup", question => {
    if (!followupRequest || active) return;
    void answer({ ...followupRequest, id: randomUUID(), thread: "continue", question });
  });
  overlay.listen("show-history", () => {
    editFollowup();
    viewingHistory = true;
    render(state, false);
  });
  overlay.listen("open-conversation", id => {
    const saved = active?.conversation.id === id ? active.conversation : history.get(id);
    if (!saved) return;
    editFollowup();
    conversation = saved;
    viewingHistory = false;
    const turn = saved.turns.at(-1)!;
    render({ status: turn.status, title: saved.title, text: turn.text }, false);
  });
  overlay.listen("archive-conversation", id => {
    if (!viewingHistory) return;
    try {
      const archivedAt = history.archive(id);
      if (!archivedAt) return;
      for (const open of [conversation, active?.conversation]) {
        if (open?.id === id) open.archivedAt = archivedAt;
      }
      render(state, false);
    } catch (error) {
      dialog.showErrorBox("Couldn't archive the thread", errorMessage(error));
    }
  });
  overlay.listen("hide-overlay", () => {
    editFollowup();
    overlay.hide();
  });
  overlay.listen("resize-height", ({ height, finished }) => {
    const applied = overlay.setHeight(height);
    if (finished) saveSettings({ height: applied });
  });
  overlay.listen("open-link", target => {
    const url = webUrl(target);
    if (url) void shell.openExternal(url).catch((error: unknown) => {
      render({ status: "error", title: "Couldn't open the link", text: errorMessage(error) });
    });
  });

  async function answer(request: WoWRequest): Promise<void> {
    if (active) return;
    editFollowup();
    if (conversation?.archivedAt) conversation = undefined;
    if (request.id !== conversation?.request.id && (request.thread === "new" || request.context !== conversation?.request.context)) {
      conversation = request.thread === "continue" ? history.findContext(request.context) : undefined;
    }
    const current = conversation ??= { id: randomUUID(), title: "", updatedAt: Date.now(), request, turns: [] };
    const turns = current.turns;
    let turn = turns.at(-1);
    // Retrying the last request replaces its reply instead of adding a turn.
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
    try {
      history.save(current);
    } catch (error) {
      turn.status = "error";
      turn.text = `Couldn't save the question: ${errorMessage(error)}`;
      render({ status: "error", title: current.title, text: turn.text });
      return;
    }
    const controller = new AbortController();
    active = { controller, conversation: current };
    const timeout = setTimeout(
      () => controller.abort("The request timed out. Retry from the tray menu."),
      config.timeoutSeconds * 1000,
    );
    render({ status: "thinking", title: current.title, text: request.question });
    try {
      const result = await askCodex(request, config, workspace, controller.signal, current.session);
      current.session = result.session;
      turn.status = "answer";
      turn.text = result.text;
    } catch (error) {
      turn.status = "error";
      turn.text = errorMessage(error);
    } finally {
      clearTimeout(timeout);
      active = undefined;
      if (!quitting) {
        let { status, text } = turn;
        try {
          history.save(current);
        } catch (error) {
          status = "error";
          text = `Couldn't save the reply: ${errorMessage(error)}`;
        }
        render(conversation === current ? { status, title: current.title, text } : state, !overlay.isDismissed());
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
      if (!request) return;
      overlay.raise();
      await answer(request);
    } catch (error) {
      if (!quitting) render({ status: "error", title: "Couldn't read the request", text: errorMessage(error) });
    } finally {
      if (!quitting) pollTimer = setTimeout(() => void poll(), 250);
    }
  }

  function refreshMenu(): void {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Show overlay", click: overlay.raise },
      { label: "Theme", submenu: [
        { label: "Original", type: "radio", checked: config.theme === "original", click: () => setTheme("original") },
        { label: "WoWhead", type: "radio", checked: config.theme === "wowhead", click: () => setTheme("wowhead") },
      ] },
      { label: "Click-through", type: "checkbox", checked: overlay.isClickThrough(), enabled: process.platform !== "linux", click: item => overlay.setClickThrough(item.checked) },
      { label: "Copy answer", enabled: !viewingHistory && state.status === "answer", click: () => void clipboard.writeText(state.text) },
      { label: "Retry last question", enabled: !!continuableThread(), click: () => {
        const thread = continuableThread();
        if (thread) void answer(thread.request);
      } },
      { label: "Cancel question", enabled: !!active, click: () => active?.controller.abort("Question cancelled. Retry from the tray menu when ready.") },
      { type: "separator" },
      { label: "Open settings", click: () => void shell.openPath(settingsPath) },
      { label: "Quit", click: () => app.quit() },
    ]));
  }

  refreshMenu();
  app.on("second-instance", overlay.raise);
  app.on("before-quit", () => {
    quitting = true;
    clearTimeout(pollTimer);
    active?.controller.abort("Scallop Alfred closed.");
    tray.destroy();
  });
  app.on("will-quit", () => history.close());
  await overlay.load();
  overlay.send("theme", config.theme);
  if (process.platform === "darwin") app.dock?.hide();
  viewingHistory = history.list().length > 0 || history.listArchived().length > 0;
  render();
  void poll();
}
