// Cross-platform DB setup (works in PowerShell / cmd / bash -- no `<` redirection needed).
//   npm run db:mysql   -> db/mysql/01_schema.sql + 02_advanced.sql + 03_seed.sql   (DROPS & recreates the database)
//   npm run db:mongo   -> db/mongodb/mongo_setup.js                                 (drops & recreates the 4 collections)
//   npm run db:test    -> db/mysql/05_test_cases.sql (expect the errors marked EXPECT ERROR)
// Needs the `mysql` client (and `mongosh` for the Mongo step) on your PATH. Credentials come from .env.local.
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const what = process.argv[2];

function run(cmd, args, { stdinFile, extraEnv } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: [stdinFile ? 'pipe' : 'inherit', 'inherit', 'inherit'], env: { ...env, ...extraEnv } });
    if (stdinFile) createReadStream(stdinFile).pipe(p.stdin);
    p.on('error', (e) => reject(e.code === 'ENOENT' ? new Error(`'${cmd}' was not found on your PATH — install it or add it to PATH.`) : e));
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))));
  });
}

const mysqlArgs = (...extra) => ['-h', env.MYSQL_HOST || 'localhost', '-P', env.MYSQL_PORT || '3306', '-u', env.MYSQL_USER || 'root', ...extra];
const sql = (f) => path.join(root, 'db', 'mysql', f);

try {
  if (what === 'mysql') {
    for (const f of ['01_schema.sql', '02_advanced.sql', '03_seed.sql']) {
      console.log(`→ mysql: ${f}`);
      await run('mysql', mysqlArgs(), { stdinFile: sql(f), extraEnv: { MYSQL_PWD: env.MYSQL_PASSWORD || '' } });
    }
    console.log('MySQL ready. Next: npm run seed:users');
  } else if (what === 'test') {
    console.log('→ mysql: 05_test_cases.sql (run on a freshly seeded DB; errors marked EXPECT ERROR are the point)');
    await run('mysql', mysqlArgs('--force', env.MYSQL_DATABASE || 'hospital_dispatch'),
      { stdinFile: sql('05_test_cases.sql'), extraEnv: { MYSQL_PWD: env.MYSQL_PASSWORD || '' } });
  } else if (what === 'mongo') {
    console.log('→ mongosh: mongo_setup.js');
    await run('mongosh', [env.MONGODB_URI || 'mongodb://localhost:27017', '--quiet', '--file', path.join(root, 'db', 'mongodb', 'mongo_setup.js')]);
    console.log('MongoDB ready.');
  } else {
    console.error('usage: node scripts/setup-db.mjs mysql|mongo|test');
    process.exit(2);
  }
} catch (e) {
  console.error('\n✗ ' + e.message);
  process.exit(1);
}
