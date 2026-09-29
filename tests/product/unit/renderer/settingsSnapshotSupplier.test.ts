import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsModal } from '../../../../src/renderer/components/SettingsModal';
import { DEFAULT_APP_SETTINGS } from '../../../../src/shared/settings';

test('settings rendering keeps backup snapshot creation lazy and omits the panel while closed', () => {
  let reads = 0;
  const getBackupSnapshot = () => {
    reads += 1;
    return { rendererRevision: 0, libraryRoots: [], collections: [], preferences: {} };
  };
  const render = (open: boolean) => renderToStaticMarkup(React.createElement(SettingsModal, {
    open,
    onClose: () => {},
    settings: DEFAULT_APP_SETTINGS,
    getBackupSnapshot,
    onRecoveryError: () => {},
    onSettingsChange: () => {},
  }));

  const closedMarkup = render(false);
  assert.equal(closedMarkup.includes('Metadata backup'), false);
  assert.equal(reads, 0);
  const openMarkup = render(true);
  assert.equal(openMarkup.includes('Metadata backup'), true);
  assert.equal(reads, 0);
});
