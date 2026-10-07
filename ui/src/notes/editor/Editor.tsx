/**
 * The markdown editor: CodeMirror 6, the engine Obsidian uses.
 *
 * The file's text is the document — nothing is converted on the way in or out,
 * so frontmatter, `[[wikilinks]]`, spacing and escaping stay exactly as typed.
 *
 *   Live preview   syntax steps aside off the cursor's line (livePreview.ts)
 *   Source         every character as it is, in the mono face
 *
 * `[[` completes note names; Ctrl/⌘-click (or a plain click on a link shown as
 * a link) opens it; pasting or dropping an image saves it beside the note.
 * Ctrl+B / Ctrl+I wrap the selection. External text (a reload from disk) comes
 * in through `revision`, so typing is never overwritten by a stale echo.
 *
 * `/` at the start of a line (or after a space) offers blocks — headings,
 * checklists, callouts, tables — so nobody has to remember the syntax. With
 * `onMakeTask`, selected text shows a small "Make a task" button.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { autocompletion, completionKeymap, type Completion, type CompletionContext } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Annotation, Compartment, EditorSelection, EditorState, StateField, type Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExt, showTooltip, type Command, type Tooltip } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { Frontmatter, WikiLinks } from './syntax';
import { linkAt, livePreview } from './livePreview';
import { noteName } from '../links';

export type EditMode = 'live' | 'source';

export interface EditorHandle {
  focus: () => void;
}

export interface EditorProps {
  /** Initial text, and the text to load whenever `revision` changes. */
  value: string;
  revision: number;
  onChange: (text: string) => void;
  mode: EditMode;
  /** Every note path, for `[[` completion. */
  notes: () => string[];
  /** A loadable URL for an image link, or null. */
  imageUrl: (target: string) => string | null;
  onOpenLink: (link: { kind: 'note' | 'url'; target: string }) => void;
  /** Saves a pasted/dropped image; resolves to the markdown to insert. */
  onImage?: (file: File) => Promise<string | null>;
  /** Turns selected text into a task; resolves to what replaces the selection (e.g. `[[Title]]`), or null. */
  onMakeTask?: (text: string) => Promise<string | null>;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  readOnly?: boolean;
}

/** Marks a change that came from outside (a reload), so it is not reported back as typing. */
const external = Annotation.define<boolean>();

const highlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: '650', color: '#f7f9fc' },
  { tag: t.strong, fontWeight: '650', color: '#f7f9fc' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'rgba(226, 234, 252, 0.55)' },
  { tag: t.link, color: '#bfe3ff' },
  { tag: t.url, color: 'rgba(191, 227, 255, 0.62)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.9em' },
  { tag: t.processingInstruction, color: 'rgba(226, 234, 252, 0.34)' },
  { tag: t.meta, color: 'rgba(226, 234, 252, 0.55)' },
  { tag: t.quote, color: 'rgba(235, 240, 250, 0.78)' },
  { tag: t.contentSeparator, color: 'rgba(226, 234, 252, 0.34)' },
  { tag: t.list, color: 'rgba(226, 234, 252, 0.5)' },
  // Fenced code
  { tag: [t.keyword, t.modifier, t.operatorKeyword], color: '#a8dcff' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#9fe1c8' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#ffc496' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'rgba(226, 234, 252, 0.4)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#9db9ff' },
  { tag: [t.typeName, t.className, t.namespace], color: '#ffd479' },
  { tag: [t.propertyName, t.attributeName], color: '#f7a8c8' },
  { tag: t.tagName, color: '#ff8f8f' },
]);

const theme = EditorView.theme(
  {
    '&': { color: 'var(--fin-text-3)', backgroundColor: 'transparent', height: '100%' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--font-ui)', lineHeight: '1.7', overflow: 'visible' },
    '.cm-content': { caretColor: '#bfe3ff', padding: '0' },
    '.cm-line': { padding: '0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#bfe3ff', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'rgba(124, 196, 255, 0.26) !important' },
    '.cm-selectionMatch': { backgroundColor: 'rgba(124, 196, 255, 0.12)' },
    '.cm-placeholder': { color: 'rgba(226, 234, 252, 0.34)' },
    '.cm-tooltip.cm-tooltip-above:has(.cm-make-task)': { border: 'none', background: 'transparent' },
  },
  { dark: true },
);

/** Wrap the selection in `mark` (Ctrl+B / Ctrl+I), or unwrap it. */
const wrap =
  (markText: string): Command =>
  (view) => {
    view.dispatch(
      view.state.changeByRange((range) => {
        const before = view.state.sliceDoc(range.from - markText.length, range.from);
        const after = view.state.sliceDoc(range.to, range.to + markText.length);
        if (before === markText && after === markText) {
          return {
            changes: [
              { from: range.from - markText.length, to: range.from, insert: '' },
              { from: range.to, to: range.to + markText.length, insert: '' },
            ],
            range: EditorSelection.range(range.from - markText.length, range.to - markText.length),
          };
        }
        return {
          changes: [
            { from: range.from, insert: markText },
            { from: range.to, insert: markText },
          ],
          range: EditorSelection.range(range.from + markText.length, range.to + markText.length),
        };
      }),
    );
    return true;
  };

/** Blocks offered after `/`: label, what to type to find it, and the text it inserts (`|` is the cursor). */
const BLOCKS: { label: string; keys: string; insert: string }[] = [
  { label: 'Heading', keys: 'heading h1 title', insert: '# |' },
  { label: 'Subheading', keys: 'heading h2 subheading', insert: '## |' },
  { label: 'Small heading', keys: 'heading h3', insert: '### |' },
  { label: 'Checklist', keys: 'checklist todo task checkbox', insert: '- [ ] |' },
  { label: 'Bulleted list', keys: 'bullet list', insert: '- |' },
  { label: 'Numbered list', keys: 'numbered list ordered', insert: '1. |' },
  { label: 'Quote', keys: 'quote', insert: '> |' },
  { label: 'Callout', keys: 'callout note info', insert: '> [!note]\n> |' },
  { label: 'Warning', keys: 'callout warning', insert: '> [!warning]\n> |' },
  { label: 'Code', keys: 'code block', insert: '```\n|\n```' },
  { label: 'Table', keys: 'table grid', insert: '| Column | Column |\n| --- | --- |\n| | |' },
  { label: 'Divider', keys: 'divider rule line hr', insert: '---\n|' },
  { label: 'Link to a note', keys: 'link note wiki', insert: '[[|' },
];

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
export { fileToBase64 };

/** "Make a task" over a selection, when the page can make tasks. */
function taskTooltip(maker: () => EditorProps['onMakeTask']): Extension {
  const build = (state: EditorState): readonly Tooltip[] => {
    const r = state.selection.main;
    if (r.empty || !maker() || !state.sliceDoc(r.from, r.to).trim()) return [];
    return [
      {
        pos: r.from,
        above: true,
        strictSide: false,
        arrow: false,
        create: (view) => {
          const dom = document.createElement('div');
          dom.className = 'cm-make-task';
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = 'Make a task';
          btn.addEventListener('mousedown', (e) => e.preventDefault());
          btn.addEventListener('click', () => {
            const sel = view.state.selection.main;
            const text = view.state.sliceDoc(sel.from, sel.to);
            const make = maker();
            if (!make) return;
            btn.disabled = true;
            void make(text).then((insert) => {
              if (insert !== null && view.state.sliceDoc(sel.from, sel.to) === text) {
                view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor: sel.from + insert.length } });
              }
            });
          });
          dom.appendChild(btn);
          return { dom };
        },
      },
    ];
  };
  return StateField.define<readonly Tooltip[]>({
    create: build,
    update: (value, tr) => (tr.docChanged || tr.selection ? build(tr.state) : value),
    provide: (f) => showTooltip.computeN([f], (state) => state.field(f)),
  });
}

const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const modes = useRef(new Compartment());
  const editable = useRef(new Compartment());
  const cb = useRef(props);
  cb.current = props;

  useImperativeHandle(ref, () => ({ focus: () => view.current?.focus() }), []);

  const modeExtension = (mode: EditMode): Extension =>
    mode === 'live' ? [livePreview({ imageUrl: (target) => cb.current.imageUrl(target) }), EditorView.editorAttributes.of({ class: 'cm-live' })] : EditorView.editorAttributes.of({ class: 'cm-source' });

  useEffect(() => {
    const complete = (ctx: CompletionContext) => {
      const m = ctx.matchBefore(/\[\[[^\]\n|#]*/);
      if (!m) return null;
      const closed = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === ']]';
      return {
        from: m.from + 2,
        options: cb.current.notes().map((p) => ({
          label: noteName(p),
          apply: closed ? noteName(p) : `${noteName(p)}]]`,
        })),
        validFor: /^[^\]\n|#]*$/,
      };
    };

    const slash = (ctx: CompletionContext) => {
      const m = ctx.matchBefore(/(?:^|\s)\/[a-z0-9 ]*$/i);
      if (!m) return null;
      const from = m.from + (m.text.startsWith('/') ? 0 : 1);
      const query = ctx.state.sliceDoc(from + 1, ctx.pos).trim().toLowerCase();
      if (/\s{2}/.test(ctx.state.sliceDoc(from + 1, ctx.pos))) return null;
      const options: Completion[] = BLOCKS.filter((b) => !query || b.label.toLowerCase().includes(query) || b.keys.includes(query)).map((b) => ({
        label: b.label,
        type: 'text',
        apply: (view, _c, f, to) => {
          const at = b.insert.indexOf('|');
          const text = b.insert.replace('|', '');
          const line = view.state.doc.lineAt(f);
          // Block syntax belongs at the start of a line.
          const pre = f === line.from || /^\s*$/.test(view.state.sliceDoc(line.from, f)) ? '' : '\n';
          view.dispatch({ changes: { from: f, to, insert: pre + text }, selection: { anchor: f + pre.length + at } });
        },
      }));
      return options.length ? { from, to: ctx.pos, options, filter: false } : null;
    };

    const openAt = (v: EditorView, e: MouseEvent) => {
      const shown = (e.target as HTMLElement | null)?.closest<HTMLElement>('.cm-md-link[data-href], .cm-md-wikilink[data-target]');
      if (shown && !e.shiftKey) {
        const href = shown.dataset.href;
        cb.current.onOpenLink(href !== undefined ? { kind: 'url', target: href } : { kind: 'note', target: shown.dataset.target ?? '' });
        return true;
      }
      if (e.ctrlKey || e.metaKey) {
        const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
        const link = pos === null ? null : linkAt(v.state, pos);
        if (link) {
          cb.current.onOpenLink(link);
          return true;
        }
      }
      return false;
    };

    const insertImage = (v: EditorView, file: File | null | undefined) => {
      if (!file || !file.type.startsWith('image/') || !cb.current.onImage) return false;
      void cb.current.onImage(file).then((md) => {
        if (md) v.dispatch(v.state.replaceSelection(md));
      });
      return true;
    };

    const state = EditorState.create({
      doc: props.value,
      extensions: [
        history(),
        search({ top: true }),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [WikiLinks, Frontmatter] }),
        syntaxHighlighting(highlight),
        autocompletion({ override: [complete, slash], icons: false }),
        taskTooltip(() => cb.current.onMakeTask),
        keymap.of([
          { key: 'Mod-b', run: wrap('**') },
          { key: 'Mod-i', run: wrap('*') },
          indentWithTab,
          ...completionKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        theme,
        placeholderExt(props.placeholder ?? ''),
        modes.current.of(modeExtension(props.mode)),
        editable.current.of(EditorState.readOnly.of(Boolean(props.readOnly))),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !u.transactions.some((tr) => tr.annotation(external))) cb.current.onChange(u.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          mousedown: (e, v) => {
            if (openAt(v, e)) {
              e.preventDefault();
              return true;
            }
            return false;
          },
          paste: (e, v) => {
            const file = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile();
            if (insertImage(v, file)) {
              e.preventDefault();
              return true;
            }
            return false;
          },
          drop: (e, v) => {
            const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
            if (file) {
              const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
              if (pos !== null) v.dispatch({ selection: { anchor: pos } });
            }
            if (insertImage(v, file)) {
              e.preventDefault();
              return true;
            }
            return false;
          },
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current! });
    view.current = v;
    if (props.autoFocus) v.focus();
    return () => {
      v.destroy();
      view.current = null;
    };
    // Built once; later changes arrive through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: modes.current.reconfigure(modeExtension(props.mode)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode]);

  useEffect(() => {
    view.current?.dispatch({ effects: editable.current.reconfigure(EditorState.readOnly.of(Boolean(props.readOnly))) });
  }, [props.readOnly]);

  // Text from outside (a reload from disk, a different note): replace the
  // document, keeping the cursor where it can stay.
  const firstRevision = useRef(props.revision);
  useEffect(() => {
    const v = view.current;
    if (!v || props.revision === firstRevision.current) return;
    firstRevision.current = props.revision;
    if (props.value === v.state.doc.toString()) return;
    const head = Math.min(v.state.selection.main.head, props.value.length);
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: props.value }, selection: { anchor: head }, annotations: external.of(true) });
  }, [props.revision, props.value]);

  return <div ref={host} className={['nts-editor', props.className].filter(Boolean).join(' ')} />;
});

export default Editor;
