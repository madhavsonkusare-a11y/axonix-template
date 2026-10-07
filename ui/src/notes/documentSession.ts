import type { DocSnapshot } from '@blocksuite/store';
import { messageOf, vault, type VaultBridge } from './backend';
import { headOf, setFields, type Note } from './notefile';

export type RichDocument = DocSnapshot & { axonixAssets?: Record<string, { type: string; base64: string }> };
export type SaveState = 'saved' | 'pending' | 'saving' | 'error';
export interface NoteDraft { expected: string; expectedBlocks: string | null; text: string; blocks: string | null }
export const draftKey = (path: string) => `axonix:notes:draft:${path}`;
export function readDraft(path: string): NoteDraft | null {
  try { const d = JSON.parse(localStorage.getItem(draftKey(path)) || 'null'); return d && typeof d.text === 'string' && typeof d.expected === 'string' ? d : null; } catch { return null; }
}

/** One owner and one queue per open document. Never retarget a live session to another note. */
export class DocumentSession {
  text: string;
  blocks: string | null;
  expected: string;
  expectedBlocks: string | null;
  state: SaveState = 'saved';
  error = '';
  private revision = 0;
  private persisted = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<boolean> | null = null;
  constructor(readonly path: string, text: string, blocks: string | null, private bridge: Pick<VaultBridge, 'saveDocument'>, private onSaved: (path: string, text: string) => void, private onState: () => void) {
    this.text = this.expected = text;
    this.blocks = this.expectedBlocks = blocks;
  }
  private changed() {
    this.revision++;
    this.state = 'pending'; this.error = ''; this.journal(); this.onState();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 300);
  }
  private journal() {
    try { localStorage.setItem(draftKey(this.path), JSON.stringify({ expected: this.expected, expectedBlocks: this.expectedBlocks, text: this.text, blocks: this.blocks })); }
    catch { /* Disk save still runs; errors remain visible if it fails. */ }
  }
  fields(fields: Record<string, unknown>) {
    const text = setFields(this.text, fields);
    if (text === this.text) return;
    this.text = text; this.changed();
  }
  content(snapshot: RichDocument, markdown: string) {
    this.blocks = JSON.stringify(snapshot);
    this.text = headOf(this.text) + markdown; this.changed();
  }
  recover(draft: NoteDraft) { this.text = draft.text; this.blocks = draft.blocks; this.changed(); }
  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.running) return this.running;
    if (this.persisted === this.revision) return Promise.resolve(true);
    this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }
  private async drain() {
    while (this.persisted !== this.revision) {
      const revision = this.revision; const text = this.text; const blocks = this.blocks;
      this.state = 'saving'; this.onState();
      try {
        const r = await this.bridge.saveDocument(this.path, text, blocks, this.expected, this.expectedBlocks);
        this.expected = r.text; this.expectedBlocks = blocks; this.persisted = revision;
        this.onSaved(r.path, r.text);
        if (this.persisted === this.revision) { try { localStorage.removeItem(draftKey(this.path)); } catch {} }
        else this.journal();
      } catch (error) {
        this.state = 'error'; this.error = messageOf(error); this.journal(); this.onState(); return false;
      }
    }
    this.state = 'saved'; this.onState(); return true;
  }
}
export const openSession = (note: Note, blocks: string | null, saved: (path: string, text: string) => void, changed: () => void) => new DocumentSession(note.path, note.text, blocks, vault, saved, changed);
