import type { Thread, Turn } from "./history.ts";
import type { OverlayState } from "./ipc.ts";
import type { WoWRequest } from "./protocol.ts";

/** A notice replaces the thread's own status, for errors that belong to no turn. */
export type ThreadView = { kind: "thread"; thread?: Thread; notice?: OverlayState };
export type View = { kind: "history" } | ThreadView;

export const welcome: OverlayState = {
  status: "ready",
  title: "Ask about World of Warcraft",
  text: "Press Alt+Q in WoW to ask a question. Hover a tooltip first or Shift-click a link into the question box, then copy the request.",
};

/**
 * Adds a thinking turn for the request. Retrying the last request replaces its turn.
 * A new thread is named after its subjects or question, and keeps that name.
 */
export function startTurn(thread: Thread, request: WoWRequest): Thread {
  const earlier = thread.turns.at(-1)?.id === request.id ? thread.turns.slice(0, -1) : thread.turns;
  const turn: Turn = { id: request.id, question: request.question, status: "thinking", text: "" };
  const started = { ...thread, request, turns: [...earlier, turn] };
  if (thread.title) return started;
  return {
    ...started,
    title: request.subjects.map(subject => subject.name).join(", ") || request.question,
    titleSubjects: request.subjects.map(({ name, type, quality }) => quality === undefined ? { name, type } : { name, type, quality }),
  };
}

export function finishTurn(thread: Thread, outcome: Pick<Turn, "status" | "text">): Thread {
  const last = thread.turns.length - 1;
  return { ...thread, turns: thread.turns.map((turn, index) => index === last ? { ...turn, ...outcome } : turn) };
}

export function overlayState({ thread, notice }: ThreadView): OverlayState {
  if (notice) return notice;
  const turn = thread?.turns.at(-1);
  return thread && turn ? { status: turn.status, title: thread.title, text: turn.text } : welcome;
}

/** The thread on screen, when it accepts a follow-up or retry. */
export function continuableThread(view: View, running: boolean): Thread | undefined {
  return view.kind === "thread" && !running && !view.thread?.archivedAt ? view.thread : undefined;
}
