/**
 * A new note with its text already in it.
 *
 * `NotesContext.create` makes the file with the app's own header for its kind.
 * This puts a body under that header in the same breath. Used where a note is
 * made from something else: a thing dropped on Notes (Lift), and the
 * assistant, whose notes are marked machine-made.
 */
import type { NotesValue } from './NotesContext';
import { messageOf, vault } from './backend';
import { newNoteText, type NoteKind } from './notefile';

export interface Composed {
  path: string;
  /** The text as saved, for putting the note in the trash again. */
  text: string;
}

export async function composeNote(notes: NotesValue, opts: { title: string; body?: string; kind?: NoteKind; project?: string; /** Written by a machine: the header says so. */ machine?: boolean }): Promise<Composed> {
  const kind = opts.kind ?? 'note';
  const project = opts.project ?? '';
  const path = await notes.create({ title: opts.title, kind, project });
  if (!path) throw new Error('the note could not be created');
  const body = (opts.body ?? '').trim();
  if (!body && !opts.machine) {
    const made = await vault.read(path).catch(() => ({ text: '' }));
    return { path, text: made.text };
  }
  let head = newNoteText(kind, project, { title: opts.title });
  if (opts.machine) head = head.startsWith('---\n') ? head.replace(/\n---\n/, '\nstatus: unverified\ngenerated_by: axonix-assistant\n---\n') : `---\nstatus: unverified\ngenerated_by: axonix-assistant\n---\n${head}`;
  // The header only; the kind's scaffold gives way to the text being written.
  const end = head.startsWith('---\n') ? head.indexOf('\n---\n', 4) : -1;
  const text = `${end >= 0 ? `${head.slice(0, end + 5)}\n` : ''}${body}\n`;
  try {
    const current = await vault.read(path);
    const saved = await vault.write(path, text, current.text);
    notes.saved(saved.path, saved.text);
    return { path: saved.path, text: saved.text };
  } catch (e) {
    throw new Error(`the note was created but its text could not be written: ${messageOf(e)}`);
  }
}

/** Takes a just-made note back: into the vault's trash, where it can be found again. */
export async function discardNote(notes: NotesValue, made: Composed): Promise<void> {
  const now = await vault.read(made.path).catch(() => ({ text: made.text }));
  await vault.trash(made.path, now.text);
  notes.forget(made.path);
}
