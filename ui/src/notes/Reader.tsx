/**
 * A note, read — Obsidian's Reading view.
 *
 * GitHub-flavoured markdown (tables, task lists, strikethrough, autolinks),
 * plus what Obsidian adds: `[[wikilinks]]` and `![[embeds]]`, callouts
 * (`> [!note] Title`), and a properties panel for the frontmatter. Code is
 * highlighted locally. Raw HTML in a note is shown as text, never run.
 *
 * Checkboxes are live: ticking one flips that line in the file.
 */
import { useMemo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import rehypeHighlight from 'rehype-highlight';
import { visit } from 'unist-util-visit';
import { parse as parseYaml } from 'yaml';
import { Check } from 'lucide-react';
import { IMAGE_EXT, linkTarget } from './links';
import { splitFrontmatter } from '../tasks/taskfile';

/* ------------------------------------------------------------------ */
/* remark plugins                                                      */
/* ------------------------------------------------------------------ */

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
}

const WIKI = /(!?)\[\[([^\]\n]+?)\]\]/g;

/** `[[note|alias]]` → a link to `wikilink:note`; `![[x.png]]` → an image. */
function remarkWikiLinks() {
  return (tree: MdNode) => {
    visit(tree as never, 'text', (node: MdNode, index: number | undefined, parent: MdNode | undefined) => {
      if (!parent || index === undefined || !node.value || !node.value.includes('[[')) return;
      const out: MdNode[] = [];
      let last = 0;
      for (const m of node.value.matchAll(WIKI)) {
        const at = m.index ?? 0;
        if (at > last) out.push({ type: 'text', value: node.value.slice(last, at) });
        const inner = m[2];
        const target = linkTarget(inner);
        const alias = inner.includes('|') ? inner.slice(inner.indexOf('|') + 1) : undefined;
        if (m[1] && IMAGE_EXT.test(target)) out.push({ type: 'image', url: `wikilink:${encodeURIComponent(target)}`, alt: alias ?? target });
        else out.push({ type: 'link', url: `wikilink:${encodeURIComponent(target)}`, children: [{ type: 'text', value: alias ?? inner.split('#')[0].split('/').pop() ?? inner }] });
        last = at + m[0].length;
      }
      if (!out.length) return;
      if (last < node.value.length) out.push({ type: 'text', value: node.value.slice(last) });
      parent.children!.splice(index, 1, ...out);
      return index + out.length;
    });
  };
}

/** `> [!warning] Title` blockquotes → callout boxes. */
function remarkCallouts() {
  return (tree: MdNode) => {
    visit(tree as never, 'blockquote', (node: MdNode) => {
      const p = node.children?.[0];
      const first = p?.type === 'paragraph' ? p.children?.[0] : undefined;
      if (!p || first?.type !== 'text' || !first.value) return;
      const m = /^\[!([\w-]+)\][+-]?[ \t]*([^\n]*)\n?/.exec(first.value);
      if (!m) return;
      const type = m[1].toLowerCase();
      first.value = first.value.slice(m[0].length);
      if (!first.value) p.children!.shift();
      if (!p.children!.length) node.children!.shift();
      node.data = { hName: 'div', hProperties: { className: ['md-callout'], 'data-callout': type } };
      node.children!.unshift({
        type: 'paragraph',
        data: { hName: 'div', hProperties: { className: ['md-callout__title'] } },
        children: [{ type: 'text', value: m[2] || type.charAt(0).toUpperCase() + type.slice(1) }],
      });
    });
  };
}

/* ------------------------------------------------------------------ */
/* properties                                                          */
/* ------------------------------------------------------------------ */

function Properties({ fm }: { fm: string }) {
  let data: Record<string, unknown> | null = null;
  try {
    const parsed = parseYaml(fm);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
  } catch {
    data = null;
  }
  if (!data) return <pre className="md-props md-props--raw">{fm}</pre>;
  const entries = Object.entries(data);
  if (!entries.length) return null;
  return (
    <dl className="md-props">
      {entries.map(([k, v]) => (
        <div key={k} className="md-props__row">
          <dt>{k}</dt>
          <dd>
            {Array.isArray(v) ? (
              v.map((x, i) => (
                <span key={i} className="md-props__chip">
                  {String(x)}
                </span>
              ))
            ) : v === null || v === undefined || v === '' ? (
              <span className="md-props__empty">—</span>
            ) : typeof v === 'object' ? (
              JSON.stringify(v)
            ) : (
              String(v)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ */
/* the reader                                                          */
/* ------------------------------------------------------------------ */

export interface ReaderProps {
  /** The whole file, frontmatter included. */
  text: string;
  /** Show the frontmatter as a properties panel (notes); tasks show their own fields. */
  showProperties?: boolean;
  /** `line` is 0-based within `text`. */
  onToggleTask?: (line: number) => void;
  onOpenLink: (link: { kind: 'note' | 'url'; target: string }) => void;
  imageUrl: (target: string) => string | null;
  className?: string;
}

export default function Reader({ text, showProperties = true, onToggleTask, onOpenLink, imageUrl, className }: ReaderProps) {
  const { fm, body } = useMemo(() => splitFrontmatter(text), [text]);
  // react-markdown reports lines within `body`; the file's line is that plus the frontmatter's.
  const offset = useMemo(() => text.slice(0, text.length - body.length).split(/\r?\n/).length - 1, [text, body]);

  const components = useMemo<Components>(
    () => ({
      a: ({ href, children }) => {
        const url = href ?? '';
        const wiki = url.startsWith('wikilink:');
        const safe = wiki || /^(https?:|mailto:)/i.test(url);
        return (
          <a
            href={safe && !wiki ? url : undefined}
            className={wiki ? 'md-wikilink' : 'md-link'}
            onClick={(e) => {
              e.preventDefault();
              if (wiki) onOpenLink({ kind: 'note', target: decodeURIComponent(url.slice('wikilink:'.length)) });
              else if (safe) onOpenLink({ kind: 'url', target: url });
            }}
          >
            {children}
          </a>
        );
      },
      img: ({ src, alt }) => {
        const raw = typeof src === 'string' ? src : '';
        const target = raw.startsWith('wikilink:') ? decodeURIComponent(raw.slice('wikilink:'.length)) : raw;
        const url = /^(https?:|data:)/i.test(target) ? target : imageUrl(target);
        return url ? <img className="md-img" src={url} alt={alt ?? ''} loading="lazy" /> : <span className="md-missing">{alt || target}</span>;
      },
      li: ({ node, className: cls, children }) => {
        const isTask = typeof cls === 'string' && cls.includes('task-list-item');
        if (!isTask) return <li className={cls}>{children}</li>;
        // The checkbox itself renders as nothing (`input` below); its state is read from the tree.
        // (In a loose list it sits inside the item's first paragraph.)
        const kids = node?.children ?? [];
        const first = kids.find((c) => c.type === 'element');
        const pool = first && first.type === 'element' && first.tagName === 'p' ? [...kids, ...first.children] : kids;
        const input = pool.find((c) => c.type === 'element' && c.tagName === 'input');
        const checked = Boolean(input && input.type === 'element' && input.properties?.checked);
        const line = (node?.position?.start.line ?? 1) - 1 + offset;
        return (
          <li className="md-task" data-done={checked || undefined}>
            <button
              type="button"
              className="md-task__box"
              role="checkbox"
              aria-checked={checked}
              disabled={!onToggleTask}
              onClick={() => onToggleTask?.(line)}
            >
              <Check size={10} strokeWidth={3} />
            </button>
            <span className="md-task__text">{children}</span>
          </li>
        );
      },
      input: () => null,
    }),
    [imageUrl, offset, onOpenLink, onToggleTask],
  );

  return (
    <div className={['md-reader', className].filter(Boolean).join(' ')}>
      {showProperties && fm !== null && fm.trim() && <Properties fm={fm} />}
      <Markdown
        remarkPlugins={[remarkGfm, remarkFrontmatter, remarkWikiLinks, remarkCallouts]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={components}
        urlTransform={(url) => url}
      >
        {body}
      </Markdown>
    </div>
  );
}
