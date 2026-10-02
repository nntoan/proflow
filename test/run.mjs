#!/usr/bin/env node
// Root test runner: every repo-level suite in `test/`, then any package-level
// suite under `packages/*/test/`.
//
// Run: npm test

import {execFileSync} from 'node:child_process';
import {existsSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const suites = [];

for (const file of readdirSync(join(ROOT, 'test')).sort()) {
	if (file.endsWith('.mjs') && file !== 'run.mjs') suites.push(join(ROOT, 'test', file));
}

for (const pkg of readdirSync(join(ROOT, 'packages')).sort()) {
	const dir = join(ROOT, 'packages', pkg, 'test');
	if (!existsSync(dir)) continue;
	for (const file of readdirSync(dir).sort()) {
		if (file.endsWith('.mjs')) suites.push(join(dir, file));
	}
}

let failed = 0;
for (const suite of suites) {
	const name = suite.replace(`${ROOT}/`, '');
	try {
		execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', suite], {
			stdio: 'inherit',
		});
		console.log(`\x1b[32m✓\x1b[0m ${name}`);
	} catch {
		failed += 1;
		console.error(`\x1b[31m✗ ${name}\x1b[0m`);
	}
}

if (failed > 0) {
	console.error(`\n${failed} of ${suites.length} suite(s) failed`);
	process.exit(1);
}
console.log(`\nAll ${suites.length} suites passed`);
