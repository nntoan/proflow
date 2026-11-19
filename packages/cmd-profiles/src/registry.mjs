// The profile registry: one small JSON file per machine that records what profiles exist.
//
// Deliberately stores as little as possible about a profile. Anything stored here can disagree
// with the directory, and a registry that disagrees with reality is worse than one that is
// sparse: authentication in particular is derived on every read, never cached, because a cached
// boolean is how a revoked profile gets reported healthy.

import {existsSync, mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve, sep} from 'node:path';
import {isAbsolutePath, registryPath} from './paths.mjs';

export const SCHEMA_VERSION = 1;

/** A registry with nothing in it. */
export function emptyRegistry() {
	return {schema_version: SCHEMA_VERSION, default: null, profiles: {}};
}

/**
 * The directory Command Code keeps all of its state in, inside a home directory.
 *
 * A vendor constant, not a choice of ours: the shipped binary composes `$HOME + "/.commandcode"`
 * for the credential, settings, sessions and mods. A profile home is a *home*, so everything
 * Command Code writes lands one level below it — never at the profile root.
 *
 * This was the site of a bug worth remembering: the launcher pointed `HOME` at a profile directory
 * correctly, then looked for the credential at `<profile>/auth.json` instead of
 * `<profile>/.commandcode/auth.json`. The nesting is easy to miss because the real home *is* named
 * `.commandcode`; setting `HOME` swaps the container, not that name. See
 * `.specify/bugs/credential-path-mismatch/`.
 */
export const CC_STATE_DIR = '.commandcode';

/** The credential file for a profile home. */
export function credentialPath(home) {
	return join(home, CC_STATE_DIR, 'auth.json');
}

/** The profile's Command Code state directory. */
export function ccStateDir(home) {
	return join(home, CC_STATE_DIR);
}

/**
 * Is this profile authenticated?
 *
 * The only signal used is the presence of `auth.json` in the profile's state directory, because that
 * is the file the binary itself acts on. Derived per call, never stored.
 */
export function isAuthenticated(home) {
	return typeof home === 'string' && existsSync(credentialPath(home));
}

/** A revoked profile may not be launched. `history` is terminal — the record is gone. */
export function isRevoked(entry) {
	return entry?.revoked === 'access' || entry?.revoked === 'history';
}

function fail(message) {
	throw new Error(`invalid registry: ${message}`);
}

/**
 * Validate a registry, throwing on the first problem.
 *
 * Refusing is the point. A repaired registry is a registry whose contents nobody chose, and on a
 * shared host that means a profile quietly pointing somewhere the operator never approved.
 */
export function validateRegistry(reg) {
	if (reg === null || typeof reg !== 'object' || Array.isArray(reg)) {
		fail('the root must be a JSON object');
	}
	if (reg.schema_version !== SCHEMA_VERSION) {
		fail(`schema_version must be ${SCHEMA_VERSION}, got ${JSON.stringify(reg.schema_version)}`);
	}
	if (reg.default !== null && reg.default !== undefined && typeof reg.default !== 'string') {
		fail('default must be null or a profile name');
	}
	const profiles = reg.profiles;
	if (profiles === null || typeof profiles !== 'object' || Array.isArray(profiles)) {
		fail('profiles must be an object');
	}

	const seenPaths = new Map();
	for (const [name, entry] of Object.entries(profiles)) {
		if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
			fail(`profile "${name}" must be an object`);
		}
		if (!isAbsolutePath(entry.path)) {
			fail(`profile "${name}" has a non-absolute path: ${JSON.stringify(entry.path)}`);
		}
		const path = resolve(entry.path);
		if (seenPaths.has(path)) {
			fail(`profiles "${seenPaths.get(path)}" and "${name}" share the path ${path}`);
		}
		seenPaths.set(path, name);
		if (entry.revoked !== null && entry.revoked !== undefined && entry.revoked !== 'access') {
			fail(`profile "${name}" has an unknown revoked state: ${JSON.stringify(entry.revoked)}`);
		}
	}

	// Nesting is refused because two profiles whose homes overlap would share state, which is
	// the one thing a profile exists to prevent.
	for (const [name, entry] of Object.entries(profiles)) {
		const outer = resolve(entry.path);
		for (const [other, otherEntry] of Object.entries(profiles)) {
			if (name === other) continue;
			const inner = resolve(otherEntry.path);
			if (inner.startsWith(outer + sep)) {
				fail(`profile "${other}" is nested inside profile "${name}" (${inner})`);
			}
		}
	}

	if (reg.default !== null && reg.default !== undefined) {
		if (!Object.hasOwn(profiles, reg.default)) {
			fail(`default "${reg.default}" is not a known profile`);
		}
		if (isRevoked(profiles[reg.default])) {
			fail(`default "${reg.default}" is revoked`);
		}
	}
	return reg;
}

/** Read and validate the registry for a root. A missing file yields an empty registry. */
export function readRegistry(root) {
	const path = registryPath(root);
	let text;
	try {
		text = readFileSync(path, 'utf8');
	} catch (error) {
		if (error.code === 'ENOENT') return emptyRegistry();
		throw error;
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new Error(`registry at ${path} is not valid JSON: ${error.message}`);
	}
	return validateRegistry(parsed);
}

/** Write the registry, validating first, and atomically so a crash cannot truncate it. */
export function writeRegistry(root, reg) {
	validateRegistry(reg);
	const path = registryPath(root);
	mkdirSync(dirname(path), {recursive: true});
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(reg, null, 2)}\n`, {mode: 0o600});
	renameSync(tmp, path);
	return reg;
}

/**
 * Run `fn` with exclusive access to the registry.
 *
 * An atomic rename stops a *torn* file but not a *lost update*: two processes can both read N
 * profiles, both write N+1, and one write disappears. That is not theoretical — eight simultaneous
 * `provision` calls reported success and six records survived, because six readers shared one
 * stale snapshot.
 *
 * The lock is a directory (`mkdir` is atomic on every filesystem this runs on), which is the
 * simplest primitive that needs no dependency and no daemon. A holder that dies leaves the lock
 * behind, so acquisition treats a lock older than `STALE_MS` as abandoned and takes it over —
 * otherwise one crashed launch would wedge provisioning forever.
 */
const STALE_MS = 10_000;
const LOCK_POLL_MS = 15;
const LOCK_TIMEOUT_MS = 15_000;

export function withRegistryLock(root, fn) {
	const lock = `${registryPath(root)}.lock`;
	mkdirSync(dirname(lock), {recursive: true});
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	let held = false;

	while (!held) {
		try {
			mkdirSync(lock);
			held = true;
			break;
		} catch (error) {
			if (error.code !== 'EEXIST') throw error;
			// An abandoned lock must not wedge the tool permanently.
			try {
				const {mtimeMs} = statSync(lock);
				if (Date.now() - mtimeMs > STALE_MS) {
					rmdirSync(lock);
					continue;
				}
			} catch {
				continue; // the holder released between our failed mkdir and the stat
			}
			if (Date.now() > deadline) {
				throw new Error(
					`the profile registry is locked by another process (${lock}); if no other cmd-profiles is running, remove that directory`,
				);
			}
			sleepSync(LOCK_POLL_MS);
		}
	}

	try {
		return fn();
	} finally {
		if (held) rmSync(lock, {recursive: true, force: true});
	}
}

/** A short blocking sleep — this is a CLI, and every caller of the lock is synchronous. */
function sleepSync(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Read, modify, write — under the lock, so the modification cannot be lost.
 *
 * Every mutation of the registry must go through this rather than its three steps separately.
 */
export function updateRegistry(root, mutate) {
	return withRegistryLock(root, () => {
		const current = readRegistry(root);
		const next = mutate(current);
		if (next === undefined) return current;
		return writeRegistry(root, next);
	});
}

/** Add or replace one profile record. */
export function upsertProfile(reg, name, entry) {
	return {...reg, profiles: {...reg.profiles, [name]: entry}};
}

/** Remove one profile record, clearing the default if it pointed at it. */
export function removeProfile(reg, name) {
	const profiles = {...reg.profiles};
	delete profiles[name];
	return {...reg, profiles, default: reg.default === name ? null : reg.default};
}
