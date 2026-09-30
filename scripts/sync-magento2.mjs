#!/usr/bin/env node
// Vendor + adapt muon-m2/magento2-tools as an optional proflow component.
//
//   node scripts/sync-magento2.mjs [ref]
//
// magento2-tools is a Claude Code plugin, so its content assumes a Claude
// environment. This script clones it and applies the declarative rules in
// `scripts/patches/magento2.mjs` through the shared vendoring engine
// (`scripts/lib/vendor.mjs`) — the same machinery `sync-upstream.mjs` uses, so
// there is one declarative path and no duplicated logic. See that patch module
// for what each rule does (namespacing, plugin-root paths, config locations,
// agent rename + tool ids, dev-file exclusion).
//
// The generated tree is committed, so installing never needs the network.

import {cpSync, existsSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cleanup, clone, copyFile, copyTree, readJson, writeRecord} from './lib/vendor.mjs';
import * as m2 from './patches/magento2.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'components', 'magento2');
const REF = process.argv[2] || 'main';
const REPO = process.env.MAGENTO2_TOOLS_REPO || 'https://github.com/muon-m2/magento2-tools.git';

const list = dir => (existsSync(dir) ? readdirSync(dir) : []);
const base = file => file.replace(/\.md$/, '');

const stage = mkdtempSync(join(tmpdir(), 'magento2-tools-'));
try {
	console.log(`Cloning ${REPO} @ ${REF} …`);
	const {commit} = clone(REPO, REF, stage);
	const plugin = readJson(join(stage, '.claude-plugin', 'plugin.json'), {});

	const skillNames = list(join(stage, 'skills')).filter(name =>
		existsSync(join(stage, 'skills', name, 'SKILL.md')),
	);
	const withGeneric = text => m2.transform(text, skillNames);

	// Rebuild from scratch so removed/renamed files (reviewer.md, gen-routing.sh) don't linger.
	rmSync(OUT, {recursive: true, force: true});

	// Skills — namespaced dir + `name:`, descriptions made YAML-safe, dev files excluded.
	for (const name of skillNames) {
		copyTree(join(stage, 'skills', name), join(OUT, 'skills', `${m2.skillPrefix}${name}`), {
			exclude: m2.exclude,
			transform: (text, from) =>
				from.endsWith('SKILL.md')
					? m2.normalizeDescription(m2.setName(withGeneric(text), `${m2.skillPrefix}${name}`))
					: withGeneric(text),
		});
	}

	// Commands — renamed to m2-<verb>.
	const commands = list(join(stage, 'commands')).filter(file => file.endsWith('.md'));
	for (const file of commands) {
		copyFile(join(stage, 'commands', file), join(OUT, 'commands', `${m2.commandPrefix}${file}`), {
			transform: text => m2.normalizeDescription(withGeneric(text)),
		});
	}

	// Agents — renamed to m2-<name>, `name:` set, tool ids mapped.
	const agents = list(join(stage, 'agents')).filter(file => file.endsWith('.md'));
	for (const file of agents) {
		const renamed = m2.agentRename[base(file)] ?? base(file);
		copyFile(join(stage, 'agents', file), join(OUT, 'agents', `${renamed}.md`), {
			transform: text =>
				m2.normalizeDescription(m2.setName(m2.mapTools(withGeneric(text)), renamed)),
		});
	}

	// Hooks — adapted for Command Code's tool ids + env.
	const hooks = list(join(stage, 'hooks')).filter(file => file.endsWith('.sh'));
	copyTree(join(stage, 'hooks'), join(OUT, 'hooks'), {
		exclude: ['hooks.json'],
		transform: text => m2.adaptHook(withGeneric(text)),
	});

	cpSync(join(stage, 'LICENSE'), join(OUT, 'LICENSE'));
	writeRecord(join(OUT, 'VENDOR.json'), {
		source: 'https://github.com/muon-m2/magento2-tools',
		repo: REPO,
		ref: REF,
		commit,
		version: plugin.version,
		transform: 'scripts/patches/magento2.mjs',
		excluded: m2.exclude,
		syncedAt: new Date().toISOString(),
	});

	console.log(
		`\nVendored magento2-tools ${plugin.version} (${commit.slice(0, 12)}) → ${relative(ROOT, OUT)}\n` +
			`  skills   ${skillNames.length} (prefixed ${m2.skillPrefix})\n` +
			`  commands ${commands.length} (renamed ${m2.commandPrefix})\n` +
			`  agents   ${agents.length} (renamed ${Object.values(m2.agentRename).join(', ')})\n` +
			`  hooks    ${hooks.length}`,
	);
} finally {
	cleanup(stage);
}
