#!/usr/bin/env node
// Writes ~/.commandcode/rates.json from the registry that ships with the harness.
// Run by install.mjs as a child process — deliberately standalone, so the
// installer never imports the harness mod — and by `npm run rates` in the repo.
//
// Best effort by contract: if the registry cannot be found or parsed this exits
// 0 with a note, because the footer reads the registry live in that case.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.PROFLOW_RATES ?? join(homedir(), '.commandcode', 'rates.json');
const TAIL = ['dist', 'bundled', 'command-code-knowledge', 'reference', 'models.md'];

function candidates() {
	const list = [];
	if (process.env.PROFLOW_REGISTRY) list.push(process.env.PROFLOW_REGISTRY);
	list.push(join(dirname(dirname(process.execPath)), 'lib', 'node_modules', 'command-code', ...TAIL));
	let dir = HERE;
	for (let i = 0; i < 5; i += 1) {
		dir = resolve(dir, '..');
		list.push(join(dir, 'node_modules', 'command-code', ...TAIL));
	}
	return list;
}

function parsePriceColumn(cell) {
	const main = /\$([0-9.]+)\s*\/\s*\$([0-9.]+)/.exec(cell);
	const cache = /cache\s*\$([0-9.]+)/.exec(cell);
	if (!main || !cache) return null;
	const write = /\(write\s*\$([0-9.]+)\)/.exec(cell);
	return {
		input: Number(main[1]),
		output: Number(main[2]),
		cacheRead: Number(cache[1]),
		...(write ? {cacheWrite: Number(write[1])} : {}),
	};
}

function parseRegistry(markdown) {
	const table = {};
	for (const line of markdown.split('\n')) {
		const model = /^\|\s*`([^`]+)`\s*\|/.exec(line);
		if (!model) continue;
		const parsed = parsePriceColumn(line);
		if (parsed) table[model[1]] = parsed;
	}
	return table;
}

const registry = candidates().find(candidate => existsSync(candidate));
if (!registry) {
	console.log('rates: skipped — no installed Command Code registry found');
	process.exit(0);
}
const table = parseRegistry(readFileSync(registry, 'utf8'));
const count = Object.keys(table).length;
if (count === 0) {
	console.log('rates: skipped — no parseable rows in the registry');
	process.exit(0);
}
mkdirSync(dirname(OUT), {recursive: true});
writeFileSync(OUT, `${JSON.stringify(table, null, '\t')}\n`);
console.log(`rates: ${count} models → ${OUT}`);
