import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applySettingsPreset,
  DEFAULT_APP_SETTINGS,
  SETTINGS_STORAGE_KEY,
  normalizeAppSettings,
  serializeAppSettings,
} from '../../../../src/shared/settings';

test('normalizeAppSettings falls back to defaults for invalid values', () => {
  const settings = normalizeAppSettings({
    lightMode: true,
    gridSize: 'huge',
    autoScan: false,
    watch: 'yes',
    showGrid: true,
    thumbQuality: '999',
    accentColor: 'blue',
    previewColor: 'orange',
    thumbnailColor: '#fff',
    thumbnail_timeout: -10,
    scanning_batch_size: 0,
    watcher_stability: 999999,
    page_size: 2,
  });

  assert.equal(settings.lightMode, true);
  assert.equal(settings.gridSize, DEFAULT_APP_SETTINGS.gridSize);
  assert.equal(settings.autoScan, false);
  assert.equal(settings.watch, DEFAULT_APP_SETTINGS.watch);
  assert.equal(settings.showGrid, true);
  assert.equal(settings.thumbQuality, DEFAULT_APP_SETTINGS.thumbQuality);
  assert.equal(settings.accentColor, DEFAULT_APP_SETTINGS.accentColor);
  assert.equal(settings.previewColor, DEFAULT_APP_SETTINGS.previewColor);
  assert.equal(settings.thumbnailColor, DEFAULT_APP_SETTINGS.thumbnailColor);
  assert.equal(settings.thumbnail_timeout, DEFAULT_APP_SETTINGS.thumbnail_timeout);
  assert.equal(settings.scanning_batch_size, DEFAULT_APP_SETTINGS.scanning_batch_size);
  assert.equal(settings.watcher_stability, DEFAULT_APP_SETTINGS.watcher_stability);
  assert.equal(settings.page_size, DEFAULT_APP_SETTINGS.page_size);
});

test('serializeAppSettings writes a normalized localStorage payload', () => {
  const payload = serializeAppSettings({
    lightMode: true,
    previewColor: '#224466',
    page_size: 2000,
  });

  assert.equal(typeof payload, 'string');
  const parsed = JSON.parse(payload) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed).sort(), Object.keys(DEFAULT_APP_SETTINGS).sort());
  assert.equal(parsed.page_size, 2000);
  assert.equal(parsed.previewColor, '#224466');
  assert.equal(SETTINGS_STORAGE_KEY, 'polytray-settings');
});

test('applySettingsPreset returns tuned advanced settings profiles', () => {
  const performance = applySettingsPreset(DEFAULT_APP_SETTINGS, 'performance');
  const fidelity = applySettingsPreset(DEFAULT_APP_SETTINGS, 'fidelity');

  assert.equal(performance.thumbQuality, '128');
  assert.equal(performance.page_size, 300);
  assert.equal(fidelity.thumbQuality, '512');
  assert.equal(fidelity.thumbnail_timeout, 30000);
});
