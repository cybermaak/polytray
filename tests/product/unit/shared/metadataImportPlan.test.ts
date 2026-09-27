import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMetadataBackupV1, validateMetadataBackupV1 } from '../../../../src/shared/metadataBackup';
import { createMetadataImportPlan, isMetadataImportPlanCurrent } from '../../../../src/shared/metadataImportPlan';

const backup = (annotations: Array<{path:string; tags:string[]; notes:string|null; printStatus?:string}> = [], pendingAnnotations = annotations, collections: Array<{id:string;name:string;paths:string[]}> = []) => buildMetadataBackupV1({
  exportedAt: '2026-09-26T12:00:00.000Z', appVersion: '1.1.1', indexedAnnotations: annotations, pendingAnnotations,
  snapshot: { rendererRevision: 1, libraryRoots: ['/backup'], collections, preferences: { watch: false } },
});
const current = (annotations: Array<{path:string; tags:string[]; notes:string|null; printStatus?:string}> = [], collections: Array<{id:string;name:string;paths:string[]}> = []) => ({
  databaseBrowseRevision: 7, databaseAnnotationRevision: 12, annotations, pendingAnnotations: [], rendererRevision: 4,
  rendererState: { libraryRoots: ['/local'], collections, preferences: { watch: true } },
});

test('backup validator enforces byte and combined annotation limits before parsing', () => {
  assert.throws(() => validateMetadataBackupV1(new Uint8Array(50 * 1024 * 1024 + 1)), /50 MiB/i);
  const tooMany = { format: 'polytray-metadata-backup', version: 1, exportedAt: 'x', appVersion: 'x', annotations: new Array(125001).fill({path:'/x',tags:[],notes:null}), pendingAnnotations: new Array(125000).fill({path:'/y',tags:[],notes:null}), collections: [], libraryRoots: [], preferences: {}, manifest:{backupType:'metadata-only',sourceModelsIncluded:false,statement:'ok'} };
  assert.throws(() => validateMetadataBackupV1(tooMany), /250,?000/i);
});

test('version one backup defaults a missing pending array, while duplicate identities within an array fail', () => {
  const valid = backup([{path:'/models/a.stl',tags:[],notes:null}]);
  const { pendingAnnotations: _pending, ...withoutPending } = valid;
  assert.deepEqual(validateMetadataBackupV1(withoutPending).pendingAnnotations, []);
  assert.throws(() => validateMetadataBackupV1({...valid, annotations:[...valid.annotations, {...valid.annotations[0], path:'/models/./a.stl'}]}), /duplicate/i);
});

test('plan merges exact identities, retains conflicts and unmatched metadata, and exposes stale revisions', () => {
  const doc = backup([
    {path:'/models/a.stl',tags:['blue','backup'],notes:'backup note',printStatus:'Printed'},
    {path:'/foreign/b.stl',tags:['offline'],notes:'keep me',printStatus:'Printed'},
  ], []);
  const plan = createMetadataImportPlan({ backup: doc, current: current([{path:'/models/a.stl',tags:['BLUE','local'],notes:'local note',printStatus:'Failed'}]), planId:'opaque' });
  assert.equal(plan.planId, 'opaque');
  assert.deepEqual(plan.annotations.find(x => x.path === '/models/a.stl')?.after, {path:'/models/a.stl',tags:['BLUE','local','backup'],notes:'local note',printStatus:'Failed'});
  assert.equal(plan.annotationConflicts.length, 2);
  assert.deepEqual(plan.unmatchedPending.map(x => x.path), ['/foreign/b.stl']);
  assert.equal(plan.pendingAnnotations.some(x => x.path === '/foreign/b.stl' && x.source === 'unmatched-pending'), true);
  assert.equal(plan.changed.some(x => x.path === '/foreign/b.stl'), true);
  assert.equal(isMetadataImportPlanCurrent(plan, {databaseBrowseRevision:7,databaseAnnotationRevision:12,rendererRevision:4}), true);
  assert.equal(isMetadataImportPlanCurrent(plan, {databaseBrowseRevision:7,databaseAnnotationRevision:13,rendererRevision:4}), false);
});

test('matching uses exact virtual member identity and reports status/note fill branches', () => {
  const a='/models/a.zip::entry::a/../part.stl', b='/models/a.zip::entry::part.stl';
  const doc=backup([{path:a,tags:['x'],notes:'',printStatus:'Printed'},{path:b,tags:['y'],notes:'note'}],[]);
  const plan=createMetadataImportPlan({backup:doc,current:current([{path:b,tags:[],notes:null,printStatus:'Not Printed'}])});
  assert.deepEqual(plan.matched.map(x=>x.path), [b]);
  assert.deepEqual(plan.unmatchedPending.map(x=>x.path), [a]);
  assert.equal(plan.annotations.find(x => x.path === b)?.after.notes,'note');
  assert.equal(plan.annotations.find(x => x.path === b)?.after.printStatus,'Not Printed');
});

test('collection collisions receive a repeat-stable id and options stage exact normalized states', () => {
  const doc=backup([],[],[{id:'same',name:'Backup',paths:['/offline/model.stl']}]);
  const currentState=current([], [{id:'same',name:'Local',paths:['/local/a.stl']}]);
  const first=createMetadataImportPlan({backup:doc,current:currentState});
  const retry=createMetadataImportPlan({backup:doc,current:currentState});
  assert.deepEqual(first.collectionIdRemaps,retry.collectionIdRemaps);
  assert.notEqual(first.collectionIdRemaps[0].newId,'same');
  assert.deepEqual(first.rendererChanges.settings.after, { lightMode:false, gridSize:'medium', autoScan:true, accentColor:'#6d9fff', previewColor:'#8888aa', thumbnailColor:'#8888aa', thumbQuality:'256', showGrid:true, watch:true });
  assert.deepEqual(first.rendererChanges.roots.after, ['/local']);
  const selected=createMetadataImportPlan({backup:doc,current:currentState,options:{replaceSettings:true,replaceRoots:true}});
  assert.deepEqual(selected.rendererChanges.roots.after,['/backup']);
  assert.deepEqual(selected.rendererChanges.settings.after,{ lightMode:false, gridSize:'medium', autoScan:true, accentColor:'#6d9fff', previewColor:'#8888aa', thumbnailColor:'#8888aa', thumbQuality:'256', showGrid:true, watch:false });
});

test('indexed and pending records remain separate and pending overlap merges only with current pending state', () => {
  const doc=backup([{path:'/same.stl',tags:['indexed'],notes:'indexed value'}], [{path:'/same.stl',tags:['pending'],notes:'pending value'}]);
  const state=current([{path:'/same.stl',tags:[],notes:'indexed value'}]);
  state.pendingAnnotations=[{path:'/same.stl',tags:[],notes:'local pending'}];
  const plan=createMetadataImportPlan({backup:doc,current:state});
  assert.equal(plan.annotations.length,1);
  assert.equal(plan.annotations[0].after.notes,'indexed value');
  assert.equal(plan.pendingAnnotations.length,1);
  assert.equal(plan.pendingAnnotations[0].after.notes,'local pending');
  assert.equal(plan.annotationConflicts.some(c=>c.field==='notes' && c.existing==='local pending' && c.incoming==='pending value'),true);
});

test('empty notes and default print status are filled while exact collection identity unions members', () => {
  const doc=backup([{path:'/models/a.stl',tags:[],notes:'restored note',printStatus:'Printed'}],[],[{id:'c1',name:'Favorites',paths:['/offline.stl']}]);
  const state=current([{path:'/models/a.stl',tags:[],notes:'   ',printStatus:'Not Printed'}],[{id:'c1',name:'Favorites',paths:['/online.stl']}]);
  const plan=createMetadataImportPlan({backup:doc,current:state});
  assert.deepEqual(plan.annotations[0].after,{path:'/models/a.stl',tags:[],notes:'restored note',printStatus:'Printed'});
  assert.deepEqual(plan.collections[0].paths,['/offline.stl','/online.stl']);
});
