#!/usr/bin/env node
// Generates packages/proflow/rates.json — the snapshot the mod prices turns from
// by default — out of Command Code's own model registry (the same data the
// harness's getDisplayRates table is built from). `--check` fails when the
// committed file is stale, so a price change upstream becomes a failure here
// rather than a quietly wrong footer.
//
//   npm run rates            # regenerate
//   npm run rates -- --check # verify the committed snapshot is current
import {existsSync, readFileSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MOD = join(ROOT, 'packages', 'proflow', 'mods', 'proflow.ts');
const OUT = join(ROOT, 'packages', 'proflow', 'rates.json');

// The mod is TypeScript inside a CommonJS package, so Node will not treat it as
// ESM from its extension alone. A staged .mts copy is the portable way to reach
// its exports — the mod imports only node builtins, so nothing relative has to
// resolve from the staging directory.
const staging = join(tmpdir(), `proflow-rates-${process.pid}.mts`);
writeFileSync(staging, readFileSync(MOD, 'utf8'));
let locateRegistry;
let parseRegistry;
try {
	({locateRegistry, parseRegistry} = await import(pathToFileURL(staging).href));
} finally {
	unlinkSync(staging);
}

// argv[1] is *this script* here, not the harness (inside the harness it is the
// cli), so the installed package is found from the node prefix and by walking up
// from the repo. The mod keeps its argv[1] route for runtime use.
const TAIL = ['dist', 'bundled', 'command-code-knowledge', 'reference', 'models.md'];
const fromRoot = (root) => [root, 'command-code', ...TAIL].join('/');
const search = [fromRoot([process.execPath, '..', '..', 'lib', 'node_modules'].join('/'))];
for (let dir = ROOT, i = 0; i < 5; i += 1, dir = [dir, '..'].join('/')) search.push(fromRoot([dir, 'node_modules'].join('/')));
// An explicit path wins (PROFLOW_REGISTRY / --registry), which is also how CI or
// a maintainer with an unusual install can point this at the right file.
const flagIndex = process.argv.indexOf('--registry');
const explicit =
	process.env.PROFLOW_REGISTRY ?? (flagIndex === -1 ? undefined : process.argv[flagIndex + 1]);
const registry = explicit ?? search.find((candidate) => existsSync(candidate)) ?? locateRegistry();
if (!registry) {
	console.error('rates: no installed Command Code registry found — nothing to read');
	process.exit(1);
}

const rates = parseRegistry(readFileSync(registry, 'utf8'));
const models = Object.keys(rates);
if (models.length === 0) {
	console.error(`rates: parsed no models out of ${registry}`);
	process.exit(1);
}
if (!rates['deepseek/deepseek-v4.1-flash']) {
	console.error('rates: the parser found no price for a model we know is listed');
	process.exit(1);
}

const serialised = `${JSON.stringify(rates, null, '\t')}\n`;
const current = (() => {
	try {
		return readFileSync(OUT, 'utf8');
	} catch {
		return null;
	}
})();

if (process.argv.includes('--check')) {
	if (current === serialised) {
		console.log(`rates: up to date — ${models.length} models`);
		process.exit(0);
	}
	console.error('rates: packages/proflow/rates.json is stale — run `npm run rates`');
	process.exit(1);
}

writeFileSync(OUT, serialised);
console.log(`rates: wrote ${models.length} models to packages/proflow/rates.json`);
