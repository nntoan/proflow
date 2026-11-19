// Reporting on profiles.
//
// The contract that matters: never print a credential value. Only whether one is present. A
// diagnostic that pastes an API key into a terminal is worse than no diagnostic, because the
// output ends up in scrollback, logs, and screenshots.

import {existsSync} from 'node:fs';
import {readRegistry} from './registry.mjs';
import {isAuthenticated, isRevoked} from './registry.mjs';
import {inspectShare} from './share.mjs';

/**
 * Findings for every profile, or one when `profile` is named.
 *
 * Each finding is a short token an operator can act on, not a sentence: `registry-invalid`,
 * `path-missing`, `unauthenticated`, `revoked`, `duplicate-path`.
 */
export function diagnose({root, profile, realHome} = {}) {
	let reg;
	try {
		reg = readRegistry(root);
	} catch (error) {
		// A registry that cannot be read is the finding, not a crash: the operator still needs to
		// know what is wrong, and the reason is not a secret.
		return {
			root,
			registry: {valid: false, reason: error.message},
			profiles: [],
		};
	}

	const names = profile ? [profile] : Object.keys(reg.profiles);
	const seen = new Map();
	for (const [name, entry] of Object.entries(reg.profiles)) {
		const key = entry.path;
		if (key) seen.set(key, (seen.get(key) ?? []).concat(name));
	}

	const profiles = names.map(name => {
		const entry = reg.profiles[name];
		const findings = [];

		if (!entry) {
			return {name, findings: ['unknown-profile'], authenticated: false, path: null};
		}
		if (!existsSync(entry.path)) findings.push('path-missing');
		if (isRevoked(entry)) findings.push('revoked');

		// Share findings (FR-027b guard ii, FR-030). Only meaningful when the profile home exists.
		let share;
		if (existsSync(entry.path)) {
			share = inspectShare(entry.path, realHome ?? '');
			if (share.dangling.length > 0) findings.push('share-target-missing');
			if (share.gaps.length > 0) findings.push('share-gap');
		}
		if (!isAuthenticated(entry.path)) findings.push('unauthenticated');
		if ((seen.get(entry.path) ?? []).length > 1) findings.push('duplicate-path');

		return {
			name,
			path: entry.path,
			owner: entry.owner ?? null,
			authenticated: isAuthenticated(entry.path),
			revoked: entry.revoked ?? null,
			share: share ?? null,
			isDefault: reg.default === name,
			findings,
		};
	});

	return {root, registry: {valid: true}, default: reg.default ?? null, profiles};
}
