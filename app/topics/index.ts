import { altarOfCorrosion } from "./altar-of-corrosion.ts";
import { corrosiveCodex } from "./corrosive-codex.ts";
import { gear } from "./gear.ts";
import { gold } from "./gold.ts";
import { greatVault } from "./great-vault.ts";
import { mechanics } from "./mechanics.ts";
import { professions } from "./professions.ts";
import { selectedAchievement } from "./selected-achievement.ts";
import type { Topic } from "./topic.ts";

const all = [mechanics, professions, gear, gold, greatVault, selectedAchievement, altarOfCorrosion, corrosiveCodex] as const;

/** Every topic the addon can send, in menu order. */
export const topics: readonly Topic[] = all;

export const categories = all.map(topic => topic.category);

/** The request fields topics add, spread by name so the request type keeps each field's shape. */
export const topicFields = {
  ...gear.fields,
  ...gold.fields,
  ...greatVault.fields,
  ...selectedAchievement.fields,
  ...altarOfCorrosion.fields,
  ...corrosiveCodex.fields,
};

export const topicPrompts = topics.flatMap(topic => topic.prompt ?? []);
