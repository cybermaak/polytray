import { create600Database, create10kDatabase, create50kDatabase } from '../support/fixtures/performanceFixtures';

const count = Number(process.argv[2]);
const userDataDir = process.argv[3];
if (![600, 10_000, 50_000].includes(count) || !userDataDir) throw new Error('Expected count (600, 10000, or 50000) and userData directory');
const fixture = count === 600 ? create600Database(userDataDir) : count === 10_000 ? create10kDatabase(userDataDir) : create50kDatabase(userDataDir);
console.log(JSON.stringify({ count, lastOnlyPath: fixture.lastOnlyCollection.collections[0]?.filePaths[0] ?? null }));
