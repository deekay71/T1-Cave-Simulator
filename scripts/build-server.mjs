// Đóng gói API, game và migrator thành JS cho image production (không cần tsx khi chạy).
// Package nội bộ @te-liet/* được gộp vào bundle; dependency npm để ngoài và cài bằng `npm ci --omit=dev`.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));

await build({
  entryPoints: { api: 'apps/api/src/index.ts', game: 'apps/game/src/index.ts', migrate: 'scripts/migrate.ts' },
  outdir: 'dist/server',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node26',
  sourcemap: true,
  tsconfig: 'tsconfig.json',          // giữ useDefineForClassFields: false như khi chạy bằng tsx
  external: Object.keys(pkg.dependencies ?? {}),
  logLevel: 'info',
});
