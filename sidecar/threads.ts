import type { Conversation, ConversationTurn } from "./history.ts";
import type { OverlayState } from "./ipc.ts";
import type { WoWRequest } from "./protocol.ts";

/** A notice replaces the thread's own status, for errors that belong to no turn. */
export type ThreadView = { kind: "thread"; conversation?: Conversation; notice?: OverlayState };
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
export function startTurn(conversation: Conversation, request: WoWRequest): Conversation {
  const earlier = conversation.turns.at(-1)?.id === request.id ? conversation.turns.slice(0, -1) : conversation.turns;
  const turn: ConversationTurn = { id: request.id, question: request.question, status: "thinking", text: "" };
  const started = { ...conversation, request, turns: [...earlier, turn] };
  if (conversation.title) return started;
  return {
    ...started,
    title: request.subjects.map(subject => subject.name).join(", ") || request.question,
    titleSubjects: request.subjects.map(({ name, type, quality }) => quality === undefined ? { name, type } : { name, type, quality }),
  };
}

export function finishTurn(conversation: Conversation, outcome: Pick<ConversationTurn, "status" | "text">): Conversation {
  const last = conversation.turns.length - 1;
  return { ...conversation, turns: conversation.turns.map((turn, index) => index === last ? { ...turn, ...outcome } : turn) };
}

export function overlayState({ conversation, notice }: ThreadView): OverlayState {
  if (notice) return notice;
  const turn = conversation?.turns.at(-1);
  return conversation && turn ? { status: turn.status, title: conversation.title, text: turn.text } : welcome;
}

/** The thread on screen, when it accepts a follow-up or retry. */
export function continuableThread(view: View, running: boolean): Conversation | undefined {
  return view.kind === "thread" && !running && !view.conversation?.archivedAt ? view.conversation : undefined;
}
