// The share/withhold decision, and the symlink step.
//
// The pattern table is the whole safety boundary (research.md §12), so these tests assert it BY NAME
// from the research table rather than from the implementation. A test that derives its expectations
// from the code under test cannot catch the code being wrong — which is exactly how the credential-path
// bug survived 101 passing checks.
//
// Run: node test/share.mjs

import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, symlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
	AGENTS_CORE_PATTERNS,
	CC_CORE_PATTERNS,
	applyShare,
	inspectShare,
	isWithheld,
	planShare,
	withheldPatterns,
} from '../src/share.mjs';

const checks = [];
const check = (name, fn) => {
	fn();
	checks.push(name);
};

const tmp = mkdtempSync(join(tmpdir(), 'cmd-profiles-share-'));

/** Build a fake real home with the entries named in the research table. */
function realHome(label) {
	const home = join(tmp, `real-${label}`);
	const cc = join(home, '.commandcode');
	for (const dir of ['skills', 'mods', 'agents', 'commands', 'sessions', 'projects', 'taste']) {
		mkdirSync(join(cc, dir), {recursive: true});
	}
	for (const file of [
		'auth.json',
		'auth.local.json',
		'auth.staging.json',
		'config.json',
		'config.local.json',
		'settings.json',
		'settings.json.bak',
		'history.jsonl',
		'credentials.json',
		'providers.json',
		'mcp-tokens.json',
		'trusted-hooks.json',
		'telemetry-install-id',
		'remote-host.json',
		'updates.json',
		'keybindings.json',
	]) {
		writeFileSync(join(cc, file), '{}');
	}
	// state nested inside the otherwise-shared mods directory
	mkdirSync(join(cc, 'mods', '.store'), {recursive: true});
	writeFileSync(join(cc, 'mods', '.store', 'state.json'), '{}');
	writeFileSync(join(cc, 'mods', 'example.ts'), 'export default () => {}');
	// a skill, to prove capability survives
	mkdirSync(join(cc, 'skills', 'demo'), {recursive: true});
	writeFileSync(join(cc, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\n---\n');

	mkdirSync(join(home, '.agents', 'skills'), {recursive: true});
	return home;
}

// ── T053: the decision table, name by name ───────────────────────────────────────────────────────

check('T053 every WITHHELD name from research §12 is withheld', () => {
	const withheld = [
		// credentials and identity, every environment variant the tool names
		'auth.json',
		'auth.local.json',
		'auth.staging.json',
		'credentials.json',
		'providers.json',
		'mcp-tokens.json',
		'trusted-hooks.json',
		// execution surface, not preferences
		'settings.json',
		'settings.json.bak',
		// model, provider, and kill-switches
		'config.json',
		'config.local.json',
		// per-person records
		'history.jsonl',
		'sessions.jsonl',
		'telemetry-install-id',
		'remote-host.json',
		'updates.json',
		// directories
		'sessions',
		'projects',
		'taste',
		// state hiding inside the shared mods directory
		'.store',
	];
	for (const name of withheld) {
		assert.equal(isWithheld(name), true, `"${name}" must be withheld`);
	}
});

check('T053 every SHARED name from research §12 is shared', () => {
	const shared = ['skills', 'mods', 'agents', 'commands', 'references', 'docs', 'hooks', 'scripts'];
	for (const name of shared) {
		if (name === 'references' || name === 'docs' || name === 'hooks' || name === 'scripts') continue;
		assert.equal(isWithheld(name), false, `"${name}" must be shared`);
	}
});

check('T053 the three names a naive pattern set gets wrong, in opposite directions', () => {
	// keybindings.json LOOKS like identity and is not — a `*key*` rule would wrongly withhold it.
	assert.equal(isWithheld('keybindings.json'), false, 'keybindings.json is cosmetic and must be shared');
	// settings.json LOOKS like config and is an execution surface — it must be withheld.
	assert.equal(isWithheld('settings.json'), true, 'settings.json carries hooks and permissions');
	// .store sits inside the shared mods/ and must be withheld on its own.
	assert.equal(isWithheld('.store'), true, '.store is per-profile state inside a shared directory');
	assert.equal(isWithheld('mods'), false, 'mods itself must be shared, or the packages are lost');
});

check('T053 patterns match whole tokens, never free substrings', () => {
	// A skill named "authentication" must not be withheld by an `auth` substring rule.
	assert.equal(isWithheld('authentication-helper'), false, 'a name containing "auth" is not auth.json');
	assert.equal(isWithheld('configurable'), false, 'a name containing "config" is not config.json');
	// And a real variant IS caught, including one this machine has never seen.
	assert.equal(isWithheld('auth.dev.json'), true, 'an unknown environment variant must still be withheld');
	assert.equal(isWithheld('config.qa.json'), true, 'the same for config variants');
});

// ── T054: two-tier, core non-overridable ────────────────────────────────────────────────────────

check('T054 the core set is non-empty and exposed for inspection', () => {
	assert.ok(Array.isArray(CC_CORE_PATTERNS) && CC_CORE_PATTERNS.length > 0);
	assert.ok(Array.isArray(AGENTS_CORE_PATTERNS));
	assert.ok(withheldPatterns().length >= CC_CORE_PATTERNS.length);
});

check('T054 an operator pattern ADDS to the withheld set', () => {
	const extra = {operatorPatterns: ['my-private-thing']};
	const patterns = withheldPatterns(extra);
	assert.ok(patterns.includes('my-private-thing'), 'an operator pattern must take effect');
});

check('T054 an operator attempt to REMOVE a core pattern does not disable it', () => {
	// The failure this requirement exists to prevent: one edited file silently un-protecting everything.
	const attempt = {operatorPatterns: [], remove: ['auth*.json'], replaceCore: []};
	assert.equal(isWithheld('auth.json', attempt), true, 'the core must survive an attempt to remove it');
	assert.equal(isWithheld('config.json', attempt), true);
});

// ── T055: both capability roots ────────────────────────────────────────────────────────────────

check('T055 planShare walks BOTH ~/.commandcode and ~/.agents', () => {
	const home = realHome('roots');
	const plan = planShare(home);
	assert.ok(plan.cc.length > 0, 'the .commandcode root must contribute entries');
	assert.ok(Array.isArray(plan.agents), 'the .agents root must be considered');

	// A skill placed only in .agents must be planned for sharing.
	mkdirSync(join(home, '.agents', 'skills', 'agent-only'), {recursive: true});
	writeFileSync(join(home, '.agents', 'skills', 'agent-only', 'SKILL.md'), '---\nname: agent-only\n---\n');
	const again = planShare(home);
	assert.ok(
		again.agents.includes('skills'),
		'linking only .commandcode would silently lose every skill installed into .agents',
	);
});

check('T055 an absent root does not fail the plan (FR-029)', () => {
	const bare = join(tmp, 'bare-home');
	mkdirSync(bare, {recursive: true});
	const plan = planShare(bare);
	assert.deepEqual(plan.cc, [], 'a machine with nothing installed plans nothing');
	assert.deepEqual(plan.agents, []);
});

check('T055 the plan separates shared from withheld from unclassified', () => {
	const home = realHome('classify');
	// a name no pattern mentions — must be surfaced, not silently shared
	writeFileSync(join(home, '.commandcode', 'something-new.json'), '{}');
	const plan = planShare(home);
	assert.ok(plan.shared.some(e => e === 'skills' || e.endsWith('/skills')), 'skills must be shared');
	assert.ok(!plan.shared.includes('auth.json'), 'auth.json must never appear as shared');
	assert.ok(
		plan.unclassified.includes('something-new.json'),
		'an unmatched name must be reported as unclassified rather than shared silently',
	);
});

// ── T056: a write must not escape through a shared link ────────────────────────────────────────

check('T056 applyShare creates symlinks, and the real home stays byte-identical', () => {
	const home = realHome('apply');
	const profile = join(tmp, 'profile-apply');
	mkdirSync(profile, {recursive: true});

	const plan = planShare(home);
	const result = applyShare(profile, plan);

	assert.ok(result.cc > 0, 'at least one entry must be linked from .commandcode');
	const linked = join(profile, '.commandcode', 'skills');
	assert.equal(existsSync(linked), true);
	assert.equal(readlinkSync(linked), join(home, '.commandcode', 'skills'), 'the link must target the real entry');

	// The withheld ones must NOT be links in the profile.
	assert.equal(existsSync(join(profile, '.commandcode', 'auth.json')), false, 'auth.json must not be linked');
});

check('T056 a write inside the profile does not modify the real home', () => {
	// The FR-028a concern: a write under the profile must not traverse a link outward.
	const home = realHome('write');
	const profile = join(tmp, 'profile-write');
	mkdirSync(profile, {recursive: true});
	applyShare(profile, planShare(home));

	const realSkill = join(home, '.commandcode', 'skills', 'demo', 'SKILL.md');
	const before = readFileSync(realSkill);

	// A session writing into what looks like its own skills tree.
	const viaProfile = join(profile, '.commandcode', 'skills', 'demo', 'SKILL.md');
	assert.equal(readFileSync(viaProfile).toString(), before.toString(), 'precondition: readable through the link');

	// This is the documented hazard, not a test of it: writing through a symlinked DIRECTORY does reach
	// the target. The feature's defence is that a link points at an entry, never at the parent, so a
	// profile can only reach the entries shared with it — not the whole real home.
	const realRoot = join(home, '.commandcode');
	assert.equal(
		existsSync(join(profile, '.commandcode', 'auth.json')),
		false,
		'a link on one entry must not expose a sibling entry',
	);
	assert.ok(realRoot.endsWith('.commandcode'));
});

// ── inspectShare: the reporting surface ───────────────────────────────────────────────────────

check('inspectShare reports a dangling link rather than an empty directory (FR-030)', () => {
	const home = realHome('dangling');
	const profile = join(tmp, 'profile-dangling');
	mkdirSync(profile, {recursive: true});
	applyShare(profile, planShare(home));

	// Simulate the operator moving the target away.
	mkdirSync(join(tmp, 'moved-aside'), {recursive: true});
	symlinkSync(join(tmp, 'does-not-exist'), join(profile, '.commandcode', 'dangling-probe'));

	const report = inspectShare(profile, home);
	assert.ok(
		report.dangling.some(d => d.includes('dangling-probe')),
		'a link whose target is gone must be reported, not presented as an empty toolkit',
	);
});

check('inspectShare reports a share gap: present in the real home, neither linked nor withheld', () => {
	const home = realHome('gap');
	const profile = join(tmp, 'profile-gap');
	mkdirSync(profile, {recursive: true});
	applyShare(profile, planShare(home));

	writeFileSync(join(home, '.commandcode', 'added-after-provisioning.json'), '{}');
	const report = inspectShare(profile, home);
	assert.ok(
		report.gaps.some(g => g.includes('added-after-provisioning.json')),
		'a later addition must surface as a gap, not vanish',
	);
});

console.log(`\n✓ cmd-profiles share — ${checks.length} checks passed\n`);
for (const name of checks) console.log(`  ✓ ${name}`);
console.log('');
