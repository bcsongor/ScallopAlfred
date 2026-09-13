const { ipcRenderer } = require("electron");

/** @typedef {import("./ipc.ts").MainMessages} MainMessages */
/** @typedef {import("./ipc.ts").OverlayMessages} OverlayMessages */

/** @type {<K extends keyof OverlayMessages>(channel: K, ...message: import("./ipc.ts").MessageArgs<OverlayMessages, K>) => void} */
const send = (channel, ...message) => ipcRenderer.send(channel, ...message);

/** @type {<K extends keyof MainMessages>(channel: K, listener: (message: MainMessages[K]) => void) => void} */
const on = (channel, listener) => {
  ipcRenderer.on(channel, (_event, message) => listener(message));
};

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

  /** @param {string} text @param {boolean} backVisible @param {string} status @param {number} fontSize */
  function setFrame(text, backVisible, status, fontSize) {
    title.textContent = text;
    title.title = text;
    back.hidden = !backVisible;
    document.body.dataset.status = status;
    document.body.style.fontSize = `${fontSize}px`;
  }

  /** @param {import("./history.ts").ConversationSummary} conversation */
  function historyRow(conversation) {
    const row = document.createElement("div");
    row.className = "conversation-row";
    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = "conversation";
    entry.dataset.conversation = conversation.id;
    const name = document.createElement("span");
    name.className = "conversation-title";
    name.textContent = conversation.title;
    entry.append(name);
    if (conversation.question !== conversation.title) {
      const preview = document.createElement("span");
      preview.className = "conversation-preview";
      preview.textContent = conversation.question;
      entry.append(preview);
    }
    const time = document.createElement("time");
    const date = new Date(conversation.updatedAt);
    time.dateTime = date.toISOString();
    time.textContent = date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    entry.append(time);
    const archive = document.createElement("button");
    archive.type = "button";
    archive.className = "archive-conversation";
    archive.dataset.archiveConversation = conversation.id;
    archive.title = "Archive thread";
    archive.setAttribute("aria-label", `Archive thread: ${conversation.title}`);
    archive.append(archiveIcon.content.cloneNode(true));
    row.append(entry, archive);
    return row;
  }

  on("history", ({ conversations, archived, fontSize }) => {
    const scrollTop = answer.querySelector(".active-conversations")?.scrollTop ?? 0;
    const archivedScrollTop = answer.querySelector(".archived-conversations")?.scrollTop ?? 0;
    setFrame("Threads", false, "history", fontSize);
    followup.hidden = true;
    form.hidden = true;
    bar.hidden = false;
    latestTurn = undefined;
    answer.setAttribute("role", "region");
    answer.setAttribute("aria-label", "Thread history");

    const activeList = document.createElement("div");
    activeList.className = "active-conversations";
    activeList.append(...conversations.map(historyRow));
    if (!conversations.length && !archived.length) {
      const empty = document.createElement("p");
      empty.textContent = "No threads yet. Press Alt+Q in WoW to ask a question.";
      activeList.append(empty);
    }
    answer.replaceChildren(activeList);

    if (archived.length) {
      const section = document.createElement("section");
      section.className = "archived-conversations";
      section.setAttribute("aria-label", "Archived threads");
      const heading = document.createElement("h2");
      heading.textContent = "Archived";
      section.append(heading, ...archived.map(conversation => {
        const entry = document.createElement("button");
        entry.type = "button";
        entry.className = "archived-conversation";
        entry.dataset.conversation = conversation.id;
        entry.textContent = conversation.title;
        entry.title = conversation.title;
        return entry;
      }));
      answer.append(section);
      section.scrollTop = archivedScrollTop;
    }
    activeList.scrollTop = scrollTop;
    updateInteractive();
  });

  /** @param {HTMLAnchorElement} link */
  function addFavicon(link) {
    ipcRenderer.invoke("favicon", link.getAttribute("href")).then(src => {
      if (typeof src !== "string" || !link.isConnected) return;
      const icon = document.createElement("img");
      icon.className = "favicon";
      icon.alt = "";
      icon.width = icon.height = 16;
      icon.addEventListener("error", () => icon.remove(), { once: true });
      icon.addEventListener("load", () => {
        if (nearBottom()) answer.scrollTop = answer.scrollHeight;
      }, { once: true });
      icon.src = src;
      link.prepend(icon);
    }).catch(() => { /* The link remains usable without its icon. */ });
  }

  /** @param {MainMessages["thread"]["turns"][number]} turn */
  function turnSection(turn) {
    const section = document.createElement("section");
    section.className = "turn";
    section.dataset.status = turn.status;
    const questionText = document.createElement("div");
    questionText.className = "question";
    questionText.setAttribute("role", "group");
    questionText.setAttribute("aria-label", "Your question");
    questionText.textContent = turn.question;
    const response = document.createElement("div");
    response.className = "response";
    response.setAttribute("role", "group");
    response.setAttribute("aria-label", "Scallop Alfred's reply");
    if (turn.html !== null) response.innerHTML = turn.html;
    else response.textContent = turn.status === "thinking" ? "Thinking…" : turn.text;
    response.querySelectorAll("a").forEach(addFavicon);
    section.append(questionText, response);
    return section;
  }

  on("thread", ({ state, turns, canFollowup, fontSize }) => {
    // New turns scroll into view; updates keep the reader's place unless they were already at the bottom.
    const followLatest = latestTurn !== turns.at(-1)?.id || nearBottom();
    const scrollTop = answer.scrollTop;
    setFrame(state.title, true, state.status, fontSize);
    answer.setAttribute("role", "log");
    answer.setAttribute("aria-label", "Thread");
    answer.replaceChildren(...turns.map(turnSection));
    if (!turns.length || (state.status === "error" && turns.at(-1)?.text !== state.text)) {
      const notice = document.createElement("div");
      notice.className = "notice";
      notice.textContent = state.text;
      answer.append(notice);
    }
    latestTurn = turns.at(-1)?.id;
    followup.disabled = !canFollowup;
    followup.hidden = !canFollowup;
    answer.scrollTop = followLatest ? answer.scrollHeight : scrollTop;
    updateInteractive();
  });
});
