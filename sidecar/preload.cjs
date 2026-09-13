const { ipcRenderer } = require("electron");

/** @typedef {import("./ipc.ts").ToOverlay} ToOverlay */
/** @typedef {import("./ipc.ts").FromOverlay} FromOverlay */
/** @typedef {import("./ipc.ts").OverlayRequests} OverlayRequests */

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
      [answer, ...answer.querySelectorAll(".active-conversations, .archived-conversations, table")]
        .some(node => node.matches(":hover") && scrollable(node)));
  }

  const nearBottom = () => answer.scrollHeight - answer.scrollTop - answer.clientHeight < 24;

  // The archived section casts its shadow only when threads can scroll beneath it.
  function markScrollableThreads() {
    const list = answer.querySelector(".active-conversations");
    list?.toggleAttribute("data-scrollable", list.scrollHeight > list.clientHeight);
  }
  window.addEventListener("resize", markScrollableThreads);

  /**
   * @param {string} text
   * @param {boolean} backVisible
   * @param {string} status
   * @param {number} fontSize
   */
  function setFrame(text, backVisible, status, fontSize) {
    title.textContent = text;
    title.title = text;
    back.hidden = !backVisible;
    document.body.dataset.status = status;
    document.body.style.fontSize = `${fontSize}px`;
  }

  /** @param {import("./history.ts").ConversationSummary} conversation */
  function historyRow(conversation) {
    const date = new Date(conversation.updatedAt);
    const preview = conversation.question === conversation.title
      ? []
      : [h("span", { className: "conversation-preview", textContent: conversation.question })];
    return h("div", { className: "conversation-row" },
      h("button", { type: "button", className: "conversation", dataset: { conversation: conversation.id } },
        h("span", { className: "conversation-title", textContent: conversation.title }),
        ...preview,
        h("time", { dateTime: date.toISOString(), textContent: date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) }),
      ),
      h("button", {
        type: "button",
        className: "archive-conversation",
        title: "Archive thread",
        ariaLabel: `Archive thread: ${conversation.title}`,
        dataset: { archiveConversation: conversation.id },
      }, archiveIcon.content.cloneNode(true)),
    );
  }

  /** @param {import("./history.ts").ArchivedConversationSummary} conversation */
  function archivedRow(conversation) {
    return h("button", {
      type: "button",
      className: "archived-conversation",
      title: conversation.title,
      textContent: conversation.title,
      dataset: { conversation: conversation.id },
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
    const archive = target?.closest("button[data-archive-conversation]");
    const entry = target?.closest("button[data-conversation]");
    const link = target?.closest("a");
    if (archive instanceof HTMLElement) {
      send("archive-conversation", archive.dataset.archiveConversation ?? "");
    } else if (entry instanceof HTMLElement) {
      send("open-conversation", entry.dataset.conversation ?? "");
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

  on("history", ({ conversations, archived, fontSize }) => {
    const scrollTop = answer.querySelector(".active-conversations")?.scrollTop ?? 0;
    const archivedScrollTop = answer.querySelector(".archived-conversations")?.scrollTop ?? 0;
    setFrame("Threads", false, "history", fontSize);
    followup.hidden = true;
    form.hidden = true;
    bar.hidden = false;
    latestTurn = undefined;
    answer.role = "region";
    answer.ariaLabel = "Thread history";

    const empty = conversations.length || archived.length
      ? []
      : [h("p", { textContent: "No threads yet. Press Alt+Q in WoW to ask a question." })];
    const activeList = h("div", { className: "active-conversations" }, ...conversations.map(historyRow), ...empty);
    const archivedSections = archived.length
      ? [h("section", { className: "archived-conversations", ariaLabel: "Archived threads" }, h("h2", { textContent: "Archived" }), ...archived.map(archivedRow))]
      : [];
    answer.replaceChildren(activeList, ...archivedSections);
    activeList.scrollTop = scrollTop;
    for (const section of archivedSections) section.scrollTop = archivedScrollTop;
    markScrollableThreads();
    updateInteractive();
  });

  on("thread", ({ state, turns, canFollowup, fontSize }) => {
    // New turns scroll into view; updates keep the reader's place unless they were already at the bottom.
    const followLatest = latestTurn !== turns.at(-1)?.id || nearBottom();
    const scrollTop = answer.scrollTop;
    setFrame(state.title, true, state.status, fontSize);
    answer.role = "log";
    answer.ariaLabel = "Thread";
    const notice = !turns.length || (state.status === "error" && turns.at(-1)?.text !== state.text)
      ? [h("div", { className: "notice", textContent: state.text })]
      : [];
    answer.replaceChildren(...turns.map(turnSection), ...notice);
    latestTurn = turns.at(-1)?.id;
    followup.hidden = !canFollowup;
    answer.scrollTop = followLatest ? answer.scrollHeight : scrollTop;
    updateInteractive();
  });
});
