// Provisioning, adopting, and revoking profiles.
//
// The asymmetry here is deliberate: `provision` creates a directory we own, `adopt` records a
// directory that already exists and must not change it, and `revoke` has two shapes because
// removing someone's access is a different decision from destroying their history.

import {existsSync, mkdirSync, readdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {assertProfileName, profileHome} from './paths.mjs';
import {credentialPath, isAuthenticated, isRevoked, readRegistry, removeProfile, updateRegistry, upsertProfile} from './registry.mjs';
import {applyShare, planShare} from './share.mjs';
import {ProfileError, EXIT} from './resolve.mjs';

/**
 * The isolation boundary, in the words the spec requires (FR-022).
 *
 * Kept as one exported constant so `provision` and `diagnose` cannot drift apart, and so a test
 * can assert the wording exists rather than trusting that a README still says it.
 */
export const ISOLATION_NOTICE =
	'Profiles separate Command Code identities inside one operating-system account. ' +
	'They guard against mistake and accident — a session inheriting the wrong home, or a credential ' +
	'being used by the wrong person. They are not a security boundary between colleagues: anyone who ' +
	'can read the profile directories can read another profile’s files. If you need that, give each ' +
	'person their own operating-system account.';

/** Create a profile that does not exist yet. Does not authenticate — that is the person's own act. */
export function provision({root, name, owner, realHome}) {
	assertProfileName(name);
	if (typeof owner !== 'string' || owner.trim() === '') {
		throw new ProfileError(`a profile needs an owner: pass --owner <text>`, EXIT.unresolved);
	}
	const home = profileHome(root, name);

	// Check for a duplicate BEFORE doing any work, so the error names the real problem.
	if (readRegistry(root).profiles[name]) {
		throw new ProfileError(`profile "${name}" already exists`, EXIT.unresolved);
	}

	mkdirSync(home, {recursive: true, mode: 0o700});

	// Share the machine's installed content BEFORE the registry entry, so a failed share leaves no
	// profile that looks provisioned (FR-023). Sharing is unconditional — a bare profile is the failure
	// this feature exists to prevent, so there is no flag to skip it.
	const plan = planShare(realHome ?? machineHome());
	const share = applyShare(home, plan);

	// SC-015: a provision that links nothing on a machine that has content must fail, not report
	// success. This is the specific silent-no-op the criterion exists to catch.
	const linked = share.cc + share.agents;
	const hasContent = plan.cc.length + plan.agents.length > 0;
	if (hasContent && linked === 0 && share.conflicts.length === 0) {
		throw new ProfileError(
			`provisioned "${name}" but linked none of the ${hasContent ? plan.cc.length + plan.agents.length : 0} available entries — refusing to report success for a bare profile`,
			EXIT.unresolved,
		);
	}

	// Held under the lock: a competing provision must not read the same snapshot and overwrite this
	// record. The existence check moves inside for the same reason.
	updateRegistry(root, reg => {
		if (reg.profiles[name]) {
			throw new ProfileError(`profile "${name}" already exists`, EXIT.unresolved);
		}
		return upsertProfile(reg, name, {
			path: home,
			owner: owner.trim(),
			created_at: new Date().toISOString(),
			last_used_at: null,
			adopted: false,
			revoked: null,
		});
	});
	return {name, home, owner: owner.trim(), share, plan};
}

/** The machine's real home, as the launching shell sees it. */
function machineHome() {
	return process.env.HOME ?? process.env.USERPROFILE ?? '';
}

/**
 * Record an existing home as a profile.
 *
 * Nothing is moved, copied, or rewritten (FR-013): the registry stores a path, and a profile is a
 * record of a directory rather than a container this tool owns. `dryRun` reports what would be
 * written and touches nothing, so an operator can look before adopting their only working setup.
 */
export function adopt({root, name, owner, path, dryRun = false}) {
	assertProfileName(name);
	if (typeof owner !== 'string' || owner.trim() === '') {
		throw new ProfileError('a profile needs an owner: pass --owner <text>', EXIT.unresolved);
	}
	const home = path;
	if (!existsSync(home)) {
		throw new ProfileError(`cannot adopt ${home}: the directory does not exist`, EXIT.unresolved);
	}

	const entry = {
		path: home,
		owner: owner.trim(),
		created_at: new Date().toISOString(),
		last_used_at: null,
		adopted: true,
		revoked: null,
	};
	const report = {name, home, owner: entry.owner, adopted: true, authenticated: isAuthenticated(home)};

	if (dryRun) {
		// A dry run must write nothing at all, including no lock directory.
		const current = readRegistry(root);
		if (current.profiles[name]) {
			throw new ProfileError(`profile "${name}" already exists`, EXIT.unresolved);
		}
		return {...report, dryRun: true, wouldWrite: upsertProfile(current, name, entry)};
	}

	updateRegistry(root, reg => {
		if (reg.profiles[name]) {
			throw new ProfileError(`profile "${name}" already exists`, EXIT.unresolved);
		}
		return upsertProfile(reg, name, entry);
	});
	return report;
}

/** Set or clear the machine default. A revoked or unknown profile cannot become the default. */
export function useDefault({root, name, clear = false}) {
	if (clear) {
		updateRegistry(root, reg => ({...reg, default: null}));
		return {default: null};
	}
	assertProfileName(name);
	updateRegistry(root, reg => {
		const entry = reg.profiles[name];
		if (!entry) throw new ProfileError(`profile "${name}" does not exist`, EXIT.unresolved);
		if (isRevoked(entry)) {
			throw new ProfileError(`profile "${name}" is revoked and cannot become the default`, EXIT.revoked);
		}
		return {...reg, default: name};
	});
	return {default: name};
}

/**
 * Revoke a profile.
 *
 * `access` deletes the credential and blocks launches while keeping every other file — the shape
 * an operator needs when someone leaves but the record must survive an audit. `history` removes
 * the directory and the registry record too. It refuses while the profile is the default, because
 * a machine whose default points at nothing is a machine where the next launch fails confusingly.
 */
export function revoke({root, name, mode, yes = false}) {
	assertProfileName(name);
	if (mode !== 'access' && mode !== 'history') {
		throw new ProfileError('say what to revoke: --access or --history', EXIT.unresolved);
	}

	// Read first so `changed` can be reported without mutating, then run the whole decision under
	// the lock: the default check, the emptiness check, the file deletion and the record update must
	// not interleave with another operator's revoke.
	const before = readRegistry(root).profiles[name];
	if (!before) throw new ProfileError(`profile "${name}" does not exist`, EXIT.unresolved);
	const alreadyRevoked = isRevoked(before);

	updateRegistry(root, reg => {
		const entry = reg.profiles[name];
		if (!entry) throw new ProfileError(`profile "${name}" does not exist`, EXIT.unresolved);

		if (mode === 'access') {
			if (isRevoked(entry)) return undefined; // already revoked; nothing to change
			// The vendor's path, not the profile root — deleting the wrong path made revocation a
			// silent no-op that still reported success. See bugs/credential-path-mismatch/.
			rmSync(credentialPath(entry.path), {force: true});
			const next = upsertProfile(reg, name, {...entry, revoked: 'access'});
			// A revoked profile cannot remain the default (registry validation enforces it).
			return next.default === name ? {...next, default: null} : next;
		}

		if (reg.default === name) {
			throw new ProfileError(
				`profile "${name}" is the default: run \`cmd-profiles use --clear\` first, so the next launch is not left pointing at nothing`,
				EXIT.unresolved,
			);
		}
		const empty = !existsSync(entry.path) || readdirSync(entry.path).length === 0;
		if (!empty && !yes) {
			throw new ProfileError(
				`refusing to delete ${entry.path}: it is not empty and holds this profile’s history. Re-run with --yes if that is intended`,
				EXIT.unresolved,
			);
		}
		rmSync(entry.path, {recursive: true, force: true});
		return removeProfile(reg, name);
	});

	return {
		name,
		revoked: mode,
		changed: mode === 'history' ? true : !alreadyRevoked,
	};
}

/** Every profile, with authentication derived per call rather than stored. */
export function list({root}) {
	const reg = readRegistry(root);
	return {
		default: reg.default,
		profiles: Object.entries(reg.profiles).map(([name, entry]) => ({
			name,
			label: name,
			owner: entry.owner ?? null,
			path: entry.path,
			authenticated: isAuthenticated(entry.path),
			revoked: entry.revoked ?? null,
			adopted: Boolean(entry.adopted),
			last_used_at: entry.last_used_at ?? null,
		})),
	};
}

/**
 * Record that a profile was just launched.
 *
 * Best-effort by design: a launch must not fail because the registry could not be updated, and a
 * stale `last_used_at` is a cosmetic defect rather than a blocked session. Returns whether the
 * write happened so a caller can report it.
 *
 * Under the lock, because `run` happens far more often than `provision` — a touch that read a stale
 * snapshot would silently undo a concurrent provision.
 */
export function touch({root, name}) {
	try {
		updateRegistry(root, reg => {
			const entry = reg.profiles[name];
			if (!entry) return undefined;
			return upsertProfile(reg, name, {...entry, last_used_at: new Date().toISOString()});
		});
		return Boolean(readRegistry(root).profiles[name]);
	} catch {
		return false;
	}
}
