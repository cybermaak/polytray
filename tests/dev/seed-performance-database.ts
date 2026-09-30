import { createPerformanceDatabase } from '../support/fixtures/performanceFixtures';

const count = Number(process.argv[2]);
const userDataDir = process.argv[3];
const shape = process.argv[4] ?? 'grouped';
const scopeIndex = process.argv[5] ?? 'incomplete';
if (![600, 10_000, 50_000].includes(count) || !userDataDir || !['flat', 'grouped'].includes(shape)
  || !['incomplete', 'ready'].includes(scopeIndex)) throw new Error('Expected count, user data directory, flat|grouped shape, and incomplete|ready scope index state');
const fixture = createPerformanceDatabase({ root: userDataDir, count, archiveMemberShare: shape === 'flat' ? 0 : 0.2, archiveGroupCount: 12, scopeIndex: scopeIndex as 'incomplete' | 'ready' });
console.log(JSON.stringify({ count, shape, scopeIndex, lastOnlyPath: fixture.lastOnlyCollection.collections[0]?.filePaths[0] ?? null }));
