import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMeasurement, formatSize } from '../../../../src/renderer/lib/formatters';

test('formats verified millimeters and model units with provenance', () => {
  assert.equal(formatMeasurement(JSON.stringify({ version: 1, x: 10, y: 2.5, z: 0, unit: 'mm', basis: 'source-build', status: 'available' })), '10 × 2.5 × 0 mm (verified source build)');
  assert.equal(formatMeasurement(JSON.stringify({ version: 1, x: 10, y: 2.5, z: 0, unit: 'model-unit', basis: 'source-build', status: 'available' })), '10 × 2.5 × 0 model units');
});

test('marks legacy, unavailable, and malformed measurements explicitly', () => {
  assert.equal(formatMeasurement('{"x":10,"y":2,"z":3}'), '10 × 2 × 3 (unverified units)');
  assert.equal(formatMeasurement(JSON.stringify({ version: 1, x: null, y: null, z: null, unit: 'mm', basis: 'source-build', status: 'unavailable', reason: 'Unknown units' })), 'Unavailable: Unknown units');
  assert.equal(formatMeasurement('{broken'), 'Unavailable: measurement data is invalid');
  assert.equal(formatMeasurement(null), 'Unavailable');
});

test('file byte sizes have a file-size presentation label', () => {
  assert.equal(formatSize(1024), '1.0 KB');
});
