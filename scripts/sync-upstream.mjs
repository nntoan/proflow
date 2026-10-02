#!/usr/bin/env node
// Re-vendor the upstream agent-skills content the proflow payload carries.
//
//   node scripts/sync-upstream.mjs [ref]
//
// Clones addyosmani/agent-skills at `ref` (default: main) and copies skills/,
// references/, agents/, `.claude/commands/` and docs/agents.md into
// `packages/proflow/`, then applies the declared patches
// (`patches/agent-skills.mjs`, `patches/commands.mjs`) through the shared engine
// in `tools/vendor.mjs`.
//
// Authored content that must live inside a wiped directory — the spec-reviewer
// persona, the /brainstorm command, the spec-reflection skill — is restored from
// `overlays/` LAST, so a sync never deletes what proflow owns.

import {cpSync, existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyPatches, cleanup, clone, copyTree, readJson, writeRecord} from '../tools/vendor.mjs';
import agentSkillsPatches from '../patches/agent-skills.mjs';
import commandPatches, {rename as commandRename} from '../patches/commands.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = join(ROOT, 'packages', 'proflow');
const REF = process.argv[2] || 'main';
const REPO = process.env.AGENT_SKILLS_REPO || 'https://github.com/addyosmani/agent-skills.git';

const stage = mkdtempSync(join(tmpdir(), 'agent-skills-'));
try {
	console.log(`Cloning ${REPO} @ ${REF} …`);
	const {commit} = clone(REPO, REF, stage);
	const version = readJson(join(stage, '.claude-plugin', 'plugin.json'), {})?.version ?? 'unknown';

	for (const dir of ['skills', 'references', 'agents']) {
		rmSync(join(PKG, dir), {recursive: true, force: true});
		copyTree(join(stage, dir), join(PKG, dir));
		console.log(`vendored ${dir}/`);
	}

	// Commands — upstream keeps them under .claude/, named for Claude's slash
	// menu. proflow renames the two that collide with Command Code built-ins.
	rmSync(join(PKG, 'commands'), {recursive: true, force: true});
	copyTree(join(stage, '.claude', 'commands'), join(PKG, 'commands'), {
		rename: Object.fromEntries(
			Object.entries(commandRename).map(([from, to]) => [`${from}.md`, `${to}.md`]),
		),
	});
	console.log('vendored commands/');

	cpSync(join(stage, 'docs', 'agents.md'), join(PKG, 'docs', 'agents.md'));
	console.log('vendored docs/agents.md');

	const applied = applyPatches(PKG, [...agentSkillsPatches, ...commandPatches]);
	console.log(`patched ${applied.length} file(s): ${applied.join(', ')}`);

	// Authored overlays are restored LAST so a sync never deletes content proflow
	// owns. This is why authored files must not live directly under the wiped
	// skills/ · references/ · agents/ · commands/ directories.
	if (existsSync(join(ROOT, 'overlays'))) {
		copyTree(join(ROOT, 'overlays'), PKG);
		console.log('restored overlays/');
	}

	cpSync(join(stage, 'LICENSE'), join(PKG, 'LICENSE.agent-skills'));
	writeRecord(join(PKG, 'VENDOR.json'), {
		source: 'https://github.com/addyosmani/agent-skills',
		repo: REPO,
		ref: REF,
		commit,
		version,
		patches: applied,
		commandRenames: commandRename,
		syncedAt: new Date().toISOString(),
	});

	console.log(`\nDone — agent-skills ${version} @ ${commit.slice(0, 12)}`);
} finally {
	cleanup(stage);
}
