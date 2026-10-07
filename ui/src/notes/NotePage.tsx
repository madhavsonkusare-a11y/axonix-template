import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy, Download, FileText, Focus, List, ListPlus, MoreHorizontal, PanelLeft, Pin, Plus, Redo2, SlidersHorizontal, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { vault, messageOf } from './backend';
import { useNotes } from './NotesContext';
import { KINDS, parseNote, setNoteProps, type Note } from './notefile';
import { draftKey, openSession, readDraft, type NoteDraft, type DocumentSession, type RichDocument } from './documentSession';
import type { EditorHandle } from './editor/BlockEditor';
import { Menu, PopUpButton, type MenuEntry } from '../finance/components/Menu';
import PropertiesSheet from './PropertiesSheet';
import { FIELDS } from './properties';
import { useTasks } from '../tasks/TasksContext';

const BlockEditor = lazy(() => import('./editor/BlockEditor'));
export function downloadNote(name: string, content: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url;
  anchor.download = name.replace(/[\\/:*?"<>|]/g, '-'); anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function NotePage({ note, focus, onFocus, onBack, onOpen, onDeleted, registerFlush }: {
  note: Note; focus: boolean; onFocus: () => void; onBack: () => void; onOpen: (path: string) => void;
  onDeleted: () => void; registerFlush: (flush: (() => Promise<boolean>) | null) => void;
}) {
  const { saved, forget, create } = useNotes(); const { projects, create: createTask } = useTasks();
  const [session, setSession] = useState<DocumentSession | null>(null);
  const [initial, setInitial] = useState<{ body: string; snapshot: RichDocument | null } | null>(null);
  const [title, setTitle] = useState(note.title);
  const [version, render] = useState(0); const [problem, setProblem] = useState('');
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const [recovery, setRecovery] = useState<NoteDraft | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false); const [properties, setProperties] = useState(false);
  const [menu, setMenu] = useState<{ rect: DOMRect; trigger: HTMLElement; kind: 'actions' | 'insert' } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false); const [busy, setBusy] = useState(false);
  const editor = useRef<EditorHandle | null>(null); const titleInput = useRef<HTMLTextAreaElement>(null);
  const page = useRef<HTMLDivElement>(null); const live = useRef(true); const sessionRef = useRef<DocumentSession | null>(null);
  const [ready, setReady] = useState(false); const [dirty, setDirty] = useState(false);
  useEffect(() => {
    live.current = true; let cancelled = false;
    void Promise.all([vault.read(note.path), vault.readBlocks(note.path)]).then(([file, blocks]) => {
      if (cancelled) return;
      const current = parseNote(file.path, file.text, file.mtime);
      if (current.broken) throw new Error(current.broken + ' Export the original below before repairing it.');
      let snapshot: RichDocument | null = blocks ? JSON.parse(blocks.text) : null;
      if (snapshot && (!snapshot.blocks || snapshot.type !== 'page')) throw new Error('This rich document cannot be read. Your saved copy is untouched.');
      const s = openSession(current, blocks?.text ?? null, saved, () => { if (live.current) render(v => v + 1); });
      const draft = readDraft(note.path);
      if (draft && draft.expected === file.text && draft.expectedBlocks === (blocks?.text ?? null)) {
        snapshot = draft.blocks ? JSON.parse(draft.blocks) : null;
        if (snapshot && (!snapshot.blocks || snapshot.type !== 'page')) throw new Error('The recovery document cannot be read. Export recovery to keep a copy.');
        s.recover(draft);
        toast('Recovered your unsaved edits.');
      } else if (draft && (draft.text !== file.text || draft.blocks !== (blocks?.text ?? null))) {
        setRecovery(draft);
        setProblem('A recovery draft differs from the saved version. Recover it as a separate note to keep both.');
        sessionRef.current = s; setSession(s); return;
      }
      sessionRef.current = s; setSession(s); setTitle(parseNote(note.path, s.text, file.mtime).title);
      setInitial({ body: parseNote(note.path, s.text, file.mtime).body, snapshot });
    }).catch(e => { if (!cancelled) setProblem(messageOf(e)); });
    return () => { cancelled = true; live.current = false; void sessionRef.current?.flush(); };
  }, [note.path, saved]);
  const flush = async () => {
    try { await editor.current?.flush(); return sessionRef.current ? sessionRef.current.flush() : true; }
    catch (e) { toast('Keep this note open: ' + messageOf(e)); return false; }
  };
  useEffect(() => { registerFlush(flush); return () => registerFlush(null); }, [session, ready]);
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty || (sessionRef.current && sessionRef.current.state !== 'saved')) { void flush(); e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  useEffect(() => {
    if (session?.state === 'saved' && note.text !== session.expected && note.text !== session.text) setChangedElsewhere(true);
  }, [note.text, session, version]);
  useLayoutEffect(() => {
    const el = titleInput.current; if (!el) return;
    const resize = () => { el.style.height = '0px'; el.style.height = el.scrollHeight + 'px'; };
    resize(); const observer = new ResizeObserver(resize); observer.observe(el.parentElement!);
    return () => observer.disconnect();
  }, [title, initial]);
  const current = session ? parseNote(note.path, session.text, note.mtime) : note;
  const words = current.body.trim().split(/\s+/).filter(Boolean).length;
  const entries = editor.current?.outline() ?? [];
  const update = (fields: Record<string, unknown>) => { try { session?.fields(fields); render(v => v + 1); } catch (e) { toast(messageOf(e)); } };
  const exportRich = async () => {
    try { await editor.current?.flush(); } catch (e) { toast(messageOf(e)); return; }
    downloadNote(title + '.axonix-note.json', JSON.stringify({ format: 'axonix-note-v2', text: session?.text ?? note.text, document: session?.blocks ? JSON.parse(session.blocks) : null }, null, 2), 'application/json');
  };
  const recoverCopy = async () => {
    if (!recovery || busy) return;
    setBusy(true);
    try {
      const recoveredTitle = parseNote(note.path, recovery.text, Date.now()).title + ' recovered';
      const path = await create({ title: recoveredTitle }); if (!path) return;
      const fresh = await vault.read(path);
      const result = await vault.saveDocument(path, setNoteProps(recovery.text, { title: recoveredTitle }), recovery.blocks, fresh.text, null);
      saved(result.path, result.text);
      localStorage.removeItem(draftKey(note.path));
      onOpen(path); toast('Recovered as a separate note. The original is unchanged.');
    } catch (e) { toast(messageOf(e)); } finally { setBusy(false); }
  };
  const duplicate = async () => {
    if (!await flush() || !session) return;
    const path = await create({ title: title + ' copy', kind: current.kind, project: current.project });
    if (!path) return;
    try {
      const fresh = await vault.read(path);
      const text = setNoteProps(session.text, { title: title + ' copy', pinned: false });
      const r = await vault.saveDocument(path, text, session.blocks, fresh.text, null);
      saved(path, r.text); onOpen(path); toast('Note duplicated.');
    } catch (e) { toast('Could not duplicate the note: ' + messageOf(e)); }
  };
  const remove = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBusy(true);
    try {
      if (!await flush() || !session) return;
      const trashPath = await vault.trash(note.path, session.expected);
      forget(note.path); onDeleted();
      toast('Moved to Recently deleted.', { action: { label: 'Undo', onClick: () => { void vault.restore(trashPath, note.path).then(r => { saved(r.path, r.text); onOpen(r.path); }).catch(e => toast(messageOf(e))); } } });
    } catch (e) { toast(messageOf(e)); } finally { setBusy(false); }
  };
  const makeTask = async () => {
    const selected = window.getSelection()?.toString().trim();
    if (!selected) { toast('Select text in your note, then choose Make task.'); return; }
    if (await createTask({ title: selected, project: current.project || undefined }) !== null) toast('Task created.');
  };
  const actions: MenuEntry[] = [
    { id: 'duplicate', label: 'Duplicate note', icon: <Copy size={15}/>, onSelect: () => void duplicate() },
    { id: 'markdown', label: 'Export Markdown', icon: <FileText size={15}/>, onSelect: () => { void (editor.current?.flush() ?? Promise.resolve()).then(() => downloadNote(title + '.md', session?.text ?? note.text, 'text/markdown')).catch(e => toast(messageOf(e))); } },
    { id: 'rich', label: 'Export complete note', icon: <Download size={15}/>, onSelect: () => void exportRich() },
    { id: 'draft', label: 'Export recovery draft', disabled: !readDraft(note.path), onSelect: () => downloadNote(title + '-recovery.json', JSON.stringify(readDraft(note.path), null, 2), 'application/json') },
    { separator: true, id: 'sep' },
    { id: 'delete', label: 'Move to Recently deleted', icon: <Trash2 size={15}/>, destructive: true, onSelect: () => setConfirmDelete(true) },
  ];
  const insertions: MenuEntry[] = [['text', 'Text'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['todo', 'Checklist'], ['bulleted', 'Bulleted list'], ['numbered', 'Numbered list'], ['quote', 'Quote'], ['code', 'Code block'], ['divider', 'Divider']].map(([id, label]) => ({ id, label, onSelect: () => editor.current?.insert(id) }));
  const showMenu = (el: HTMLElement, kind: 'actions' | 'insert') => setMenu({ rect: el.getBoundingClientRect(), trigger: el, kind });
  const titleField = <div className="nts-doc-title-wrap"><div className="nv-doc-eyebrow">{current.project || 'Personal note'}</div><textarea ref={titleInput} className="nts-doc-title" aria-label="Note title" placeholder="Untitled" value={title === 'Untitled' ? '' : title} rows={1} onChange={e => { setTitle(e.target.value); update({ title: e.target.value.trim() || 'Untitled' }); }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); page.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus(); } }}/></div>;
  const tools = <div className="nts-doc-properties"><PopUpButton value={current.kind} onChange={kind => update({ kind })} label="Note type" className="nts-type-popup nts-doc-type" options={KINDS.map(k => ({value:k.id,label:k.label}))}/><PopUpButton value={current.project} onChange={project => update({ project: project || null })} label="Project" className="nts-type-popup nts-doc-type" options={[{value:'',label:'Personal'},...projects.filter(Boolean).map(p=>({value:p,label:p}))]}/>{(FIELDS[current.kind]?.length ?? 0) > 0 && <button className="nts-doc-property nts-doc-property--button" onClick={()=>setProperties(true)}><SlidersHorizontal size={13}/> Properties</button>}</div>;
  return <article className="nv-document" ref={page}>
    <header className="nv-docbar">
      <div className="nv-docbar-group"><button className="nv-icon nv-mobile-back" onClick={onBack} title="Back to library" aria-label="Back to library"><ArrowLeft size={17}/></button><button className="nv-icon" onClick={onFocus} title={focus ? 'Show library' : 'Focus mode'} aria-label={focus ? 'Show library' : 'Focus mode'}>{focus ? <PanelLeft size={17}/> : <Focus size={17}/>}</button><span className="nv-save" role="status">{session?.state === 'error' ? 'Not saved' : dirty || session?.state === 'pending' || session?.state === 'saving' ? 'Saving…' : 'On this device'}</span></div>
      <div className="nv-docbar-group">
        <button className="nv-icon" disabled={!ready} onMouseDown={e=>e.preventDefault()} onClick={()=>editor.current?.undo()} aria-label="Undo" title="Undo (Ctrl Z)"><Undo2 size={16}/></button>
        <button className="nv-icon" disabled={!ready} onMouseDown={e=>e.preventDefault()} onClick={()=>editor.current?.redo()} aria-label="Redo" title="Redo"><Redo2 size={16}/></button>
        <span className="nv-toolbar-divider"/>
        <button className="nv-icon" data-active={current.pinned || undefined} disabled={!session} onClick={()=>update({pinned:current.pinned ? null : true})} aria-label={current.pinned?'Unpin note':'Pin note'} title="Pin note"><Pin size={16}/></button>
        <button className="nv-icon" onClick={()=>setOutlineOpen(v=>!v)} data-active={outlineOpen || undefined} aria-label="Document outline" title="Document outline"><List size={17}/></button>
        <button className="nv-icon" disabled={!ready} onClick={e=>showMenu(e.currentTarget,'insert')} aria-label="Insert block" title="Insert block"><Plus size={18}/></button>
        <button className="nv-icon" onClick={e=>showMenu(e.currentTarget,'actions')} aria-label="Note actions" title="Note actions"><MoreHorizontal size={19}/></button>
      </div>
    </header>
    {(problem || changedElsewhere || session?.state === 'error') && <div className="nv-error" role="alert"><span>{problem || (changedElsewhere ? 'This note changed elsewhere. Your current edits are kept as a recovery draft.' : session?.error)}</span>{session?.state === 'error' && <button onClick={()=>void flush()}>Retry save</button>}<button onClick={()=>downloadNote(title+'-recovery.json', JSON.stringify(readDraft(note.path) ?? {text:session?.text ?? note.text, blocks:session?.blocks},null,2))}>Export recovery</button></div>}
    {confirmDelete && <div className="nv-delete-confirm"><span>Move “{title || 'Untitled'}” to Recently deleted?</span><button onClick={()=>setConfirmDelete(false)}>Keep note</button><button className="nv-danger" disabled={busy} onClick={()=>void remove()}>Move to trash</button></div>}
    {recovery && <div className="nv-error"><button disabled={busy} onClick={() => void recoverCopy()}>Recover draft as a separate note</button></div>}
    <div className="nv-writing-area">
      <div className="nts-focus__canvas">{!initial ? <div className="nv-empty"><FileText size={28}/><p>{problem ? 'Unable to open this note' : 'Opening your note…'}</p>{problem && <button onClick={()=>downloadNote(title+'.md',note.text)}>Export original</button>}</div> : <Suspense fallback={<div className="nv-empty">Preparing your writing space…</div>}><BlockEditor initialText={initial.body} initialTitle={title} snapshot={initial.snapshot} header={titleField} tools={tools} onReady={handle=>{editor.current=handle;setReady(true);render(v=>v+1);}} onDirty={()=>setDirty(true)} onChange={(snapshot, markdown)=>{sessionRef.current?.content(snapshot, markdown);if(live.current){setDirty(false);render(v=>v+1);}}}/></Suspense>}</div>
      {outlineOpen && <aside className="nv-outline"><h3>On this page</h3>{entries.length ? entries.map(row=><button key={row.id} style={{paddingLeft:12+(row.level-1)*10}} onClick={()=>editor.current?.scrollTo(row.id)}>{row.text}</button>) : <p>Add a heading to give your thoughts some structure.</p>}</aside>}
    </div>
    <footer className="nv-docfoot"><span>{words.toLocaleString()} words<span className="nv-foot-dot">·</span>{Math.max(1,Math.ceil(words/200))} min read</span><button onMouseDown={e=>e.preventDefault()} onClick={()=>void makeTask()}><ListPlus size={13}/> Make task from selection</button><span className="nv-slash-hint">Type / for blocks</span></footer>
    {menu && <Menu entries={menu.kind==='actions'?actions:insertions} placement={{over:menu.rect}} trigger={menu.trigger} onClose={()=>setMenu(null)} label={menu.kind==='actions'?'Note actions':'Insert block'}/>}
    <PropertiesSheet key={current.kind} note={current} open={properties} onClose={()=>setProperties(false)} onSave={async fields=>{update(fields);await flush();}}/>
  </article>;
}
