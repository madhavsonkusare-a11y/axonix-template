/**
 * Settings: categories, budgets, subscriptions and data.
 *
 * Categories and budgets edit in place and save as you type — there is no Save
 * button to forget. Subscriptions read first and edit in a form (see
 * `SubscriptionsPanel`), because each one carries a schedule. Accounts and
 * statement import used to live here too; they moved to Accounts & cards,
 * where you are already looking at the thing you want to change.
 */
import { useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import Sheet from './Sheet';
import SubscriptionsPanel from './SubscriptionsPanel';
import { LiquidSegment } from './Liquid';
import { barFill } from './Charts';
import { useFinance } from '../FinanceContext';
import { useFinanceUi } from '../ui';
import type { FinanceData } from '../types';
import { backupData, readBackup } from '../repo';
import { desktop } from '../desktop';
import { monthPeriod, spentIn } from '../ledger';
import { money, percent, todayIso } from '../format';

type Tab = 'categories' | 'budgets' | 'subscriptions' | 'data';

export default function SettingsSheet({ open, onClose, tab = 'categories' }: { open: boolean; onClose: () => void; tab?: Tab }) {
  return (
    <Sheet open={open} onClose={onClose} title="Settings" width={640} className="fin-settings">
      <SettingsBody initial={tab} onClose={onClose} />
    </Sheet>
  );
}

function SettingsBody({ initial, onClose }: { initial: Tab; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>(initial);
  const ui = useFinanceUi();
  return (
    <div className="fin-form">
      <LiquidSegment<Tab>
        label="Section"
        mono={false}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'categories', label: 'Categories' },
          { value: 'budgets', label: 'Budgets' },
          { value: 'subscriptions', label: 'Subscriptions' },
          { value: 'data', label: 'Data' },
        ]}
      />
      {tab === 'categories' && <Categories />}
      {tab === 'budgets' && <Budgets />}
      {tab === 'subscriptions' && (
        <SubscriptionsPanel
          onRecord={(preset) => {
            onClose();
            ui.addTransaction(preset);
          }}
        />
      )}
      {tab === 'data' && <DataTab onDone={onClose} />}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="fin-set">
      <header className="fin-set__head">
        <h3>{title}</h3>
        {hint && <p>{hint}</p>}
      </header>
      <div className="fin-set__rows">{children}</div>
    </section>
  );
}

function Categories() {
  const { data, dispatch, undo } = useFinance();
  // A budget names its category too: deleting or renaming one of those left an
  // invisible budget still counted in "Free to spend".
  const inUse = new Set([...data.transactions.map((t) => t.category), ...data.budgets.map((b) => b.category)]);
  const [removed, setRemoved] = useState<{ name: string; change: number } | null>(null);
  const kinds: ['expense' | 'income', string][] = [
    ['expense', 'Spending'],
    ['income', 'Income'],
  ];

  return (
    <>
      {removed && (
        <p className="fin-saved-line" role="status">
          Deleted {removed.name}
          <button type="button" className="fin-link" onClick={() => { undo(removed.change); setRemoved(null); }}>
            Undo
          </button>
        </p>
      )}
      {kinds.map(([kind, title]) => (
        <Section key={kind} title={title}>
          {data.categories
            .filter((c) => c.kind === kind)
            .map((c) => (
              <div className="fin-set__row" key={c.id}>
                <label className="fin-swatchpick" style={{ background: c.color }} title="Colour">
                  <input type="color" value={c.color.startsWith('#') ? c.color : '#8b8b8b'} onChange={(e) => dispatch({ type: 'SAVE_CATEGORY', category: { ...c, color: e.target.value } })} />
                </label>
                <input className="fin-inline" value={c.name} disabled={inUse.has(c.name)} title={inUse.has(c.name) ? 'In use — renaming would orphan its transactions' : undefined} onChange={(e) => dispatch({ type: 'SAVE_CATEGORY', category: { ...c, name: e.target.value } })} />
                <button type="button" className="fin-icon-btn" disabled={inUse.has(c.name)} onClick={() => setRemoved({ name: c.name, change: dispatch({ type: 'DELETE_CATEGORY', id: c.id }) })} aria-label={`Delete ${c.name}`} title={inUse.has(c.name) ? 'In use by transactions or a budget' : 'Delete'}>
                  <Trash2 size={14} strokeWidth={1.7} />
                </button>
              </div>
            ))}
          <button type="button" className="fin-set__add" onClick={() => dispatch({ type: 'SAVE_CATEGORY', category: { name: `New ${kind === 'income' ? 'income' : 'category'}`, color: '#7aa4ff', kind } })}>
            <Plus size={14} strokeWidth={1.8} /> Add
          </button>
        </Section>
      ))}
    </>
  );
}

function Budgets() {
  const { data, dispatch } = useFinance();
  const p = monthPeriod();
  const limits = new Map(data.budgets.map((b) => [b.category, b.limit]));

  return (
    <Section title="Monthly limits" hint="Leave blank for no budget. Spent is this month so far.">
      {data.categories
        .filter((c) => c.kind === 'expense')
        .map((c) => {
          const limit = limits.get(c.name);
          const spent = spentIn(data, c.name, p);
          const over = limit !== undefined && spent > limit;
          return (
            <div className="fin-set__row fin-set__row--budget" key={c.id}>
              <span className="fin-cat__dot" style={{ background: c.color }} aria-hidden="true" />
              <span className="fin-set__name">{c.name}</span>
              <div className="fin-set__bar">
                {limit !== undefined && (
                  <div className="fin-bar fin-bar--thin">
                    <div className={over ? 'fin-bar__fill fin-bar__fill--over' : 'fin-bar__fill'} style={barFill(percent(spent, limit))} />
                  </div>
                )}
                <span className={over ? 'fin-num fin-negative' : 'fin-num'}>{money(spent)}</span>
              </div>
              <div className="fin-input fin-input--affix fin-input--sm">
                <span className="fin-num">₹</span>
                <input
                  className="fin-num"
                  inputMode="numeric"
                  value={limit ?? ''}
                  placeholder="—"
                  onChange={(e) => dispatch({ type: 'SET_BUDGET', budget: { category: c.name, limit: Number(e.target.value.replace(/\D/g, '')) || 0 } })}
                  aria-label={`${c.name} limit`}
                />
              </div>
            </div>
          );
        })}
    </Section>
  );
}

/**
 * Save an export. Desktop: written natively to Downloads, and the full path
 * comes back so the sheet can say where it went. Browser (dev): a download.
 */
async function exportFile(name: string, type: string, body: string): Promise<string | null> {
  if (desktop) return desktop.exportFile(name, body);
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return null;
}

/** Quote a CSV cell; a leading = + @ is neutralised so a spreadsheet never runs a merchant name as a formula. */
const csvCell = (v: string | number | undefined) => {
  if (typeof v === 'number') return String(v);
  let s = v ?? '';
  // Text only (amounts are numbers): a leading = + - @ or tab would run as a spreadsheet formula.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

type Notice = { tone: 'ok' | 'error'; text: string; path?: string };

/**
 * Backups, export, restore and starting over. Messages are shown in the sheet:
 * a toast draws beneath the modal and would go unseen. `onDone` closes the
 * sheet after an action that replaces data, so its Undo toast is visible.
 */
function DataTab({ onDone }: { onDone: () => void }) {
  const { data, dispatch, undo } = useFinance();
  const [confirm, setConfirm] = useState<'demo' | 'reset' | null>(null);
  const [pending, setPending] = useState<{ name: string; data: FinanceData } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const stamp = todayIso();

  const saveExport = async (name: string, type: string, body: string, what: string) => {
    try {
      const path = await exportFile(name, type, body);
      setNotice(path ? { tone: 'ok', text: `${what} saved to ${path}`, path } : { tone: 'ok', text: `${what} downloaded as ${name}` });
    } catch (e) {
      setNotice({ tone: 'error', text: `${what} was not saved: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const exportCsv = () => {
    const names = new Map(data.accounts.map((a) => [a.id, a.name]));
    const methods = new Map(data.methods.map((m) => [m.id, m.name]));
    const rows = data.transactions
      .filter((t) => t.kind !== 'adjustment')
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((t) => [t.date, t.kind, t.merchant, t.category, t.amount, names.get(t.accountId), t.toAccountId ? names.get(t.toAccountId) : '', t.methodId ? methods.get(t.methodId) : '', t.note].map(csvCell).join(','));
    void saveExport(`axonix-transactions-${stamp}.csv`, 'text/csv', ['Date,Kind,Merchant,Category,Amount,Account,To account,Paid with,Note', ...rows].join('\n'), 'Transactions CSV');
  };

  const choose = async (file: File) => {
    setNotice(null);
    try {
      setPending({ name: file.name, data: readBackup(await file.text()) });
    } catch (e) {
      setPending(null);
      setNotice({ tone: 'error', text: `Nothing was restored. ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const restore = async () => {
    if (!pending) return;
    try {
      await backupData('before-restore');
    } catch (e) {
      setNotice({ tone: 'error', text: `Stopped — could not back up your current data first: ${String(e)}` });
      setPending(null);
      return;
    }
    const change = dispatch({ type: 'SET_DATA', data: pending.data });
    toast(`Restored ${pending.name}`, {
      description: `${pending.data.accounts.length} accounts · ${pending.data.transactions.length} transactions`,
      action: { label: 'Undo', onClick: () => undo(change) },
    });
    setPending(null);
    onDone();
  };

  const run = async (what: 'demo' | 'reset') => {
    try {
      await backupData(what === 'demo' ? 'before-demo' : 'before-reset');
    } catch (e) {
      // No backup, no destructive action.
      setNotice({ tone: 'error', text: `Stopped — could not back up first: ${String(e)}` });
      setConfirm(null);
      return;
    }
    const change = dispatch({ type: what === 'demo' ? 'LOAD_DEMO' : 'RESET' });
    toast(what === 'demo' ? 'Demo data loaded' : 'Back to your accounts, with no history', { action: { label: 'Undo', onClick: () => undo(change) } });
    setConfirm(null);
    onDone();
  };

  const reveal = async (path: string) => {
    try {
      if (!(await desktop?.showInFolder(path))) throw new Error('that file is no longer there');
    } catch (e) {
      setNotice({ tone: 'error', text: `Could not open the folder: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  return (
    <>
      <Section
        title="Where it lives"
        hint={
          desktop
            ? 'On this laptop only: %LOCALAPPDATA%\\Axonix\\finance-data.json, with automatic backups beside it. Nothing leaves the machine.'
            : 'In this browser’s local storage (dev mode). The desktop app keeps its own copy.'
        }
      >
        <div className="fin-set__actions">
          <button type="button" className="fin-pill" onClick={() => void saveExport(`axonix-finance-${stamp}.json`, 'application/json', JSON.stringify(data, null, 2), 'Backup')}>
            Back up (JSON)
          </button>
          <button type="button" className="fin-pill" onClick={exportCsv}>
            Export transactions (CSV)
          </button>
          <label className="fin-pill">
            Restore a backup…
            <input
              type="file"
              accept=".json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                // Cleared, so picking the same file again still fires.
                e.target.value = '';
                if (f) void choose(f);
              }}
            />
          </label>
        </div>
        {pending && (
          <div className="fin-set__danger">
            <div>
              <strong>Restore {pending.name}?</strong>
              <span>
                {pending.data.accounts.length} accounts · {pending.data.transactions.length} transactions · {pending.data.ids.length} IDs. It replaces everything
                you have now; your current data is backed up first.
              </span>
            </div>
            <span className="fin-confirm">
              <button type="button" className="fin-link fin-link--danger" onClick={() => void restore()}>
                Replace
              </button>
              <button type="button" className="fin-link" onClick={() => setPending(null)}>
                Cancel
              </button>
            </span>
          </div>
        )}
        {notice && (
          <p className={notice.tone === 'ok' ? 'fin-saved-line fin-set__notice' : 'fin-error fin-set__notice'} role="status">
            <span>{notice.text}</span>
            {notice.path && (
              <button type="button" className="fin-link" onClick={() => void reveal(notice.path!)}>
                Show in folder
              </button>
            )}
          </p>
        )}
      </Section>

      <Section title="Start over" hint="Both back up your data first and can be undone straight after.">
        <div className="fin-set__danger">
          <div>
            <strong>Load demo data</strong>
            <span>Four invented months over your real account list. Replaces everything.</span>
          </div>
          {confirm === 'demo' ? (
            <span className="fin-confirm">
              Replace all data?
              <button type="button" className="fin-link fin-link--danger" onClick={() => void run('demo')}>
                Replace
              </button>
              <button type="button" className="fin-link" onClick={() => setConfirm(null)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="fin-pill" onClick={() => setConfirm('demo')}>
              Load demo
            </button>
          )}
        </div>
        <div className="fin-set__danger">
          <div>
            <strong>Reset</strong>
            <span>Keeps your accounts, payment methods, categories and subscriptions; removes every transaction, budget and ID.</span>
          </div>
          {confirm === 'reset' ? (
            <span className="fin-confirm">
              Erase history?
              <button type="button" className="fin-link fin-link--danger" onClick={() => void run('reset')}>
                Erase
              </button>
              <button type="button" className="fin-link" onClick={() => setConfirm(null)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="fin-pill fin-pill--danger" onClick={() => setConfirm('reset')}>
              Reset
            </button>
          )}
        </div>
      </Section>
    </>
  );
}
