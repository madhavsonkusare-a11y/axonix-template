/**
 * Connecting Google Calendar, and which calendars show.
 *
 * Axonix signs in with the owner's own OAuth client, so Google can't block it
 * the way it blocked shared clients (Super Productivity, 2026): the sheet walks
 * through making one in Google Cloud (about ten minutes, once), takes the
 * client ID and secret (kept in Windows Credential Manager), and opens
 * Google's consent page in the browser.
 */
import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import Sheet, { Field, SheetFooter } from '../finance/components/Sheet';
import { vault } from '../notes/backend';
import { calendar, messageOf, type CalInfo } from './backend';
import { useCalendar } from './CalendarContext';
import { clockOf } from '../finance/format';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.app.created',
];

const STEPS: { title: string; text: string; link?: { label: string; url: string } }[] = [
  { title: 'Make a project', text: 'Name it Axonix.', link: { label: 'New project', url: 'https://console.cloud.google.com/projectcreate' } },
  { title: 'Turn on the Google Calendar API', text: 'In that project, press Enable.', link: { label: 'Calendar API', url: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com' } },
  {
    title: 'Set up Google Auth Platform',
    text: 'Branding: app name Axonix and your email. Audience: External, then Publish app so it is In production — in Testing, Google signs you out every 7 days.',
    link: { label: 'Google Auth Platform', url: 'https://console.cloud.google.com/auth/overview' },
  },
  { title: 'Add the three scopes', text: 'Data access → Add or remove scopes → paste them (the copy button below) → Update → Save.', link: { label: 'Data access', url: 'https://console.cloud.google.com/auth/scopes' } },
  { title: 'Make a Desktop client', text: 'Clients → Create client → Application type: Desktop app → Create. Paste its Client ID and Client secret here.', link: { label: 'Clients', url: 'https://console.cloud.google.com/auth/clients' } },
];

export default function CalendarSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { status } = useCalendar();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Google Calendar"
      subtitle={status?.connected ? `Connected as ${status.account ?? 'your Google account'}` : 'Your events beside your time blocks, both ways'}
      width={600}
      className="cal-sheet"
    >
      {status?.connected ? <Connected onClose={onClose} /> : <Setup />}
    </Sheet>
  );
}

function Setup() {
  const { status, refreshStatus, invalidate } = useCalendar();
  const [id, setId] = useState(status?.clientId ?? '');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'connect' | null>(null);
  const [copied, setCopied] = useState(false);
  const configured = !!status?.configured;
  const [editing, setEditing] = useState(!configured);

  const save = async () => {
    setError(null);
    setBusy('save');
    try {
      await calendar.setClient(id, secret);
      setSecret('');
      setEditing(false);
      await refreshStatus();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    setError(null);
    setBusy('connect');
    try {
      await calendar.connect();
      invalidate();
      toast('Google Calendar connected');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
      void refreshStatus();
    }
  };

  const copyScopes = async () => {
    await navigator.clipboard.writeText(SCOPES.join('\n'));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="fin-form">
      {editing ? (
        <>
          <p className="fin-hint cal-sheet__lead">
            Axonix uses your own Google Cloud app to sign in, so the connection is yours alone. Five steps, about ten minutes, once.
          </p>
          <ol className="cal-steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="cal-steps__n fin-num">{i + 1}</span>
                <div>
                  <strong>{s.title}</strong>
                  <span>{s.text}</span>
                  {s.link && (
                    <button type="button" className="fin-link cal-steps__link" onClick={() => vault.openUrl(s.link!.url)}>
                      <ExternalLink size={11} strokeWidth={2} aria-hidden="true" />
                      {s.link.label}
                    </button>
                  )}
                  {i === 3 && (
                    <button type="button" className="fin-pill fin-pill--sm cal-steps__copy" onClick={() => void copyScopes()}>
                      {copied ? <Check size={12} strokeWidth={2.2} aria-hidden="true" /> : <Copy size={12} strokeWidth={2} aria-hidden="true" />}
                      {copied ? 'Copied' : 'Copy the scopes'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <div className="fin-form__grid">
            <Field label="Client ID">
              <input className="fin-input" value={id} onChange={(e) => setId(e.target.value)} placeholder="…apps.googleusercontent.com" spellCheck={false} autoComplete="off" />
            </Field>
            <Field label="Client secret">
              <input className="fin-input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="GOCSPX-…" spellCheck={false} autoComplete="off" />
            </Field>
          </div>
          <p className="fin-hint">Both are kept in Windows Credential Manager, never in a file.</p>
        </>
      ) : (
        <div className="cal-ready">
          <p>
            Your Google Cloud client is saved. Connecting opens Google in your browser; Google will say it hasn’t verified the app — it’s your own, so choose{' '}
            <b>Advanced</b>, then <b>Go to Axonix</b>, and allow access.
          </p>
          <p className="fin-hint">
            Client <span className="fin-num">{status?.clientId?.slice(0, 18)}…</span>{' '}
            <button type="button" className="fin-link" onClick={() => setEditing(true)}>
              Change
            </button>
          </p>
        </div>
      )}

      {status?.error && !error && (
        <p className="fin-error" role="alert">
          {status.error}
        </p>
      )}
      {error && (
        <p className="fin-error" role="alert">
          {error}
        </p>
      )}
      {busy === 'connect' && <p className="fin-hint">Finish in your browser. This page updates when Google sends you back.</p>}

      <SheetFooter>
        <span className="fin-spacer" />
        {editing ? (
          <button type="button" className="fin-pill fin-pill--action" onClick={() => void save()} disabled={!id.trim() || !secret.trim() || busy !== null}>
            Save client
          </button>
        ) : (
          <button type="button" className="fin-pill fin-pill--action" onClick={() => void connect()} disabled={busy !== null}>
            {busy === 'connect' ? 'Waiting for Google…' : 'Connect Google Calendar'}
          </button>
        )}
      </SheetFooter>
    </div>
  );
}

function Connected({ onClose }: { onClose: () => void }) {
  const { status, syncNow, syncing, invalidate } = useCalendar();
  const [cals, setCals] = useState<CalInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [forget, setForget] = useState(false);

  useEffect(() => {
    calendar
      .calendars()
      .then(setCals)
      .catch((e) => setError(messageOf(e)));
  }, []);

  const toggle = async (c: CalInfo) => {
    const next = (cals ?? []).map((x) => (x.id === c.id ? { ...x, shown: !x.shown } : x));
    setCals(next);
    await calendar.setShown(next.filter((x) => x.shown).map((x) => x.id));
    invalidate();
  };

  return (
    <div className="fin-form">
      <Field label="Show in Axonix">
        {cals ? (
          <div className="cal-list">
            {cals
              .filter((c) => !c.axonix)
              .map((c) => (
                <label key={c.id} className="cal-list__row">
                  <span className="cal-list__dot" style={{ background: c.color }} />
                  <span className="cal-list__name">
                    {c.name}
                    {c.primary && <small>primary</small>}
                  </span>
                  <span className="fin-toggle">
                    <input type="checkbox" checked={c.shown} onChange={() => void toggle(c)} aria-label={`Show ${c.name}`} />
                    <span className="fin-toggle__track" />
                  </span>
                </label>
              ))}
          </div>
        ) : error ? (
          <p className="fin-error">{error}</p>
        ) : (
          <p className="fin-hint">Reading your calendars…</p>
        )}
      </Field>

      <div className="cal-ready">
        <p>
          Time blocks live on a calendar named <b>Axonix</b> in your Google account. Move or resize one there and it moves here; delete it there and the task loses its time. Your other calendars are only read.
        </p>
        <p className="fin-hint">
          {syncing ? 'Syncing…' : status?.lastSync ? `Last synced ${clockOf(new Date(status.lastSync))}.` : 'Not synced yet.'}{' '}
          <button type="button" className="fin-link" onClick={() => void syncNow()} disabled={syncing}>
            Sync now
          </button>
        </p>
      </div>
      {status?.error && (
        <p className="fin-error" role="alert">
          {status.error}
        </p>
      )}

      <SheetFooter>
        {confirm ? (
          <span className="fin-confirm">
            Disconnect Google Calendar?
            <label className="cal-forget">
              <input type="checkbox" checked={forget} onChange={(e) => setForget(e.target.checked)} /> forget the client too
            </label>
            <button
              type="button"
              className="fin-link fin-link--danger"
              onClick={() =>
                void calendar
                  .disconnect(forget)
                  .then(() => {
                    invalidate();
                    toast('Google Calendar disconnected', { description: 'The Axonix calendar stays in Google; your tasks keep their times.' });
                    onClose();
                  })
                  .catch((e) => setError(messageOf(e)))
              }
            >
              Disconnect
            </button>
            <button type="button" className="fin-link" onClick={() => setConfirm(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button type="button" className="fin-link fin-link--danger" onClick={() => setConfirm(true)}>
            Disconnect
          </button>
        )}
        <span className="fin-spacer" />
        <button type="button" className="fin-pill fin-pill--action" onClick={onClose}>
          Done
        </button>
      </SheetFooter>
    </div>
  );
}
