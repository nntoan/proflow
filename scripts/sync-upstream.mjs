#!/usr/bin/env node
// Re-vendor the upstream agent-skills content this package carries.
//
// Usage:  node scripts/sync-upstream.mjs [ref]
//
// Clones addyosmani/agent-skills at `ref` (default: main), then replaces
// skills/, references/, agents/, docs/agents.md, LICENSE.agent-skills and
// VENDOR.json. The command workflows in commands/ are authored here (adapted
// for Command Code) and are never overwritten by this script.

import {execFileSync} from 'node:child_process';
import {cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const REF = process.argv[2] || 'main';
const REPO = process.env.AGENT_SKILLS_REPO || 'https://github.com/addyosmani/agent-skills.git';

const stage = mkdtempSync(join(tmpdir(), 'agent-skills-'));
try {
	console.log(`Cloning ${REPO} @ ${REF} …`);
	execFileSync('git', ['clone', '--depth', '1', '--branch', REF, REPO, stage], {
		stdio: 'inherit',
	});

	const commit = execFileSync('git', ['-C', stage, 'rev-parse', 'HEAD'], {
		encoding: 'utf8',
	}).trim();

	const pluginPath = join(stage, '.claude-plugin', 'plugin.json');
	const version = existsSync(pluginPath)
		? JSON.parse(readFileSync(pluginPath, 'utf8')).version
		: 'unknown';

	for (const dir of ['skills', 'references', 'agents']) {
		rmSync(join(ROOT, dir), {recursive: true, force: true});
		cpSync(join(stage, dir), join(ROOT, dir), {recursive: true});
		console.log(`vendored ${dir}/`);
	}

	cpSync(join(stage, 'docs', 'agents.md'), join(ROOT, 'docs', 'agents.md'));
	console.log('vendored docs/agents.md');

	cpSync(join(stage, 'LICENSE'), join(ROOT, 'LICENSE.agent-skills'));
	writeFileSync(
		join(ROOT, 'VENDOR.json'),
		`${JSON.stringify(
			{
				source: 'https://github.com/addyosmani/agent-skills',
				repo: REPO,
				ref: REF,
				commit,
				version,
				syncedAt: new Date().toISOString(),
			},
			null,
			2,
		)}\n`,
	);
	console.log(`\nDone — agent-skills ${version} @ ${commit.slice(0, 12)}`);
} finally {
	rmSync(stage, {recursive: true, force: true});
}
