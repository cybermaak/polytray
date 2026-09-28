import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import * as THREE from 'three';
import { parsePreviewMeshes } from '../../../../src/renderer/lib/previewParseRenderer';

const triangleObject = `<object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="2" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>`;

async function make3mf(unit: string) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`);
  zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`);
  zip.file('3D/3dmodel.model', `<model unit="${unit}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${triangleObject}</resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 5 7 9"/></build></model>`);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test('preview preparation preserves source-build measurement provenance separately from oriented geometry bounds', async () => {
  const priorWindow = (globalThis as any).window;
  (globalThis as any).window = { polytray: { emitPreviewMetric() {} } };
  try {
    const preview = await parsePreviewMeshes(await make3mf('centimeter'), '3mf', '/tmp/measurement.3mf');
    assert.deepEqual(preview.measurements, {
      version: 1, x: 10, y: 20, z: 0, unit: 'mm', basis: 'source-build', status: 'verified',
    });
    const size = new THREE.Vector3(...preview.bounds.max).sub(new THREE.Vector3(...preview.bounds.min));
    assert.deepEqual([size.x, size.y, size.z].sort((a, b) => a - b), [0, 1, 2]);
    assert.notDeepEqual([size.x, size.y, size.z], [10, 20, 0]);
  } finally {
    if (priorWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = priorWindow;
  }
});

test('preview preparation keeps unknown unit provenance explicitly unavailable', async () => {
  const priorWindow = (globalThis as any).window;
  (globalThis as any).window = { polytray: { emitPreviewMetric() {} } };
  try {
    const preview = await parsePreviewMeshes(await make3mf('parsec'), '3mf', '/tmp/unknown-unit.3mf');
    assert.equal(preview.measurements?.status, 'unavailable');
    assert.equal(preview.measurements?.basis, 'source-build');
    assert.equal(preview.measurements?.unit, 'mm');
    if (preview.measurements?.status === 'unavailable') assert.equal(preview.measurements.reason, 'unknown-units');
  } finally {
    if (priorWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = priorWindow;
  }
});
