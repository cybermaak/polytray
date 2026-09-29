import { createPerformanceDatabase } from '../support/fixtures/performanceFixtures';

const count = Number(process.argv[2]);
const userDataDir = process.argv[3];
const shape = process.argv[4] ?? 'grouped';
if (![600, 10_000, 50_000].includes(count) || !userDataDir || !['flat', 'grouped'].includes(shape)) throw new Error('Expected count (600, 10000, or 50000), userData directory, and optional flat|grouped shape');
const fixture = createPerformanceDatabase({ root: userDataDir, count, archiveMemberShare: shape === 'flat' ? 0 : 0.2, archiveGroupCount: 12 });
console.log(JSON.stringify({ count, shape, lastOnlyPath: fixture.lastOnlyCollection.collections[0]?.filePaths[0] ?? null }));
