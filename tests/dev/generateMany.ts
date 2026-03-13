import fs from 'node:fs';
import path from 'node:path';

const fixtureDir = path.join(__dirname, '../support/fixtures');
fs.mkdirSync(fixtureDir, { recursive: true });

for (let i = 0; i < 100; i++) {
  fs.writeFileSync(
    path.join(fixtureDir, `test_${i}.obj`),
    '# Test cube OBJ\nv 0 0 0\nf 1 1 1\n',
    'utf8',
  );
}
