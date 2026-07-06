import { Effect } from "effect";
import { normalizeConfig } from "../../domain/config.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { NotesStore } from "../../shared/infrastructure/notes-store.js";
import { NotesListCommand, NotesListResult } from "./request.js";

export const notesListHandler = Effect.fn("notesListHandler")(function* (_command: NotesListCommand) {
  const configLoader = yield* ConfigLoader;
  const notesStore = yield* NotesStore;
  const config = normalizeConfig(yield* configLoader.load());
  const notes = yield* notesStore.load(config.noteDirs);

  if (notes.length === 0) {
    return new NotesListResult({
      message: "No learned notes found. Add markdown notes with trigger frontmatter under .agents/learn/.",
      exitCode: 0,
    });
  }

  const lines: string[] = [];
  for (const note of notes.toSorted((a, b) => a.name.localeCompare(b.name))) {
    const triggerParts: string[] = [];
    if (note.triggers.files?.length) triggerParts.push(`files: ${note.triggers.files.join(", ")}`);
    if (note.triggers.grep) triggerParts.push(`grep: ${note.triggers.grep}`);
    const triggers = triggerParts.length > 0 ? triggerParts.join("; ") : "search-only (no triggers)";

    lines.push(`${note.name} (${note.path})`);
    if (note.description.length > 0) lines.push(`  ${note.description}`);
    lines.push(`  Triggers: ${triggers}`);
  }

  return new NotesListResult({ message: lines.join("\n"), exitCode: 0 });
});
