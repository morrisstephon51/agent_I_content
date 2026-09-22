/**
 * Test runner — discovers and runs EVERY `*.test.ts` file in the repo.
 *
 * Why a glob runner instead of an enumerated `npm test` script?
 * ------------------------------------------------------------
 * This repo has no test framework, so each fix PR historically hardcoded its
 * own test file into package.json's "test" script:
 *
 *     "test": "ts-node agents/content-pipeline/caption-limit.test.ts"
 *     "test": "ts-node agents/content-pipeline/platform-validation.test.ts"
 *
 * Because every such PR edits the SAME line, two independent fix branches
 * add/add-conflict on package.json, and a naive "pick one side" resolution
 * silently drops the other branch's tests from CI — the guard that PR shipped
 * then never runs. Enumerating test files by hand does not scale and does not
 * terminate: every new test file repeats the conflict.
 *
 * This runner removes the enumerated list entirely. `npm test` runs this file,
 * it discovers all `*.test.ts` files by walking the tree, and runs each in its
 * own `ts-node` process (isolating module-level state and any process.exit).
 * Adding a test is now just adding a `*.test.ts` file — no package.json edit,
 * so the conflict class cannot recur, and no test can be dropped by a merge.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const IGNORE = new Set(['node_modules', 'dist', '.git']);

function findTestFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...findTestFiles(full));
    } else if (entry.endsWith('.test.ts')) {
      found.push(full);
    }
  }
  return found;
}

/** Prefer the repo-local ts-node binary; fall back to PATH resolution. */
function tsNodeCommand(): string {
  const localBin = join(
    ROOT,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'ts-node.cmd' : 'ts-node'
  );
  return existsSync(localBin) ? localBin : 'ts-node';
}

const testFiles = findTestFiles(ROOT).sort();

if (testFiles.length === 0) {
  console.log('No *.test.ts files found — nothing to run.');
  process.exit(0);
}

const tsNode = tsNodeCommand();
let failed = 0;

for (const file of testFiles) {
  const rel = relative(ROOT, file);
  console.log(`\n▶ ${rel}`);
  const result = spawnSync(tsNode, [file], { stdio: 'inherit' });
  if (result.status !== 0) {
    failed++;
    console.error(`✗ FAILED: ${rel} (exit code ${result.status})`);
  }
}

console.log(`\n${testFiles.length - failed}/${testFiles.length} test file(s) passed.`);
process.exit(failed === 0 ? 0 : 1);
