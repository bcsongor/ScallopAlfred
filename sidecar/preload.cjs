const { ipcRenderer } = require("electron");

// The isolated preload displays HTML produced by our Markdown renderer, never raw model HTML.
window.addEventListener("DOMContentLoaded", () => {
  const title = document.getElementById("title");
  const answer = document.getElementById("answer");
  const hide = document.getElementById("hide");
  const back = document.getElementById("back");
  const followup = document.getElementById("followup");
  const bar = document.getElementById("followup-bar");
  const form = document.getElementById("followup-form");
  const question = document.getElementById("question");
  const cancel = document.getElementById("cancel-followup");
  const resize = document.getElementById("resize-height");
  if (!title || !answer || !hide || !back || !bar || !cancel || !resize ||
      !(followup instanceof HTMLButtonElement) || !(form instanceof HTMLFormElement) || !(question instanceof HTMLTextAreaElement)) return;

  hide.addEventListener("click", () => ipcRenderer.send("hide-overlay"));
  back.addEventListener("click", () => ipcRenderer.send("show-history"));
  followup.addEventListener("click", () => ipcRenderer.send("edit-followup", true));
  cancel.addEventListener("click", () => ipcRenderer.send("edit-followup", false));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (question.value.trim()) ipcRenderer.send("submit-followup", question.value);
  });
  form.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      ipcRenderer.send("edit-followup", false);
    } else if (event.key === "Enter" && !event.shiftKey && event.target === question) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  ipcRenderer.on("edit-followup", (_event, editing) => {
    form.hidden = !editing;
    bar.hidden = editing;
    if (editing) question.focus();
    else { question.value = ""; question.blur(); }
  });
  let interactive = false;
  /** @type {{ y: number, height: number, next: number } | undefined} */
  let resizing;
  /** @type {string | undefined} */
  let latestTurn;
  /** @param {boolean} next */
  function setInteractive(next) {
    if (next === interactive) return;
    interactive = next;
    ipcRenderer.send("hover-control", next);
  }
  const updateInteractive = () => {
    setInteractive(!!resizing || !!document.querySelector("button:hover, textarea:hover, #answer a:hover, #resize-height:hover") ||
      [answer, ...answer.querySelectorAll(".active-conversations, .archived-conversations, table")]
        .some(element => element.matches(":hover") && (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth)));
  };
  ipcRenderer.on("theme", /**
   * @param {import("electron").IpcRendererEvent} _event
   * @param {import("./config.ts").Config["theme"]} theme
   */ (_event, theme) => {
    document.documentElement.dataset.theme = theme;
    updateInteractive();
  });
  document.addEventListener("mousemove", updateInteractive);
  document.addEventListener("mouseleave", () => setInteractive(!!resizing));
  resize.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizing = { y: event.screenY, height: window.innerHeight, next: window.innerHeight };
    resize.setPointerCapture(event.pointerId);
    updateInteractive();
  });
  resize.addEventListener("pointermove", (event) => {
    if (!resizing) return;
    resizing.next = resizing.height + event.screenY - resizing.y;
    ipcRenderer.send("resize-height", resizing.next, false);
  });
  resize.addEventListener("lostpointercapture", () => {
    if (!resizing) return;
    const height = resizing.next;
    resizing = undefined;
    ipcRenderer.send("resize-height", height, true);
    updateInteractive();
  });
  answer.addEventListener("click", (event) => {
    const archive = event.target instanceof Element ? event.target.closest("button[data-archive-conversation]") : null;
    if (archive) {
      ipcRenderer.send("archive-conversation", archive.getAttribute("data-archive-conversation"));
      return;
    }
    const entry = event.target instanceof Element ? event.target.closest("button[data-conversation]") : null;
    if (entry) {
      ipcRenderer.send("open-conversation", entry.getAttribute("data-conversation"));
      return;
    }
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    if (!link) return;
    event.preventDefault();
    ipcRenderer.send("open-link", link.getAttribute("href"));
  });

  ipcRenderer.on("history", /**
   * @param {import("electron").IpcRendererEvent} _event
   * @param {import("./history.ts").ConversationSummary[]} conversations
   * @param {number} fontSize
   * @param {import("./history.ts").ArchivedConversationSummary[]} archived
   */ (_event, conversations, fontSize, archived) => {
    const scrollTop = answer.querySelector(".active-conversations")?.scrollTop ?? 0;
    const archivedScrollTop = answer.querySelector(".archived-conversations")?.scrollTop ?? 0;
    title.textContent = "Threads";
    title.title = "Threads";
    back.hidden = true;
    followup.hidden = true;
    form.hidden = true;
    bar.hidden = false;
    latestTurn = undefined;
    answer.setAttribute("role", "region");
    answer.setAttribute("aria-label", "Thread history");
    const list = document.createDocumentFragment();
    const activeList = document.createElement("div");
    activeList.className = "active-conversations";
    list.append(activeList);
    for (const conversation of conversations) {
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
      archive.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3h18v5H3zM5 8v13h14V8M10 12h4"/></svg>';
      row.append(entry, archive);
      activeList.append(row);
    }
    if (!conversations.length && !archived.length) {
      const empty = document.createElement("p");
      empty.textContent = "No threads yet. Press Alt+Q in WoW to ask a question.";
      activeList.append(empty);
    }
    if (archived.length) {
      const section = document.createElement("section");
      section.className = "archived-conversations";
      section.setAttribute("aria-label", "Archived threads");
      const heading = document.createElement("h2");
      heading.textContent = "Archived";
      section.append(heading);
      for (const conversation of archived) {
        const entry = document.createElement("button");
        entry.type = "button";
        entry.className = "archived-conversation";
        entry.dataset.conversation = conversation.id;
        entry.textContent = conversation.title;
        entry.title = conversation.title;
        section.append(entry);
      }
      list.append(section);
    }
    answer.replaceChildren(list);
    document.body.dataset.status = "history";
    document.body.style.fontSize = `${fontSize}px`;
    activeList.scrollTop = scrollTop;
    const archivedList = answer.querySelector(".archived-conversations");
    if (archivedList) archivedList.scrollTop = archivedScrollTop;
    updateInteractive();
  });

  ipcRenderer.on("overlay", /**
   * @param {import("electron").IpcRendererEvent} _event
   * @param {import("./protocol.ts").OverlayState} state
   * @param {number} fontSize
   * @param {Array<import("./protocol.ts").ConversationTurn & { html: string | null }>} turns
   * @param {boolean} canFollowup
   */ (_event, state, fontSize, turns, canFollowup) => {
    title.textContent = state.title;
    title.title = state.title;
    back.hidden = false;
    answer.setAttribute("role", "log");
    answer.setAttribute("aria-label", "Thread");
    const followLatest = latestTurn !== turns.at(-1)?.id || answer.scrollHeight - answer.scrollTop - answer.clientHeight < 24;
    const scrollTop = answer.scrollTop;
    const conversation = document.createDocumentFragment();
    for (const turn of turns) {
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
      if (turn.status === "answer" && typeof turn.html === "string") response.innerHTML = turn.html;
      else response.textContent = turn.status === "thinking" ? "Thinking…" : turn.text;
      for (const link of response.querySelectorAll("a")) {
        void ipcRenderer.invoke("favicon", link.getAttribute("href")).then(src => {
          if (typeof src !== "string" || !link.isConnected) return;
          const icon = document.createElement("img");
          icon.className = "favicon";
          icon.alt = "";
          icon.width = icon.height = 16;
          icon.addEventListener("error", () => icon.remove(), { once: true });
          icon.addEventListener("load", () => {
            if (answer.scrollHeight - answer.scrollTop - answer.clientHeight < 24) answer.scrollTop = answer.scrollHeight;
          }, { once: true });
          icon.src = src;
          link.prepend(icon);
        }).catch(() => { /* The link remains usable without its icon. */ });
      }
      section.append(questionText, response);
      conversation.append(section);
    }
    if (!turns.length || (state.status === "error" && turns.at(-1)?.text !== state.text)) {
      const notice = document.createElement("div");
      notice.className = "notice";
      notice.textContent = state.text;
      conversation.append(notice);
    }
    answer.replaceChildren(conversation);
    latestTurn = turns.at(-1)?.id;
    followup.disabled = !canFollowup;
    followup.hidden = !canFollowup;
    document.body.dataset.status = state.status;
    document.body.style.fontSize = `${fontSize}px`;
    answer.scrollTop = followLatest ? answer.scrollHeight : scrollTop;
    updateInteractive();
  });
});
