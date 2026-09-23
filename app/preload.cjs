const { ipcRenderer } = require("electron");

/** @typedef {import("./ipc.ts").ToOverlay} ToOverlay */
/** @typedef {import("./ipc.ts").FromOverlay} FromOverlay */
/** @typedef {import("./ipc.ts").OverlayRequests} OverlayRequests */
/** @typedef {import("./history.ts").TitleSubject} TitleSubject */
/** @typedef {{ x: number, y: number }} Point */

/** @type {<K extends keyof FromOverlay>(channel: K, ...message: import("./ipc.ts").MessageArgs<FromOverlay, K>) => void} */
const send = (channel, ...message) => ipcRenderer.send(channel, ...message);

/** @type {<K extends keyof ToOverlay>(channel: K, listener: (message: ToOverlay[K]) => void) => void} */
const on = (channel, listener) => {
  ipcRenderer.on(channel, (_event, message) => listener(message));
};

/** @type {<K extends keyof OverlayRequests>(channel: K, message: OverlayRequests[K]["message"]) => Promise<OverlayRequests[K]["result"]>} */
const invoke = (channel, message) => ipcRenderer.invoke(channel, message);

/**
 * Creates an element with properties, data attributes and children.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Partial<Omit<HTMLElementTagNameMap[K], "dataset">> & { dataset?: Record<string, string> }} [properties]
 * @param {...(Node | string)} children
 * @returns {HTMLElementTagNameMap[K]}
 */
function h(tag, properties = {}, ...children) {
  const { dataset = {}, ...rest } = properties;
  const element = Object.assign(document.createElement(tag), rest);
  Object.assign(element.dataset, dataset);
  element.append(...children);
  return element;
}

/**
 * A thread title, with each subject marked by type and item quality so CSS can colour it.
 * @param {string} text
 * @param {TitleSubject[] | undefined} subjects
 * @returns {(Node | string)[]}
 */
function titleContent(text, subjects) {
  if (!subjects?.length) return [text];
  return subjects.flatMap(({ name, type, quality }, index) => {
    const subject = h("span", { textContent: name });
    if (type) subject.dataset.type = type;
    if (quality !== undefined) subject.dataset.quality = String(quality);
    return index ? [", ", subject] : [subject];
  });
}

/**
 * @template {HTMLElement} T
 * @param {string} id
 * @param {{ new (): T, prototype: T }} type
 * @returns {T}
 */
function element(id, type) {
  const found = document.getElementById(id);
  if (!(found instanceof type)) throw new Error(`Overlay element #${id} is missing`);
  return found;
}

// The page runs no scripts; this isolated preload renders it. It inserts HTML only from our
// Markdown renderer, never raw model output.
window.addEventListener("DOMContentLoaded", () => {
  const title = element("title", HTMLElement);
  const titleEditor = element("title-editor", HTMLInputElement);
  const answer = element("answer", HTMLElement);
  const back = element("back", HTMLButtonElement);
  const followup = element("followup", HTMLButtonElement);
  const bar = element("followup-bar", HTMLElement);
  const form = element("followup-form", HTMLFormElement);
  const question = element("question", HTMLTextAreaElement);
  const sendFollowup = element("send-followup", HTMLButtonElement);
  const header = element("header", HTMLElement);
  const resizeHeight = element("resize-height", HTMLElement);
  const resizeWidth = element("resize-width", HTMLElement);
  const fade = element("fade", HTMLInputElement);
  const tabAsk = element("tab-ask", HTMLButtonElement);
  const tabBrowse = element("tab-browse", HTMLButtonElement);
  const browse = element("browse", HTMLElement);
  const browseView = element("browse-view", HTMLElement);
  const address = element("browse-url", HTMLInputElement);
  const browseBack = element("browse-back", HTMLButtonElement);
  const browseForward = element("browse-forward", HTMLButtonElement);
  const browseReload = element("browse-reload", HTMLButtonElement);
  const archiveIcon = element("archive-icon", HTMLTemplateElement);
  const deleteIcon = element("delete-icon", HTMLTemplateElement);
  const unarchiveIcon = element("unarchive-icon", HTMLTemplateElement);

  /** @type {string | undefined} */
  let latestTurn;
  /** The thread on screen and its title, which double-clicking the title edits. */
  /** @type {string | undefined} */
  let threadId;
  let currentTitle = "";
  /** The title as it was when editing began, so cancelling can tell nothing changed. */
  /** @type {string | undefined} */
  let editingTitle;
  /** The turn whose reply is streaming, and how much of its text the last render showed. */
  /** @type {string | undefined} */
  let streaming;
  let shown = 0;
  /** Where recent reveals began and when, so re-rendering the reply resumes their fades. */
  /** @type {{ offset: number, at: number }[]} */
  let reveals = [];
  const fadeMs = 300;
  /** @type {ToOverlay["history"] | undefined} */
  let latestHistory;
  // The archived section starts collapsed and reveals five threads at a time.
  const archivedPage = 5;
  let archivedOpen = false;
  let archivedShown = archivedPage;

  const nearBottom = () => answer.scrollHeight - answer.scrollTop - answer.clientHeight < 24;

  /**
   * Keeps the reader's place unless a new turn starts or they are already at the bottom.
   * @param {() => void} update
   * @param {boolean} [newTurn]
   */
  function keepScroll(update, newTurn = false) {
    const followLatest = newTurn || nearBottom();
    const scrollTop = answer.scrollTop;
    update();
    answer.scrollTop = followLatest ? answer.scrollHeight : scrollTop;
    markScrollable();
  }

  // The follow-up bar and archived section cast their shadows only while content is hidden beneath them.
  function markScrollable() {
    for (const list of [answer, answer.querySelector(".active-threads")]) {
      list?.toggleAttribute("data-more-below", list.scrollHeight - list.scrollTop - list.clientHeight > 1);
    }
  }
  // Window resizes and the follow-up editor opening or closing change the space available, and scrolling
  // either list moves what is beneath. Scroll events don't bubble, so they are caught on the way down.
  new ResizeObserver(markScrollable).observe(answer);
  answer.addEventListener("scroll", markScrollable, { capture: true, passive: true });

  /**
   * @param {string} text
   * @param {TitleSubject[] | undefined} subjects
   * @param {boolean} backVisible
   * @param {string} status
   * @param {number} fontSize
   */
  function setFrame(text, subjects, backVisible, status, fontSize) {
    currentTitle = text;
    title.replaceChildren(...titleContent(text, subjects));
    title.title = text;
    back.hidden = !backVisible;
    document.body.dataset.status = status;
    document.body.style.fontSize = `${fontSize}px`;
  }

  /** @param {import("./history.ts").ThreadSummary} thread */
  function historyRow(thread) {
    const date = new Date(thread.updatedAt);
    const preview = thread.question === thread.title
      ? []
      : [h("span", { className: "thread-preview", textContent: thread.question })];
    return h("div", { className: "thread-row" },
      h("button", { type: "button", className: "thread", dataset: { thread: thread.id } },
        h("span", { className: "thread-title" }, ...titleContent(thread.title, thread.titleSubjects)),
        ...preview,
        h("time", { dateTime: date.toISOString(), textContent: date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) }),
      ),
      h("button", {
        type: "button",
        className: "row-action archive-thread",
        title: "Archive thread",
        ariaLabel: `Archive thread: ${thread.title}`,
        dataset: { archiveThread: thread.id },
      }, archiveIcon.content.cloneNode(true)),
    );
  }

  /** @param {import("./history.ts").ArchivedThreadSummary} thread */
  function archivedRow(thread) {
    return h("div", { className: "archived-row" },
      h("button", {
        type: "button",
        className: "archived-thread",
        title: thread.title,
        textContent: thread.title,
        dataset: { thread: thread.id },
      }),
      h("button", {
        type: "button",
        className: "row-action",
        title: "Unarchive thread",
        ariaLabel: `Unarchive thread: ${thread.title}`,
        dataset: { unarchiveThread: thread.id },
      }, unarchiveIcon.content.cloneNode(true)),
      h("button", {
        type: "button",
        className: "row-action delete-thread",
        title: "Delete thread",
        ariaLabel: `Delete thread: ${thread.title}`,
        dataset: { deleteThread: thread.id },
      }, deleteIcon.content.cloneNode(true)),
    );
  }

  /** @param {import("./history.ts").ArchivedThreadSummary[]} archived */
  function archivedSection(archived) {
    const header = h("button", {
      type: "button",
      className: "archived-header",
      ariaExpanded: String(archivedOpen),
      textContent: `Archived (${archived.length})`,
      dataset: { toggleArchived: "" },
    });
    const rows = archivedOpen ? archived.slice(0, archivedShown).map(archivedRow) : [];
    const more = archivedOpen && archived.length > archivedShown
      ? [h("button", { type: "button", className: "archived-more", textContent: `Show ${Math.min(archivedPage, archived.length - archivedShown)} more`, dataset: { moreArchived: "" } })]
      : [];
    return h("section", { className: "archived-threads", ariaLabel: "Archived threads" }, header, ...rows, ...more);
  }

  /**
   * Prepends a link's icon: an item's own icon, or the site's favicon. Item links also carry their
   * quality so CSS can colour them.
   * @param {HTMLAnchorElement} link
   */
  function addLinkIcon(link) {
    invoke("link-icon", link.getAttribute("href") ?? "").then(result => {
      if (result === undefined || !link.isConnected) return;
      const icon = h("img", { className: "link-icon", alt: "", width: 16, height: 16 });
      icon.addEventListener("error", () => icon.remove(), { once: true });
      icon.addEventListener("load", () => {
        if (nearBottom()) answer.scrollTop = answer.scrollHeight;
        markScrollable();
      }, { once: true });
      icon.src = result.icon;
      link.prepend(icon);
      if (result.quality !== undefined) link.dataset.quality = String(result.quality);
    }).catch(() => { /* The link remains usable without its icon. */ });
  }

  /**
   * Fades in the text added since the last render. Every update replaces the reply's HTML, so the
   * last few reveals are wrapped again with a negative delay that resumes their animation.
   * @param {Element} response
   */
  function fadeIn(response) {
    const now = performance.now();
    const walker = document.createTreeWalker(response, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(/** @type {Text} */ (walker.currentNode));
    let end = nodes.reduce((length, node) => length + node.length, 0);
    // Rendered text shrinks when Markdown syntax completes, so no earlier reveal may start after this one.
    const offset = Math.min(shown, end);
    reveals = reveals.filter(reveal => now - reveal.at < fadeMs).map(reveal => ({ ...reveal, offset: Math.min(reveal.offset, offset) }));
    reveals.push({ offset, at: now });
    shown = end;
    for (const node of nodes.reverse()) {
      const start = end - node.length;
      for (const { offset, at } of reveals.toReversed()) {
        if (offset >= end) continue;
        const fresh = node.splitText(Math.max(0, offset - start));
        if (fresh.data.trim()) {
          const span = h("span", { className: "fresh" });
          span.style.animationDelay = `${at - now}ms`;
          fresh.replaceWith(span);
          span.append(fresh);
        }
        if (offset <= start) break;
      }
      end = start;
    }
  }

  /**
   * Shows what Codex is doing.
   * @param {import("./ipc.ts").Progress} progress
   */
  function progressLine(progress) {
    return h("div", { className: "progress", role: "status" },
      h("span", { className: "activity", textContent: progress.activity ?? "Thinking…" }),
    );
  }

  /**
   * @param {ToOverlay["thread"]["turns"][number]} turn
   * @param {import("./ipc.ts").Progress} [progress]
   */
  function turnSection(turn, progress) {
    const response = h("div", { className: "response", role: "group", ariaLabel: "Scallop Alfred's reply" });
    if (turn.html !== null) response.innerHTML = turn.html;
    else response.textContent = turn.text;
    if (turn.status === "answer") response.querySelectorAll("a").forEach(addLinkIcon);
    const status = turn.status === "thinking" && progress ? [progressLine(progress)] : [];
    return h("section", { className: "turn", dataset: { status: turn.status } },
      h("div", { className: "question", role: "group", ariaLabel: "Your question", textContent: turn.question }),
      response,
      ...status,
    );
  }

  function closeTitleEditor() {
    editingTitle = undefined;
    titleEditor.hidden = true;
    title.hidden = false;
  }

  /**
   * Ends the edit. A kept change renames the thread, and an empty one asks Codex for a name.
   * @param {boolean} keep
   */
  function finishTitleEdit(keep) {
    if (editingTitle === undefined || threadId === undefined) return;
    const next = titleEditor.value.trim();
    const changed = next !== editingTitle;
    closeTitleEditor();
    if (!keep || !changed) return;
    send("rename-thread", { id: threadId, title: next });
    if (!next) title.replaceChildren(h("span", { className: "naming", textContent: "Naming the thread…" }));
  }

  // Double-clicking the title edits it wherever a follow-up is possible. Enter keeps the change, Escape
  // drops it, and clicking away keeps a non-empty change.
  title.addEventListener("dblclick", () => {
    if (followup.hidden || threadId === undefined) return;
    editingTitle = currentTitle;
    titleEditor.value = currentTitle;
    title.hidden = true;
    titleEditor.hidden = false;
    titleEditor.focus();
    titleEditor.select();
    send("focus-overlay");
  });
  titleEditor.addEventListener("keydown", event => {
    if (event.isComposing || (event.key !== "Enter" && event.key !== "Escape")) return;
    event.preventDefault();
    finishTitleEdit(event.key === "Enter");
  });
  titleEditor.addEventListener("blur", () => finishTitleEdit(titleEditor.value.trim() !== ""));

  element("hide", HTMLButtonElement).addEventListener("click", () => send("hide-overlay"));
  back.addEventListener("click", () => send("show-history"));
  followup.addEventListener("click", () => send("edit-followup", true));
  element("cancel-followup", HTMLButtonElement).addEventListener("click", () => send("edit-followup", false));
  // A blank question greys out Send rather than triggering the browser's validation bubble.
  const syncSend = () => { sendFollowup.disabled = !question.value.trim(); };
  question.addEventListener("input", syncSend);
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (question.value.trim()) send("submit-followup", question.value);
  });
  // Enter with nothing focused opens the editor, where Enter then sends the question.
  document.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.isComposing || event.target !== document.body || followup.hidden) return;
    event.preventDefault();
    send("edit-followup", true);
  });
  form.addEventListener("keydown", event => {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      send("edit-followup", false);
    } else if (event.key === "Enter" && !event.shiftKey && event.target === question) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  /**
   * Follows a left-button drag on `element`, reporting how far the pointer has moved on screen. The
   * pointer is captured, so the drag keeps going when the window moves or the pointer leaves it, and
   * the element carries `data-dragging` meanwhile. `begin` returns what the drag starts from, or
   * undefined to leave the press alone.
   * @template T
   * @param {HTMLElement} element
   * @param {(event: PointerEvent) => T | undefined} begin
   * @param {(from: T, moved: Point, finished: boolean) => void} update
   */
  function drag(element, begin, update) {
    /** @type {{ from: T, start: Point, moved: Point } | undefined} */
    let dragging;
    element.addEventListener("pointerdown", event => {
      const from = event.button === 0 ? begin(event) : undefined;
      if (from === undefined) return;
      event.preventDefault();
      dragging = { from, start: { x: event.screenX, y: event.screenY }, moved: { x: 0, y: 0 } };
      element.setPointerCapture(event.pointerId);
      element.toggleAttribute("data-dragging", true);
    });
    element.addEventListener("pointermove", event => {
      if (!dragging) return;
      dragging.moved = { x: event.screenX - dragging.start.x, y: event.screenY - dragging.start.y };
      update(dragging.from, dragging.moved, false);
    });
    element.addEventListener("lostpointercapture", () => {
      if (!dragging) return;
      const { from, moved } = dragging;
      dragging = undefined;
      element.toggleAttribute("data-dragging", false);
      update(from, moved, true);
    });
  }

  // Each edge handle pushes the edge it sits on: the bottom one grows downwards, the left one leftwards.
  drag(resizeHeight, () => window.innerHeight,
    (height, moved, finished) => send("resize-height", { height: height + moved.y, finished }));
  drag(resizeWidth, () => window.innerWidth,
    (width, moved, finished) => send("resize-width", { width: width - moved.x, finished }));
  // Dragging the header moves the window. Its controls still click, so only the rest of it grabs.
  drag(header,
    event => event.target instanceof Element && event.target.closest("button, label") ? undefined : { x: window.screenX, y: window.screenY },
    (from, moved, finished) => send("move-overlay", { x: from.x + moved.x, y: from.y + moved.y, finished }));

  fade.addEventListener("change", () => send("set-fade", fade.checked));
  tabAsk.addEventListener("click", () => send("select-tab", "ask"));
  tabBrowse.addEventListener("click", () => send("select-tab", "browse"));

  // The web view is a native child of the window, so the main process needs this box in window coordinates.
  function reportBrowseBounds() {
    if (browse.hidden) return;
    const { x, y, width, height } = browseView.getBoundingClientRect();
    send("browse-bounds", { x, y, width, height });
  }
  new ResizeObserver(reportBrowseBounds).observe(browseView);

  address.addEventListener("keydown", event => {
    if (event.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      send("browse-navigate", address.value);
      address.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      address.blur();
    }
  });
  browseBack.addEventListener("click", () => send("browse-back"));
  browseForward.addEventListener("click", () => send("browse-forward"));
  browseReload.addEventListener("click", () => send("browse-reload"));

  answer.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : undefined;
    const archive = target?.closest("button[data-archive-thread]");
    const remove = target?.closest("button[data-delete-thread]");
    const unarchive = target?.closest("button[data-unarchive-thread]");
    const entry = target?.closest("button[data-thread]");
    const link = target?.closest("a");
    if (target?.closest("button[data-toggle-archived]")) {
      archivedOpen = !archivedOpen;
      archivedShown = archivedPage;
      renderHistory();
    } else if (target?.closest("button[data-more-archived]")) {
      archivedShown += archivedPage;
      renderHistory();
    } else if (archive instanceof HTMLElement) {
      send("archive-thread", archive.dataset.archiveThread ?? "");
    } else if (remove instanceof HTMLElement) {
      send("delete-thread", remove.dataset.deleteThread ?? "");
    } else if (unarchive instanceof HTMLElement) {
      send("unarchive-thread", unarchive.dataset.unarchiveThread ?? "");
    } else if (entry instanceof HTMLElement) {
      send("open-thread", entry.dataset.thread ?? "");
    } else if (link) {
      event.preventDefault();
      send("open-link", link.getAttribute("href") ?? "");
    } else if (!followup.hidden) {
      // A click on the reply takes the keyboard so Enter can open the editor.
      send("focus-overlay");
    }
  });

  on("theme", theme => {
    document.documentElement.dataset.theme = theme;
  });

  on("fade", enabled => {
    fade.checked = enabled;
  });

  on("tab", tab => {
    const browsing = tab === "browse";
    document.body.dataset.tab = tab;
    browse.hidden = !browsing;
    tabAsk.ariaSelected = String(!browsing);
    tabBrowse.ariaSelected = String(browsing);
    if (browsing) reportBrowseBounds();
  });

  on("browse", ({ url, canGoBack, canGoForward }) => {
    // Whatever the player is typing outranks the address the page reports.
    if (document.activeElement !== address) address.value = url;
    browseBack.disabled = !canGoBack;
    browseForward.disabled = !canGoForward;
  });

  on("followup-editor", editing => {
    form.hidden = !editing;
    bar.hidden = editing;
    if (editing) {
      question.focus();
    } else {
      question.value = "";
      question.blur();
      syncSend();
    }
  });

  function renderHistory() {
    if (!latestHistory) return;
    const { threads, archived, fontSize } = latestHistory;
    const scrollTop = answer.querySelector(".active-threads")?.scrollTop ?? 0;
    const archivedScrollTop = answer.querySelector(".archived-threads")?.scrollTop ?? 0;
    closeTitleEditor();
    setFrame("Threads", undefined, false, "history", fontSize);
    followup.hidden = true;
    form.hidden = true;
    bar.hidden = false;
    latestTurn = undefined;
    threadId = undefined;
    answer.role = "region";
    answer.ariaLabel = "Thread history";

    const empty = threads.length || archived.length
      ? []
      : [h("p", { textContent: "No threads yet. Press Alt+Q in WoW to ask a question." })];
    const activeList = h("div", { className: "active-threads" }, ...threads.map(historyRow), ...empty);
    const archivedSections = archived.length ? [archivedSection(archived)] : [];
    answer.replaceChildren(activeList, ...archivedSections);
    activeList.scrollTop = scrollTop;
    for (const section of archivedSections) section.scrollTop = archivedScrollTop;
    markScrollable();
  }

  on("history", history => {
    latestHistory = history;
    renderHistory();
  });

  on("thread", ({ id, state, titleSubjects, progress, turns, canFollowup, fontSize }) => {
    const last = turns.at(-1);
    keepScroll(() => {
      // A re-render of the thread being renamed keeps the player's edit.
      if (id !== threadId) closeTitleEditor();
      setFrame(state.title, titleSubjects, true, state.status, fontSize);
      threadId = id;
      answer.role = "log";
      answer.ariaLabel = "Thread";
      const notice = state.notice === undefined ? [] : [h("div", { className: "notice", textContent: state.notice })];
      answer.replaceChildren(...turns.map(turn => turnSection(turn, turn === last ? progress : undefined)), ...notice);
      // A reply that just finished streaming fades in the rest of its text. Anything else counts as shown.
      const response = answer.querySelector(".turn:last-of-type .response");
      if (response && last && last.id === streaming && last.status === "answer") fadeIn(response);
      else shown = response?.textContent?.length ?? 0;
      streaming = last?.status === "thinking" ? last.id : undefined;
      latestTurn = last?.id;
      followup.hidden = !canFollowup;
    }, latestTurn !== last?.id);
  });

  on("progress", ({ id, activity }) => {
    if (id !== streaming) return;
    const line = answer.querySelector('.turn:last-of-type[data-status="thinking"] .progress .activity');
    if (line) line.textContent = activity;
  });

  on("reply", ({ id, html }) => {
    if (id !== streaming) return;
    const response = answer.querySelector('.turn:last-of-type[data-status="thinking"] .response');
    if (!response) return;
    keepScroll(() => {
      response.innerHTML = html;
      fadeIn(response);
    });
  });
});
