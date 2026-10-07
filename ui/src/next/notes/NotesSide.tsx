/**
 * Notes' sidebar.
 *
 * Views first: every note, the pinned ones, then the collections you saved
 * (a collection is a kept filter, not a folder). Under them, folded until
 * wanted, the two things a note can be narrowed by: what kind it is and which
 * project it belongs to. Those rows are switches, not places: press one and
 * the page shows only that, press it again and it lets go. Type and project
 * can be on together.
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { BookOpen, ChevronRight, Import, Layers, Pin, Sparkles, Trash2, X } from 'lucide-react';
import { LiquidLens, useLiquidIndicator } from '../../finance/components/Liquid';
import type { MenuEntry } from '../../finance/components/Menu';
import { useNotes, type NoteFilter } from '../../notes/NotesContext';
import { KINDS, type NoteKind } from '../../notes/notefile';
import { ProjectDot } from '../../tasks/components/bits';

/** `all`, `pinned`, `trash`, or a collection's id. */
export type NotesScope = string;

const FOLDS = 'axonix.next.notes.folds';
type Folds = Record<string, boolean>;
const OPEN_AT_FIRST: Folds = { kinds: true, projects: true };

function readFolds(): Folds {
  try {
    return { ...OPEN_AT_FIRST, ...(JSON.parse(localStorage.getItem(FOLDS) ?? '{}') as Folds) };
  } catch {
    return OPEN_AT_FIRST;
  }
}

function Group({ id, title, count, open, onToggle, children }: { id: string; title: string; count: number; open: boolean; onToggle: (id: string) => void; children: ReactNode }) {
  return (
    <section className="nx-group" data-open={open}>
      <div className="nx-group__head">
        <button type="button" className="nx-group__toggle" aria-expanded={open} onClick={() => onToggle(id)}>
          <ChevronRight className="nx-group__chev" size={12} strokeWidth={2} aria-hidden="true" />
          <span>{title}</span>
          <span className="fin-num">{count}</span>
        </button>
      </div>
      {open && <div className="nx-group__rows">{children}</div>}
    </section>
  );
}

export interface NotesSideProps {
  scope: NotesScope;
  filter: NoteFilter;
  onScope: (scope: NotesScope, filter?: NoteFilter) => void;
  onFilter: (patch: Partial<NoteFilter>) => void;
  onTemplates: () => void;
  onImport: () => void;
}

export default function NotesSide({ scope, filter, onScope, onFilter, onTemplates, onImport }: NotesSideProps) {
  const { notes, collections, deleteCollection } = useNotes();
  const host = useRef<HTMLElement>(null);
  const lens = useRef<HTMLSpanElement>(null);
  useLiquidIndicator(host, lens, scope === 'trash' ? undefined : scope, 'y');
  const [folds, setFolds] = useState(readFolds);
  const toggle = useCallback((id: string) => {
    setFolds((now) => {
      const next = { ...now, [id]: !now[id] };
      try {
        localStorage.setItem(FOLDS, JSON.stringify(next));
      } catch {
        /* storage refused: the fold lasts for this session only */
      }
      return next;
    });
  }, []);

  const kinds = KINDS.map((k) => ({ ...k, count: notes.filter((n) => n.kind === k.id).length })).filter((k) => k.count > 0);
  const projects = [...new Set(notes.map((n) => n.project))].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));

  return (
    <>
      <nav className="nx-nav nxn-nav" ref={host} aria-label="Notes views">
        <LiquidLens lensRef={lens} radius={10} />
        <button type="button" data-liquid-key="all" className="nx-nav__item" aria-current={scope === 'all' ? 'page' : undefined} onClick={() => onScope('all')}>
          <span className="nx-nav__glyph">
            <BookOpen size={16} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <span>All notes</span>
          <span className="nxt-nav__count fin-num">{notes.length || ''}</span>
        </button>
        <button type="button" data-liquid-key="pinned" className="nx-nav__item" aria-current={scope === 'pinned' ? 'page' : undefined} onClick={() => onScope('pinned')}>
          <span className="nx-nav__glyph">
            <Pin size={16} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <span>Pinned</span>
          <span className="nxt-nav__count fin-num">{notes.filter((n) => n.pinned).length || ''}</span>
        </button>
        {collections.map((c) => (
          <div key={c.id} className="nxn-nav__collection" data-liquid-key={c.id}>
            <button type="button" className="nx-nav__item" aria-current={scope === c.id ? 'page' : undefined} onClick={() => onScope(c.id, c.filter)}>
              <span className="nx-nav__glyph">
                <Layers size={16} strokeWidth={1.6} aria-hidden="true" />
              </span>
              <span className="nxt-nav__name">{c.name}</span>
            </button>
            <button
              type="button"
              className="nx-iconbtn nx-iconbtn--sm"
              aria-label={`Remove the collection ${c.name}`}
              title="Remove this collection. Its notes stay."
              onClick={() => {
                deleteCollection(c.id);
                if (scope === c.id) onScope('all');
              }}
            >
              <X size={12} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        ))}
      </nav>

      <div className="nx-side__more">
        {kinds.length > 0 && (
          <Group id="kinds" title="Types" count={kinds.length} open={folds.kinds} onToggle={toggle}>
            {kinds.map((k) => (
              <button key={k.id} type="button" className="nx-row nxn-switch" aria-pressed={filter.kind === k.id} onClick={() => onFilter({ kind: filter.kind === k.id ? undefined : (k.id as NoteKind) })}>
                <span className="nx-row__label">{k.label}</span>
                <span className="nx-row__hint fin-num">{k.count}</span>
              </button>
            ))}
          </Group>
        )}
        {projects.length > 1 && (
          <Group id="projects" title="Projects" count={projects.length} open={folds.projects} onToggle={toggle}>
            {projects.map((p) => (
              <button key={p || '·personal'} type="button" className="nx-row nxn-switch" aria-pressed={filter.project === p} onClick={() => onFilter({ project: filter.project === p ? undefined : p })}>
                <span className="nx-row__icon">
                  <ProjectDot name={p} />
                </span>
                <span className="nx-row__label">{p || 'Personal'}</span>
                <span className="nx-row__hint fin-num">{notes.filter((n) => n.project === p).length}</span>
              </button>
            ))}
          </Group>
        )}
      </div>

      <div className="nx-side__foot">
        <button type="button" className="nx-row" onClick={onTemplates}>
          <span className="nx-row__icon">
            <Sparkles size={14} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <span className="nx-row__label">Templates</span>
        </button>
        <button type="button" className="nx-row" onClick={onImport} title="Markdown, text, or an Axonix note export">
          <span className="nx-row__icon">
            <Import size={14} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <span className="nx-row__label">Import</span>
        </button>
        <button type="button" className="nx-row nxn-switch" aria-pressed={scope === 'trash'} onClick={() => onScope(scope === 'trash' ? 'all' : 'trash')}>
          <span className="nx-row__icon">
            <Trash2 size={14} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <span className="nx-row__label">Recently deleted</span>
        </button>
      </div>
    </>
  );
}

/** With the sidebar put away: what is left of it, as the menu on the module's name. */
export function notesMenu(collections: { id: string; name: string; filter: NoteFilter }[], onScope: (scope: NotesScope, filter?: NoteFilter) => void, onTemplates: () => void, onImport: () => void): MenuEntry[] {
  const glyph = { size: 14, strokeWidth: 1.6 } as const;
  return [
    ...collections.map((c) => ({ id: `collection-${c.id}`, label: c.name, icon: <Layers {...glyph} />, onSelect: () => onScope(c.id, c.filter) })),
    ...(collections.length ? [{ separator: true as const, id: 'sep-collections' }] : []),
    { id: 'templates', label: 'Templates', icon: <Sparkles {...glyph} />, onSelect: onTemplates },
    { id: 'import', label: 'Import', icon: <Import {...glyph} />, onSelect: onImport },
    { id: 'trash', label: 'Recently deleted', icon: <Trash2 {...glyph} />, onSelect: () => onScope('trash') },
  ];
}
