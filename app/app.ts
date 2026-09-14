import { app, dialog, shell } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { watchClipboard, type Clipboard } from "./clipboard.ts";
import type { Ask, CodexOptions } from "./codex.ts";
import { createSettingsWriter, loadConfig, type AppearanceChanges, type Config } from "./config.ts";
import { errorMessage } from "./errors.ts";
import { createFavicons } from "./favicons.ts";
import { openHistory, type Thread } from "./history.ts";
import { renderMarkdown, webUrl } from "./markdown.ts";
import { createOverlay } from "./overlay.ts";
import type { WoWRequest } from "./protocol.ts";
import { continuableThread, finishTurn, overlayState, startTurn, type ThreadView, type View } from "./threads.ts";
import { trayMenu, type SystemTray } from "./tray.ts";

/** What tests replace with fakes: the clipboard, tray, Codex, network and browser. Electron itself is imported directly. */
type Ports = {
  userData: string;
  clipboard: Clipboard;
  tray: SystemTray;
  createCodex: (options: CodexOptions) => Ask;
  fetch: typeof fetch;
  openExternal: (url: string) => Promise<void>;
};

export async function startApp({ userData, clipboard, tray, createCodex, fetch, openExternal }: Ports): Promise<void> {
  const settingsPath = join(userData, "settings.json");
  const workspace = join(userData, "workspace");
  await mkdir(workspace, { recursive: true });
  const config = await loadConfig(settingsPath);
  const writeSettings = createSettingsWriter(settingsPath);
  const history = openHistory(join(userData, "threads.sqlite"));
  const ask = createCodex({ codexPath: config.codexPath, model: config.model, workspace });
  const favicon = createFavicons(join(userData, "favicons"), fetch);
  const overlay = createOverlay(config);
  const quit = new AbortController();

  let view: View = history.list().length || history.listArchived().length ? { kind: "history" } : { kind: "thread" };
  let theme = config.theme;
  let running: AbortController | undefined;
  /** The thread a follow-up continues, set only while the editor is open. */
  let followup: Thread | undefined;

  const openThread = (): Thread | undefined => continuableThread(view, running !== undefined);

  function render(reveal = false): void {
    if (view.kind === "history") {
      overlay.send("history", { threads: history.list(), archived: history.listArchived(), fontSize: config.fontSize });
    } else {
      overlay.send("thread", {
        state: overlayState(view),
        // A notice replaces the title, so only the thread's own title shows its subjects.
        titleSubjects: view.notice ? undefined : view.thread?.titleSubjects,
        turns: (view.thread?.turns ?? []).map(turn => ({ ...turn, html: turn.status === "answer" ? renderMarkdown(turn.text) : null })),
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

  function showNotice(title: string, error: unknown): void {
    show({ kind: "thread", thread: view.kind === "thread" ? view.thread : undefined, notice: { title, text: errorMessage(error) } }, true);
  }

  function editFollowup(thread: Thread | undefined): void {
    if (followup === thread) return;
    followup = thread;
    overlay.setEditing(thread !== undefined);
    overlay.send("followup-editor", thread !== undefined);
    // Closing the editor must not activate another application or reorder windows.
    if (!thread) render();
  }

  const closeFollowup = (): void => editFollowup(undefined);

  function saveThread(thread: Thread, failure: string): ThreadView {
    try {
      return { kind: "thread", thread: history.save(thread) };
    } catch (error) {
      return { kind: "thread", thread, notice: { title: thread.title, text: `${failure}: ${errorMessage(error)}` } };
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
    const turn = view.kind === "thread" ? view.thread?.turns.at(-1) : undefined;
    const reply = turn?.status === "answer" ? turn.text : undefined;
    const thread = openThread();
    tray.setMenu(trayMenu(
      {
        theme,
        clickThrough: overlay.isClickThrough(),
        clickThroughAvailable: process.platform !== "linux",
        canCopyAnswer: reply !== undefined,
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
        copyAnswer: () => { if (reply !== undefined) void clipboard.writeText(reply); },
        retry: () => { if (thread) void answer(thread.request, thread); },
        cancel: () => running?.abort("Question cancelled. Retry from the tray menu when ready."),
        openSettings: () => void shell.openPath(settingsPath),
        quit: () => app.quit(),
      },
    ));
  }

  async function answer(request: WoWRequest, thread?: Thread): Promise<void> {
    if (running) return;
    closeFollowup();
    const started = startTurn(thread ?? { id: randomUUID(), title: "", titleSubjects: [], updatedAt: Date.now(), request, turns: [] }, request);
    const saved = saveThread(started, "Couldn't save the question");
    if (saved.notice) {
      show({ kind: "thread", thread: finishTurn(started, { status: "error", text: saved.notice.text }) }, true);
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
    show(view.kind === "thread" && view.thread?.id === finished.id ? stored : view, !overlay.isDismissed());
  }

  /** A follow-up from the game continues the thread on screen, or starts a new one when there isn't one to continue. */
  function answerCopied(request: WoWRequest): Promise<void> {
    if (request.thread === "followup") {
      const thread = openThread();
      return thread
        ? answer({ ...request, thread: "continue", context: thread.request.context }, thread)
        : answer({ ...request, thread: "new" });
    }
    return answer(request, request.thread === "continue" ? history.findContext(request.context) : undefined);
  }

  async function answerCopiedRequests(): Promise<void> {
    const copies = watchClipboard(clipboard, {
      signal: quit.signal,
      paused: () => running !== undefined || followup !== undefined,
      onInvalid: error => showNotice("Couldn't read the request", error),
    });
    for await (const request of copies) {
      try {
        overlay.raise();
        await answerCopied(request);
      } catch (error) {
        showNotice("Couldn't start the question", error);
      }
    }
  }

  overlay.handle("favicon", favicon);
  overlay.listen("edit-followup", editing => {
    const thread = openThread();
    if (!editing) closeFollowup();
    else if (thread) editFollowup(thread);
  });
  overlay.listen("submit-followup", question => {
    if (followup && !running) void answer({ ...followup.request, id: randomUUID(), thread: "continue", question }, followup);
  });
  overlay.listen("show-history", () => {
    closeFollowup();
    show({ kind: "history" });
  });
  overlay.listen("open-thread", id => {
    const thread = history.get(id);
    if (!thread) return;
    closeFollowup();
    show({ kind: "thread", thread });
  });
  overlay.listen("archive-thread", id => {
    if (view.kind !== "history") return;
    try {
      if (history.archive(id)) render();
    } catch (error) {
      dialog.showErrorBox("Couldn't archive the thread", errorMessage(error));
    }
  });
  overlay.listen("hide-overlay", () => {
    closeFollowup();
    overlay.hide();
  });
  overlay.listen("resize-height", ({ height, finished }) => {
    const applied = overlay.setHeight(height);
    if (finished) saveSettings({ height: applied });
  });
  overlay.listen("open-link", target => {
    const url = webUrl(target);
    if (url) openExternal(url).catch((error: unknown) => showNotice("Couldn't open the link", error));
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
  answerCopiedRequests().catch((error: unknown) => showNotice("Stopped watching the clipboard", error));
}
