import test from 'node:test';
import assert from 'node:assert/strict';

import { buildElectronLaunchArgs, buildElectronLaunchEnv } from '../../support/helpers/electronLaunch';

test('buildElectronLaunchEnv removes ELECTRON_RUN_AS_NODE from inherited env', () => {
  const env = buildElectronLaunchEnv(
    {
      PATH: '/tmp/bin',
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_USER_DATA: '/tmp/original',
    },
    {
      ELECTRON_USER_DATA: '/tmp/test-user-data',
    },
  );

  assert.equal('ELECTRON_RUN_AS_NODE' in env, false);
  assert.equal(env.PATH, '/tmp/bin');
  assert.equal(env.ELECTRON_USER_DATA, '/tmp/test-user-data');
});

test('buildElectronLaunchArgs opts isolated macOS launches out of crashed window restoration', () => {
  assert.deepEqual(
    buildElectronLaunchArgs('/app/out/main/index.js', '/tmp/polytray-user-data', ['--custom'], 'darwin'),
    ['/app/out/main/index.js', '--user-data-dir=/tmp/polytray-user-data', '--custom', '-ApplePersistenceIgnoreState', 'YES'],
  );
});

test('buildElectronLaunchArgs preserves Windows and Linux arguments without macOS persistence flags', () => {
  assert.deepEqual(
    buildElectronLaunchArgs('/app/out/main/index.js', '/tmp/polytray-user-data', ['--custom'], 'win32'),
    ['/app/out/main/index.js', '--user-data-dir=/tmp/polytray-user-data', '--custom'],
  );
  assert.deepEqual(
    buildElectronLaunchArgs('/app/out/main/index.js', '/tmp/polytray-user-data', [], 'linux'),
    ['/app/out/main/index.js', '--user-data-dir=/tmp/polytray-user-data'],
  );
});
