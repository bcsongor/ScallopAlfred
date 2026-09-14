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

  let interactive = false;
  /** @type {{ y: number, height: number, next: number } | undefined} */
  let resizing;
  /** @type {string | undefined} */
  let latestTurn;

  /** @param {boolean} next */
  function setInteractive(next) {
    if (next === interactive) return;
    interactive = next;
    send("hover-control", next);
  }

  /** @param {Element} node */
  const scrollable = node => node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth;

  // Mouse input passes through to the game except over controls and scrollable content.
  function updateInteractive() {
    setInteractive(!!resizing || !!document.querySelector("button:hover, textarea:hover, #answer a:hover, #resize-height:hover") ||
      [answer, ...answer.querySelectorAll(".active-threads, .archived-threads, table")]
        .some(node => node.matches(":hover") && scrollable(node)));
  }

  const nearBottom = () => answer.scrollHeight - answer.scrollTop - answer.clientHeight < 24;

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

  /** @param {ToOverlay["thread"]["turns"][number]} turn */
  function turnSection(turn) {
    const response = h("div", { className: "response", role: "group", ariaLabel: "Scallop Alfred's reply" });
    if (turn.html !== null) response.innerHTML = turn.html;
    else response.textContent = turn.status === "thinking" ? "Thinking…" : turn.text;
    response.querySelectorAll("a").forEach(addFavicon);
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

  document.addEventListener("mousemove", updateInteractive);
  document.addEventListener("mouseleave", () => setInteractive(!!resizing));
  resize.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizing = { y: event.screenY, height: window.innerHeight, next: window.innerHeight };
    resize.setPointerCapture(event.pointerId);
    updateInteractive();
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
    updateInteractive();
  });

  answer.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : undefined;
    const archive = target?.closest("button[data-archive-thread]");
    const entry = target?.closest("button[data-thread]");
    const link = target?.closest("a");
    if (archive instanceof HTMLElement) {
      send("archive-thread", archive.dataset.archiveThread ?? "");
    } else if (entry instanceof HTMLElement) {
      send("open-thread", entry.dataset.thread ?? "");
    } else if (link) {
      event.preventDefault();
      send("open-link", link.getAttribute("href") ?? "");
    }
  });

  on("theme", theme => {
    document.documentElement.dataset.theme = theme;
    updateInteractive();
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

  on("history", ({ threads, archived, fontSize }) => {
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
    const archivedSections = archived.length
      ? [h("section", { className: "archived-threads", ariaLabel: "Archived threads" }, h("h2", { textContent: "Archived" }), ...archived.map(archivedRow))]
      : [];
    answer.replaceChildren(activeList, ...archivedSections);
    activeList.scrollTop = scrollTop;
    for (const section of archivedSections) section.scrollTop = archivedScrollTop;
    markScrollable();
    updateInteractive();
  });

  on("thread", ({ state, titleSubjects, turns, canFollowup, fontSize }) => {
    // New turns scroll into view; updates keep the reader's place unless they were already at the bottom.
    const followLatest = latestTurn !== turns.at(-1)?.id || nearBottom();
    const scrollTop = answer.scrollTop;
    setFrame(state.title, titleSubjects, true, state.status, fontSize);
    answer.role = "log";
    answer.ariaLabel = "Thread";
    const notice = state.notice === undefined ? [] : [h("div", { className: "notice", textContent: state.notice })];
    answer.replaceChildren(...turns.map(turnSection), ...notice);
    latestTurn = turns.at(-1)?.id;
    followup.hidden = !canFollowup;
    answer.scrollTop = followLatest ? answer.scrollHeight : scrollTop;
    markScrollable();
    updateInteractive();
  });
});
