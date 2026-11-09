/**
 * Build low-poly GLB assets.
 *
 *   npx tsx tools/models/build.ts <group|all|g1,g2>
 *
 * Each group lives in tools/models/groups/<group>.ts and default-exports (or exports `build`)
 * a function returning Model[] (sync or async). Output:
 *   apps/web/public/models/<group>/<name>.glb
 *   apps/web/public/models/manifest.<group>.json
 *   apps/web/public/models/index.json   (lists the five groups)
 * Missing group files are skipped with a message. Exit code 1 if any group failed.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GROUPS, Model, writeAssets, writeIndex } from "./lib.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = process.argv[2];
if (!arg) {
  console.error(`usage: npx tsx tools/models/build.ts <${GROUPS.join("|")}|all>`);
  process.exit(1);
}
const groups = arg === "all" ? [...GROUPS] : arg.split(",").map((s) => s.trim()).filter(Boolean);

let failed = 0;
for (const group of groups) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(group)) {
    console.error(`[models] bad group name "${group}"`);
    failed++;
    continue;
  }
  const file = path.join(here, "groups", `${group}.ts`);
  if (!existsSync(file)) {
    console.log(`[models] skip ${group}: tools/models/groups/${group}.ts not found`);
    continue;
  }
  const t0 = Date.now();
  try {
    const mod = (await import(pathToFileURL(file).href)) as { default?: unknown; build?: unknown };
    const fn = mod.default ?? mod.build;
    if (typeof fn !== "function")
      throw new Error(`groups/${group}.ts must export a default function (or "build") returning Model[]`);
    const assets: unknown = await fn();
    if (!Array.isArray(assets) || !assets.every((a) => a instanceof Model))
      throw new Error(`groups/${group}.ts must return an array of Model`);
    console.log(`[models] ${group}: building ${assets.length} assets`);
    await writeAssets(group, assets);
    console.log(`[models] ${group}: done in ${Date.now() - t0} ms`);
  } catch (err) {
    failed++;
    console.error(`[models] ${group} FAILED:`, err instanceof Error ? (err.stack ?? err.message) : err);
  }
}
writeIndex();
process.exit(failed ? 1 : 0);
