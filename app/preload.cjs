const { ipcRenderer } = require("electron");

/** @typedef {import("./ipc.ts").ToOverlay} ToOverlay */
/** @typedef {import("./ipc.ts").FromOverlay} FromOverlay */
/** @typedef {import("./ipc.ts").OverlayRequests} OverlayRequests */
/** @typedef {import("./history.ts").TitleSubject} TitleSubject */

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
  const answer = element("answer", HTMLElement);
  const back = element("back", HTMLButtonElement);
  const followup = element("followup", HTMLButtonElement);
  const bar = element("followup-bar", HTMLElement);
  const form = element("followup-form", HTMLFormElement);
  const question = element("question", HTMLTextAreaElement);
  const resize = element("resize-height", HTMLElement);
  const archiveIcon = element("archive-icon", HTMLTemplateElement);

  /** @type {{ y: number, height: number, next: number } | undefined} */
  let resizing;
  /** @type {string | undefined} */
  let latestTurn;
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

  // The follow-up bar and archived section cast their shadows only when content scrolls beneath them.
  function markScrollable() {
    for (const list of [answer, answer.querySelector(".active-threads")]) {
      list?.toggleAttribute("data-scrollable", list.scrollHeight > list.clientHeight);
    }
  }
  // Window resizes and the follow-up editor opening or closing change the space available.
  new ResizeObserver(markScrollable).observe(answer);

  /**
   * @param {string} text
   * @param {TitleSubject[] | undefined} subjects
   * @param {boolean} backVisible
   * @param {string} status
   * @param {number} fontSize
   */
  function setFrame(text, subjects, backVisible, status, fontSize) {
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
        className: "archive-thread",
        title: "Archive thread",
        ariaLabel: `Archive thread: ${thread.title}`,
        dataset: { archiveThread: thread.id },
      }, archiveIcon.content.cloneNode(true)),
    );
  }

  /** @param {import("./history.ts").ArchivedThreadSummary} thread */
  function archivedRow(thread) {
    return h("button", {
      type: "button",
      className: "archived-thread",
      title: thread.title,
      textContent: thread.title,
      dataset: { thread: thread.id },
    });
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

  /** @param {HTMLAnchorElement} link */
  function addFavicon(link) {
    invoke("favicon", link.getAttribute("href") ?? "").then(src => {
      if (src === undefined || !link.isConnected) return;
      const icon = h("img", { className: "favicon", alt: "", width: 16, height: 16 });
      icon.addEventListener("error", () => icon.remove(), { once: true });
      icon.addEventListener("load", () => {
        if (nearBottom()) answer.scrollTop = answer.scrollHeight;
        markScrollable();
      }, { once: true });
      icon.src = src;
      link.prepend(icon);
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

  /** @param {ToOverlay["thread"]["turns"][number]} turn */
  function turnSection(turn) {
    const response = h("div", { className: "response", role: "group", ariaLabel: "Scallop Alfred's reply" });
    if (turn.html !== null) response.innerHTML = turn.html;
    else response.textContent = turn.text;
    if (turn.status === "answer") response.querySelectorAll("a").forEach(addFavicon);
    return h("section", { className: "turn", dataset: { status: turn.status } },
      h("div", { className: "question", role: "group", ariaLabel: "Your question", textContent: turn.question }),
      response,
    );
  }

  element("hide", HTMLButtonElement).addEventListener("click", () => send("hide-overlay"));
  back.addEventListener("click", () => send("show-history"));
  followup.addEventListener("click", () => send("edit-followup", true));
  element("cancel-followup", HTMLButtonElement).addEventListener("click", () => send("edit-followup", false));
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

  resize.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizing = { y: event.screenY, height: window.innerHeight, next: window.innerHeight };
    resize.setPointerCapture(event.pointerId);
  });
  resize.addEventListener("pointermove", event => {
    if (!resizing) return;
    resizing.next = resizing.height + event.screenY - resizing.y;
    send("resize-height", { height: resizing.next, finished: false });
  });
  resize.addEventListener("lostpointercapture", () => {
    if (!resizing) return;
    const height = resizing.next;
    resizing = undefined;
    send("resize-height", { height, finished: true });
  });

  answer.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : undefined;
    const archive = target?.closest("button[data-archive-thread]");
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

  on("followup-editor", editing => {
    form.hidden = !editing;
    bar.hidden = editing;
    if (editing) {
      question.focus();
    } else {
      question.value = "";
      question.blur();
    }
  });

  function renderHistory() {
    if (!latestHistory) return;
    const { threads, archived, fontSize } = latestHistory;
    const scrollTop = answer.querySelector(".active-threads")?.scrollTop ?? 0;
    const archivedScrollTop = answer.querySelector(".archived-threads")?.scrollTop ?? 0;
    setFrame("Threads", undefined, false, "history", fontSize);
    followup.hidden = true;
    form.hidden = true;
    bar.hidden = false;
    latestTurn = undefined;
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

  on("thread", ({ state, titleSubjects, turns, canFollowup, fontSize }) => {
    const last = turns.at(-1);
    keepScroll(() => {
      setFrame(state.title, titleSubjects, true, state.status, fontSize);
      answer.role = "log";
      answer.ariaLabel = "Thread";
      const notice = state.notice === undefined ? [] : [h("div", { className: "notice", textContent: state.notice })];
      answer.replaceChildren(...turns.map(turnSection), ...notice);
      // A reply that just finished streaming fades in the rest of its text. Anything else counts as shown.
      const response = answer.querySelector(".turn:last-child .response");
      if (response && last && last.id === streaming && last.status === "answer") fadeIn(response);
      else shown = response?.textContent?.length ?? 0;
      streaming = last?.status === "thinking" ? last.id : undefined;
      latestTurn = last?.id;
      followup.hidden = !canFollowup;
    }, latestTurn !== last?.id);
  });

  on("reply", ({ id, html }) => {
    if (id !== streaming) return;
    const response = answer.querySelector('.turn:last-child[data-status="thinking"] .response');
    if (!response) return;
    keepScroll(() => {
      response.innerHTML = html;
      fadeIn(response);
    });
  });
});
