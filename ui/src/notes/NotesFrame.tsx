/** Notes v2: a library and a quiet document, with no filesystem concepts in the UI. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownWideNarrow, ArrowLeft, BookOpen, FileText, Import, Layers, NotebookPen, Pin, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { matchesNote, useNotes, type NoteFilter } from './NotesContext';
import { KINDS, KIND_LABEL, parseNote, setNoteProps, type Note, type NoteKind } from './notefile';
import { vault, messageOf, type TrashedNote } from './backend';
import { Menu, PopUpButton } from '../finance/components/Menu';
import NotePage from './NotePage';
import Sheet, { Field, SheetFooter } from '../finance/components/Sheet';
import { useTasks } from '../tasks/TasksContext';

export interface NoteRequest { target: string; n: number }
const dayLabel = (time: number) => {
  const day = new Date(time); const today = new Date(); today.setHours(0,0,0,0);
  return time >= +today ? 'Today' : time >= +today - 86400000 ? 'Yesterday' : new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'}).format(day);
};
const preference = (key: string, fallback: string) => { try { return localStorage.getItem('axonix:notes:'+key) || fallback; } catch { return fallback; } };
export default function NotesFrame({ request, onExit }: { request?: NoteRequest | null; onExit?: () => void }) {
  const { notes, loading, error, create, saved, refresh, collections, saveCollection, deleteCollection } = useNotes();
  const { projects } = useTasks();
  const [active, setActive] = useState<string|null>(()=>preference('active','') || null);
  useEffect(() => { try { localStorage.setItem('axonix:notes:active', active || ''); } catch {} }, [active]);
  const [scope, setScope] = useState('all'); const [filter, setFilter] = useState<NoteFilter>({});
  const [sort, setSort] = useState(()=>preference('sort','edited'));
  const [focus, setFocus] = useState(false); const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState(false); const [collectionForm, setCollectionForm] = useState(false);
  const [collectionName, setCollectionName] = useState(''); const [trash, setTrash] = useState<TrashedNote[]>([]);
  const [trashLoading, setTrashLoading] = useState(false); const [trashError, setTrashError] = useState('');
  const [restoreBusy, setRestoreBusy] = useState<string|null>(null);
  const [menu, setMenu] = useState<{rect:DOMRect;trigger:HTMLElement}|null>(null);
  const search = useRef<HTMLInputElement>(null); const input = useRef<HTMLInputElement>(null);
  const flush = useRef<(()=>Promise<boolean>)|null>(null);
  const registerFlush = useCallback((f:(()=>Promise<boolean>)|null)=>{flush.current=f;},[]);
  const select = async (path:string|null) => { if (flush.current && !await flush.current()) return; setActive(path); try {localStorage.setItem('axonix:notes:active',path||'');}catch{} };
  const effective = {...filter, ...(scope==='pinned'?{pinned:true}:{})};
  const visible = useMemo(()=>notes.filter(n=>matchesNote(n,effective)).sort((a,b)=>Number(b.pinned)-Number(a.pinned) || (sort==='title'?a.title.localeCompare(b.title):sort==='oldest'?a.mtime-b.mtime:b.mtime-a.mtime)),[notes,filter,scope,sort]);
  const current = notes.find(n=>n.path===active);
  const requestSeen = useRef<number|null>(null);
  useEffect(()=>{
    if(!request || requestSeen.current===request.n || loading) return;
    const target=request.target.replace(/\.md$/i,'').toLowerCase();
    const found=notes.find(n=>n.title.toLowerCase()===target || n.path.replace(/\.md$/i,'').toLowerCase()===target || n.path.replace(/\.md$/i,'').split('/').pop()?.toLowerCase()===target);
    requestSeen.current=request.n;
    if(found){setScope('all');setFilter({});void select(found.path);} else toast('That note could not be found.');
  },[request,notes,loading]);
  const loadTrash = useCallback(async()=>{
    setTrashLoading(true);setTrashError('');
    try{setTrash(await vault.listTrash());}catch(e){setTrashError(messageOf(e));}finally{setTrashLoading(false);}
  },[]);
  const chooseScope = async (next:string, nextFilter:NoteFilter={}) => {
    if(next==='trash' && flush.current && !await flush.current())return;
    setScope(next);setFilter(nextFilter);setFocus(false);
    if(next==='trash'){setActive(null);void loadTrash();}
  };
  const add = async (kind:NoteKind='note')=>{
    if(creating)return;
    if(flush.current && !await flush.current())return;
    setCreating(true);
    try{const path=await create({kind,project:filter.project||''});if(path){setScope('all');setFilter({});setActive(path);setTemplates(false);}}
    finally{setCreating(false);}
  };
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      if(document.querySelector('dialog[open]'))return;
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='n'){e.preventDefault();e.stopPropagation();void add();}
      if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='f'){e.preventDefault();e.stopPropagation();setFocus(false);search.current?.focus();}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();e.stopPropagation();void flush.current?.();}
      // Native block menus own Escape; Notes shouldn't unexpectedly exit to the launcher.
      if(e.key==='Escape'){e.preventDefault();if(focus)setFocus(false);}
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[focus,creating,filter.project]);
  const restore = async (item:TrashedNote)=>{
    setRestoreBusy(item.path);
    try{const r=await vault.restore(item.path,item.originalPath);saved(r.path,r.text);await loadTrash();toast('Note restored.');}
    catch(e){toast('Could not restore: '+messageOf(e));}finally{setRestoreBusy(null);}
  };
  const importFiles = async (files:FileList|null)=>{
    if(!files)return;
    if(flush.current&&!await flush.current())return;
    for(const file of Array.from(files)){
      try{
        if(file.size>12*1024*1024)throw new Error('Choose a note smaller than 12 MB.');
        let text=await file.text();let blocks:string|null=null;
        let title=file.name.replace(/\.(md|txt|json)$/i,'').replace(/\.axonix-note$/i,'');
        if(file.name.endsWith('.json')){
          const bundle=JSON.parse(text);
          if(bundle.format!=='axonix-note-v2'||typeof bundle.text!=='string')throw new Error('This is not an Axonix note export.');
          text=bundle.text;
          if(bundle.document){if(bundle.document.type!=='page'||!bundle.document.blocks)throw new Error('Invalid rich document.');blocks=JSON.stringify(bundle.document);}
          title=parseNote('',text,Date.now()).title||title;
        }
        const path=await create({title});if(!path)continue;
        const fresh=await vault.read(path);
        const r=await vault.saveDocument(path,setNoteProps(text,{title}),blocks,fresh.text,null);
        saved(path,r.text);setScope('all');setFilter({});setActive(path);
      }catch(e){toast('Could not import '+file.name+': '+messageOf(e));}
    }
    if(input.current)input.current.value='';
  };
  const sectionTitle=scope==='pinned'?'Pinned':scope==='trash'?'Recently deleted':collections.find(c=>c.id===scope)?.name||'All notes';
  return <div className="nv-workspace" data-focus={focus&&!!current||undefined} data-open={!!current||undefined}>
    <aside className="nv-library" aria-label="Notes library">
      {onExit && <button className="nv-exit" onClick={() => { void (async () => { if (!flush.current || await flush.current()) onExit(); })(); }}><ArrowLeft size={12}/> AXONIX</button>}
      <header className="nv-library-head"><div><NotebookPen size={22}/><h1>Notes</h1><span className="nv-version">2</span></div><button className="nv-icon nv-compose" onClick={()=>void add()} disabled={creating} aria-label="New note" title="New note (Ctrl N)"><Plus size={20}/></button></header>
      <label className="nv-search"><Search size={15}/><input ref={search} aria-label="Search notes" placeholder="Search your notes" value={filter.query||''} onChange={e=>setFilter(f=>({...f,query:e.target.value}))}/>{filter.query&&<button className="nv-icon" onClick={()=>setFilter(f=>({...f,query:''}))} aria-label="Clear search"><X size={13}/></button>}</label>
      <nav className="nv-scopes" aria-label="Library views"><button data-active={scope==='all'||undefined} onClick={()=>void chooseScope('all')}><BookOpen size={15}/> All notes <span>{notes.length}</span></button><button data-active={scope==='pinned'||undefined} onClick={()=>void chooseScope('pinned')}><Pin size={14}/> Pinned <span>{notes.filter(n=>n.pinned).length}</span></button></nav>
      {collections.length>0&&<div className="nv-collections">{collections.map(c=><div key={c.id}><button data-active={scope===c.id||undefined} onClick={()=>void chooseScope(c.id,c.filter)}><Layers size={13}/>{c.name}</button><button className="nv-icon" aria-label={'Remove collection '+c.name} title="Remove saved view" onClick={()=>{deleteCollection(c.id);if(scope===c.id)void chooseScope('all');}}><X size={11}/></button></div>)}</div>}
      <div className="nv-list-heading"><h2>{sectionTitle}</h2><div><button className="nv-icon" title="Save current filters as a collection" aria-label="Save collection" onClick={()=>{setCollectionName('');setCollectionForm(true);}}><Plus size={15}/></button><button className="nv-icon" title="Sort notes" aria-label="Sort notes" onClick={e=>setMenu({rect:e.currentTarget.getBoundingClientRect(),trigger:e.currentTarget})}><ArrowDownWideNarrow size={15}/></button></div></div>
      {scope!=='trash'&&<div className="nv-filterrow"><PopUpButton value={filter.kind||''} onChange={kind=>setFilter(f=>({...f,kind:kind||undefined}))} label="Filter by type" options={[{value:'',label:'All types'},...KINDS.map(k=>({value:k.id,label:k.label}))]}/><PopUpButton value={filter.project??'*'} onChange={project=>setFilter(f=>({...f,project:project==='*'?undefined:project}))} label="Filter by project" options={[{value:'*',label:'All projects'},{value:'',label:'Personal'},...projects.filter(Boolean).map(p=>({value:p,label:p}))]}/></div>}
      <div className="nv-note-list" aria-label="Your notes">
        {loading||trashLoading?<div className="nv-list-empty">Opening your library…</div>:error||trashError?<div className="nv-error" role="alert">{error||trashError}<button onClick={()=>void(scope==='trash'?loadTrash():refresh())}>Try again</button></div>:scope==='trash'?trash.length?trash.map(item=>{const n=parseNote(item.originalPath,item.text,item.mtime);return <div className="nv-trash-row" key={item.path}><FileText size={16}/><div><strong>{n.title}</strong><p>{n.excerpt||'Empty note'}</p></div><button disabled={restoreBusy===item.path} onClick={()=>void restore(item)}>Restore</button></div>;}):<div className="nv-list-empty"><Trash2 size={24}/><strong>Nothing in Recently deleted</strong><p>Notes you delete can be restored here.</p></div>:visible.length?visible.map(n=><LibraryNote key={n.path} note={n} selected={active===n.path} onClick={()=>void select(n.path)}/>):<div className="nv-list-empty"><Search size={23}/><strong>{notes.length?'No matching notes':'A little space for everything'}</strong><p>{notes.length?'Try another search or clear your filters.':'Capture an idea. Plan something. Start wherever you are.'}</p>{notes.length?<button onClick={()=>{setFilter({});setScope('all');}}>Clear filters</button>:<button onClick={()=>void add()}>Write your first note</button>}</div>}
      </div>
      <footer className="nv-library-foot"><button onClick={()=>setTemplates(true)}><Sparkles size={14}/> Templates</button><button onClick={()=>input.current?.click()} title="Import Markdown, text or Axonix note" aria-label="Import notes"><Import size={15}/></button><button data-active={scope==='trash'||undefined} onClick={()=>void chooseScope('trash')} title="Recently deleted" aria-label="Recently deleted"><Trash2 size={15}/></button></footer>
      <input ref={input} type="file" hidden multiple accept=".md,.txt,.json" onChange={e=>void importFiles(e.target.files)}/>
    </aside>
    <main className="nv-main">{current&&scope!=='trash'?<NotePage key={current.path} note={current} focus={focus} onFocus={()=>setFocus(v=>!v)} onBack={()=>void select(null)} onOpen={path=>{void select(path);}} onDeleted={()=>{flush.current=null;setActive(null);}} registerFlush={registerFlush}/>:<div className="nv-welcome"><div className="nv-welcome-mark"><NotebookPen size={35} strokeWidth={1.2}/></div><span className="nv-kicker">YOUR THINKING SPACE</span><h2>Room for a thought.<br/>Space for the whole idea.</h2><p>A quiet place to write, collect and connect.<br/>Everything stays with you, on this device.</p><button className="nv-primary" onClick={()=>void add()} disabled={creating}><Plus size={17}/> New note <kbd>Ctrl N</kbd></button><button className="nv-text-button" onClick={()=>setTemplates(true)}>Start with a template</button><div className="nv-welcome-hints"><span><Search size={14}/> Find any thought</span><span><Layers size={14}/> Make it your own</span></div></div>}</main>
    {menu&&<Menu label="Sort notes" trigger={menu.trigger} placement={{over:menu.rect,selectedId:sort}} onClose={()=>setMenu(null)} entries={[['edited','Last edited'],['title','Title'],['oldest','Oldest first']].map(([id,label])=>({id,label,checked:sort===id,onSelect:()=>{setSort(id);try{localStorage.setItem('axonix:notes:sort',id);}catch{}}}))}/>}
    <Sheet open={templates} onClose={()=>setTemplates(false)} title="Start with a little structure"><div className="nv-template-grid">{KINDS.map(k=><button key={k.id} disabled={creating} onClick={()=>void add(k.id)}><FileText size={21}/><strong>{k.label}</strong><span>{k.hint}</span></button>)}</div></Sheet>
    <Sheet open={collectionForm} onClose={()=>setCollectionForm(false)} title="Save this collection"><form id="nv-collection-form" onSubmit={e=>{e.preventDefault();const c=saveCollection(collectionName,effective);setScope(c.id);setCollectionForm(false);}}><p className="fin-hint">Keep this combination of search, type and project filters. Matching notes appear automatically.</p><Field label="Collection name"><input className="fin-input" autoFocus required value={collectionName} onChange={e=>setCollectionName(e.target.value)} placeholder="Research, meeting notes, ideas…"/></Field><SheetFooter><button type="button" className="fin-pill" onClick={()=>setCollectionForm(false)}>Cancel</button><button className="fin-pill fin-pill--primary" type="submit" form="nv-collection-form">Save collection</button></SheetFooter></form></Sheet>
  </div>;
}
function LibraryNote({note,selected,onClick}:{note:Note;selected:boolean;onClick:()=>void}){
  return <button className="nv-note-row" data-selected={selected||undefined} aria-current={selected?'page':undefined} onClick={onClick}><div className="nv-note-row-title">{note.pinned&&<Pin size={12}/>}<strong>{note.title||'Untitled'}</strong></div><p>{note.excerpt||'No additional text'}</p><div className="nv-note-row-meta"><span>{dayLabel(note.mtime)}</span><span className="nv-note-type">{note.project||KIND_LABEL[note.kind]}</span></div></button>;
}
