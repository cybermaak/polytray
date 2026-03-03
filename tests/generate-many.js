const fs = require('fs');
const path = require('path');
const FIXTURE_DIR = path.join(__dirname, 'fixtures');
fs.mkdirSync(FIXTURE_DIR, { recursive: true });
for(let i=0; i<100; i++) {
  fs.writeFileSync(path.join(FIXTURE_DIR, `test_${i}.obj`), `# Test cube OBJ\nv 0 0 0\nf 1 1 1\n`, 'utf-8');
}
