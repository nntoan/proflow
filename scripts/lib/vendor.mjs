// Shared vendoring machinery for proflow's upstream syncs.
//
// Both `sync-upstream.mjs` (agent-skills) and `sync-magento2.mjs`
// (magento2-tools) use these primitives, so there is ONE declarative path for
// cloning, copying, patching, and recording — no duplicated logic between them.
//
// A "patch set" is data (see `scripts/patches/*.mjs`):
//
//   [{
//     file: 'skills/x/SKILL.md',            // path relative to the vendored root
//     replaces: [{find, with, count?}],     // exact string; must occur `count` (default 1) times
//     transforms: [{pattern, flags?, replace}], // regex rewrites
//   }]
//
// `applyPatches` FAILS LOUDLY when a `find` no longer matches the expected
// number of times, so upstream drift breaks the sync in CI instead of silently
// shipping stale or wrong content.

import {execFileSync} from 'node:child_process';
import {chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

/** Text extensions the transform step rewrites (everything else is copied). */
export const TEXT_RE = /\.(md|markdown|sh|bash|mjs|cjs|js|ts|json|txt|ya?ml|php|xml|less|css|html)$/i;

/** Shallow-clone `repo` at `ref` into `dest`; returns `{dir, commit}`. */
export function clone(repo, ref, dest) {
	execFileSync('git', ['clone', '--depth', '1', '--branch', ref, repo, dest], {stdio: 'inherit'});
	const commit = execFileSync('git', ['-C', dest, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
	return {dir: dest, commit};
}

/** Read a JSON file, or `fallback` when it is missing/unparseable. */
export function readJson(file, fallback = null) {
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return fallback;
	}
}

/**
 * Recursively copy `src` → `dest`. For every file:
 *   - skipped entirely when its basename is in `exclude`;
 *   - renamed when its basename is a key of `rename`;
 *   - text files are read, passed through `transform(text, srcFile)`, and written;
 *   - everything else is copied byte-for-byte. The executable bit is preserved.
 */
export function copyTree(src, dest, {transform, exclude = [], rename = {}} = {}) {
	mkdirSync(dest, {recursive: true});
	for (const entry of readdirSync(src)) {
		if (exclude.includes(entry)) continue;
		const from = join(src, entry);
		const to = join(dest, rename[entry] ?? entry);
		if (statSync(from).isDirectory()) {
			copyTree(from, to, {transform, exclude, rename});
			continue;
		}
		mkdirSync(dirname(to), {recursive: true});
		if (transform && TEXT_RE.test(entry)) {
			writeFileSync(to, transform(readFileSync(from, 'utf8'), from));
		} else {
			cpSync(from, to);
		}
		if (statSync(from).mode & 0o111) {
			try {
				chmodSync(to, 0o755);
			} catch {
				// best effort (e.g. Windows)
			}
		}
	}
}

/** Copy one file, transforming it when it is text. */
export function copyFile(src, dest, {transform} = {}) {
	mkdirSync(dirname(dest), {recursive: true});
	if (transform && TEXT_RE.test(src)) {
		writeFileSync(dest, transform(readFileSync(src, 'utf8'), src));
	} else {
		cpSync(src, dest);
	}
}

/**
 * Apply a declarative patch set to a vendored root. Returns the list of files
 * touched. Throws on a missing target file or a `replaces` mismatch, so a rule
 * that no longer matches upstream is a hard failure, not a silent no-op.
 */
export function applyPatches(root, patches) {
	const applied = [];
	for (const patch of patches) {
		const file = join(root, patch.file);
		if (!existsSync(file)) {
			throw new Error(`vendor patch target missing: ${patch.file}`);
		}
		let text = readFileSync(file, 'utf8');
		for (const rule of patch.replaces ?? []) {
			const expected = rule.count ?? 1;
			const found = text.split(rule.find).length - 1;
			if (found !== expected) {
				throw new Error(
					`vendor patch drift in ${patch.file}: expected ${expected} match(es) of ` +
						`${JSON.stringify(rule.find.slice(0, 70))}…, found ${found}. ` +
						'Upstream changed — update scripts/patches/*.mjs.',
				);
			}
			text = text.split(rule.find).join(rule.with);
		}
		for (const rule of patch.transforms ?? []) {
			text = text.replace(new RegExp(rule.pattern, rule.flags ?? 'g'), rule.replace);
		}
		writeFileSync(file, text);
		applied.push(patch.file);
	}
	return applied;
}

/** Write a provenance record (the `VENDOR.json` shape). */
export function writeRecord(file, data) {
	writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

/** Remove a staging directory (best effort). */
export function cleanup(dir) {
	try {
		rmSync(dir, {recursive: true, force: true});
	} catch {
		// ignore
	}
}
