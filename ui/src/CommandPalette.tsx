/**
 * Cmd/Ctrl-K command palette.
 *
 * The one search surface in the app: the finance top bar's search pill and the
 * launcher's "Jump anywhere" both open this rather than adding a second input.
 * Built on `cmdk` (MIT).
 *
 * The pill says "Search, jump, or add", so it searches: typed text can be
 * handed to the transactions ledger, accounts and payment methods open their
 * details directly, and from two letters on it finds tasks and notes by name
 * and opens them where they live. It used to hold Finance commands only.
 *
 * Open state is owned by `App` so those two affordances can raise it; the
 * keyboard shortcut is still handled here, next to the thing it opens.
 */
import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import { Archive, CalendarDays, FilePlus2, FileText, FileUp, FolderKanban, History, Home as HomeIcon, IdCard, ListPlus, NotebookPen, Plus, Search, Settings2, SquareCheck, Users, Wallet, WalletCards } from 'lucide-react';
import { NAV, type FinanceIntent, type Frame } from './finance/FinanceApp';
import { frameIcon } from './finance/components/Glyphs';
import { BrandMark } from './finance/components/BrandMark';
import { useFinance } from './finance/FinanceContext';
import { KIND_LABEL } from './finance/ledger';
import { money } from './finance/format';
import { parseEntry } from './finance/parse';
import { useTasks } from './tasks/TasksContext';
import { isOpen, projectLabel } from './tasks/derive';
import { ProjectDot, StateGlyph } from './tasks/components/bits';
import { useNotes } from './notes/NotesContext';
import { KIND_LABEL as NOTE_KIND } from './notes/notefile';

export interface PaletteProps {
  open: boolean;
  /** Words to open with (a thing dropped on the mark). */
  seed?: string;
  onOpenChange: (open: boolean) => void;
  onHome: () => void;
  onFrame: (frame: Frame) => void;
  onIntent: (intent: FinanceIntent) => void;
  /** Opens a module by its dock id. */
  onApp?: (id: string) => void;
  /** Opens a task's panel in Tasks. */
  onOpenTask?: (id: string) => void;
  /** Goes to Tasks with the add line ready. */
  onAddTask?: () => void;
  /** Opens a project in Tasks. */
  onProject?: (project: string) => void;
  /** Opens a note, by path, in Notes. */
  onOpenNote?: (path: string) => void;
  /** The first version of each module, kept beside the new one. */
  onLegacyFinance?: () => void;
  onLegacyHome?: () => void;
  onLegacyTasks?: () => void;
  onLegacyCalendar?: () => void;
  onLegacyNotes?: () => void;
  onLegacyStoreroom?: () => void;
  onLegacySocial?: () => void;
}

const MODULES: { id: string; label: string; keywords: string; Icon: typeof Plus }[] = [
  { id: 'finance', label: 'Finance', keywords: 'money accounts spending', Icon: Wallet },
  { id: 'tasks', label: 'Tasks', keywords: 'board kanban to do', Icon: SquareCheck },
  { id: 'projects', label: 'Projects', keywords: 'today agenda upcoming ahead momentum', Icon: FolderKanban },
  { id: 'calendar', label: 'Calendar', keywords: 'week month time blocks events schedule', Icon: CalendarDays },
  { id: 'notes', label: 'Notes', keywords: 'write library documents', Icon: NotebookPen },
  { id: 'storeroom', label: 'Storeroom', keywords: 'references inspiration images links', Icon: Archive },
  { id: 'social', label: 'Social', keywords: 'instagram x threads reddit linkedin pinterest', Icon: Users },
];

const ACTIONS: { intent: FinanceIntent; label: string; keywords: string; Icon: typeof Plus }[] = [
  { intent: { type: 'add' }, label: 'Add a transaction', keywords: 'new expense income spend quick add', Icon: Plus },
  { intent: { type: 'import' }, label: 'Import a bank statement', keywords: 'csv upload sbi icici', Icon: FileUp },
  { intent: { type: 'account' }, label: 'Add an account', keywords: 'bank card forex demat', Icon: WalletCards },
  { intent: { type: 'id' }, label: 'Add a digital ID', keywords: 'aadhaar pan passport licence digilocker', Icon: IdCard },
  { intent: { type: 'settings' }, label: 'Finance settings', keywords: 'categories budgets subscriptions backup export restore', Icon: Settings2 },
];

const METHOD_WORD = { upi: 'UPI app', card: 'Card', wallet: 'Wallet' } as const;

export default function CommandPalette({ open, seed, onOpenChange, onHome, onApp, onOpenTask, onAddTask, onProject, onOpenNote, onFrame, onIntent, onLegacyFinance, onLegacyHome, onLegacyTasks, onLegacyCalendar, onLegacyNotes, onLegacyStoreroom, onLegacySocial }: PaletteProps) {
  const { data } = useFinance();
  const { tasks, projects } = useTasks();
  const { notes, create: createNote } = useNotes();
  const [search, setSearch] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        // A modal sheet owns the top layer; a palette opened now would sit
        // invisible and unreachable underneath it.
        if (document.querySelector('dialog[open]')) return;
        onOpenChange(!open);
      }
      // App also listens for Escape to return to the launcher. Both listeners
      // are on `window`, so stopPropagation would not stop it — App's own
      // `!paletteOpen` guard is what keeps one keypress from doing two things.
      if (e.key === 'Escape' && open) onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  // Each opening starts with an empty box, or with the words it was opened for.
  useEffect(() => {
    setSearch(open ? (seed ?? '') : '');
  }, [open, seed]);

  if (!open) return null;

  const run = (fn: () => void) => {
    fn();
    onOpenChange(false);
  };
  const query = search.trim();

  // Tasks and notes are found here rather than by cmdk: there can be hundreds,
  // and a fuzzy match over all of them would bury the commands. Every word
  // must appear; what is still open comes first; six of each at most.
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const has = (text: string) => words.every((w) => text.toLowerCase().includes(w));
  const finds = query.length >= 2;
  const taskHits = finds && onOpenTask ? tasks.filter((t) => has(`${t.title} ${t.project}`)).sort((a, b) => Number(isOpen(b)) - Number(isOpen(a))).slice(0, 6) : [];
  const noteHits = finds && onOpenNote ? notes.filter((n) => has(`${n.title} ${n.project}`)).slice(0, 6) : [];
  // A line that reads as money ("paid 450 chai", "salary 80k") is offered as an
  // entry. It opens the Add sheet filled in: the sheet checks it and saves it,
  // so nothing reaches the ledger without being seen.
  const entry = /\d/.test(query) && /[a-z]/i.test(query) ? parseEntry(query, data) : null;
  const quick = entry && entry.amount && entry.merchant ? entry : null;
  const newNote = async () => {
    const path = await createNote({});
    if (path) onOpenNote?.(path);
  };

  return (
    <div className="palette__scrim" onClick={() => onOpenChange(false)}>
      <Command className="palette" label="Command palette" onClick={(e) => e.stopPropagation()} loop>
        <div className="palette__input">
          <Search size={14} strokeWidth={1.75} />
          <Command.Input autoFocus value={search} onValueChange={setSearch} placeholder="Search tasks, notes and transactions, jump anywhere, or add…" />
        </div>

        <Command.List>
          <Command.Empty>No matches.</Command.Empty>

          {quick && (
            <Command.Group heading="Quick add" forceMount>
              <Command.Item
                forceMount
                value={`quick add ${query}`}
                onSelect={() =>
                  run(() =>
                    onIntent({
                      type: 'add',
                      preset: { kind: quick.kind, amount: quick.amount, merchant: quick.merchant, category: quick.category, accountId: quick.accountId, methodId: quick.methodId, toAccountId: quick.toAccountId, date: quick.date },
                    }),
                  )
                }
              >
                <Plus size={14} strokeWidth={1.75} />
                {quick.kind === 'income' ? 'Add income' : quick.kind === 'transfer' ? 'Add a transfer' : 'Add an expense'}: {money(quick.amount!)} · {quick.merchant}
                <span className="palette__hint">Opens filled in</span>
              </Command.Item>
            </Command.Group>
          )}

          {taskHits.length > 0 && (
            <Command.Group heading="Tasks" forceMount>
              {taskHits.map((t) => (
                <Command.Item forceMount key={t.id} value={`task ${t.id} ${t.title}`} onSelect={() => run(() => onOpenTask!(t.id))}>
                  <StateGlyph state={t.state} size={14} />
                  {t.title}
                  <span className="palette__hint">{projectLabel(t.project)}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {noteHits.length > 0 && (
            <Command.Group heading="Notes" forceMount>
              {noteHits.map((n) => (
                <Command.Item forceMount key={n.path} value={`note ${n.path}`} onSelect={() => run(() => onOpenNote!(n.path))}>
                  <FileText size={14} strokeWidth={1.75} />
                  {n.title || 'Untitled'}
                  <span className="palette__hint">{n.project || NOTE_KIND[n.kind]}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          <Command.Group heading="Do">
            {onAddTask && (
              <Command.Item value="Add a task new todo to do" onSelect={() => run(onAddTask)}>
                <ListPlus size={14} strokeWidth={1.75} />
                Add a task
              </Command.Item>
            )}
            {onOpenNote && (
              <Command.Item value="New note write page" onSelect={() => run(() => void newNote())}>
                <FilePlus2 size={14} strokeWidth={1.75} />
                New note
              </Command.Item>
            )}
            {ACTIONS.map((a) => (
              <Command.Item key={a.label} value={`${a.label} ${a.keywords}`} onSelect={() => run(() => onIntent(a.intent))}>
                <a.Icon size={14} strokeWidth={1.75} />
                {a.label}
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Group heading="Accounts & payment apps">
            {data.accounts
              .filter((a) => !a.archived)
              .map((a) => (
                <Command.Item
                  key={a.id}
                  value={`account ${a.name} ${KIND_LABEL[a.kind]} ${a.id}`}
                  onSelect={() => run(() => onIntent({ type: 'details', target: { type: 'account', id: a.id } }))}
                >
                  <BrandMark brand={a.brand} fallback={a.name} size={16} />
                  {a.name}
                  <span className="palette__hint">{KIND_LABEL[a.kind]}</span>
                </Command.Item>
              ))}
            {data.methods.map((m) => (
              <Command.Item
                key={m.id}
                value={`method ${m.name} ${METHOD_WORD[m.kind]} ${m.id}`}
                onSelect={() => run(() => onIntent({ type: 'details', target: { type: 'method', id: m.id } }))}
              >
                <BrandMark brand={m.brand} fallback={m.name} size={16} />
                {m.name}
                <span className="palette__hint">{METHOD_WORD[m.kind]}</span>
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Group heading="Apps">
            <Command.Item value="home axonix launcher" onSelect={() => run(onHome)}>
              <HomeIcon size={14} strokeWidth={1.75} />
              Axonix Home
            </Command.Item>
            {onApp &&
              MODULES.map((m) => (
                <Command.Item key={m.id} value={`open ${m.label} ${m.keywords}`} onSelect={() => run(() => onApp(m.id))}>
                  <m.Icon size={14} strokeWidth={1.75} />
                  {m.label}
                </Command.Item>
              ))}
          </Command.Group>

          {onProject && projects.length > 0 && (
            <Command.Group heading="Projects">
              {projects.map((p) => (
                <Command.Item key={p} value={`project ${p}`} onSelect={() => run(() => onProject(p))}>
                  <ProjectDot name={p} />
                  {p}
                  <span className="palette__hint">{tasks.filter((t) => isOpen(t) && t.project === p).length || ''}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          <Command.Group heading="First versions">
            {(
              [
                ['Home', 'launcher tiles', onLegacyHome],
                ['Finance', 'tracker', onLegacyFinance],
                ['Tasks', 'board', onLegacyTasks],
                ['Calendar', 'week', onLegacyCalendar],
                ['Notes', 'library', onLegacyNotes],
                ['Storeroom', 'references', onLegacyStoreroom],
                ['Social', 'dock apps', onLegacySocial],
              ] as const
            ).map(
              ([name, words, go]) =>
                go && (
                  <Command.Item key={name} value={`legacy ${name} old previous first ${words}`} onSelect={() => run(go)}>
                    <History size={14} strokeWidth={1.75} />
                    Legacy {name}
                  </Command.Item>
                ),
            )}
          </Command.Group>

          <Command.Group heading="Finance">
            {NAV.map((item) => {
              const Icon = frameIcon[item.id];
              return (
                <Command.Item key={item.id} value={`finance ${item.label}`} onSelect={() => run(() => onFrame(item.id))}>
                  {Icon && <Icon size={14} strokeWidth={1.75} />}
                  {item.label}
                </Command.Item>
              );
            })}
          </Command.Group>
          {/* Last on purpose: a command, task or note that matches takes Enter; when
              nothing else does, this is the only row and Enter searches the ledger. */}
          {/* A sentence reads as a question for Axonix; a word or two reads as a search of the ledger.
              Whichever it reads as comes first, so Enter does that when nothing above matched. */}
          {query && (
            <Command.Group heading="Transactions" forceMount>
              <Command.Item forceMount value={`search-transactions ${query}`} onSelect={() => run(() => onIntent({ type: 'search', query }))}>
                <Search size={14} strokeWidth={1.75} />
                Search transactions for “{query}”
              </Command.Item>
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
