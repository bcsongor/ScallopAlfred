import { app, dialog, shell } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { watchClipboard, type Clipboard } from "./clipboard.ts";
import type { Ask, CodexOptions } from "./codex.ts";
import { createSettingsWriter, loadConfig, type AppearanceChanges, type Config } from "./config.ts";
import { errorMessage } from "./errors.ts";
import { createFavicons } from "./favicons.ts";
import { openHistory, type Conversation } from "./history.ts";
import type { OverlayState } from "./ipc.ts";
import { renderMarkdown, webUrl } from "./markdown.ts";
import { createOverlay } from "./overlay.ts";
import type { WoWRequest } from "./protocol.ts";
import { continuableThread, finishTurn, overlayState, startTurn, type ThreadView, type View } from "./threads.ts";
import { trayMenu, type SystemTray } from "./tray.ts";

/** What the app takes from the outside world. Tests pass fakes for all of it. */
export type Ports = {
  userData: string;
  clipboard: Clipboard;
  tray: SystemTray;
  createCodex: (options: CodexOptions) => Ask;
  fetch: typeof fetch;
  openExternal: (url: string) => Promise<void>;
};

const readFailure = (error: unknown): OverlayState => ({ status: "error", title: "Couldn't read the request", text: errorMessage(error) });

export async function startApp({ userData, clipboard, tray, createCodex, fetch, openExternal }: Ports): Promise<void> {
  const settingsPath = join(userData, "settings.json");
  const workspace = join(userData, "workspace");
  await mkdir(workspace, { recursive: true });
  const config = await loadConfig(settingsPath);
  const writeSettings = createSettingsWriter(settingsPath);
  const history = openHistory(join(userData, "conversations.sqlite"));
  const ask = createCodex({ codexPath: config.codexPath, model: config.model, workspace });
  const favicon = createFavicons(join(userData, "favicons"), fetch);
  const overlay = createOverlay(config);
  const quit = new AbortController();

  let view: View = history.list().length || history.listArchived().length ? { kind: "history" } : { kind: "thread" };
  let theme = config.theme;
  let running: AbortController | undefined;
  /** The thread a follow-up continues, set only while the editor is open. */
  let followup: Conversation | undefined;

  const openThread = (): Conversation | undefined => continuableThread(view, running !== undefined);

  function render(reveal = false): void {
    if (view.kind === "history") {
      overlay.send("history", { conversations: history.list(), archived: history.listArchived(), fontSize: config.fontSize });
    } else {
      overlay.send("thread", {
        state: overlayState(view),
        turns: (view.conversation?.turns ?? []).map(turn => ({ ...turn, html: turn.status === "answer" ? renderMarkdown(turn.text) : null })),
        canFollowup: openThread() !== undefined,
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
    overlay.setEditing(thread !== undefined);
    overlay.send("followup-editor", thread !== undefined);
    // Closing the editor must not activate another application or reorder windows.
    if (!thread) render();
  }

  function saveThread(conversation: Conversation, failure: string): ThreadView {
    try {
      return { kind: "thread", conversation: history.save(conversation) };
    } catch (error) {
      return { kind: "thread", conversation, notice: { status: "error", title: conversation.title, text: `${failure}: ${errorMessage(error)}` } };
    }
  }

  function saveSettings(changes: AppearanceChanges): void {
    writeSettings(changes).catch((error: unknown) => dialog.showErrorBox("Couldn't save settings", errorMessage(error)));
  }

  function setTheme(next: Config["theme"]): void {
    if (theme === next) return;
    theme = next;
    overlay.send("theme", theme);
    refreshMenu();
    saveSettings({ theme });
  }

  function refreshMenu(): void {
    const state = view.kind === "thread" ? overlayState(view) : undefined;
    const thread = openThread();
    tray.setMenu(trayMenu(
      {
        theme,
        clickThrough: overlay.isClickThrough(),
        clickThroughAvailable: process.platform !== "linux",
        canCopyAnswer: state?.status === "answer",
        canRetry: thread !== undefined,
        canCancel: running !== undefined,
      },
      {
        show: overlay.raise,
        setTheme,
        setClickThrough: enabled => {
          overlay.setClickThrough(enabled);
          refreshMenu();
        },
        copyAnswer: () => { if (state) void clipboard.writeText(state.text); },
        retry: () => { if (thread) void answer(thread.request, thread); },
        cancel: () => running?.abort("Question cancelled. Retry from the tray menu when ready."),
        openSettings: () => void shell.openPath(settingsPath),
        quit: () => app.quit(),
      },
    ));
  }

  async function answer(request: WoWRequest, thread?: Conversation): Promise<void> {
    if (running) return;
    editFollowup();
    const started = startTurn(thread ?? { id: randomUUID(), title: "", updatedAt: Date.now(), request, turns: [] }, request);
    const saved = saveThread(started, "Couldn't save the question");
    if (saved.notice) {
      show({ kind: "thread", conversation: finishTurn(started, { status: "error", text: saved.notice.text }) }, true);
      return;
    }
    const cancel = new AbortController();
    const timeout = AbortSignal.timeout(config.timeoutSeconds * 1000);
    running = cancel;
    show(saved, true);
    const finished = await ask(request, { signal: AbortSignal.any([cancel.signal, timeout, quit.signal]), session: started.session }).then(
      ({ text, session }) => finishTurn({ ...started, session }, { status: "answer", text }),
      (error: unknown) => finishTurn(started, {
        status: "error",
        text: timeout.aborted ? "The request timed out. Retry from the tray menu." : errorMessage(error),
      }),
    );
    running = undefined;
    if (quit.signal.aborted) return;
    const stored = saveThread(finished, "Couldn't save the reply");
    show(view.kind === "thread" && view.conversation?.id === finished.id ? stored : view, !overlay.isDismissed());
  }

  async function answerCopiedRequests(): Promise<void> {
    const copies = watchClipboard(clipboard, {
      signal: quit.signal,
      paused: () => running !== undefined || followup !== undefined,
      onInvalid: error => showNotice(readFailure(error)),
    });
    for await (const request of copies) {
      try {
        overlay.raise();
        await answer(request, request.thread === "continue" ? history.findContext(request.context) : undefined);
      } catch (error) {
        showNotice(readFailure(error));
      }
    }
  }

  overlay.handle("favicon", favicon);
  overlay.listen("edit-followup", editing => {
    const thread = openThread();
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
    if (url) void openExternal(url).catch((error: unknown) => {
      showNotice({ status: "error", title: "Couldn't open the link", text: errorMessage(error) });
    });
  });

  tray.onClick(overlay.raise);
  app.on("second-instance", overlay.raise);
  app.on("before-quit", () => {
    quit.abort("Scallop Alfred closed.");
    tray.destroy();
  });
  app.on("will-quit", () => history.close());
  refreshMenu();
  await overlay.load();
  overlay.send("theme", theme);
  if (process.platform === "darwin") app.dock?.hide();
  render(true);
  void answerCopiedRequests();
}
