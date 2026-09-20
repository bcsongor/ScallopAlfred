import { equipmentNotes } from "./equipment.ts";
import { inventoryNotes } from "./inventory.ts";
import { playerChoiceNotes } from "./player-choice.ts";
import { professionsNotes } from "./professions.ts";
import { recipesNotes } from "./recipes.ts";
import { subjectNotes } from "./subject.ts";
import { talentsNotes } from "./talents.ts";
import { traitTreeNotes } from "./trait-tree.ts";

/** How to read each data shape, in the order the prompt explains them. */
export const snapshotNotes = [
  subjectNotes,
  equipmentNotes,
  talentsNotes,
  professionsNotes,
  inventoryNotes,
  recipesNotes,
  traitTreeNotes,
  playerChoiceNotes,
];
