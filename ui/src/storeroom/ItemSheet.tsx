/**
 * One reference, opened: the picture at full size, and the three things that
 * turn a pile of images into a design language — why it was kept (one line),
 * its tags, and free notes. Everything saves as you leave the field; the
 * sidecar on disk is the only copy.
 *
 * After Karakeep's bookmark preview, in the Axonix sheet: details first, the
 * palette computed from the picture, and the item's R-id always in reach so
 * it can be named to an agent ("use R0042").
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Copy, ExternalLink, FolderOpen, Hash, RotateCw, X } from 'lucide-react';
import { toast } from 'sonner';
import Sheet, { SheetFooter } from '../finance/components/Sheet';
import { isDesktop, mediaUrl, storeroomBackend as backend } from './backend';
import { paletteOf, pngDataUrl } from './palette';
import { useStoreroom } from './StoreroomContext';
import type { StoreItem } from './types';

const KIND_LABEL: Record<StoreItem['kind'], string> = { image: 'Image', svg: 'Vector', video: 'Video', link: 'Link', note: 'Note' };

export function viaLabel(via?: string): string {
  if (!via) return 'Added';
  if (via.startsWith('social:')) {
    const app = via.slice(7);
    return `Saved from ${app.charAt(0).toUpperCase()}${app.slice(1)}`;
  }
  return { drop: 'Dropped in', paste: 'Pasted', add: 'Added', file: 'Added from a file', demo: 'Demo' }[via] ?? via;
}

const bytesLabel = (n?: number) => (!n ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`);

function dateLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const hostOf = (url?: string) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
};

async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast('Couldn’t copy that');
  }
}

export default function ItemSheet({ id, onClose, extra }: { id: string | null; onClose: () => void; /** Shown under the item's details (what it is linked to, in the new shell). */ extra?: ReactNode }) {
  const { items, loading } = useStoreroom();
  const item = id ? items.find((i) => i.id === id) : undefined;
  const last = useRef<StoreItem | undefined>(item);
  if (item) last.current = item;

  // Gone from the folder (trashed here, or moved away in Explorer): close.
  useEffect(() => {
    if (id && !item && !loading) onClose();
  }, [id, item, loading, onClose]);

  const shown = item ?? last.current;
  return (
    <Sheet
      open={id !== null && item !== undefined}
      onClose={onClose}
      title={shown ? <TitleField item={shown} /> : ''}
      subtitle={shown ? <Subtitle item={shown} /> : undefined}
      width={720}
      className="str-sheet"
    >
      {shown && <Detail key={shown.id} item={shown} onClose={onClose} extra={extra} />}
    </Sheet>
  );
}

function Subtitle({ item }: { item: StoreItem }) {
  const size = item.width && item.height ? `${item.width} × ${item.height}` : '';
  return (
    <span className="str-sheet__sub">
      <button type="button" className="str-sheet__id fin-num" onClick={() => void copyText(item.id, `Copied ${item.id}`)} title="Copy the id — name it to an agent">
        <Hash size={11} strokeWidth={2} aria-hidden="true" />
        {item.id}
      </button>
      {[KIND_LABEL[item.kind], size, bytesLabel(item.bytes)].filter(Boolean).join(' · ')}
    </span>
  );
}

/** The title, editable in place. It grows with its text through CSS (`field-sizing: content`). */
function TitleField({ item }: { item: StoreItem }) {
  const { update } = useStoreroom();
  const [value, setValue] = useState(item.title);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setValue(item.title);
  }, [item.title]);
  const commit = () => {
    editing.current = false;
    const next = value.trim();
    if (!next) setValue(item.title);
    else if (next !== item.title) void update(item.id, { title: next });
  };
  return (
    <textarea
      className="str-sheet__title"
      rows={1}
      value={value}
      onChange={(e) => {
        editing.current = true;
        setValue(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      aria-label="Title"
      spellCheck={false}
    />
  );
}

/** A field that saves itself: on blur, on Enter (single line), and when the sheet closes. */
function useAutosave(initial: string, save: (value: string) => void) {
  const [value, setValue] = useState(initial);
  const dirty = useRef(false);
  const saveRef = useRef(save);
  saveRef.current = save;
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    if (!dirty.current) setValue(initial);
  }, [initial]);
  const flush = () => {
    if (!dirty.current) return;
    dirty.current = false;
    saveRef.current(valueRef.current);
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    value,
    change: (next: string) => {
      dirty.current = true;
      setValue(next);
    },
    flush,
  };
}

function Detail({ item, onClose, extra }: { item: StoreItem; onClose: () => void; extra?: ReactNode }) {
  const { update, trash, recapture } = useStoreroom();
  const [confirmTrash, setConfirmTrash] = useState(false);
  const why = useAutosave(item.why, (v) => v.trim() !== item.why && void update(item.id, { why: v.trim() }));
  const notes = useAutosave(item.notes, (v) => v.trim() !== item.notes.trim() && void update(item.id, { notes: v }));

  const file = mediaUrl(item, 'file');
  const copyImage = async () => {
    if (!file) return;
    const png = await pngDataUrl(file).catch(() => null);
    const ok = png ? await backend.copyImage(png).catch(() => false) : false;
    toast(ok ? `Copied ${item.id}` : 'Couldn’t copy the picture');
  };
  const copySvg = async () => {
    if (!file) return;
    const text = await fetch(file)
      .then((r) => r.text())
      .catch(() => '');
    if (text) void copyText(text, 'Copied the SVG code');
    else toast('Couldn’t read the SVG');
  };

  return (
    <div className="str-detail">
      <Preview item={item} file={file} onRecapture={() => void recapture(item.id)} />

      <label className="str-field">
        <span className="str-field__label">Why I kept it</span>
        <input
          className="str-why"
          value={why.value}
          onChange={(e) => why.change(e.target.value)}
          onBlur={why.flush}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          placeholder="The one line that matters — what to take from this"
          maxLength={600}
          spellCheck={false}
        />
      </label>

      <div className="str-field">
        <span className="str-field__label">Tags</span>
        <TagEditor item={item} />
      </div>

      <label className="str-field">
        <span className="str-field__label">{item.kind === 'note' ? 'Note' : 'Notes'}</span>
        <textarea
          className="str-notes"
          data-note={item.kind === 'note' || undefined}
          value={notes.value}
          onChange={(e) => notes.change(e.target.value)}
          onBlur={notes.flush}
          placeholder={item.kind === 'note' ? 'Write it down' : 'Anything worth remembering: the type, the grid, the timing…'}
          spellCheck={false}
        />
      </label>

      <Palette item={item} url={file} />

      <dl className="str-facts">
        {item.source && (
          <div>
            <dt>Source</dt>
            <dd>
              <button type="button" className="fin-link str-facts__link" onClick={() => backend.openUrl(item.source!)} title={item.source}>
                {hostOf(item.source) || item.source}
                <ExternalLink size={11} strokeWidth={1.9} aria-hidden="true" />
              </button>
            </dd>
          </div>
        )}
        <div>
          <dt>Came from</dt>
          <dd>{viaLabel(item.via)}</dd>
        </div>
        <div>
          <dt>Kept</dt>
          <dd>{dateLabel(item.created)}</dd>
        </div>
        {item.file && (
          <div>
            <dt>File</dt>
            <dd className="str-facts__file" title={item.file}>
              {item.file}
            </dd>
          </div>
        )}
      </dl>

      {extra && <div className="nx-extra">{extra}</div>}

      <SheetFooter>
        {confirmTrash ? (
          <span className="fin-confirm">
            Move to the trash?
            <button
              type="button"
              className="fin-link fin-link--danger"
              onClick={() => {
                onClose();
                void trash(item.id);
              }}
            >
              Move
            </button>
            <button type="button" className="fin-link" onClick={() => setConfirmTrash(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button type="button" className="fin-link fin-link--danger" onClick={() => setConfirmTrash(true)}>
            Delete
          </button>
        )}
        <span className="fin-spacer" />
        {isDesktop && (
          <button type="button" className="fin-pill" onClick={() => backend.showInFolder(item.id)}>
            <FolderOpen size={13} strokeWidth={1.8} />
            Show in folder
          </button>
        )}
        {item.kind === 'svg' && (
          <button type="button" className="fin-pill" onClick={() => void copySvg()}>
            <Copy size={13} strokeWidth={1.8} />
            Copy SVG
          </button>
        )}
        {(item.kind === 'image' || item.kind === 'svg' || (item.kind === 'link' && item.file)) && isDesktop && (
          <button type="button" className="fin-pill" onClick={() => void copyImage()}>
            <Copy size={13} strokeWidth={1.8} />
            Copy image
          </button>
        )}
      </SheetFooter>
    </div>
  );
}

function Preview({ item, file, onRecapture }: { item: StoreItem; file: string | null; onRecapture: () => void }) {
  if (item.kind === 'note') return null;
  if (item.kind === 'video') {
    return <div className="str-preview">{file && <video src={file} controls autoPlay muted loop playsInline />}</div>;
  }
  if (item.kind === 'link') {
    return (
      <div className="str-preview str-preview--link">
        {file ? (
          <img src={file} alt={`Screenshot of ${item.title}`} />
        ) : (
          <div className="str-preview__empty">
            {item.capture === 'pending' ? (
              <>
                <span className="str-card__pulse" aria-hidden="true" />
                Capturing the page…
              </>
            ) : (
              <>
                {item.capture === 'failed' ? 'Couldn’t capture this page.' : 'No picture of this page yet.'}
                {isDesktop && (
                  <button type="button" className="fin-link" onClick={onRecapture}>
                    <RotateCw size={12} strokeWidth={1.9} /> Try again
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {item.description && <p className="str-preview__desc">{item.description}</p>}
      </div>
    );
  }
  return <div className="str-preview" data-svg={item.kind === 'svg' || undefined}>{file && <img src={file} alt={item.title} />}</div>;
}

const normTag = (raw: string) =>
  raw
    .trim()
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}/_-]/gu, '')
    .slice(0, 48);

function TagEditor({ item }: { item: StoreItem }) {
  const { items, update } = useStoreroom();
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const known = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of items) for (const t of i.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  }, [items]);
  const query = normTag(draft);
  const suggestions = known.filter((t) => !item.tags.includes(t) && (!query || t.includes(query))).slice(0, 6);

  const add = (raw: string) => {
    const tag = normTag(raw);
    setDraft('');
    if (!tag || item.tags.includes(tag)) return;
    void update(item.id, { tags: [...item.tags, tag] });
  };
  const remove = (tag: string) => void update(item.id, { tags: item.tags.filter((t) => t !== tag) });

  return (
    <div className="str-tags">
      <div className="str-tags__row">
        {item.tags.map((tag) => (
          <span key={tag} className="str-tag">
            #{tag}
            <button type="button" aria-label={`Remove ${tag}`} onClick={() => remove(tag)}>
              <X size={11} strokeWidth={2} />
            </button>
          </span>
        ))}
        <input
          className="str-tags__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (draft.trim()) add(draft);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',' || (e.key === 'Tab' && draft.trim())) {
              if (!draft.trim()) return;
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && item.tags.length) {
              remove(item.tags[item.tags.length - 1]);
            }
          }}
          placeholder={item.tags.length ? 'Add a tag' : 'poster, type/grotesk, motion/easing…'}
          aria-label="Add a tag"
          spellCheck={false}
        />
      </div>
      {focused && suggestions.length > 0 && (
        <div className="str-tags__suggest">
          {suggestions.map((tag) => (
            <button
              key={tag}
              type="button"
              className="str-tag str-tag--suggest"
              onMouseDown={(e) => {
                // Keep the field focused: pick several in a row.
                e.preventDefault();
                add(tag);
              }}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Palette({ item, url }: { item: StoreItem; url: string | null }) {
  const [colors, setColors] = useState<string[]>([]);
  const readable = item.kind === 'image' || item.kind === 'svg' || (item.kind === 'link' && Boolean(item.file));
  useEffect(() => {
    let live = true;
    setColors([]);
    if (!url || !readable) return;
    paletteOf(url, item.kind === 'svg')
      .then((c) => live && setColors(c))
      .catch(() => live && setColors([]));
    return () => {
      live = false;
    };
  }, [url, readable, item.kind]);
  if (!colors.length) return null;
  return (
    <div className="str-field">
      <span className="str-field__label">Palette</span>
      <div className="str-palette">
        {colors.map((c) => (
          <button key={c} type="button" className="str-swatch" onClick={() => void copyText(c, `Copied ${c}`)} title={`Copy ${c}`}>
            <span className="str-swatch__chip" style={{ background: c }} />
            <span className="fin-num">{c}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
