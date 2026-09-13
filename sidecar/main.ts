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
import { parseRequest, type ConversationTurn, type OverlayState, type WoWRequest } from "./protocol.ts";

/** A notice replaces the thread's own status, for errors that belong to no turn. */
type ThreadView = { kind: "thread"; conversation?: Conversation; notice?: OverlayState };
type View = { kind: "history" } | ThreadView;

const iconPath = join(import.meta.dirname, "..", "assets", "scallop.jpg");
const welcome: OverlayState = {
  status: "ready",
  title: "Ask about World of Warcraft",
  text: "Press Alt+Q in WoW to ask a question. Hover a tooltip first or Shift-click a link into the question box, then copy the request.",
};

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

/** Adds a thinking turn for the request. Retrying the last request replaces its turn. */
function startTurn(conversation: Conversation, request: WoWRequest): Conversation {
  const earlier = conversation.turns.at(-1)?.id === request.id ? conversation.turns.slice(0, -1) : conversation.turns;
  const turn: ConversationTurn = { id: request.id, question: request.question, status: "thinking", text: "" };
  const turns = [...earlier, turn];
  const title = request.subjects.map(subject => subject.name).join(", ") || (turns[0] ?? turn).question;
  return { ...conversation, request, turns, title };
}

function finishTurn(conversation: Conversation, outcome: Pick<ConversationTurn, "status" | "text">): Conversation {
  const last = conversation.turns.length - 1;
  return { ...conversation, turns: conversation.turns.map((turn, index) => index === last ? { ...turn, ...outcome } : turn) };
}

function overlayState({ conversation, notice }: ThreadView): OverlayState {
  if (notice) return notice;
  const turn = conversation?.turns.at(-1);
  return conversation && turn ? { status: turn.status, title: conversation.title, text: turn.text } : welcome;
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

  let view: View = history.list().length || history.listArchived().length ? { kind: "history" } : { kind: "thread" };
  let theme = config.theme;
  let running: AbortController | undefined;
  /** The thread a follow-up continues, set only while the editor is open. */
  let followup: Conversation | undefined;
  let previousClipboard = await clipboard.readText().catch(() => "");
  let pollTimer: NodeJS.Timeout | undefined;
  let quitting = false;
  let savingSettings = Promise.resolve();

  function continuableThread(): Conversation | undefined {
    return view.kind === "thread" && !running && !view.conversation?.archivedAt ? view.conversation : undefined;
  }

  function render(reveal = false): void {
    if (view.kind === "history") {
      overlay.send("history", { conversations: history.list(), archived: history.listArchived(), fontSize: config.fontSize });
    } else {
      overlay.send("thread", {
        state: overlayState(view),
        turns: (view.conversation?.turns ?? []).map(turn => ({ ...turn, html: turn.status === "answer" ? renderMarkdown(turn.text) : null })),
        canFollowup: !!continuableThread(),
        fontSize: config.fontSize,
      });
    }
    if (reveal) overlay.reveal();
    refreshMenu();
  }

  function show(next: View, reveal = false): void {
    view = next;
    render(reveal);
  }

  function showNotice(notice: OverlayState): void {
    show({ kind: "thread", conversation: view.kind === "thread" ? view.conversation : undefined, notice }, true);
  }

  function editFollowup(thread?: Conversation): void {
    if (followup === thread) return;
    followup = thread;
    overlay.setEditing(!!thread);
    overlay.send("followup-editor", !!thread);
    // Closing the editor must not activate another application or reorder windows.
    if (!thread) render();
  }

  function save(conversation: Conversation, failure: string): ThreadView {
    try {
      return { kind: "thread", conversation: history.save(conversation) };
    } catch (error) {
      return { kind: "thread", conversation, notice: { status: "error", title: conversation.title, text: `${failure}: ${errorMessage(error)}` } };
    }
  }

  // Theme and height saves share a queue so neither overwrites the other.
  function saveSettings(changes: Partial<Pick<Config, "height" | "theme">>): void {
    savingSettings = savingSettings.then(() => saveAppearance(settingsPath, changes)).catch((error: unknown) => {
      dialog.showErrorBox("Couldn't save settings", errorMessage(error));
    });
  }

  function setTheme(next: Config["theme"]): void {
    if (theme === next) return;
    theme = next;
    overlay.send("theme", theme);
    refreshMenu();
    saveSettings({ theme });
  }

  overlay.listen("edit-followup", editing => {
    const thread = continuableThread();
    if (!editing) editFollowup();
    else if (thread) editFollowup(thread);
  });
  overlay.listen("submit-followup", question => {
    if (followup && !running) void answer({ ...followup.request, id: randomUUID(), thread: "continue", question }, followup);
  });
  overlay.listen("show-history", () => {
    editFollowup();
    show({ kind: "history" });
  });
  overlay.listen("open-conversation", id => {
    const conversation = history.get(id);
    if (!conversation) return;
    editFollowup();
    show({ kind: "thread", conversation });
  });
  overlay.listen("archive-conversation", id => {
    if (view.kind !== "history") return;
    try {
      if (history.archive(id)) render();
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
      showNotice({ status: "error", title: "Couldn't open the link", text: errorMessage(error) });
    });
  });

  async function answer(request: WoWRequest, thread?: Conversation): Promise<void> {
    if (running) return;
    editFollowup();
    const started = startTurn(thread ?? { id: randomUUID(), title: "", updatedAt: Date.now(), request, turns: [] }, request);
    const saved = save(started, "Couldn't save the question");
    if (saved.notice) {
      show({ kind: "thread", conversation: finishTurn(started, { status: "error", text: saved.notice.text }) }, true);
      return;
    }
    const controller = new AbortController();
    running = controller;
    show(saved, true);
    const timeout = setTimeout(
      () => controller.abort("The request timed out. Retry from the tray menu."),
      config.timeoutSeconds * 1000,
    );
    const finished = await askCodex(request, config, workspace, controller.signal, started.session).then(
      ({ text, session }) => finishTurn({ ...started, session }, { status: "answer", text }),
      (error: unknown) => finishTurn(started, { status: "error", text: errorMessage(error) }),
    );
    clearTimeout(timeout);
    running = undefined;
    if (quitting) return;
    const stored = save(finished, "Couldn't save the reply");
    const showing = view.kind === "thread" && view.conversation?.id === finished.id;
    show(showing ? stored : view, !overlay.isDismissed());
  }

  // Await each run before polling again. If several requests are copied meanwhile,
  // only the one still on the clipboard is considered when Codex finishes.
  async function poll(): Promise<void> {
    try {
      if (running || followup) return;
      const text = await clipboard.readText().catch(() => undefined);
      if (text === undefined || text === previousClipboard || quitting || running || followup) return;
      previousClipboard = text;
      const request = parseRequest(text);
      if (!request) return;
      overlay.raise();
      await answer(request, request.thread === "continue" ? history.findContext(request.context) : undefined);
    } catch (error) {
      if (!quitting) showNotice({ status: "error", title: "Couldn't read the request", text: errorMessage(error) });
    } finally {
      if (!quitting) pollTimer = setTimeout(() => void poll(), 250);
    }
  }

  function refreshMenu(): void {
    const state = view.kind === "thread" ? overlayState(view) : undefined;
    const thread = continuableThread();
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Show overlay", click: overlay.raise },
      { label: "Theme", submenu: [
        { label: "Original", type: "radio", checked: theme === "original", click: () => setTheme("original") },
        { label: "WoWhead", type: "radio", checked: theme === "wowhead", click: () => setTheme("wowhead") },
      ] },
      { label: "Click-through", type: "checkbox", checked: overlay.isClickThrough(), enabled: process.platform !== "linux", click: item => overlay.setClickThrough(item.checked) },
      { label: "Copy answer", enabled: state?.status === "answer", click: () => { if (state) void clipboard.writeText(state.text); } },
      { label: "Retry last question", enabled: !!thread, click: () => { if (thread) void answer(thread.request, thread); } },
      { label: "Cancel question", enabled: !!running, click: () => running?.abort("Question cancelled. Retry from the tray menu when ready.") },
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
    running?.abort("Scallop Alfred closed.");
    tray.destroy();
  });
  app.on("will-quit", () => history.close());
  await overlay.load();
  overlay.send("theme", theme);
  if (process.platform === "darwin") app.dock?.hide();
  render(true);
  void poll();
}
