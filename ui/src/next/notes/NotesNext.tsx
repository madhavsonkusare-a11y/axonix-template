/**
 * Notes in the new shell.
 *
 * Same notes, same files, same context (`NotesContext`). The document itself
 * (`NotePage`: the block editor, saving, the recovery draft, export, the
 * properties panel) is the first Notes' own and is not rewritten here: it is
 * what stands between a keystroke and the file.
 *
 * What is new is everything around it. With no note open the page is the
 * library, as cards gathered by how recently they were touched. With one open,
 * the page is the document, and the notes of the current view stay in a list
 * beside it that can be put away. Type and project are switches in the
 * sidebar, and any mix of them (and a search) can be kept as a collection.
 *
 * Keys, as before: Ctrl+N new note, Ctrl+Shift+F search, Ctrl+S save now.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileText, Layers, NotebookPen, Pin, PinOff, Plus, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import ErrorBoundary from '../../ErrorBoundary';
import { LiquidSegment } from '../../finance/components/Liquid';
import { Menu, PopUpButton, type MenuEntry } from '../../finance/components/Menu';
import Sheet, { Field, SheetFooter } from '../../finance/components/Sheet';
import NotePage from '../../notes/NotePage';
import type { NoteRequest } from '../../notes/NotesFrame';
import { matchesNote, useNotes, type NoteFilter } from '../../notes/NotesContext';
import { isConflict, messageOf, vault, type TrashedNote } from '../../notes/backend';
import { KINDS, KIND_LABEL, parseNote, setNoteProps, type Note, type NoteKind } from '../../notes/notefile';
import Shell from '../Shell';
import { useDockApps } from '../apps';
import Linked from '../lift/Links';
import { liftAttrs, noteThing } from '../lift/things';
import { refuseChange, useAsOf } from '../scrub/Scrub';
import Library, { Deleted, whenLabel, type NoteSort } from './Library';
import NotesSide, { notesMenu, type NotesScope } from './NotesSide';

const ACTIVE = 'axonix:notes:active';
const SORT = 'axonix:notes:sort';
const LIST = 'axonix.next.notes.list';

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const keep = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage refused: the choice lasts for this session only */
  }
};

const SORTS: { value: NoteSort; label: string }[] = [
  { value: 'edited', label: 'Last edited' },
  { value: 'title', label: 'Title' },
  { value: 'oldest', label: 'Oldest first' },
];

export interface NotesNextProps {
  /** A note to open, asked for from another module (a task's linked note). */
  request?: NoteRequest | null;
  onOpenApp: (id: string) => void;
  onSearch: () => void;
}

export default function NotesNext({ request, onOpenApp, onSearch }: NotesNextProps) {
  const apps = useDockApps();
  const { notes: allNotes, loading, error, create, saved, forget, refresh, collections, saveCollection } = useNotes();
  // Looking back, the library is what had been written by then. A note keeps
  // one text and no history, so an open note reads as it does today.
  const asOf = useAsOf();
  const notes = useMemo(() => {
    if (!asOf.past) return allNotes;
    const [y, m, d] = asOf.day.split('-').map(Number);
    const end = new Date(y, m - 1, d + 1).getTime();
    return allNotes.filter((n) => n.mtime < end);
  }, [allNotes, asOf.past, asOf.day]);
  const [active, setActive] = useState<string | null>(() => read(ACTIVE) || null);
  const [scope, setScope] = useState<NotesScope>('all');
  const [filter, setFilter] = useState<NoteFilter>({});
  const [sort, setSortState] = useState<NoteSort>(() => (SORTS.some((s) => s.value === read(SORT)) ? (read(SORT) as NoteSort) : 'edited'));
  const [list, setListState] = useState(() => read(LIST) !== 'closed');
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState(false);
  const [collectionForm, setCollectionForm] = useState(false);
  const [collectionName, setCollectionName] = useState('');
  const [trash, setTrash] = useState<TrashedNote[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashError, setTrashError] = useState('');
  const [restoreBusy, setRestoreBusy] = useState<string | null>(null);
  const [cardMenu, setCardMenu] = useState<{ note: Note; at: { x: number; y: number }; trigger: HTMLElement } | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  /* ---------- the open document saves before anything takes its place ---------- */

  const flush = useRef<(() => Promise<boolean>) | null>(null);
  const registerFlush = useCallback((f: (() => Promise<boolean>) | null) => {
    flush.current = f;
  }, []);
  const settled = useCallback(async () => !flush.current || (await flush.current()), []);

  const select = useCallback(
    async (path: string | null) => {
      if (!(await settled())) return;
      setActive(path);
      keep(ACTIVE, path ?? '');
    },
    [settled],
  );
  const leave = useCallback(
    (go: () => void) => {
      void settled().then((ok) => ok && go());
    },
    [settled],
  );

  const setSort = useCallback((s: NoteSort) => {
    setSortState(s);
    keep(SORT, s);
  }, []);
  const toggleList = useCallback(() => {
    setListState((on) => {
      keep(LIST, on ? 'closed' : 'open');
      return !on;
    });
  }, []);

  /* ---------- what the page shows ---------- */

  const effective = useMemo<NoteFilter>(() => ({ ...filter, ...(scope === 'pinned' ? { pinned: true } : {}) }), [filter, scope]);
  const visible = useMemo(
    () =>
      notes
        .filter((n) => matchesNote(n, effective))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (sort === 'title' ? a.title.localeCompare(b.title) : sort === 'oldest' ? a.mtime - b.mtime : b.mtime - a.mtime)),
    [notes, effective, sort],
  );
  const current = scope === 'trash' ? undefined : allNotes.find((n) => n.path === active);
  const collection = collections.find((c) => c.id === scope);
  const title = scope === 'pinned' ? 'Pinned' : scope === 'trash' ? 'Recently deleted' : (collection?.name ?? 'All notes');
  const narrowed = Boolean(filter.kind || filter.project !== undefined || filter.query?.trim());

  const loadTrash = useCallback(async () => {
    setTrashLoading(true);
    setTrashError('');
    try {
      setTrash(await vault.listTrash());
    } catch (e) {
      setTrashError(messageOf(e));
    } finally {
      setTrashLoading(false);
    }
  }, []);

  const chooseScope = useCallback(
    (next: NotesScope, nextFilter: NoteFilter = {}) => {
      void settled().then((ok) => {
        if (!ok) return;
        setScope(next);
        setFilter(nextFilter);
        // A view is somewhere you go to look: the open note closes, the library shows.
        setActive(null);
        keep(ACTIVE, '');
        if (next === 'trash') void loadTrash();
      });
    },
    [settled, loadTrash],
  );
  const patchFilter = useCallback(
    (patch: Partial<NoteFilter>) => {
      setFilter((f) => ({ ...f, ...patch }));
      // Narrowing a saved collection makes it a plain filter again.
      setScope((s) => (s === 'trash' || collections.some((c) => c.id === s) ? 'all' : s));
    },
    [collections],
  );

  /* ---------- a note asked for from elsewhere ---------- */

  const requestSeen = useRef<number | null>(null);
  useEffect(() => {
    if (!request || requestSeen.current === request.n || loading) return;
    const target = request.target.replace(/\.md$/i, '').toLowerCase();
    const bare = (p: string) => p.replace(/\.md$/i, '').toLowerCase();
    const found = notes.find((n) => n.title.toLowerCase() === target || bare(n.path) === target || bare(n.path).split('/').pop() === target);
    requestSeen.current = request.n;
    if (found) {
      setScope('all');
      setFilter({});
      void select(found.path);
    } else toast('That note could not be found.');
  }, [request, notes, loading, select]);

  /* ---------- making, importing, restoring ---------- */

  const add = useCallback(
    async (kind: NoteKind = 'note') => {
      if (!asOf.live) return refuseChange(asOf.day);
      if (creating || !(await settled())) return;
      setCreating(true);
      try {
        const path = await create({ kind, project: filter.project || '' });
        if (path) {
          if (scope === 'trash') setScope('all');
          setActive(path);
          keep(ACTIVE, path);
          setTemplates(false);
        }
      } finally {
        setCreating(false);
      }
    },
    [creating, settled, create, filter.project, scope, asOf.live, asOf.day],
  );

  const restore = async (item: TrashedNote) => {
    setRestoreBusy(item.path);
    try {
      const r = await vault.restore(item.path, item.originalPath);
      saved(r.path, r.text);
      await loadTrash();
      toast('Note restored.');
    } catch (e) {
      toast(`Could not restore: ${messageOf(e)}`);
    } finally {
      setRestoreBusy(null);
    }
  };

  /* ---------- a card's menu: pin or delete without opening the note ---------- */

  // Both name the text they replace, as every write to a note does: if the
  // file changed on disk since it was read, nothing is written.
  const togglePin = async (note: Note) => {
    if (!asOf.live) return refuseChange(asOf.day);
    try {
      const r = await vault.write(note.path, setNoteProps(note.text, { pinned: !note.pinned }), note.text);
      saved(r.path, r.text);
    } catch (e) {
      toast(isConflict(e) ? 'That note changed on disk a moment ago. Try again.' : `Could not change the pin: ${messageOf(e)}`);
    }
  };
  const moveToTrash = async (note: Note) => {
    if (!asOf.live) return refuseChange(asOf.day);
    try {
      const trashPath = await vault.trash(note.path, note.text);
      forget(note.path);
      toast('Moved to Recently deleted.', {
        action: {
          label: 'Undo',
          onClick: () =>
            void vault
              .restore(trashPath, note.path)
              .then((r) => saved(r.path, r.text))
              .catch((e) => toast(messageOf(e))),
        },
      });
    } catch (e) {
      toast(isConflict(e) ? 'That note changed on disk a moment ago. Try again.' : `Could not delete the note: ${messageOf(e)}`);
    }
  };
  const cardEntries = (note: Note): MenuEntry[] => [
    { id: 'open', label: 'Open', icon: <FileText size={14} strokeWidth={1.6} />, onSelect: () => void select(note.path) },
    { id: 'pin', label: note.pinned ? 'Unpin' : 'Pin', icon: note.pinned ? <PinOff size={14} strokeWidth={1.6} /> : <Pin size={14} strokeWidth={1.6} />, disabled: !!note.broken, onSelect: () => void togglePin(note) },
    { separator: true, id: 'sep' },
    { id: 'delete', label: 'Move to Recently deleted', icon: <Trash2 size={14} strokeWidth={1.6} />, destructive: true, onSelect: () => void moveToTrash(note) },
  ];

  const importFiles = async (files: FileList | null) => {
    if (!files || !(await settled())) return;
    for (const file of Array.from(files)) {
      try {
        if (file.size > 12 * 1024 * 1024) throw new Error('Choose a note smaller than 12 MB.');
        let text = await file.text();
        let blocks: string | null = null;
        let name = file.name.replace(/\.(md|txt|json)$/i, '').replace(/\.axonix-note$/i, '');
        if (file.name.endsWith('.json')) {
          const bundle = JSON.parse(text);
          if (bundle.format !== 'axonix-note-v2' || typeof bundle.text !== 'string') throw new Error('This is not an Axonix note export.');
          text = bundle.text;
          if (bundle.document) {
            if (bundle.document.type !== 'page' || !bundle.document.blocks) throw new Error('Invalid rich document.');
            blocks = JSON.stringify(bundle.document);
          }
          name = parseNote('', text, Date.now()).title || name;
        }
        const path = await create({ title: name });
        if (!path) continue;
        const fresh = await vault.read(path);
        const r = await vault.saveDocument(path, setNoteProps(text, { title: name }), blocks, fresh.text, null);
        saved(path, r.text);
        setScope('all');
        setFilter({});
        setActive(path);
        keep(ACTIVE, path);
      } catch (e) {
        toast(`Could not import ${file.name}: ${messageOf(e)}`);
      }
    }
    if (picker.current) picker.current.value = '';
  };

  /* ---------- keys ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (ctrl && !e.shiftKey && key === 'n') {
        e.preventDefault();
        e.stopPropagation();
        void add();
      } else if (ctrl && e.shiftKey && key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        search.current?.focus();
      } else if (ctrl && !e.shiftKey && key === 's') {
        e.preventDefault();
        e.stopPropagation();
        void flush.current?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [add]);

  /* ---------- render ---------- */

  const chips = (
    <>
      {filter.kind && (
        <button type="button" className="nxn-chip" onClick={() => patchFilter({ kind: undefined })} title="Stop narrowing by type">
          {KIND_LABEL[filter.kind]} <X size={11} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
      {filter.project !== undefined && (
        <button type="button" className="nxn-chip" onClick={() => patchFilter({ project: undefined })} title="Stop narrowing by project">
          {filter.project || 'Personal'} <X size={11} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
      {filter.query?.trim() && (
        <button type="button" className="nxn-chip" onClick={() => patchFilter({ query: '' })} title="Clear the search">
          “{filter.query.trim()}” <X size={11} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
    </>
  );

  const empty = (
    <section className="nxf-card">
      <div className="fin-empty fin-empty--tall">
        {notes.length === 0 ? <NotebookPen size={24} strokeWidth={1.3} aria-hidden="true" /> : <Search size={22} strokeWidth={1.4} aria-hidden="true" />}
        <p className="fin-empty__text">
          {notes.length === 0 ? 'No notes yet. Write the first one, or start from a template.' : scope === 'pinned' && !narrowed ? 'Nothing is pinned. Pin a note from its toolbar to keep it here.' : 'No note matches.'}
        </p>
        {/* Templates has one door, at the sidebar's foot. */}
        {notes.length === 0 ? null : narrowed ? (
          <button type="button" className="fin-pill fin-pill--sm" onClick={() => setFilter({})}>
            Clear the filters
          </button>
        ) : null}
      </div>
    </section>
  );

  const views = [
    { value: 'all', label: 'All notes' },
    { value: 'pinned', label: 'Pinned' },
    ...collections.map((c) => ({ value: c.id, label: c.name })),
  ];
  const tabs = (
    <LiquidSegment<string>
      label="Notes views"
      className="nx-tabs"
      mono={false}
      value={scope}
      onChange={(v) => chooseScope(v, collections.find((c) => c.id === v)?.filter)}
      options={scope === 'trash' ? [...views, { value: 'trash', label: 'Recently deleted' }] : views}
    />
  );

  const find = (
    <label className="nx-find nxn-find">
      <Search size={14} strokeWidth={1.7} aria-hidden="true" />
      <input
        ref={search}
        value={filter.query ?? ''}
        onChange={(e) => patchFilter({ query: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            if (filter.query) patchFilter({ query: '' });
            else e.currentTarget.blur();
          }
        }}
        placeholder="Search your notes"
        aria-label="Search notes"
        spellCheck={false}
      />
      {filter.query ? (
        <button type="button" className="nx-iconbtn nx-iconbtn--sm" onClick={() => patchFilter({ query: '' })} aria-label="Clear the search">
          <X size={12} strokeWidth={1.8} aria-hidden="true" />
        </button>
      ) : (
        <span className="fin-key">Ctrl ⇧ F</span>
      )}
    </label>
  );

  return (
    <>
      <Shell
        module="notes"
        title="Notes"
        icon={NotebookPen}
        apps={apps}
        onOpenApp={(id) => leave(() => onOpenApp(id))}
        onAsk={onSearch}
        side={
          <NotesSide
            scope={scope}
            filter={filter}
            onScope={chooseScope}
            onFilter={(patch) => {
              // The switches narrow the library, so the library is what shows.
              void select(null);
              patchFilter(patch);
            }}
            onTemplates={() => setTemplates(true)}
            onImport={() => picker.current?.click()}
          />
        }
        tabs={tabs}
        menu={() => notesMenu(collections, chooseScope, () => setTemplates(true), () => picker.current?.click())}
        lead={find}
        actions={
          <button type="button" className="fin-pill fin-pill--action" onClick={() => void add()} disabled={creating} title="New note · Ctrl N">
            <Plus size={14} strokeWidth={2} aria-hidden="true" /> New note
          </button>
        }
        scrollKey={current ? 'document' : `library ${scope}`}
        fill={!!current}
      >
        <ErrorBoundary label="notes">
          {current ? (
            <div className="nv-workspace nxn" data-list={list || undefined}>
              {list && (
                <aside className="nxn-list" aria-label={title}>
                  <div className="nxn-list__head">
                    <button type="button" className="nx-iconbtn nx-iconbtn--sm" onClick={() => void select(null)} aria-label="Back to the library" title="Back to the library">
                      <ArrowLeft size={14} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                    <h3>{title}</h3>
                    <span className="fin-num">{visible.length}</span>
                  </div>
                  <div className="nxn-list__rows">
                    {visible.map((n) => (
                      <ListRow key={n.path} note={n} selected={n.path === active} onClick={() => void select(n.path)} />
                    ))}
                    {visible.length === 0 && <p className="nxn-list__none">No note matches. The open one is still here.</p>}
                  </div>
                </aside>
              )}
              {/* The open note takes a drop: whatever is carried here is linked to it. */}
              <main className="nxn-doc" data-drop={`thing:note:${current.path}`} data-drop-title={current.title || 'this note'}>
                <div className="nxn-linked">
                  <Linked thing={{ kind: 'note', id: current.path }} label="Linked to this note" />
                </div>
                <NotePage
                  key={current.path}
                  note={current}
                  focus={!list}
                  onFocus={toggleList}
                  onBack={() => void select(null)}
                  onOpen={(path) => void select(path)}
                  onDeleted={() => {
                    flush.current = null;
                    setActive(null);
                    keep(ACTIVE, '');
                  }}
                  registerFlush={registerFlush}
                />
              </main>
            </div>
          ) : (
            <div className="nxf-page nxn-page">
              <header className="nxf-head">
                <div>
                  <h2>{title}</h2>
                  <p>
                    {scope === 'trash' ? (
                      'Deleted notes wait here and can be brought back.'
                    ) : loading ? (
                      'Opening your library…'
                    ) : (
                      <>
                        <b className="fin-num">{visible.length}</b> {visible.length === 1 ? 'note' : 'notes'}
                        {narrowed && notes.length !== visible.length && <> of {notes.length}</>}
                      </>
                    )}
                  </p>
                </div>
                {scope !== 'trash' && (
                  <div className="nxn-head__end">
                    {chips}
                    {narrowed && !collection && (
                      <button
                        type="button"
                        className="fin-pill fin-pill--sm"
                        onClick={() => {
                          setCollectionName('');
                          setCollectionForm(true);
                        }}
                        title="Keep this mix of type, project and search. Matching notes appear in it on their own."
                      >
                        <Layers size={13} strokeWidth={1.8} aria-hidden="true" /> Save as a collection
                      </button>
                    )}
                    <PopUpButton<NoteSort> label="Sort notes" value={sort} onChange={setSort} options={SORTS} />
                  </div>
                )}
              </header>

              {error || trashError ? (
                <p className="fin-error" role="alert">
                  {error || trashError}{' '}
                  <button type="button" className="fin-link" onClick={() => void (scope === 'trash' ? loadTrash() : refresh())}>
                    Try again
                  </button>
                </p>
              ) : scope === 'trash' ? (
                trashLoading ? null : (
                  <Deleted items={trash} busy={restoreBusy} onRestore={(item) => void restore(item)} />
                )
              ) : loading ? null : (
                <Library notes={visible} sort={sort} pinnedApart={scope !== 'pinned'} onOpen={(path) => void select(path)} onMenu={(note, at, trigger) => setCardMenu({ note, at, trigger })} empty={empty} />
              )}
            </div>
          )}
        </ErrorBoundary>
      </Shell>

      <input ref={picker} type="file" hidden multiple accept=".md,.txt,.json" onChange={(e) => void importFiles(e.target.files)} />
      {cardMenu && <Menu entries={cardEntries(cardMenu.note)} placement={{ at: cardMenu.at }} onClose={() => setCardMenu(null)} trigger={cardMenu.trigger} label={cardMenu.note.title} />}

      <Sheet open={templates} onClose={() => setTemplates(false)} title="Start from a template" subtitle="Each kind of note begins with the headings it usually needs" width={520}>
        <div className="nxn-templates">
          {KINDS.map((k) => (
            <button key={k.id} type="button" disabled={creating} onClick={() => void add(k.id)}>
              <FileText size={18} strokeWidth={1.4} aria-hidden="true" />
              <span>
                <strong>{k.label}</strong>
                <small>{k.hint}</small>
              </span>
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={collectionForm} onClose={() => setCollectionForm(false)} title="Save as a collection" subtitle="A kept filter, not a folder: matching notes appear in it on their own" width={460}>
        <form
          id="nxn-collection-form"
          className="fin-form"
          onSubmit={(e) => {
            e.preventDefault();
            const c = saveCollection(collectionName, effective);
            setScope(c.id);
            setCollectionForm(false);
          }}
        >
          <Field label="Name">
            <input className="fin-input" autoFocus required value={collectionName} onChange={(e) => setCollectionName(e.target.value)} placeholder="Research, meeting notes, ideas…" />
          </Field>
          <p className="fin-hint">
            Keeps: {[filter.kind && KIND_LABEL[filter.kind], filter.project !== undefined && (filter.project || 'Personal'), filter.query?.trim() && `“${filter.query.trim()}”`, scope === 'pinned' && 'pinned only'].filter(Boolean).join(' · ')}
          </p>
          <SheetFooter>
            <span className="fin-spacer" />
            <button type="button" className="fin-pill" onClick={() => setCollectionForm(false)}>
              Cancel
            </button>
            <button className="fin-pill fin-pill--action" type="submit" form="nxn-collection-form">
              Save
            </button>
          </SheetFooter>
        </form>
      </Sheet>
    </>
  );
}

function ListRow({ note, selected, onClick }: { note: Note; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" className="nxn-row" data-selected={selected || undefined} aria-current={selected ? 'page' : undefined} {...liftAttrs(noteThing(note))} onClick={onClick}>
      <span className="nxn-row__title">
        {note.pinned && <Pin size={11} strokeWidth={1.8} aria-hidden="true" />}
        <strong>{note.title || 'Untitled'}</strong>
      </span>
      <span className="nxn-row__text">{note.excerpt || 'No text yet'}</span>
      <span className="nxn-row__meta">
        <span className="fin-num">{whenLabel(note.mtime)}</span>
        <span>{note.project || KIND_LABEL[note.kind]}</span>
      </span>
    </button>
  );
}
