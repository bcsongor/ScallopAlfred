import { app, dialog, shell } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { watchClipboard, type Clipboard } from "./clipboard.ts";
import type { Codex, CodexOptions } from "./codex.ts";
import { createSettingsWriter, loadConfig, type Config } from "./config.ts";
import { errorMessage } from "./errors.ts";
import { openHistory, type Thread } from "./history.ts";
import { createIcons } from "./icons.ts";
import type { Tab } from "./ipc.ts";
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
  createCodex: (options: CodexOptions) => Codex;
  fetch: typeof fetch;
  openExternal: (url: string) => Promise<void>;
};

export async function startApp({ userData, clipboard, tray, createCodex, fetch, openExternal }: Ports): Promise<void> {
  const settingsPath = join(userData, "settings.json");
  const workspace = join(userData, "workspace");
  await mkdir(workspace, { recursive: true });
  const config = await loadConfig(settingsPath);
  const settings = createSettingsWriter(settingsPath);
  const history = openHistory(join(userData, "threads.sqlite"));
  const codex = createCodex({ codexPath: config.codexPath, model: config.model, workspace });
  const icons = createIcons(join(userData, "favicons"), fetch);
  const overlay = createOverlay(config, state => overlay.send("browse", state));
  const quit = new AbortController();

  let view: View = history.list().length || history.listArchived().length ? { kind: "history" } : { kind: "thread" };
  let theme = config.theme;
  /** The question in flight, the text Codex has produced for it so far and what it is doing now. */
  let running: { cancel: AbortController; threadId: string; draft: string; activity?: string } | undefined;
  /** The thread a follow-up continues, set only while the editor is open. */
  let followup: Thread | undefined;
  /** Threads Codex is naming, by ID. A newer rename of the same thread cancels the naming. */
  const naming = new Map<string, AbortController>();
  /** The pane on screen, and the page the browse tab reopens at. */
  let tab: Tab = "ask";
  let lastBrowsed = config.browseUrl;

  const openThread = (): Thread | undefined => continuableThread(view, running !== undefined);

  function render(reveal = false): void {
    if (view.kind === "history") {
      overlay.send("history", { threads: history.list(), archived: history.listArchived(), fontSize: config.fontSize });
    } else {
      const thread = view.thread && view.thread.id === running?.threadId
        ? finishTurn(view.thread, { status: "thinking", text: running.draft })
        : view.thread;
      overlay.send("thread", {
        // A notice replaces the title, so only the thread's own title shows its subjects or can be renamed.
        id: view.notice ? undefined : view.thread?.id,
        state: overlayState(view),
        titleSubjects: view.notice ? undefined : view.thread?.titleSubjects,
        progress: running && running.threadId === view.thread?.id ? { activity: running.activity } : undefined,
        turns: (thread?.turns ?? []).map(turn => ({ ...turn, html: turn.status !== "error" && turn.text ? renderMarkdown(turn.text) : null })),
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
    if (thread) overlay.focus();
    overlay.send("followup-editor", thread !== undefined);
    // Closing the editor must not activate another application or reorder windows.
    if (!thread) render();
  }

  const closeFollowup = (): void => editFollowup(undefined);

  /** Records the page on screen so the browse tab returns to it, including after a restart. */
  function rememberBrowsed(): void {
    const url = overlay.browse.url();
    if (!url || url === lastBrowsed) return;
    lastBrowsed = url;
    saveSettings({ browseUrl: url });
  }

  /**
   * Switches pane. A web page needs the keyboard for its own fields and the address bar, so the
   * overlay takes focus while the browse tab is open and gives it back to the game on the way out.
   */
  function selectTab(next: Tab): void {
    if (tab === next) return;
    tab = next;
    overlay.send("tab", tab);
    if (tab === "browse") {
      closeFollowup();
      overlay.browse.show(lastBrowsed);
      overlay.focus();
    } else {
      rememberBrowsed();
      overlay.browse.hide();
      overlay.releaseFocus();
    }
  }

  /** Raises the overlay, taking the keyboard back when the browse tab is the one returning. */
  function raiseOverlay(): void {
    overlay.raise();
    if (tab === "browse") overlay.focus();
  }

  function saveThread(thread: Thread, failure: string): ThreadView {
    try {
      return { kind: "thread", thread: history.save(thread) };
    } catch (error) {
      return { kind: "thread", thread, notice: { title: thread.title, text: `${failure}: ${errorMessage(error)}` } };
    }
  }

  /** Renames a stored thread and refreshes whichever view shows its title. */
  function renameThread(id: string, title: string): void {
    try {
      const renamed = history.rename(id, title);
      if (!renamed) return;
      if (view.kind === "history") render();
      else if (view.thread?.id === id) show({ kind: "thread", thread: renamed });
    } catch (error) {
      showNotice("Couldn't rename the thread", error);
    }
  }

  async function nameThread(thread: Thread): Promise<void> {
    const cancel = new AbortController();
    naming.set(thread.id, cancel);
    const signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(config.timeoutSeconds * 1000), quit.signal]);
    try {
      const title = await codex.title(thread.turns, signal);
      if (!signal.aborted) renameThread(thread.id, title);
    } catch (error) {
      if (!signal.aborted) showNotice("Couldn't name the thread", error);
    } finally {
      if (naming.get(thread.id) === cancel) naming.delete(thread.id);
    }
  }

  function saveSettings(changes: Partial<Config>): void {
    settings.save(changes).catch((error: unknown) => dialog.showErrorBox("Couldn't save settings", errorMessage(error)));
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
        canCopyAnswer: reply !== undefined,
        canRetry: thread !== undefined,
        canCancel: running !== undefined,
      },
      {
        show: raiseOverlay,
        setTheme,
        copyAnswer: () => { if (reply !== undefined) void clipboard.writeText(reply); },
        retry: () => { if (thread) void answer(thread.request, thread); },
        cancel: () => running?.cancel.abort("Question cancelled. Retry from the tray menu when ready."),
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
    const signal = AbortSignal.any([cancel.signal, timeout, quit.signal]);
    running = { cancel, threadId: started.id, draft: "" };
    show(saved, true);
    const onScreen = (): boolean => view.kind === "thread" && view.thread?.id === started.id && !view.notice;
    // Only the reply on screen is re-rendered, so earlier turns and the tray stay untouched.
    const reveal = pace(30, text => {
      if (onScreen()) overlay.send("reply", { id: request.id, html: renderMarkdown(text) });
    });
    const onText = (text: string): void => {
      if (signal.aborted || running?.cancel !== cancel) return;
      running = { ...running, draft: text };
      reveal.update(text);
    };
    const onActivity = (activity: string): void => {
      if (signal.aborted || running?.cancel !== cancel) return;
      running = { ...running, activity };
      if (onScreen()) overlay.send("progress", { id: request.id, activity });
    };
    const finished = await codex.ask(request, { signal, session: started.session, onText, onActivity }).then(
      ({ text, session }) => finishTurn({ ...started, session }, { status: "answer", text }),
      (error: unknown) => finishTurn(started, {
        status: "error",
        text: timeout.aborted ? "The request timed out. Retry from the tray menu." : errorMessage(error),
      }),
    );
    reveal.stop();
    running = undefined;
    if (quit.signal.aborted) return;
    const stored = saveThread(finished, "Couldn't save the reply");
    show(view.kind === "thread" && view.thread?.id === finished.id ? stored : view, !overlay.isDismissed());
  }

  /** A follow-up from the game continues the thread on screen, or starts a new one when there isn't one to continue. */
  async function answerCopied(request: WoWRequest): Promise<void> {
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
    // The reply runs in the background so a show command still comes through while Codex works.
    for await (const copied of copies) {
      // A question's answer is about to arrive, so its own pane comes to the front. The show
      // command only asks for the overlay back, so it leaves the browse tab where it was.
      if (copied.kind === "ask") selectTab("ask");
      raiseOverlay();
      if (copied.kind === "ask") answerCopied(copied.request).catch((error: unknown) => showNotice("Couldn't start the question", error));
    }
  }

  overlay.handle("link-icon", icons);
  overlay.listen("edit-followup", editing => {
    if (tab === "browse") return;
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
  /** Changes a thread's place in the history list and re-renders it, reporting a database failure. */
  function updateHistory(change: (id: string) => boolean, failure: string): (id: string) => void {
    return id => {
      if (view.kind !== "history") return;
      try {
        if (change(id)) render();
      } catch (error) {
        dialog.showErrorBox(failure, errorMessage(error));
      }
    };
  }

  overlay.listen("archive-thread", updateHistory(history.archive, "Couldn't archive the thread"));
  overlay.listen("unarchive-thread", updateHistory(history.unarchive, "Couldn't unarchive the thread"));
  overlay.listen("delete-thread", updateHistory(history.delete, "Couldn't delete the thread"));
  overlay.listen("rename-thread", ({ id, title }) => {
    const thread = openThread();
    if (!thread || thread.id !== id) return;
    naming.get(id)?.abort();
    if (title) renameThread(id, title);
    else void nameThread(thread);
  });
  overlay.listen("focus-overlay", () => {
    if (openThread()) overlay.focus();
  });
  overlay.listen("hide-overlay", () => {
    closeFollowup();
    overlay.hide();
  });
  overlay.listen("resize-height", ({ height, finished }) => {
    const applied = overlay.setHeight(height);
    if (finished) saveSettings({ height: applied });
  });
  // Widening moves the left edge, so the position is saved with the width.
  overlay.listen("resize-width", ({ width, finished }) => {
    const applied = overlay.setWidth(width);
    if (finished) saveSettings(applied);
  });
  overlay.listen("move-overlay", ({ x, y, finished }) => {
    const applied = overlay.moveTo(x, y);
    if (finished) saveSettings(applied);
  });
  overlay.listen("select-tab", selectTab);
  overlay.listen("set-fade", fade => {
    overlay.setFade(fade);
    saveSettings({ fade });
  });
  overlay.listen("browse-bounds", bounds => overlay.browse.setBounds(bounds));
  overlay.listen("browse-navigate", target => overlay.browse.navigate(target));
  overlay.listen("browse-back", overlay.browse.back);
  overlay.listen("browse-forward", overlay.browse.forward);
  overlay.listen("browse-reload", overlay.browse.reload);
  overlay.listen("open-link", target => {
    const url = webUrl(target);
    if (url) openExternal(url).catch((error: unknown) => showNotice("Couldn't open the link", error));
  });

  tray.onClick(raiseOverlay);
  app.on("second-instance", raiseOverlay);
  // Quitting waits for pending settings saves, such as the page the browse tab was on.
  app.once("before-quit", event => {
    event.preventDefault();
    rememberBrowsed();
    overlay.browse.destroy();
    quit.abort("Scallop Alfred closed.");
    tray.destroy();
    void settings.settled().then(() => app.quit());
  });
  app.on("will-quit", () => history.close());
  refreshMenu();
  await overlay.load();
  overlay.send("theme", theme);
  overlay.send("fade", config.fade);
  overlay.setFade(config.fade);
  overlay.send("tab", tab);
  if (process.platform === "darwin") app.dock?.hide();
  render(true);
  answerCopiedRequests().catch((error: unknown) => showNotice("Stopped watching the clipboard", error));
}

/**
 * Reveals text at a steady pace instead of in the bursts it arrives in. Each tick shows a
 * slice of the backlog, so a large chunk melts in over a few hundred milliseconds. Text that
 * replaces what was shown is revealed again from its first change.
 */
function pace(intervalMs: number, reveal: (text: string) => void): { update: (text: string) => void; stop: () => void } {
  let target = "";
  let shown = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = (): void => { clearInterval(timer); timer = undefined; };
  const tick = (): void => {
    const backlog = target.length - shown;
    if (backlog <= 0) return stop();
    shown += Math.max(2, Math.ceil(backlog / 10));
    reveal(target.slice(0, shown));
  };
  return {
    update: text => {
      shown = commonPrefixLength(target.slice(0, shown), text);
      target = text;
      timer ??= setInterval(tick, intervalMs);
    },
    stop,
  };
}

/** The number of leading characters `a` and `b` share. */
function commonPrefixLength(a: string, b: string): number {
  let length = 0;
  while (length < a.length && a[length] === b[length]) length++;
  return length;
}
