/**
 * Markdown syntax the stock parser lacks, as Obsidian writes it:
 *
 *   - `[[wikilinks]]`, `[[note|alias]]`, `[[note#heading]]` and `![[embeds]]`
 *   - YAML frontmatter between `---` fences at the very top (without this, the
 *     closing fence turns the last property into a setext heading)
 */
import type { BlockContext, InlineContext, Line, MarkdownConfig } from '@lezer/markdown';
import { tags as t } from '@lezer/highlight';

const OPEN = 91; // [
const BANG = 33; // !

export const WikiLinks: MarkdownConfig = {
  defineNodes: [
    { name: 'WikiLink', style: t.link },
    { name: 'WikiEmbed', style: t.link },
    { name: 'WikiLinkMark', style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: 'WikiLink',
      before: 'Link',
      parse(cx: InlineContext, next: number, pos: number) {
        const embed = next === BANG && cx.char(pos + 1) === OPEN && cx.char(pos + 2) === OPEN;
        if (!embed && !(next === OPEN && cx.char(pos + 1) === OPEN)) return -1;
        const start = embed ? pos + 1 : pos;
        const rest = cx.slice(start + 2, cx.end);
        const close = rest.indexOf(']]');
        if (close <= 0) return -1;
        const inner = rest.slice(0, close);
        if (/[\n[\]]/.test(inner)) return -1;
        const end = start + 2 + close + 2;
        return cx.addElement(
          cx.elt(embed ? 'WikiEmbed' : 'WikiLink', pos, end, [cx.elt('WikiLinkMark', pos, start + 2), cx.elt('WikiLinkMark', end - 2, end)]),
        );
      },
    },
  ],
};

export const Frontmatter: MarkdownConfig = {
  defineNodes: [
    { name: 'Frontmatter', block: true, style: t.meta },
    { name: 'FrontmatterMark', style: t.processingInstruction },
  ],
  parseBlock: [
    {
      name: 'Frontmatter',
      before: 'HorizontalRule',
      parse(cx: BlockContext, line: Line) {
        if (cx.lineStart !== 0 || !/^---\s*$/.test(line.text)) return false;
        const from = cx.lineStart;
        const marks = [cx.elt('FrontmatterMark', from, from + 3)];
        while (cx.nextLine()) {
          if (/^(---|\.\.\.)\s*$/.test(line.text)) {
            marks.push(cx.elt('FrontmatterMark', cx.lineStart, cx.lineStart + 3));
            const end = cx.lineStart + line.text.length;
            cx.nextLine();
            cx.addElement(cx.elt('Frontmatter', from, end, marks));
            return true;
          }
        }
        cx.addElement(cx.elt('Frontmatter', from, cx.lineStart, marks));
        return true;
      },
    },
  ],
};
