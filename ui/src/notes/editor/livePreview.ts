/**
 * Live preview, after Obsidian's: the markdown stays the document, but away
 * from the line you are on its syntax steps aside — `#`, `**`, `[`…`](url)`,
 * `[[`…`]]` hide; checkboxes, bullets, rules and images render in place.
 * Move onto a line and its syntax comes back, exactly as typed.
 *
 * Nothing here changes the text except ticking a checkbox, which flips the one
 * character between its brackets.
 */
import { syntaxTree } from '@codemirror/language';
import type { EditorState, Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common';
import { IMAGE_EXT, linkTarget } from '../links';

export interface LiveOptions {
  /** A loadable URL for an image link (`![[x.png]]`, `![](a/x.png)`), or null. */
  imageUrl: (target: string) => string | null;
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly at: number,
  ) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.at === this.at;
  }
  toDOM(view: EditorView) {
    const box = document.createElement('span');
    box.className = 'cm-md-check';
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(this.checked));
    box.dataset.checked = String(this.checked);
    box.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.6 6.3 5 8.6 9.4 3.8"/></svg>';
    box.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const now = view.state.sliceDoc(this.at, this.at + 1);
      view.dispatch({ changes: { from: this.at, to: this.at + 1, insert: now === ' ' ? 'x' : ' ' } });
    });
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const dot = document.createElement('span');
    dot.className = 'cm-md-bullet';
    dot.textContent = '•';
    return dot;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const hr = document.createElement('span');
    hr.className = 'cm-md-hr';
    return hr;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return other.url === this.url && other.alt === this.alt;
  }
  toDOM() {
    const img = document.createElement('img');
    img.className = 'cm-md-img';
    img.src = this.url;
    img.alt = this.alt;
    img.loading = 'lazy';
    return img;
  }
}

const hide = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const rule = Decoration.replace({ widget: new RuleWidget() });

function build(view: EditorView, opts: LiveOptions): { all: DecorationSet; atomic: DecorationSet } {
  const { state } = view;
  const doc = state.doc;
  const out: Range<Decoration>[] = [];
  const active = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let l = doc.lineAt(r.from).number; l <= doc.lineAt(r.to).number; l++) active.add(l);
  }
  const isActive = (pos: number) => active.has(doc.lineAt(pos).number);
  const lines = (from: number, to: number, cls: string) => {
    for (let l = doc.lineAt(from).number; l <= doc.lineAt(Math.max(from, to - 1)).number; l++) {
      out.push(Decoration.line({ class: cls }).range(doc.line(l).from));
    }
  };
  const mark = (from: number, to: number, cls: string, attributes?: Record<string, string>) => {
    if (to > from) out.push(Decoration.mark({ class: cls, attributes }).range(from, to));
  };
  const cut = (from: number, to: number) => {
    if (to > from) out.push(hide.range(from, to));
  };
  const spaceAfter = (pos: number) => (state.sliceDoc(pos, pos + 1) === ' ' ? 1 : 0);

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (n: SyntaxNodeRef) => {
        switch (n.name) {
          case 'Frontmatter':
            lines(n.from, n.to, 'cm-md-fm');
            return false;
          case 'FencedCode':
            lines(n.from, n.to, 'cm-md-codeblock');
            return false;
          case 'ATXHeading1':
          case 'ATXHeading2':
          case 'ATXHeading3':
          case 'ATXHeading4':
          case 'ATXHeading5':
          case 'ATXHeading6':
            lines(n.from, n.to, `cm-md-h cm-md-h${n.name.slice(-1)}`);
            return true;
          case 'SetextHeading1':
          case 'SetextHeading2':
            lines(n.from, n.from + 1, `cm-md-h cm-md-h${n.name.slice(-1)}`);
            return true;
          case 'HeaderMark': {
            const parent = n.node.parent?.name ?? '';
            if (parent.startsWith('ATXHeading') && !isActive(n.from)) cut(n.from, n.to + (n.from === doc.lineAt(n.from).from ? spaceAfter(n.to) : 0));
            return false;
          }
          case 'EmphasisMark':
          case 'StrikethroughMark':
            if (!isActive(n.from)) cut(n.from, n.to);
            return false;
          case 'InlineCode':
            mark(n.from, n.to, 'cm-md-code');
            if (!isActive(n.from)) for (const m of n.node.getChildren('CodeMark')) cut(m.from, m.to);
            return false;
          case 'Blockquote': {
            // Obsidian callouts: `> [!type] Title` — the marker hides, the box takes the type's colour.
            const first = doc.lineAt(n.from);
            const callout = /^(\s*>\s*)\[!([\w-]+)\][+-]?\s?/.exec(first.text);
            if (callout) {
              for (let l = first.number; l <= doc.lineAt(Math.max(n.from, n.to - 1)).number; l++) {
                out.push(Decoration.line({ class: l === first.number ? 'cm-md-callout cm-md-callout-head' : 'cm-md-callout', attributes: { 'data-callout': callout[2].toLowerCase() } }).range(doc.line(l).from));
              }
              if (!isActive(n.from)) cut(first.from + callout[1].length, first.from + callout[0].length);
            } else lines(n.from, n.to, 'cm-md-quote');
            return true;
          }
          case 'QuoteMark':
            if (!isActive(n.from)) cut(n.from, n.to + spaceAfter(n.to));
            return false;
          case 'HorizontalRule':
            if (!isActive(n.from)) out.push(rule.range(n.from, n.to));
            return false;
          case 'ListMark': {
            const item = n.node.parent;
            const marker = item?.getChild('Task')?.getChild('TaskMarker');
            if (marker) {
              const checked = /x/i.test(state.sliceDoc(marker.from, marker.to));
              if (checked) lines(n.from, n.from + 1, 'cm-md-task-done');
              if (!isActive(n.from)) {
                out.push(Decoration.replace({ widget: new CheckboxWidget(checked, marker.from + 1) }).range(n.from, marker.to + spaceAfter(marker.to)));
              }
            } else if (item?.parent?.name === 'BulletList' && !isActive(n.from)) {
              out.push(bullet.range(n.from, n.to));
            }
            return false;
          }
          case 'Link': {
            const marks = n.node.getChildren('LinkMark');
            const url = n.node.getChild('URL');
            // `[text]` with no destination is not a link on its own (and `[!note]` is a callout).
            if (!url && !n.node.getChild('LinkLabel')) return false;
            if (marks.length >= 2 && !isActive(n.from)) {
              const href = url ? state.sliceDoc(url.from, url.to) : '';
              cut(n.from, marks[0].to);
              mark(marks[0].to, marks[1].from, 'cm-md-link', { 'data-href': href });
              cut(marks[1].from, n.to);
            }
            return false;
          }
          case 'Image': {
            const url = n.node.getChild('URL');
            const marks = n.node.getChildren('LinkMark');
            if (url && !isActive(n.from)) {
              const src = opts.imageUrl(state.sliceDoc(url.from, url.to));
              const alt = marks.length >= 2 ? state.sliceDoc(marks[0].to, marks[1].from) : '';
              if (src) out.push(Decoration.replace({ widget: new ImageWidget(src, alt) }).range(n.from, n.to));
            }
            return false;
          }
          case 'WikiLink':
          case 'WikiEmbed': {
            const embed = n.name === 'WikiEmbed';
            const innerFrom = n.from + (embed ? 3 : 2);
            const inner = state.sliceDoc(innerFrom, n.to - 2);
            const target = linkTarget(inner);
            if (isActive(n.from)) {
              mark(n.from, n.to, 'cm-md-wikilink-raw');
              return false;
            }
            if (embed && IMAGE_EXT.test(target)) {
              const src = opts.imageUrl(target);
              if (src) {
                out.push(Decoration.replace({ widget: new ImageWidget(src, target) }).range(n.from, n.to));
                return false;
              }
            }
            const pipe = inner.indexOf('|');
            const shownFrom = pipe >= 0 ? innerFrom + pipe + 1 : innerFrom;
            cut(n.from, shownFrom);
            mark(shownFrom, n.to - 2, 'cm-md-wikilink', { 'data-target': target });
            cut(n.to - 2, n.to);
            return false;
          }
        }
        return true;
      },
    });
  }
  return {
    all: Decoration.set(out, true),
    // Only what is hidden or drawn over is atomic: the cursor steps over it, not into it.
    atomic: Decoration.set(
      out.filter((r) => r.value.spec.widget !== undefined || (r.to > r.from && !r.value.spec.class)),
      true,
    ),
  };
}

export function livePreview(opts: LiveOptions) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      atomic: DecorationSet;
      constructor(view: EditorView) {
        ({ all: this.decorations, atomic: this.atomic } = build(view, opts));
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) {
          ({ all: this.decorations, atomic: this.atomic } = build(u.view, opts));
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
    },
  );
}

/** Whether `state` has a `[[link]]` or `[text](url)` at `pos`, and what it points to. */
export function linkAt(state: EditorState, pos: number): { kind: 'note' | 'url'; target: string } | null {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === 'WikiLink' || n.name === 'WikiEmbed') {
      const inner = state.sliceDoc(n.from + (n.name === 'WikiEmbed' ? 3 : 2), n.to - 2);
      return { kind: 'note', target: linkTarget(inner) };
    }
    if (n.name === 'Link') {
      const url = n.getChild('URL');
      return url ? { kind: 'url', target: state.sliceDoc(url.from, url.to) } : null;
    }
    if (n.name === 'URL') return { kind: 'url', target: state.sliceDoc(n.from, n.to) };
  }
  return null;
}
