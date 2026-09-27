import test from 'node:test';
import assert from 'node:assert/strict';
import type { FileRecord } from '../../../../src/shared/types';
import { createPreviewGeometryIdentity, previewStateReducer, type PreviewLoadState } from '../../../../src/renderer/lib/previewState';

const file=(overrides: Partial<FileRecord> = {}): FileRecord => ({
  id:1,path:'/models/a.stl',name:'a',extension:'stl',directory:'/models',size_bytes:10,modified_at:1,
  content_revision:2,archive_path:null,vertex_count:3,face_count:1,tags:null,notes:null,dimensions:null,
  thumbnail:null,thumbnail_failed:0,indexed_at:1,...overrides,
});

test('geometry identity ignores annotations and thumbnail arrival', () => {
  const before=file();
  const metadataUpdate=file({tags:'["tag"]',notes:'a note',thumbnail:'/cache/a.png'});
  assert.equal(createPreviewGeometryIdentity(before),createPreviewGeometryIdentity(metadataUpdate));
  for (const changed of [
    file({id:2}), file({path:'/models/b.stl'}), file({extension:'obj'}), file({content_revision:3}),
  ]) assert.notEqual(createPreviewGeometryIdentity(before),createPreviewGeometryIdentity(changed));
});

test('preview load state ignores progress and completion from stale identities or retry tokens', () => {
  let state: PreviewLoadState={status:'idle'};
  state=previewStateReducer(state,{type:'start',identity:'a',token:1});
  state=previewStateReducer(state,{type:'start',identity:'b',token:2});
  state=previewStateReducer(state,{type:'progress',identity:'a',token:1,progress:80});
  state=previewStateReducer(state,{type:'ready',identity:'a',token:1});
  assert.deepEqual(state,{status:'loading',identity:'b',token:2,progress:-1});
  state=previewStateReducer(state,{type:'error',identity:'b',token:2,message:'bad model'});
  assert.deepEqual(state,{status:'error',identity:'b',token:2,message:'bad model'});
  state=previewStateReducer(state,{type:'start',identity:'b',token:3});
  state=previewStateReducer(state,{type:'ready',identity:'b',token:2});
  assert.deepEqual(state,{status:'loading',identity:'b',token:3,progress:-1});
  state=previewStateReducer(state,{type:'ready',identity:'b',token:3});
  assert.deepEqual(state,{status:'ready',identity:'b',token:3});
  assert.deepEqual(previewStateReducer(state,{type:'reset'}),{status:'idle'});
});
