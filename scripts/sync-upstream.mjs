#!/usr/bin/env node
// Re-vendor the upstream agent-skills content this package carries.
//
//   node scripts/sync-upstream.mjs [ref]
//
// Clones addyosmani/agent-skills at `ref` (default: main), copies skills/,
// references/, agents/ and docs/agents.md verbatim, then applies the declared
// patches in `scripts/patches/agent-skills.mjs` through the shared vendoring
// engine (`scripts/lib/vendor.mjs`). The command workflows in commands/ are
// authored here and are never touched by this script.

import {cpSync, existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyPatches, cleanup, clone, copyTree, readJson, writeRecord} from './lib/vendor.mjs';
import patches from './patches/agent-skills.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REF = process.argv[2] || 'main';
const REPO = process.env.AGENT_SKILLS_REPO || 'https://github.com/addyosmani/agent-skills.git';

const stage = mkdtempSync(join(tmpdir(), 'agent-skills-'));
try {
	console.log(`Cloning ${REPO} @ ${REF} …`);
	const {commit} = clone(REPO, REF, stage);
	const version = readJson(join(stage, '.claude-plugin', 'plugin.json'), {})?.version ?? 'unknown';

	for (const dir of ['skills', 'references', 'agents']) {
		rmSync(join(ROOT, dir), {recursive: true, force: true});
		copyTree(join(stage, dir), join(ROOT, dir));
		console.log(`vendored ${dir}/`);
	}
	cpSync(join(stage, 'docs', 'agents.md'), join(ROOT, 'docs', 'agents.md'));
	console.log('vendored docs/agents.md');

	const applied = applyPatches(ROOT, patches);
	console.log(`patched ${applied.length} file(s): ${applied.join(', ')}`);

	// Authored overlays (e.g. the spec-reviewer persona, which upstream has no
	// equivalent for) are restored LAST, so a sync never deletes content proflow
	// owns. This is why authored files must not live directly under the wiped
	// skills/ · references/ · agents/ directories.
	if (existsSync(join(ROOT, 'overlays'))) {
		copyTree(join(ROOT, 'overlays'), ROOT);
		console.log('restored overlays/');
	}

	cpSync(join(stage, 'LICENSE'), join(ROOT, 'LICENSE.agent-skills'));
	writeRecord(join(ROOT, 'VENDOR.json'), {
		source: 'https://github.com/addyosmani/agent-skills',
		repo: REPO,
		ref: REF,
		commit,
		version,
		patches: applied,
		syncedAt: new Date().toISOString(),
	});

	console.log(`\nDone — agent-skills ${version} @ ${commit.slice(0, 12)}`);
} finally {
	cleanup(stage);
}
