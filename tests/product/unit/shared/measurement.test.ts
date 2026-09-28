import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  createAvailableMeasurement,
  createUnavailableMeasurement,
  isCurrentMeasurement,
  legacyMeasurementToUnavailable,
  toMeasurementPresentation,
  type Measurement,
} from '../../../../src/shared/model/measurement';
import { get3mfUnitScale, measureFast3mfBuild } from '../../../../src/shared/model/fast3mfGeometry';

function xml(modelBody: string, unit = 'millimeter') {
  return `<model unit="${unit}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${modelBody}</resources><build><item objectid="1" transform="2 0 0 0 2 0 0 0 2 10 0 0"/></build></model>`;
}

const triangle = `<object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>`;

async function make3mf(model: string) {
  const zip = new JSZip();
  zip.file('3D/3dmodel.model', model);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test('measurement payloads retain provenance and reject nonfinite available values', () => {
  assert.deepEqual(createAvailableMeasurement({ x: 1, y: 0, z: 2 }, 'mm'), {
    version: 1, x: 1, y: 0, z: 2, unit: 'mm', basis: 'source-build', status: 'available',
  });
  assert.equal(createAvailableMeasurement({ x: Infinity, y: 0, z: 2 }, 'mm'), null);
  assert.deepEqual(createUnavailableMeasurement('mm', 'Unsupported structure'), {
    version: 1, x: null, y: null, z: null, unit: 'mm', basis: 'source-build', status: 'unavailable', reason: 'Unsupported structure',
  });
  assert.equal(isCurrentMeasurement(createUnavailableMeasurement('mm', 'bad')), true);
  assert.deepEqual(legacyMeasurementToUnavailable({ x: 1, y: 2, z: 3 }), {
    version: 1, x: null, y: null, z: null, unit: 'model-unit', basis: 'source-build', status: 'unavailable', reason: 'Legacy dimensions have unverified units and provenance',
  });
  assert.deepEqual(toMeasurementPresentation({ x: 1, y: 2, z: 3 }), {
    status: 'unavailable', reason: 'Legacy dimensions have unverified units and provenance',
  });
});

test('3MF bounds include build scaling and translation before display transforms, excluding unused objects', async () => {
  const model = xml(`${triangle}<object id="99" type="model"><mesh><vertices><vertex x="-500" y="-500" z="-500"/></vertices><triangles><triangle v1="0" v2="0" v3="0"/></triangles></mesh></object>`);
  const result = await measureFast3mfBuild(await make3mf(model));
  assert.deepEqual(result, { status: 'available', dimensions: { x: 2, y: 2, z: 0 }, unit: 'mm' });
});

test('3MF source bounds preserve the transformed build axes before viewer orientation', async () => {
  const rotated = xml(triangle).replace('2 0 0 0 2 0 0 0 2 10 0 0', '1 0 0 0 0 1 0 -1 0 10 20 30');
  const result = await measureFast3mfBuild(await make3mf(rotated));
  assert.deepEqual(result, { status: 'available', dimensions: { x: 1, y: 0, z: 1 }, unit: 'mm' });
});

test('3MF bounds include nested component transforms and repeated instances', async () => {
  const nested = `<object id="1" type="model"><components><component objectid="2" transform="1 0 0 0 1 0 0 0 1 3 0 0"/><component objectid="2" transform="1 0 0 0 1 0 0 0 1 8 0 0"/></components></object><object id="2" type="model"><components><component objectid="3" transform="1 0 0 0 1 0 0 0 1 0 4 0"/></components></object><object id="3" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>`;
  const result = await measureFast3mfBuild(await make3mf(xml(nested)));
  assert.deepEqual(result, { status: 'available', dimensions: { x: 12, y: 2, z: 0 }, unit: 'mm' });
});

test('3MF declared unit conversion is applied once and omitted units default to millimeters', async () => {
  const centimeter = await measureFast3mfBuild(await make3mf(xml(triangle, 'centimeter')));
  assert.deepEqual(centimeter, { status: 'available', dimensions: { x: 20, y: 20, z: 0 }, unit: 'mm' });
  const omitted = await measureFast3mfBuild(await make3mf(await (async () => {
    const value = xml(triangle).replace(' unit="millimeter"', '');
    return value;
  })()));
  assert.deepEqual(omitted, { status: 'available', dimensions: { x: 2, y: 2, z: 0 }, unit: 'mm' });
});

test('unknown units, external references, and corrupt archives return explicit unavailable reasons', async () => {
  const unknown = await measureFast3mfBuild(await make3mf(xml(triangle, 'parsec')));
  assert.equal(unknown.status, 'unavailable');
  if (unknown.status === 'unavailable') assert.match(unknown.measurement.reason, /unit/i);

  const externalXml = xml(`<object id="1" type="model"><components><component objectid="9" path="/3D/other.model"/></components></object>`);
  const external = await measureFast3mfBuild(await make3mf(externalXml));
  assert.equal(external.status, 'unavailable');
  if (external.status === 'unavailable') assert.match(external.measurement.reason, /external/i);

  const malformedTransform = await measureFast3mfBuild(await make3mf(xml(triangle).replace('2 0 0 0 2 0 0 0 2 10 0 0', '2 0 0')));
  assert.equal(malformedTransform.status, 'unavailable');
  if (malformedTransform.status === 'unavailable') assert.match(malformedTransform.measurement.reason, /transform/i);

  const missingResourceXml = xml(`<object id="1" type="model"><components><component objectid="404"/></components></object>`);
  const missingResource = await measureFast3mfBuild(await make3mf(missingResourceXml));
  assert.equal(missingResource.status, 'unavailable');
  if (missingResource.status === 'unavailable') assert.match(missingResource.measurement.reason, /object|resource|geometry/i);

  const corrupt = await measureFast3mfBuild(new ArrayBuffer(12));
  assert.equal(corrupt.status, 'unavailable');
  if (corrupt.status === 'unavailable') assert.match(corrupt.measurement.reason, /archive|zip|3mf/i);
});

test('STL and OBJ dimensions use model units and preserve flat thickness', () => {
  const value: Measurement = createAvailableMeasurement({ x: 1, y: 2, z: 0 }, 'model-unit')!;
  assert.equal(value.unit, 'model-unit');
  assert.equal(value.z, 0);
});

test('3MF unit mapping follows the core specification and defaults omitted units to millimeters', () => {
  assert.deepEqual(['micron', 'millimeter', 'centimeter', 'inch', 'foot', 'meter'].map(get3mfUnitScale), [0.001, 1, 10, 25.4, 304.8, 1000]);
  assert.equal(get3mfUnitScale(undefined), 1);
  assert.equal(get3mfUnitScale('parsec'), null);
});
