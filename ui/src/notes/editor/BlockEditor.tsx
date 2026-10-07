import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MarkdownAdapter } from '@blocksuite/blocks';
import { AffineSchemas } from '@blocksuite/blocks/schemas';
import { effects as blockEffects } from '@blocksuite/blocks/effects';
import { PageEditor } from '@blocksuite/presets';
import { effects as presetEffects } from '@blocksuite/presets/effects';
import { DocCollection, Job, Schema, Text, type BlockSnapshot, type Doc } from '@blocksuite/store';
import type { RichDocument } from '../documentSession';
import { combinedDarkCssVariables } from '@toeverything/theme';

// Native menus are portalled outside the editor (including shadow roots).
// Supply the complete upstream theme, scoped to an open Notes workspace.
const editorTheme = 'body:has(.nv-workspace){' + Object.entries({
  ...combinedDarkCssVariables,
  '--affine-font-family': 'var(--font-ui)', '--affine-font-code-family': 'var(--font-mono)',
  '--affine-primary-color': '#7cc4ff', '--affine-brand-color': '#7cc4ff',
  '--affine-link-color': '#9bd0f7', '--affine-background-overlay-panel-color': '#242830',
  '--affine-background-primary-color': '#111317', '--affine-background-secondary-color': '#1b1e24',
  '--affine-border-color': '#ffffff16', '--affine-hover-color': '#7cc4ff16',
  '--affine-text-primary-color': '#dce2eb', '--affine-text-secondary-color': '#9aa5b4',
  '--affine-shadow-2': '0 12px 40px #0008, 0 0 0 1px #ffffff12',
}).map(([key,value]) => `${key}:${value}`).join(';') + '}';

let registered = false;
function register() { if (!registered) { if (!customElements.get('page-editor')) { blockEffects(); presetEffects(); } registered = true; } }
export const blockText = (block: BlockSnapshot): string => {
  const text = block.props.text as { delta?: { insert?: unknown }[] } | undefined;
  return text?.delta?.map(p => typeof p.insert === 'string' ? p.insert : '').join('') || '';
};
export function plainTextFromSnapshot(snapshot: RichDocument): string {
  const walk = (b: BlockSnapshot): string[] => [blockText(b), ...b.children.flatMap(walk)].filter(Boolean);
  return walk(snapshot.blocks).join('\n\n');
}
export interface EditorHandle { flush: () => Promise<void>; undo: () => void; redo: () => void; insert: (type: string) => void; outline: () => { id: string; text: string; level: number }[]; scrollTo: (id: string) => void }
interface Props {
  initialText: string; initialTitle: string; snapshot: RichDocument | null;
  header?: ReactNode; tools?: ReactNode;
  onChange: (snapshot: RichDocument, markdown: string) => void;
  onDirty?: () => void; onReady?: (handle: EditorHandle) => void;
}
const blobData = (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob); });

export default function BlockEditor({ initialText, initialTitle, snapshot, header, tools, onChange, onDirty, onReady }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onChange, onDirty, onReady }); callbacks.current = { onChange, onDirty, onReady };
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false; let cleanup = () => {};
    void (async () => {
      register();
      const workspace = new DocCollection({ schema: new Schema().register(AffineSchemas) }); workspace.meta.initialize();
      const job = new Job({ collection: workspace });
      const adapter = new MarkdownAdapter(job);
      let doc: Doc;
      try {
        for (const [id, asset] of Object.entries(snapshot?.axonixAssets ?? {})) {
          const bytes = Uint8Array.from(atob(asset.base64), c => c.charCodeAt(0));
          await workspace.blobSync.set(id, new Blob([bytes], { type: asset.type }));
        }
        if (snapshot || initialText.trim()) {
          // GFM requires content after a checkbox. Keep intentionally blank
          // template tasks editable instead of importing a literal "[ ]" bullet.
          const imported = snapshot ?? await adapter.toDocSnapshot({ file: initialText.replace(/^- \[ \] *$/gm, '- [ ] \u200b') });
          const restored = await job.snapshotToDoc(imported);
          if (!restored) throw new Error('This document could not be opened. Your saved copy has not been changed.');
          doc = restored;
        } else {
          doc = workspace.createDoc(); doc.load();
          const root = doc.addBlock('affine:page', { title: new Text(initialTitle) });
          doc.addBlock('affine:surface', {}, root);
          const note = doc.addBlock('affine:note', {}, root);
          doc.addBlock('affine:paragraph', { text: new Text('') }, note);
        }
      } catch (e) { workspace.dispose(); throw e; }
      if (cancelled) { doc.dispose(); workspace.dispose(); return; }
      // Native selection, slash menus and scroll anchoring require a viewport ancestor.
      const editor = new PageEditor(); editor.doc = doc; editor.hasViewport = true;
      host.current?.replaceChildren(editor);
      // A standalone document has no AFFiNE workspace service. Never expose
      // upstream commands that create transient, unsaved linked documents.
      await editor.updateComplete;
      const slash = editor.querySelector('affine-slash-menu-widget');
      if (slash) slash.config = { ...slash.config, items: slash.config.items.filter(item => typeof item === 'function' || !('name' in item ? ['New Doc', 'Linked Doc'].includes(item.name) : item.groupName === 'Page')) };
      const linked = editor.querySelector('affine-linked-doc-widget');
      if (linked) Object.defineProperty(linked, 'config', { value: { ...linked.config, triggerKeys: [] } });
      const format = editor.querySelector('affine-format-bar-widget');
      if (format) format.configItems = format.configItems.filter(item => !('id' in item && item.id === 'convert-to-linked-doc'));
      if (cancelled) { editor.remove(); doc.dispose(); workspace.dispose(); return; }
      let dirty = false; let timer: ReturnType<typeof setTimeout> | undefined;
      let queue = Promise.resolve();
      const emit = () => {
        clearTimeout(timer);
        if (!dirty) return queue;
        dirty = false;
        const next = job.docToSnapshot(doc) as RichDocument | undefined;
        if (!next) { dirty = true; const message = 'Could not prepare this edit for saving. Keep this note open and retry.'; setError(message); return Promise.reject(new Error(message)); }
        queue = queue.catch(() => {}).then(async () => {
          const assets: NonNullable<RichDocument['axonixAssets']> = {};
          for (const id of await workspace.blobSync.list()) {
            const blob = await workspace.blobSync.get(id);
            if (blob) assets[id] = { type: blob.type, base64: await blobData(blob) };
          }
          next.axonixAssets = assets;
          const { file } = await adapter.fromSliceSnapshot({ snapshot: { type: 'slice', content: next.blocks.children.filter(b => b.flavour === 'affine:note'), workspaceId: workspace.id, pageId: doc.id }, assets: job.assetsManager });
          callbacks.current.onChange(next, file);
          setError('');
        }).catch(e => { setError(`Could not prepare this edit: ${String(e)}`); dirty = true; throw e; });
        return queue;
      };
      const changed = () => { dirty = true; callbacks.current.onDirty?.(); clearTimeout(timer); timer = setTimeout(() => void emit().catch(() => {}), 180); };
      const subscription = doc.slots.blockUpdated.on(changed);
      const flushOnHide = () => { if (document.visibilityState === 'hidden') void emit().catch(() => {}); };
      document.addEventListener('visibilitychange', flushOnHide);
      const handle: EditorHandle = {
        flush: emit, undo: () => doc.undo(), redo: () => doc.redo(),
        insert: type => {
          const note = doc.root?.children.find(b => b.flavour === 'affine:note'); if (!note) return;
          if (type === 'divider') doc.addBlock('affine:divider', {}, note.id);
          else if (type === 'todo' || type === 'bulleted' || type === 'numbered') doc.addBlock('affine:list', { type, text: new Text(''), checked: false }, note.id);
          else if (type === 'code') doc.addBlock('affine:code', { text: new Text(''), language: 'plaintext' }, note.id);
          else doc.addBlock('affine:paragraph', { type: type as 'text' | 'h1' | 'h2' | 'h3' | 'quote', text: new Text('') }, note.id);
          void editor.updateComplete.then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
            if (cancelled) return;
            const fields = editor.querySelectorAll<HTMLElement>('div[contenteditable="true"]');
            fields[fields.length - 1]?.focus();
            fields[fields.length - 1]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          })));
        },
        outline: () => {
          const next = job.docToSnapshot(doc); const rows: { id: string; text: string; level: number }[] = [];
          const walk = (b: BlockSnapshot) => { if (/^h[1-6]$/.test(String(b.props.type))) rows.push({ id: b.id, text: blockText(b) || 'Heading', level: Number(String(b.props.type).slice(1)) }); b.children.forEach(walk); };
          if (next) walk(next.blocks); return rows;
        },
        scrollTo: id => editor.querySelector(`[data-block-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      };
      callbacks.current.onReady?.(handle);
      cleanup = () => { subscription.dispose(); document.removeEventListener('visibilitychange', flushOnHide); void emit().catch(() => {}).finally(() => { editor.remove(); doc.dispose(); workspace.dispose(); }); };
    })().catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; cleanup(); };
  }, [snapshot]);
  return <div className="nts-block-editor" aria-label="Note editor"><style>{editorTheme}</style>{header}{tools}{error && <div className="nv-error" role="alert">{error}</div>}<div className="nts-block-editor__page" ref={host} /></div>;
}
