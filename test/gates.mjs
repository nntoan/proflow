#!/usr/bin/env node
// Gate lint: the question tool is one name in one place.
//
// The bodies teach the model to ask with the question tool; the mod's `onStop` gate
// catches the turn where it does not. Both depend on the tool having ONE id, so this
// suite pins the rule layer that produces it. It checks the transforms, not the synced
// payload, so it holds without a network sync — the same discipline as test/vendor.mjs.

import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(file, 'utf8');

const suite = [];
const check = (name, fn) => suite.push([name, fn]);

// The only id a body may name. Claude's `AskUserQuestion` is not a tool here.
const TOOL_ID = 'ask_user_question';
const FOREIGN_ID = 'AskUserQuestion';

check('the magento2 transform renames the foreign ask-tool id', async () => {
	const {transform} = await import(join(ROOT, 'patches', 'magento2.mjs'));
	const out = transform(`After Phase 7B, \`${FOREIGN_ID}\`: "N specs remain"`, [], 'skills/m2-feature/SKILL.md');
	assert.ok(!out.includes(FOREIGN_ID), `${FOREIGN_ID} must not survive the transform`);
	assert.ok(out.includes(TOOL_ID), `the transform must produce ${TOOL_ID}`);
});

check('the proflow patch set renames it in the skill that names it', async () => {
	const patches = (await import(join(ROOT, 'patches', 'agent-skills.mjs'))).default;
	const entry = patches.find(p => p.file === 'skills/idea-refine/SKILL.md');
	assert.ok(entry, 'idea-refine must have a patch entry');
	const rewrites = (entry.transforms ?? []).some(r => new RegExp(r.pattern).test(FOREIGN_ID));
	assert.ok(rewrites, 'the entry must rewrite the foreign id');
});

check('no shipped command names the foreign ask-tool id', () => {
	const dirs = ['packages/proflow/commands', 'packages/magento2/commands'].map(d => join(ROOT, d));
	let checked = 0;
	for (const dir of dirs) {
		if (!existsSync(dir)) continue;
		for (const file of readdirSync(dir)) {
			if (!file.endsWith('.md')) continue;
			checked += 1;
			const text = read(join(dir, file));
			assert.ok(!text.includes(FOREIGN_ID), `${file} names ${FOREIGN_ID}`);
		}
	}
	assert.ok(checked > 0, 'no commands were checked — the paths moved');
});

check('a gated stop names the tool the gate tells the model to use', async () => {
	// The mod's reason and the bodies must agree on the name, or the gate pushes the
	// model at something the commands never mention.
	const {default: read2} = {default: read};
	const mod = read2(join(ROOT, 'packages', 'proflow', 'mods', 'proflow.ts'));
	const gate = /QUESTION_TOOLS = new Set\(\[([^\]]*)\]\)/.exec(mod);
	assert.ok(gate, 'the mod must declare the question tool ids');
	assert.ok(gate[1].includes(TOOL_ID), `the gate must look for ${TOOL_ID}`);
});

check('every gated stop in our command patches names the question tool', async () => {
	// Checked against the patch layer rather than the built files: those files also carry upstream
	// prose we do not own, and a lint that fails on someone else's wording is a lint nobody keeps.
	const patches = (await import(join(ROOT, 'patches', 'commands.mjs'))).default;
	const STOP = /ask which|stop and ask|confirm with the user|wait for explicit|ask the user/i;
	let checked = 0;
	for (const entry of patches) {
		for (const rule of entry.replaces ?? []) {
			if (!STOP.test(rule.with ?? '')) continue;
			checked += 1;
			assert.match(rule.with, /question tool/i, `${entry.file}: a decision stop must name the question tool`);
		}
	}
	assert.ok(checked >= 3, `expected the known gated stops, found ${checked}`);
});

let failed = 0;
for (const [name, fn] of suite) {
	try {
		await fn();
		console.log(`  \x1b[32m✓\x1b[0m ${name}`);
	} catch (error) {
		failed += 1;
		console.error(`  \x1b[31m✗ ${name}\x1b[0m`);
		console.error(`    ${error.message}`);
	}
}
if (failed > 0) process.exit(1);
