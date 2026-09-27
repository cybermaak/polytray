import test from 'node:test';
import assert from 'node:assert/strict';
import type { LibraryPageResult, LibraryQueryClient } from '../../../../src/shared/libraryQuery';
import type { PreviewTarget } from '../../../../src/shared/previewTarget';
import { createArchivePreviewPages } from '../../../../src/renderer/lib/archivePreviewPages';
import type { FileRecord } from '../../../../src/shared/types';

const file=(id:number): FileRecord => ({
  id,path:`/models/archive.zip::entry::${id}.stl`,name:`${id}`,extension:'stl',directory:'/models/archive.zip::entry::',
  size_bytes:12,modified_at:id,content_revision:1,archive_path:'/models/archive.zip',vertex_count:3,face_count:1,
  thumbnail:null,thumbnail_failed:0,indexed_at:1,
});
const target: Extract<PreviewTarget,{kind:'archive'}> = {
  kind:'archive',
  archive:{kind:'archive',key:'archive:/models/archive.zip',archivePath:'/models/archive.zip',name:'archive.zip',modelCount:65,vertexCount:1,faceCount:1,sizeBytes:100,thumbnailSamples:[file(1)]},
  query:{sort:'date',direction:'DESC',extension:'stl',folder:'/models',search:'part',collectionPaths:['/models/archive.zip::entry::12.stl'],limit:500,offset:500,expectedBrowseRevision:7},
};
function result(offset:number,total=65,revision=7): LibraryPageResult {
  const files=Array.from({length:Math.max(0,Math.min(24,total-offset))},(_,index)=>file(offset+index+1));
  return {status:'ok',revision,items:files.map(record=>({kind:'file',key:`file:${record.id}`,file:record})),totalItems:total,totalModels:total,nextOffset:offset+files.length<total?offset+files.length:null};
}

test('archive page query retains origin filters but starts at archive offset zero',async()=>{
  const queries=[];
  const loader=createArchivePreviewPages(target,{getLibraryPage:async query=>{queries.push(query);return result(query.offset);}});
  const page=await loader.loadPage(0);
  assert.equal(page.totalModels,65);
  assert.equal(page.files.length,24);
  assert.equal(page.nextOffset,24);
  assert.deepEqual(queries[0],{...target.query,limit:24,offset:0,archivePath:'/models/archive.zip',expectedBrowseRevision:7});
  assert.equal(target.query.offset,500);
  loader.dispose();
});

test('adjacent pages load on demand and cache retains only a bounded recent window',async()=>{
  const queries:number[]=[];
  const client:LibraryQueryClient={getLibraryPage:async query=>{queries.push(query.offset);return result(query.offset,120);}};
  const loader=createArchivePreviewPages(target,client,{maxCachedPages:2});
  assert.equal(queries.length,0);
  await loader.loadPage(0);
  await loader.loadPage(24);
  await loader.loadPage(48);
  assert.deepEqual(queries,[0,24,48]);
  assert.equal(loader.cachedPageCount,2);
  await loader.loadPage(48);
  assert.equal(queries.length,3);
  await loader.loadPage(0);
  assert.deepEqual(queries,[0,24,48,0]);
  loader.dispose();
  assert.equal(loader.cachedPageCount,0);
});

test('stale browse revision rebases the page query and retries once at the returned revision',async()=>{
  const queries:number[]=[];
  const client:LibraryQueryClient={getLibraryPage:async query=>{
    queries.push(query.expectedBrowseRevision ?? -1);
    return queries.length===1?{status:'stale',revision:8}:result(0,65,8);
  }};
  const loader=createArchivePreviewPages(target,client);
  const page=await loader.loadPage(0);
  assert.equal(page.revision,8);
  assert.deepEqual(queries,[7,8]);
  loader.dispose();
});

test('thumbnail arrival patches cached archive pages without changing file geometry identity',async()=>{
  const loader=createArchivePreviewPages(target,{getLibraryPage:async query=>result(query.offset)});
  const before=await loader.loadPage(0);
  loader.updateThumbnail(before.files[0].id,before.files[0].content_revision - 1,'/cache/stale.png');
  assert.equal((await loader.loadPage(0)).files[0].thumbnail,null);
  loader.updateThumbnail(before.files[0].id,before.files[0].content_revision,'/cache/new.png');
  const after=await loader.loadPage(0);
  assert.equal(after.files[0].thumbnail,'/cache/new.png');
  assert.equal(after.files[0].content_revision,before.files[0].content_revision);
  loader.dispose();
});

test('browse revision invalidation clears cached pages and uses the new revision for later offsets',async()=>{
  const revisions:number[]=[];
  const loader=createArchivePreviewPages(target,{getLibraryPage:async query=>{
    const revision=query.expectedBrowseRevision ?? 7;
    revisions.push(revision);
    return result(query.offset,65,revision);
  }});
  await loader.loadPage(0);
  assert.equal(loader.cachedPageCount,1);
  loader.invalidate(8);
  assert.equal(loader.cachedPageCount,0);
  const page=await loader.loadPage(24);
  assert.equal(page.revision,8);
  assert.deepEqual(revisions,[7,8]);
  loader.dispose();
});

test('disposed page requests cannot publish a stale response',async()=>{
  let resolve!: (value:LibraryPageResult)=>void;
  const loader=createArchivePreviewPages(target,{getLibraryPage:()=>new Promise(res=>{resolve=res;})});
  const pending=loader.loadPage(0);
  loader.dispose();
  resolve(result(0));
  await assert.rejects(pending,/disposed|stale/i);
});

test('archive-scoped query rejects grouped summaries instead of treating samples as all models',async()=>{
  const client={getLibraryPage:async()=>({status:'ok',revision:7,items:[target.archive],totalItems:1,totalModels:65,nextOffset:null} as LibraryPageResult)};
  const loader=createArchivePreviewPages(target,client);
  await assert.rejects(loader.loadPage(0),/file records/i);
  loader.dispose();
});
