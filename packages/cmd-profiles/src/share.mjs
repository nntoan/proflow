// Deciding what a profile shares from the machine, and linking it.
//
// A profile home is a *home*, so Command Code resolves every capability directory under
// `<profile>/.commandcode/` — and under `<profile>/.agents/` for the compatibility root. That means a
// fresh profile starts with no skills, no mods and no sub-agents: a bare installation nobody can work in.
// This module reverses that accident without reversing the isolation.
//
// The pattern table is the entire safety boundary (research.md §12). It is derived from the shipped
// binary, and the tests assert it BY NAME from the research table rather than from this file — a test
// that reads its expectations from the code under test cannot catch the code being wrong.

import {existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, symlinkSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';

/** The tool's own state directory, inside a home. */
export const CC_DIR = '.commandcode';
/** The compatibility root the tool also scans for skills and commands. */
export const AGENTS_DIR = '.agents';

/**
 * Withheld patterns for `~/.commandcode/`.
 *
 * Matched against an entry name as **whole tokens and path segments**, never as a free substring —
 * `authentication-helper` is a skill, not a credential, and `keybindings.json` is cosmetic while
 * `credentials.json` is not (FR-027b guard iii).
 *
 * Deliberately absent: `*.md`, which would withhold every `SKILL.md` and agent definition; `*key*`,
 * which catches `keybindings.json` and nothing useful; and any rule on `mods`, because installed
 * packages live there and must be shared.
 */
export const CC_CORE_PATTERNS = Object.freeze([
	// credentials and identity, in every environment variant the tool names (FR-027a)
	'auth*.json',
	'auth.*.json',
	'credentials*.json',
	'providers.json',
	'mcp-tokens.json',
	'trusted-hooks.json',
	'telemetry-install-id',
	// an execution surface, not preferences: hook commands as absolute paths, plus permission grants.
	// The trailing `*` matters — the tool leaves a `settings.json.bak` beside it, and that backup holds
	// the same hook commands.
	'settings*.json*',
	// model, provider, reasoning effort, telemetry kill-switches
	'config*.json',
	// per-person records — every one of them is JSONL
	'*.jsonl',
	// state directories
	'sessions',
	'projects',
	'file-history',
	'plans',
	'cron',
	'worktrees',
	'cache',
	'logs',
	'ide',
	'taste',
	// one machine, one updater
	'remote-host.json',
	'updates.json',
	'update.lock',
	'update-status',
	'ide-gallery-*',
	// global user memory — "personal preferences for all projects"
	'AGENTS.md',
	// per-profile runtime state that hides INSIDE the otherwise-shared mods directory (FR-027c)
	'.store',
]);

/** Withheld patterns for `~/.agents/`. Narrow: this root holds capability, plus an ownership lock. */
export const AGENTS_CORE_PATTERNS = Object.freeze(['.skill-lock.json']);

/**
 * Entry names this feature *expects* to share — the capability surface.
 *
 * Not a gate. Sharing is the default (FR-026), so anything absent from this list is still shared; it is
 * only reported, because a shared path nobody recognised is how an unclassified addition becomes visible
 * instead of silent (FR-027b guard ii).
 */
export const KNOWN_CAPABILITY = Object.freeze([
	'skills',
	'mods',
	'agents',
	'commands',
	'references',
	'docs',
	'hooks',
	'scripts',
]);

/**
 * Translate one pattern into a matcher.
 *
 * A leading dot pattern (`.store`) matches that exact name. A `*` matches any run of characters within
 * a single segment. A pattern ending in `/` was written as a directory and matches only that name.
 */
function matches(name, pattern) {
	const cleaned = pattern.replace(/\/$/, '');
	// Reject only when the name is longer than one segment is expected to be; entry names never contain
	// a separator, so a pattern with one cannot match.
	if (cleaned.includes('/')) return false;
	const escaped = cleaned.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
	return new RegExp(`^${escaped}$`).test(name);
}

/**
 * The effective withheld set.
 *
 * Two tiers (FR-027): the core always applies, and an operator layer may only *add*. There is no
 * supported way to remove a core pattern — an edited file that silently disabled the protection is the
 * failure this exists to prevent.
 */
export function withheldPatterns({operatorPatterns = [], root = CC_DIR} = {}) {
	const core = root === AGENTS_DIR ? AGENTS_CORE_PATTERNS : CC_CORE_PATTERNS;
	const extra = Array.isArray(operatorPatterns) ? operatorPatterns.filter(p => typeof p === 'string' && p) : [];
	return [...core, ...extra];
}

/** Is this entry name withheld for the given root? */
export function isWithheld(name, options = {}) {
	if (typeof name !== 'string' || name === '') return false;
	const root = options.root ?? CC_DIR;
	return withheldPatterns({...options, root}).some(pattern => matches(name, pattern));
}

/** Every entry name directly under a directory, or [] when it is absent. */
function entriesIn(dir) {
	try {
		return readdirSync(dir).sort();
	} catch {
		return [];
	}
}

/**
 * What to link for one real home.
 *
 * Returns four lists so the caller can report honestly rather than guessing: the entries to share, those
 * withheld by pattern, those neither shared nor withheld (unclassified — surface them, never share them
 * silently), and any that could not be read.
 */
export function planShare(realHome, options = {}) {
	const ccRoot = join(realHome, CC_DIR);
	const agentsRoot = join(realHome, AGENTS_DIR);

	const ccEntries = entriesIn(ccRoot);
	const agentEntries = entriesIn(agentsRoot);

	const shared = [];
	const withheld = [];
	const unclassified = [];

	const classify = (name, root) => {
		if (isWithheld(name, {...options, root})) {
			withheld.push(name);
			return false;
		}
		// Sharing is the default (FR-026). A name nobody recognised is still shared — but recorded, so
		// an addition to the tool's home becomes visible rather than silent (FR-027b guard ii).
		shared.push(name);
		if (!KNOWN_CAPABILITY.includes(name)) unclassified.push(name);
		return true;
	};

	for (const name of ccEntries) classify(name, CC_DIR);
	for (const name of agentEntries) classify(name, AGENTS_DIR);

	return {
		realHome,
		cc: ccEntries.filter(name => shared.includes(name)),
		agents: agentEntries.filter(name => shared.includes(name)),
		shared,
		withheld,
		unclassified,
		roots: {
			[CC_DIR]: existsSync(ccRoot),
			[AGENTS_DIR]: existsSync(agentsRoot),
		},
	};
}

/** Link one entry into the profile, replacing nothing. */
function linkEntry(target, linkPath) {
	const existing = lstatSync(linkPath, {throwIfNoEntry: false});
	if (existing) {
		if (existing.isSymbolicLink() && readlinkSync(linkPath) === target) return 'kept';
		return 'conflict';
	}
	mkdirSync(join(linkPath, '..'), {recursive: true});
	symlinkSync(target, linkPath);
	return 'linked';
}

/**
 * Apply a share plan to a profile home.
 *
 * A link points at one entry, never at the parent, so a profile can reach exactly the entries shared with
 * it and no sibling. An existing correct link is kept (idempotent); an existing *wrong* link is reported
 * rather than clobbered, because overwriting it could discard something the operator did deliberately.
 */
export function applyShare(profileHome, plan) {
	const result = {cc: 0, agents: 0, kept: 0, conflicts: []};

	const applyRoot = (dirName, names) => {
		if (names.length === 0) return 0;
		const destRoot = join(profileHome, dirName);
		mkdirSync(destRoot, {recursive: true});
		let count = 0;
		for (const name of names) {
			const outcome = linkEntry(join(plan.realHome, dirName, name), join(destRoot, name));
			if (outcome === 'linked') count += 1;
			else if (outcome === 'kept') result.kept += 1;
			else result.conflicts.push(join(dirName, name));
		}
		return count;
	};

	result.cc = applyRoot(CC_DIR, plan.cc);
	result.agents = applyRoot(AGENTS_DIR, plan.agents);
	return result;
}

/**
 * What a profile currently shares, and what is wrong with it.
 *
 * Reports both failure directions (FR-027b guard ii, FR-030): a link whose target has gone, and an entry
 * present in the real home that is neither linked nor withheld.
 */
export function inspectShare(profileHome, realHome, options = {}) {
	const linked = [];
	const dangling = [];
	const gaps = [];

	for (const dirName of [CC_DIR, AGENTS_DIR]) {
		const destRoot = join(profileHome, dirName);
		for (const name of entriesIn(destRoot)) {
			const full = join(destRoot, name);
			const stat = lstatSync(full, {throwIfNoEntry: false});
			if (!stat?.isSymbolicLink()) continue;
			const target = readlinkSync(full);
			linked.push(join(dirName, name));
			if (!existsSync(target)) dangling.push(join(dirName, name));
		}
	}

	// An entry present in the real home and neither linked nor withheld is a share gap.
	for (const dirName of [CC_DIR, AGENTS_DIR]) {
		for (const name of entriesIn(join(realHome, dirName))) {
			if (isWithheld(name, {...options, root: dirName})) continue;
			const linkPath = join(profileHome, dirName, name);
			if (!existsSync(linkPath) && !lstatSync(linkPath, {throwIfNoEntry: false})) {
				gaps.push(join(dirName, name));
			}
		}
	}

	return {linked, dangling, gaps};
}

/** Remove a share link, for tests and for a future re-provision. Never touches the target. */
export function unlinkShare(linkPath) {
	const stat = lstatSync(linkPath, {throwIfNoEntry: false});
	if (stat?.isSymbolicLink()) unlinkSync(linkPath);
}
