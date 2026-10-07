import { build } from 'esbuild';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.on('uncaughtException', error => { console.error(error.message); process.exit(1); });

// Isolated unit/integration checks. Never points at the owner's vault or profile.
const memory = new Map();
globalThis.localStorage = { getItem: k => memory.get(k) ?? null, setItem: (k,v) => memory.set(k,v), removeItem: k => memory.delete(k) };
async function compile(entry, plugins = []) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm', plugins, banner: {js: `import {createRequire} from 'node:module';const require=createRequire(${JSON.stringify(path.resolve('package.json'))});`} });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const { DocumentSession, readDraft } = await compile('src/notes/documentSession.ts');
const { vault } = await compile('src/notes/backend.ts');
const { parseNote } = await compile('src/notes/notefile.ts');
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('PASS', name); }
const original = '---\ntitle: Original\ncustom: preserve\n---\nBody';
await check('rapid metadata and body changes serialize without clobbering', async () => {
  let release; let persisted = original; let rich = null; const writes = [];
  const first = new Promise(resolve => { release = resolve; });
  const session = new DocumentSession('Notes/race.md', original, null, { async saveDocument(p,t,b,e,eb) {
    writes.push(t); if (writes.length === 1) await first;
    assert.equal(e,persisted); assert.equal(eb,rich); persisted=t; rich=b;
    return {path:p,text:t,mtime:Date.now()};
  } }, () => {}, () => {});
  session.fields({title:'First'}); const saving = session.flush();
  session.content({type:'page',blocks:{flavour:'affine:page',children:[]}}, 'New body');
  session.fields({title:'Final',project:'Demo'}); release();
  assert.equal(await saving,true); assert.equal(writes.length,2);
  assert.equal(parseNote('Notes/race.md',persisted,0).title,'Final');
  assert.match(persisted,/custom: preserve/); assert.match(persisted,/New body/);
  assert.equal(readDraft('Notes/race.md'),null);
});
await check('save conflict keeps recovery draft and reports failure', async () => {
  const session = new DocumentSession('Notes/conflict.md',original,null,{async saveDocument(){throw new Error('conflict: changed elsewhere');}},()=>{},()=>{});
  session.fields({title:'Unsaved'});
  assert.equal(await session.flush(),false); assert.equal(session.state,'error');
  assert.equal(parseNote('',readDraft(session.path).text,0).title,'Unsaved');
  assert.equal(readDraft(session.path).expected,original);
});
await check('browser paired save refuses stale rich document', async () => {
  await vault.write('Notes/paired.md',original,null);
  await vault.saveDocument('Notes/paired.md',original,'snapshot-1',original,null);
  await assert.rejects(vault.saveDocument('Notes/paired.md','wrong','snapshot-2',original,null),/conflict/);
  assert.equal((await vault.read('Notes/paired.md')).text,original);
  assert.equal((await vault.readBlocks('Notes/paired.md')).text,'snapshot-1');
});
await check('browser trash and restore preserve rich document including assets', async () => {
  const bundle = JSON.stringify({axonixAssets:{image:{type:'image/png',base64:'AA=='}}});
  await vault.write('Notes/restore.md',original,null);
  await vault.saveDocument('Notes/restore.md',original,bundle,original,null);
  const trash = await vault.trash('Notes/restore.md',original);
  assert.ok((await vault.listTrash()).some(n=>n.originalPath==='Notes/restore.md'));
  assert.equal(await vault.readBlocks('Notes/restore.md'),null);
  await vault.restore(trash,'Notes/restore.md');
  assert.equal((await vault.readBlocks('Notes/restore.md')).text,bundle);
});

const handlers = new Map(); globalThis.__notesTestHandlers = handlers;
const { registerVault } = await compile('electron/vault.ts', [{ name:'electron-test-bridge', setup(b) {
  b.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'test'}));
  b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export const ipcMain={handle:(n,f)=>globalThis.__notesTestHandlers.set(n,f),on:()=>{}}; export const protocol={handle:()=>{},registerSchemesAsPrivileged:()=>{}}; export const net={}; export const shell={};`,loader:'js'}));
} }]);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(),'axonix-notes-v2-test-'));
registerVault({vault:scratch,isHost:s=>s==='test-host',send:()=>{}});
const call = (name,...args)=>handlers.get('vault:'+name)({sender:'test-host'},...args);
try {
  await check('desktop paired save checks both expectations before writing', async()=>{
    call('write','Notes/Test.md',original,null);
    call('document-save','Notes/Test.md',original,'rich-one',original,null);
    assert.throws(()=>call('document-save','Notes/Test.md','wrong','rich-two',original,null),/conflict/);
    assert.equal(call('read','Notes/Test.md').text,original);
    assert.equal(call('blocks-read','Notes/Test.md').text,'rich-one');
  });
  await check('desktop trash listing and paired restoration round-trip', async()=>{
    const trashed=call('trash','Notes/Test.md',original);
    assert.equal(call('notes-trash-list')[0].originalPath,'Notes/Test.md');
    call('restore',trashed,'Notes/Test.md');
    assert.equal(call('blocks-read','Notes/Test.md').text,'rich-one');
    assert.equal(call('notes-trash-list').length,0);
  });
  await check('desktop rejects untrusted sender and path traversal', async()=>{
    assert.throws(()=>handlers.get('vault:read')({sender:'other'},'Notes/Test.md'),/not allowed/);
    assert.throws(()=>call('document-save','../escape.md','x',null,'x',null));
  });
  await check('desktop restores cannot overwrite an existing note', async()=>{
    const trashed=call('trash','Notes/Test.md',original);
    call('write','Notes/Test.md','new original',null);
    assert.throws(()=>call('restore',trashed,'Notes/Test.md'),/conflict/);
    assert.equal(call('read','Notes/Test.md').text,'new original');
    assert.equal(call('notes-trash-list').length,1);
  });
} finally {
  // Only the explicit mkdtemp directory created by this test is removed.
  assert.ok(path.resolve(scratch).startsWith(path.resolve(os.tmpdir())+path.sep+'axonix-notes-v2-test-'));
  fs.rmSync(scratch,{recursive:true,force:true});
}
console.log(`${passed} Notes v2 checks passed.`);
