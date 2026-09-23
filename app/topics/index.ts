import { altarOfCorrosion } from "./altar-of-corrosion.ts";
import { corrosiveCodex } from "./corrosive-codex.ts";
import { gear } from "./gear.ts";
import { gold } from "./gold.ts";
import { greatVault } from "./great-vault.ts";
import { mechanics } from "./mechanics.ts";
import { professions } from "./professions.ts";
import { selectedAchievement } from "./selected-achievement.ts";
import type { Topic } from "./topic.ts";

/** Every topic the addon can send. Adding one here is all the request schema and prompt need. */
const all = [mechanics, professions, gear, gold, greatVault, selectedAchievement, altarOfCorrosion, corrosiveCodex] as const;

type UnionToIntersection<U> = (U extends unknown ? (union: U) => void : never) extends (intersection: infer I) => void ? I : never;

export const categories = all.map(topic => topic.category);

/** The request fields topics add, merged so the request type keeps each field's shape. */
export const topicFields = Object.assign({}, ...all.map(topic => topic.fields)) as UnionToIntersection<(typeof all)[number]["fields"]>;

export const topicPrompts = (all satisfies readonly Topic[]).flatMap((topic: Topic) => topic.prompt ?? []);
