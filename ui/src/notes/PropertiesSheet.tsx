/**
 * A note's properties, as a form — nobody should have to type YAML.
 *
 * The fields come from `properties.ts`, so the form, the scaffold and whatever
 * reads the note always agree. Values are written straight into the
 * frontmatter, one key at a time, leaving everything else in the file alone.
 *
 * Anything looked up on a website carries `source` and `checked`; the sheet
 * fills both in when a fetch drafts the fields, and shows how old they are.
 */
import { useMemo, useState } from 'react';
import { CalendarDays, Download, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import Sheet, { Field, SheetFooter } from '../finance/components/Sheet';
import { CalendarPopover } from '../finance/components/DatePicker';
import { PopUpButton } from '../finance/components/Menu';
import { readFields } from './notefile';
import { FIELDS, groupsOf, valueAt, type FieldSpec } from './properties';
import type { Note } from './notefile';
import { canResearch, draftFrom, research, type University } from '../tasks/masters/research';
import { todayIso } from '../tasks/derive';

type Values = Record<string, unknown>;

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : typeof v === 'string' && v.trim() ? v.split(/[,;]/).map((x) => x.trim()).filter(Boolean) : []);
const asText = (v: unknown): string => (v === undefined || v === null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

interface DeadlineRow {
  cycle: string;
  date: string;
}
const asDeadlines = (v: unknown): DeadlineRow[] =>
  (Array.isArray(v) ? v : [])
    .map((item) => {
      if (item instanceof Date) return { cycle: '', date: item.toISOString().slice(0, 10) };
      if (typeof item === 'string') return { cycle: '', date: item.slice(0, 10) };
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        return { cycle: asText(o.cycle), date: asText(o.date).slice(0, 10) };
      }
      return { cycle: '', date: '' };
    })
    .filter((d) => d.date || d.cycle);

export default function PropertiesSheet({
  note,
  open,
  onClose,
  onSave,
}: {
  note: Note;
  open: boolean;
  onClose: () => void;
  /** Writes these keys into the note's frontmatter; a null clears one. */
  onSave: (fields: Record<string, unknown>) => Promise<void> | void;
}) {
  const specs = FIELDS[note.kind] ?? [];
  const initial = useMemo(() => readFields(note.text), [note.text]);
  const [values, setValues] = useState<Values>(() => {
    const v: Values = {};
    for (const f of specs) v[f.key] = valueAt(initial, f.key);
    return v;
  });
  const [busy, setBusy] = useState(false);
  const [calendar, setCalendar] = useState<{ key: string; rect: DOMRect; trigger: HTMLButtonElement } | null>(null);
  const [link, setLink] = useState('');
  const [fetching, setFetching] = useState(false);
  const [draft, setDraft] = useState<ReturnType<typeof draftFrom> | null>(null);
  const [unis, setUnis] = useState<University[]>([]);
  const today = todayIso();

  /**
   * One page, because the owner pasted it: the main process checks robots.txt,
   * fetches once and caches. What it finds is *offered*, never written — the
   * owner clicks the date or the amount that is actually right.
   */
  const fetchPage = async () => {
    const url = link.trim();
    if (!/^https:\/\//i.test(url)) {
      toast('Paste the page\u2019s https address.');
      return;
    }
    setFetching(true);
    try {
      const read = await research.page(url);
      const d = draftFrom(read, today);
      setDraft(d);
      setValues((v) => ({ ...v, link: v.link || d.link, source: d.source, checked: d.checked }));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(false);
    }
  };

  const addDeadline = (date: string) => {
    const rows = ((values.deadlines as { cycle: string; date: string }[] | undefined) ?? []).filter((r) => r.date);
    if (rows.some((r) => r.date === date)) return;
    set('deadlines', [...rows, { cycle: '', date }]);
  };

  const findUnis = async (text: string) => {
    if (!canResearch || text.trim().length < 3) {
      setUnis([]);
      return;
    }
    try {
      setUnis((await research.universities(text.trim())).slice(0, 6));
    } catch {
      setUnis([]);
    }
  };

  const set = (key: string, value: unknown) => setValues((v) => ({ ...v, [key]: value }));

  const save = async () => {
    setBusy(true);
    const fields: Record<string, unknown> = {};
    for (const f of specs) {
      const v = values[f.key];
      if (f.type === 'number') fields[f.key] = v === '' || v === undefined || v === null ? null : Number(v);
      else if (f.type === 'list') fields[f.key] = asList(v).length ? asList(v) : null;
      else if (f.type === 'bool') fields[f.key] = v === true ? true : null;
      else if (f.type === 'deadlines') {
        const rows = (v as DeadlineRow[] | undefined)?.filter((d) => d.date) ?? [];
        fields[f.key] = rows.length ? rows.map((d) => (d.cycle ? { cycle: d.cycle, date: d.date } : { date: d.date })) : null;
      } else fields[f.key] = asText(v).trim() || null;
    }
    try {
      await onSave(fields);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const input = (f: FieldSpec) => {
    const v = values[f.key];
    if (f.type === 'bool') {
      return (
        <label className="fin-toggle">
          <input type="checkbox" checked={v === true} onChange={(e) => set(f.key, e.target.checked)} />
          <span className="fin-toggle__track" aria-hidden="true" />
          <span>Yes</span>
        </label>
      );
    }
    if (f.type === 'enum') {
      return (
        <PopUpButton
          value={asText(v)}
          onChange={(next) => set(f.key, next)}
          label={f.label}
          options={(f.options ?? []).map((o) => ({ value: o, label: o === '' ? 'Not set' : o.replace(/-/g, ' ') }))}
        />
      );
    }
    if (f.type === 'date') {
      return (
        <button
          type="button"
          className="fin-input fin-input--sm nts-prop__date"
          onClick={(e) => setCalendar({ key: f.key, rect: e.currentTarget.getBoundingClientRect(), trigger: e.currentTarget })}
        >
          <CalendarDays size={13} strokeWidth={1.8} aria-hidden="true" />
          {asText(v) || 'Not set'}
        </button>
      );
    }
    if (f.type === 'deadlines') {
      const rows = (v as DeadlineRow[] | undefined) ?? asDeadlines(valueAt(initial, f.key));
      return (
        <div className="nts-prop__rows">
          {rows.map((row, i) => (
            <div className="nts-prop__row" key={i}>
              <input
                className="fin-input fin-input--sm"
                value={row.cycle}
                onChange={(e) => set(f.key, rows.map((r, j) => (j === i ? { ...r, cycle: e.target.value } : r)))}
                placeholder="2027 intake"
                aria-label="What this deadline is for"
              />
              <input
                className="fin-input fin-input--sm fin-num"
                value={row.date}
                onChange={(e) => set(f.key, rows.map((r, j) => (j === i ? { ...r, date: e.target.value } : r)))}
                placeholder="2027-01-15"
                aria-label="Date"
              />
              <button type="button" className="fin-icon-btn fin-icon-btn--sm" onClick={() => set(f.key, rows.filter((_, j) => j !== i))} aria-label="Remove this deadline">
                <X size={13} strokeWidth={2} />
              </button>
            </div>
          ))}
          <button type="button" className="fin-pill fin-pill--sm" onClick={() => set(f.key, [...rows, { cycle: '', date: '' }])}>
            <Plus size={12} strokeWidth={2.2} />
            Add a deadline
          </button>
        </div>
      );
    }
    if (f.type === 'uni') {
      return (
        <div className="nts-prop__uni">
          <input
            className="fin-input fin-input--sm"
            value={asText(v)}
            onChange={(e) => {
              set(f.key, e.target.value);
              void findUnis(e.target.value);
            }}
            placeholder={f.placeholder}
            spellCheck={false}
          />
          {unis.length > 0 && (
            <div className="nts-prop__suggest">
              {unis.map((u) => (
                <button
                  type="button"
                  key={`${u.name}-${u.country}`}
                  onClick={() => {
                    set(f.key, u.name);
                    if (u.alpha_two_code && values.country === undefined) set('country', u.alpha_two_code);
                    setUnis([]);
                  }}
                >
                  {u.name} <em>{u.alpha_two_code}</em>
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }
    return (
      <input
        className="fin-input fin-input--sm"
        value={f.type === 'list' ? asList(v).join(', ') : asText(v)}
        onChange={(e) => set(f.key, f.type === 'list' ? e.target.value.split(',').map((x) => x.trim()).filter(Boolean) : e.target.value)}
        placeholder={f.placeholder}
        inputMode={f.type === 'number' ? 'decimal' : undefined}
        spellCheck={false}
      />
    );
  };

  return (
    <Sheet open={open} onClose={onClose} title="Properties" subtitle={note.title} width={640}>
      <div className="nts-prop">
        {canResearch && specs.some((f) => f.key === 'checked') && (
          <section className="nts-prop__group nts-prop__fetch">
            <h3>From a page</h3>
            <div className="nts-prop__row">
              <input className="fin-input fin-input--sm" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://… the official page" aria-label="Page address" spellCheck={false} />
              <button type="button" className="fin-pill fin-pill--sm" onClick={() => void fetchPage()} disabled={fetching}>
                <Download size={12} strokeWidth={2.2} />
                {fetching ? 'Reading…' : 'Read it'}
              </button>
            </div>
            {draft && (
              <div className="nts-prop__draft">
                <p className="fin-hint">Read once, robots permitting. Nothing was filled in for you beyond the link and today\u2019s date — click what is actually right:</p>
                {draft.dates.length > 0 && (
                  <div className="nts-prop__chips">
                    <span>Dates found</span>
                    {draft.dates.map((d) => (
                      <button type="button" key={d} className="fin-num" onClick={() => addDeadline(d)}>
                        {d}
                      </button>
                    ))}
                  </div>
                )}
                {draft.amounts.length > 0 && (
                  <div className="nts-prop__chips">
                    <span>Money found</span>
                    {draft.amounts.map((a) => (
                      <button type="button" key={a} onClick={() => set('amount', a)}>
                        {a}
                      </button>
                    ))}
                  </div>
                )}
                {!draft.dates.length && !draft.amounts.length && <p className="fin-hint">Nothing obvious on that page — the link and date are saved, fill the rest in by hand.</p>}
              </div>
            )}
          </section>
        )}
        {groupsOf(specs).map((g) => (
          <section key={g.name} className="nts-prop__group">
            {g.name && <h3>{g.name}</h3>}
            <div className="nts-prop__fields">
              {g.fields.map((f) => (
                <Field key={f.key} label={f.label} hint={f.hint} className={f.type === 'deadlines' ? 'nts-prop__wide' : undefined}>
                  {input(f)}
                </Field>
              ))}
            </div>
          </section>
        ))}
        {!specs.length && <p className="fin-hint">This kind of note keeps no properties beyond its type and project.</p>}
      </div>

      {calendar && (
        <CalendarPopover
          anchor={calendar.rect}
          trigger={calendar.trigger}
          value={asText(values[calendar.key]) || undefined}
          clearable
          label={calendar.key}
          onPick={(iso) => set(calendar.key, iso ?? '')}
          onClose={() => setCalendar(null)}
        />
      )}

      <SheetFooter>
        <span className="fin-spacer" />
        <button type="button" className="fin-pill" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="fin-pill fin-pill--action" onClick={() => void save()} disabled={busy}>
          Save properties
        </button>
      </SheetFooter>
    </Sheet>
  );
}
