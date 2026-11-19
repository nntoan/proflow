// Where profiles live on this machine, and what a profile may be called.
//
// A profile is a directory that Command Code treats as its home. The registry records them;
// this module owns the layout and the name rules, so both the writer and the reader agree.

import {homedir} from 'node:os';
import {isAbsolute, join, resolve, sep} from 'node:path';

/** Windows device names that are not portable as directory names. */
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/** A profile name: lowercase, starts with a letter, 1–32 characters. */
const NAME_SHAPE = /^[a-z][a-z0-9._-]{0,31}$/;

/**
 * Validate a profile name, returning it unchanged.
 *
 * The rules are deliberately narrow: a name becomes a directory under the profiles root, is
 * printed into an operator's Orca command string, and is compared case-insensitively on macOS.
 * Anything that could escape the root, collide on a case-insensitive filesystem, or be a
 * reserved device name is refused rather than sanitized — a sanitized name is a name the user
 * did not choose.
 */
export function assertProfileName(name) {
	if (typeof name !== 'string' || name.length === 0) {
		throw new Error('a profile name is required');
	}
	if (name.length > 32) {
		throw new Error(`profile name "${name}" is longer than 32 characters`);
	}
	if (!NAME_SHAPE.test(name)) {
		throw new Error(
			`invalid profile name "${name}": use lowercase letters, digits, dots, underscores or hyphens, starting with a letter`,
		);
	}
	if (name.endsWith('.')) {
		throw new Error(`invalid profile name "${name}": must not end with a dot`);
	}
	if (DEVICE_NAME.test(name)) {
		throw new Error(`invalid profile name "${name}": it is a reserved device name`);
	}
	return name;
}

/** The machine-wide profiles root. `CMD_PROFILES_ROOT` wins so tests never touch a real home. */
export function defaultRoot() {
	const override = process.env.CMD_PROFILES_ROOT;
	if (override && override.trim() !== '') return resolve(override);
	return join(homedir(), '.cmd-profiles');
}

/** The registry file for a root. */
export function registryPath(root) {
	return join(root, 'registry.json');
}

/** The directory that holds every profile for a root. */
export function profilesDir(root) {
	return join(root, 'profiles');
}

/**
 * The home directory of one profile.
 *
 * The name is validated first, then the result is checked to be inside the profiles root. The
 * second check is redundant against today's rules and stays anyway: this path is the whole
 * isolation boundary, and a future relaxation of `assertProfileName` must not silently become a
 * traversal.
 */
export function profileHome(root, name) {
	assertProfileName(name);
	const base = resolve(profilesDir(root));
	const home = resolve(join(base, name));
	if (home !== base && !home.startsWith(base + sep)) {
		throw new Error(`profile "${name}" escapes the profiles root`);
	}
	return home;
}

/** True when `path` is absolute; used by registry validation. */
export function isAbsolutePath(path) {
	return typeof path === 'string' && isAbsolute(path);
}
