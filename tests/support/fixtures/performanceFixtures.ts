import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { MIGRATIONS } from '../../../src/main/database';
import { CollectionsState } from '../../../src/shared/libraryCollections';

export interface PerformanceDatabaseFixture {
  dbPath: string;
  root: string;
  count: number;
  collections: CollectionsState;
  lastOnlyCollection: CollectionsState;
  openDatabase(): Database.Database;
  cleanup(): void;
}

/** Creates a portable migrated database. Paths, folders, timestamps, ties and collection membership are deterministic. */
export function createPerformanceDatabase(options: { root?: string; count: number; archiveMemberShare?: number; archiveGroupCount?: number }): PerformanceDatabaseFixture {
  const ownsRoot = !options.root;
  const root = options.root ?? fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-perf-'));
  fs.mkdirSync(root, { recursive: true });
  const dbPath = path.join(root, 'data', 'polytray.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  for (const migration of MIGRATIONS) {
    db.exec(migration.sql);
    db.pragma(`user_version = ${migration.version}`);
  }
  const insert = db.prepare(`INSERT INTO files
    (path,name,extension,directory,size_bytes,modified_at,vertex_count,face_count,indexed_at,thumbnail_failed,tags,notes,print_status,dimensions)
    VALUES (@path,@name,@extension,@directory,@size_bytes,@modified_at,@vertex_count,@face_count,@indexed_at,0,'[]','','Not Printed',NULL)`);
  const paths: string[] = [];
  const insertBatch = db.transaction(() => {
    for (let i = 0; i < options.count; i++) {
      const directory = path.join(root, 'library', `folder-${String(i % 40).padStart(2, '0')}`);
      const extension = ['stl', 'obj', '3mf'][i % 3];
      const filePath = path.join(directory, `model-${String(i).padStart(6, '0')}.${extension}`);
      paths.push(filePath);
      insert.run({ path: filePath, name: path.basename(filePath), extension, directory,
        size_bytes: 10_000 + (i % 7) * 1_024, modified_at: 1_700_000_000_000 + (i % 9) * 1_000,
        vertex_count: 100 + (i % 11) * 10, face_count: 80 + (i % 13) * 10,
        indexed_at: 1_700_000_000_000 + i });
    }
  });
  insertBatch();
  // Preserve F02's original flat shape by default. Grouped-query diagnostics
  // opt into the D02 reference distribution explicitly.
  const archiveMemberShare = options.archiveMemberShare ?? 0;
  const archiveGroupCount = options.archiveGroupCount ?? 12;
  if (!Number.isFinite(archiveMemberShare) || archiveMemberShare < 0 || archiveMemberShare > 1) throw new Error('archiveMemberShare must be between 0 and 1');
  if (!Number.isInteger(archiveGroupCount) || archiveGroupCount < 1) throw new Error('archiveGroupCount must be a positive integer');
  const archiveUpdate = db.prepare('UPDATE files SET archive_path = ? WHERE id = ?');
  const archiveRoot = path.join(root, 'library', 'archives');
  const markArchives = db.transaction(() => {
    for (let i = 0; i < Math.floor(options.count * archiveMemberShare); i++) {
      const archiveIndex = i % archiveGroupCount;
      archiveUpdate.run(path.join(archiveRoot, `archive-${String(archiveIndex).padStart(2, '0')}.zip`), i + 1);
    }
  });
  markArchives();
  db.close();
  const collections: CollectionsState = { activeCollectionId: 'performance-collection', collections: [{
    id: 'performance-collection', name: `Performance ${options.count}`, filePaths: paths,
  }] };
  const lastOnlyCollection: CollectionsState = { activeCollectionId: 'last-only', collections: [{
    id: 'last-only', name: `Last only ${options.count}`, filePaths: paths.length ? [paths[paths.length - 1]] : [],
  }] };
  return {
    root, dbPath, count: options.count, collections, lastOnlyCollection,
    openDatabase: () => new Database(dbPath, { readonly: true }),
    cleanup() { if (ownsRoot) fs.rmSync(root, { recursive: true, force: true }); },
  };
}

export function create600Database(root?: string) { return createPerformanceDatabase({ root, count: 600 }); }
export function create10kDatabase(root?: string) { return createPerformanceDatabase({ root, count: 10_000 }); }
export function create50kDatabase(root?: string) { return createPerformanceDatabase({ root, count: 50_000 }); }

export interface ModelFixtureSet { root: string; files: Record<string, string>; archivePath: string; revisions: string[]; cleanup(): void }

/** Writes compact text/binary mesh fixtures into a caller-owned directory; no model binaries are committed. */
export async function createModelFixtures(rootOption?: string, options: { denseTriangleCount?: number } = {}): Promise<ModelFixtureSet> {
  const ownsRoot = !rootOption;
  const root = rootOption ?? fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-model-fixtures-'));
  fs.mkdirSync(root, { recursive: true });
  const files: Record<string, string> = {};
  const write = (name: string, data: string | Buffer) => { const file = path.join(root, name); fs.writeFileSync(file, data); files[name] = file; return file; };
  const stl = (triangles: number) => {
    const buf = Buffer.alloc(84 + triangles * 50); buf.write('Polytray synthetic STL', 0, 'ascii'); buf.writeUInt32LE(triangles, 80);
    for (let i = 0, off = 84; i < triangles; i++, off += 50) {
      buf.writeFloatLE(0, off); buf.writeFloatLE(0, off + 4); buf.writeFloatLE(1, off + 8);
      const p = i * 0.001; [[p,0,0],[p+1,0,0],[p,1,0]].flat().forEach((n, j) => buf.writeFloatLE(n, off + 12 + j * 4));
    }
    return buf;
  };
  const obj = (offset = 0, vertexStart = 1) => `o Part${offset}\nv ${offset} 0 0\nv ${offset + 1} 0 0\nv ${offset} 1 0\nf ${vertexStart} ${vertexStart + 1} ${vertexStart + 2}\n`;
  write('normal.stl', stl(12)); write('malformed.stl', Buffer.from('solid broken\nfacet nonsense\n'));
  write('normal.obj', obj()); write('malformed.obj', 'v NaN 0 0\nf 1 2 99\n');
  write('dense-single-mesh.stl', stl(options.denseTriangleCount ?? 20_000)); write('multipart.obj', `${obj(0, 1)}${obj(3, 4)}${obj(6, 7)}`);
  const model = (attrs = '', objects = '<object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>', build = '<item objectid="1"/>') => `<?xml version="1.0"?><model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter" ${attrs}><resources>${objects}</resources><build>${build}</build></model>`;
  const write3mf = async (name: string, xml: string, additional: Record<string, string> = {}) => {
    const zip = new JSZip();
    const modelOverrides = ['/3D/3dmodel.model', ...Object.keys(additional).filter((key) => key.toLowerCase().endsWith('.model')).map((key) => `/${key}`)]
      .map((partName) => `<Override PartName="${partName}" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>`).join('');
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>${modelOverrides}</Types>`);
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>');
    zip.file('3D/3dmodel.model', xml);
    for (const [key, value] of Object.entries(additional)) zip.file(key, value);
    return write(name, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  };
  await write3mf('normal.3mf', model());
  await write3mf('malformed.3mf', '<model unit="millimeter"><resources><object id="1"><mesh><vertices></resources>');
  await write3mf('unit-inch.3mf', model().replace('millimeter', 'inch'));
  const componentObjects = '<object id="1" type="model"><components><component objectid="2" transform="1 0 0 0 1 0 0 0 1 20 0 0"/></components></object><object id="2" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>';
  await write3mf('component-transform.3mf', model('', componentObjects));
  await write3mf('build-transform.3mf', model('', undefined, '<item objectid="1" transform="2 0 0 0 2 0 0 0 2 5 0 0"/>'));
  await write3mf('unsupported.3mf', model().replace('<resources>', '<resources><colorgroup id="2"><color color="#FFFFFFFF"/></colorgroup>'));
  await write3mf('external-component.3mf', model('', '<object id="1" type="model"><components><component objectid="2" path="/3D/Objects/object_2.model"/></components></object>', undefined), {
    '3D/Objects/object_2.model': '<?xml version="1.0"?><model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources></resources><build></build></model>',
    '3D/_rels/3dmodel.model.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/Objects/object_2.model" Id="rel-object-2" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
  });
  const archive = new JSZip(); for (let i = 0; i < 501; i++) archive.file(`page-${String(i).padStart(3, '0')}/part-${i}.stl`, 'solid x\nendsolid x\n');
  const archivePath = write('many-entry-archive.zip', await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  const revisions = [write('revision.stl', stl(3)), write('revision.obj', obj())];
  return { root, files, archivePath, revisions, cleanup() { if (ownsRoot) fs.rmSync(root, { recursive: true, force: true }); } };
}

/** Rewrites the same path while setting a caller-selected mtime revision for scanner tests. */
export function reviseFixture(filePath: string, content: Buffer | string, mtimeMs: number) {
  fs.writeFileSync(filePath, content); fs.utimesSync(filePath, mtimeMs / 1000, mtimeMs / 1000);
  return { path: filePath, mtimeMs: fs.statSync(filePath).mtimeMs, sizeBytes: fs.statSync(filePath).size };
}
