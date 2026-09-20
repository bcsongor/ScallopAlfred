import type { Topic } from "./topic.ts";

// Every request carries professions; this topic adds their specialisation trees to the same field.
export const professions = { category: "professions", fields: {} } as const satisfies Topic;
