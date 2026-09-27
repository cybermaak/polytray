import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { MetadataImportPlan as PublicMetadataImportPlan } from '../../../../src/shared/backupContracts';
import { buildMetadataBackupV1, serializeMetadataBackup, validateMetadataBackupV1 } from '../../../../src/shared/metadataBackup';
import { createMetadataImportPlan, isMetadataImportPlanCurrent } from '../../../../src/shared/metadataImportPlan';

const backup = (annotations: Array<{path:string; tags:string[]; notes:string|null; printStatus?:string}> = [], pendingAnnotations = annotations, collections: Array<{id:string;name:string;paths:string[]}> = [], preferences: Record<string, unknown> = { watch: false }, libraryRoots=['/backup']) => buildMetadataBackupV1({
  exportedAt: '2026-09-26T12:00:00.000Z', appVersion: '1.1.1', indexedAnnotations: annotations, pendingAnnotations,
  snapshot: { rendererRevision: 1, libraryRoots, collections, preferences: preferences as never },
});
const current = (annotations: Array<{path:string; tags:string[]; notes:string|null; printStatus?:string}> = [], collections: Array<{id:string;name:string;paths:string[]}> = [], preferences: Record<string, unknown> = { watch: true }) => ({
  databaseBrowseRevision: 7, annotations, pendingAnnotations: [], rendererRevision: 4,
  rendererState: { libraryRoots: ['/local'], collections, preferences },
});

test('plan uses the single real browse revision and shared public plan contract', () => {
  const plan: PublicMetadataImportPlan = createMetadataImportPlan({ backup: backup(), current: current(), transactionId:'opaque' });
  assert.equal(plan.transactionId, 'opaque');
  assert.match(plan.inputRevision,/^[0-9a-f]{64}$/);
  assert.equal(plan.currentBrowseRevision, 7);
  assert.equal(isMetadataImportPlanCurrent(plan, { browseRevision:7, rendererRevision:4 }), true);
  assert.equal(isMetadataImportPlanCurrent(plan, { browseRevision:8, rendererRevision:4 }), false);
  assert.equal(isMetadataImportPlanCurrent(plan, { browseRevision:7, rendererRevision:5 }), false);
});

test('fingerprint and default transaction ID include normalized replacement intent', () => {
  const source={backup:backup(),current:current()};
  const omitted=createMetadataImportPlan(source);
  const explicitFalse=createMetadataImportPlan({...source,options:{replaceSettings:false,replaceRoots:false}});
  const settingsReplacement=createMetadataImportPlan({...source,options:{replaceSettings:true}});
  const rootsReplacement=createMetadataImportPlan({...source,options:{replaceRoots:true}});
  assert.equal(omitted.inputRevision,explicitFalse.inputRevision);
  assert.equal(omitted.transactionId,explicitFalse.transactionId);
  assert.notEqual(omitted.inputRevision,settingsReplacement.inputRevision);
  assert.notEqual(omitted.transactionId,settingsReplacement.transactionId);
  assert.notEqual(omitted.inputRevision,rootsReplacement.inputRevision);
  assert.notEqual(omitted.transactionId,rootsReplacement.transactionId);
  assert.equal(createMetadataImportPlan({...source,transactionId:'caller-token',options:{replaceRoots:true}}).transactionId,'caller-token');
});

test('online indexed and pending sources become one indexed update with deterministic unions and conflicts', () => {
  const doc=backup(
    [{path:'/models/a.stl',tags:['indexed'],notes:'indexed backup note'}],
    [{path:'/models/a.stl',tags:['pending'],notes:'pending backup note',printStatus:'Printed'}],
  );
  const plan=createMetadataImportPlan({backup:doc,current:current([{path:'/models/a.stl',tags:['current'],notes:'local note',printStatus:'Failed'}])});
  assert.equal(plan.annotationUpdates.length,1);
  assert.equal(plan.annotationUpdates[0].destination,'indexed');
  assert.deepEqual(plan.annotationUpdates[0].after,{path:'/models/a.stl',tags:['current','indexed','pending'],notes:'local note',printStatus:'Failed'});
  assert.deepEqual(plan.annotationUpdates[0].sources,['annotations','pendingAnnotations']);
  assert.deepEqual(plan.annotationConflicts.map(x=>[x.field,x.incoming]),[
    ['notes','indexed backup note'],['notes','pending backup note'],['printStatus','Printed'],
  ]);
});

test('unmatched indexed and pending values upsert one current pending record without replacing unrelated pending rows', () => {
  const doc=backup(
    [{path:'/offline.stl',tags:['from-indexed'],notes:'incoming indexed note'}],
    [{path:'/offline.stl',tags:['from-pending'],notes:'incoming pending note'}],
  );
  const state=current();
  state.pendingAnnotations=[
    {path:'/offline.stl',tags:['existing'],notes:'local pending note'},
    {path:'/other-offline.stl',tags:['keep'],notes:'unrelated'},
  ];
  const plan=createMetadataImportPlan({backup:doc,current:state});
  assert.equal(plan.pendingAnnotationUpdates.length,1);
  assert.equal(plan.pendingAnnotationUpdates[0].path,'/offline.stl');
  assert.deepEqual(plan.pendingAnnotationUpdates[0].after,{path:'/offline.stl',tags:['existing','from-indexed','from-pending'],notes:'local pending note'});
  assert.deepEqual(plan.pendingAnnotationUpdates[0].sources,['annotations','pendingAnnotations']);
  assert.deepEqual(plan.unmatchedPaths,['/offline.stl']);
  assert.equal(plan.annotationConflicts.filter(x=>x.path==='/offline.stl' && x.field==='notes').length,2);
  assert.equal(plan.pendingAnnotationUpdates.some(x=>x.path==='/other-offline.stl'),false);
});

test('empty notes and default print status fill; exact virtual paths match without filename guessing', () => {
  const a='/models/a.zip::entry::a/../part.stl', b='/models/a.zip::entry::part.stl';
  const doc=backup([{path:a,tags:['x'],notes:'virtual'},{path:b,tags:['y'],notes:'restored note',printStatus:'Printed'}],[]);
  const plan=createMetadataImportPlan({backup:doc,current:current([{path:b,tags:[],notes:'   ',printStatus:'Not Printed'}])});
  assert.deepEqual(plan.annotationUpdates.map(x=>x.path),[b]);
  assert.deepEqual(plan.pendingAnnotationUpdates.map(x=>x.path),[a]);
  assert.equal(plan.annotationUpdates[0].after.notes,'restored note');
  assert.equal(plan.annotationUpdates[0].after.printStatus,'Printed');
});

test('collection collision IDs are reused after a plan has been applied', () => {
  const doc=backup([],[],[{id:'same',name:'Backup',paths:['/offline/model.stl']}]);
  const baseId=`import-${createHash('sha256').update('2026-09-26T12:00:00.000Z|1.1.1|same|Backup').digest('hex').slice(0,16)}`;
  const initial=current([], [
    {id:'same',name:'Local',paths:['/local/a.stl']},
    {id:baseId,name:'Occupied',paths:['/occupied.stl']},
  ]);
  const first=createMetadataImportPlan({backup:doc,current:initial});
  assert.equal(first.collectionIdRemaps[0].newId,`${baseId}-1`);
  const appliedState=current([],first.collectionsAfter);
  const retry=createMetadataImportPlan({backup:doc,current:appliedState});
  assert.equal(first.collectionIdRemaps[0].newId,retry.collectionIdRemaps[0].newId);
  assert.equal(retry.collectionsAfter.length,3);
  assert.deepEqual(retry.collectionsAfter[2].paths,['/offline/model.stl']);
});

test('settings preview retains the complete normalized local settings with replacement off or on', () => {
  const local={watch:true,page_size:700,thumbnail_timeout:3210,slicerPath:'/apps/slicer',previewPanelWidth:777,gridSize:'large'};
  const doc=backup([],[],[],{watch:false,gridSize:'small',slicerPath:'/foreign/slicer',page_size:1} as never);
  const state=current([],[],local);
  const off=createMetadataImportPlan({backup:doc,current:state});
  const complete={...local,lightMode:false,autoScan:true,showGrid:true,thumbQuality:'256',accentColor:'#6d9fff',previewColor:'#8888aa',thumbnailColor:'#8888aa',scanning_batch_size:50,watcher_stability:1000};
  assert.deepEqual(off.settingsBefore,complete);
  assert.deepEqual(off.settingsAfter,complete);
  const on=createMetadataImportPlan({backup:doc,current:state,options:{replaceSettings:true}});
  assert.equal(on.settingsAfter.watch,false);
  assert.equal(on.settingsAfter.gridSize,'small');
  assert.equal(on.settingsAfter.page_size,700);
  assert.equal(on.settingsAfter.thumbnail_timeout,3210);
  assert.equal(on.settingsAfter.slicerPath,'/apps/slicer');
  assert.equal(on.settingsAfter.previewPanelWidth,777);
});

test('collection identity union preserves current collection ordering', () => {
  const doc=backup([],[],[{id:'c1',name:'Favorites',paths:['/offline.stl']},{id:'new',name:'New',paths:['/new.stl']}]);
  const state=current([],[{id:'z',name:'Last',paths:[]},{id:'c1',name:'Favorites',paths:['/online.stl']}]);
  const plan=createMetadataImportPlan({backup:doc,current:state});
  assert.deepEqual(plan.collectionsAfter.map(c=>c.id),['z','c1','new']);
  assert.deepEqual(plan.collectionsAfter[1].paths,['/online.stl','/offline.stl']);
});

test('backup round-trip and tag merge preserve nonblank multiline note formatting verbatim', () => {
  const note='\n  first line\n    indented detail\n';
  const document=backup([{path:'/notes.stl',tags:['backup'],notes:note}],[]);
  const roundTripped=validateMetadataBackupV1(JSON.parse(serializeMetadataBackup(document)));
  assert.equal(roundTripped.annotations[0].notes,note);
  const plan=createMetadataImportPlan({
    backup:roundTripped,
    current:current([{path:'/notes.stl',tags:['local'],notes:note}]),
  });
  assert.equal(plan.annotationUpdates[0].after.notes,note);
  assert.deepEqual(plan.annotationUpdates[0].after.tags,['local','backup']);
  assert.equal(plan.annotationConflicts.some(conflict=>conflict.field==='notes'),false);
});

test('Windows drive and UNC aliases preserve current roots and collection member spellings', () => {
  const driveRoot='C:\\Models\\';
  const uncRoot='\\\\NASBOX\\Share\\Models';
  const driveMember='C:\\Models\\Part.stl';
  const uncMember='\\\\NASBOX\\Share\\Part.stl';
  const state=current(
    [{path:driveMember,tags:[],notes:null}],
    [
      {id:'drive',name:'Drive',paths:[driveMember]},
      {id:'unc',name:'UNC',paths:[uncMember]},
      {id:'new',name:'New',paths:[]},
    ],
  );
  state.rendererState.libraryRoots=[driveRoot,uncRoot];
  const document=backup(
    [{path:'c:/models/part.stl',tags:['backup'],notes:null}],
    [],
    [
      {id:'drive',name:'Drive',paths:['c:/MODELS/PART.stl']},
      {id:'unc',name:'UNC',paths:['\\\\nasbox\\share\\part.stl']},
      {id:'new',name:'New',paths:['c:/models/part.stl']},
    ],
    undefined,
    ['c:/models','\\\\nasbox\\share\\models','/foreign/models'],
  );
  const plan=createMetadataImportPlan({backup:document,current:state,options:{replaceRoots:true}});
  assert.deepEqual(plan.rootsBefore,[driveRoot,uncRoot]);
  assert.deepEqual(plan.rootsAfter,[driveRoot,uncRoot,'/foreign/models']);
  assert.deepEqual(plan.collectionsBefore[0].paths,[driveMember]);
  assert.deepEqual(plan.collectionsBefore[1].paths,[uncMember]);
  assert.deepEqual(plan.collectionsAfter[0].paths,[driveMember]);
  assert.deepEqual(plan.collectionsAfter[1].paths,[uncMember]);
  assert.deepEqual(plan.collectionsAfter[2].paths,[driveMember]);
  assert.equal(plan.annotationUpdates.length,1);
  assert.equal(plan.annotationUpdates[0].destination,'indexed');
});
