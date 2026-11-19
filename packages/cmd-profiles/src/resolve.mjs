// Resolving which profile a session runs under.
//
// The chain is exactly four steps and there is deliberately no fifth. Falling back to the real
// ~/.commandcode when nothing resolves would run a person's session as whoever owns that home,
// which on a shared host is the single worst outcome this feature could have. So "nothing
// resolved" is an error with its own exit code, not a default.

import {isAuthenticated, isRevoked, readRegistry} from './registry.mjs';
import {profileHome} from './paths.mjs';

/** A failure that carries the exit code the CLI must use, per contracts/cli.md. */
export class ProfileError extends Error {
	constructor(message, exitCode) {
		super(message);
		this.name = 'ProfileError';
		this.exitCode = exitCode;
	}
}

export const EXIT = {
	unresolved: 2,
	revoked: 3,
	unauthenticated: 4,
	binaryMissing: 5,
};

/**
 * Which profile name applies, without touching the filesystem.
 *
 * `--profile` beats the environment, which beats the registry default. Returns `null` when no
 * source supplied one — the caller turns that into a failure, so this function never invents a
 * fallback of its own.
 */
export function selectName({profile, env, reg}) {
	const flag = typeof profile === 'string' && profile.trim() !== '' ? profile : null;
	if (flag) return {name: flag, source: 'flag'};

	const fromEnv = env?.CMD_PROFILES_PROFILE;
	if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return {name: fromEnv, source: 'env'};

	if (typeof reg?.default === 'string') return {name: reg.default, source: 'default'};

	return {name: null, source: 'none'};
}

/**
 * Resolve a profile to `{name, home, source, authenticated}`, or throw a `ProfileError`.
 *
 * Order: unknown profile, then revoked. Authentication is reported but only enforced when
 * `requireAuthenticated` is set, because `run` is how a person *reaches* their profile to
 * authenticate in the first place — refusing to launch an unauthenticated profile would make the
 * first login impossible. `provision` and `run` therefore tolerate it and say so; commands that
 * report on a profile (`diagnose`) surface it as a finding rather than a failure.
 */
export function resolveProfile({
	profile,
	root,
	env = process.env,
	registry,
	requireAuthenticated = false,
} = {}) {
	const reg = registry ?? readRegistry(root);
	const {name, source} = selectName({profile, env, reg});

	if (name === null) {
		throw new ProfileError(
			'no profile selected: pass --profile <name>, set CMD_PROFILES_PROFILE, or run `cmd-profiles use <name>`',
			EXIT.unresolved,
		);
	}

	const entry = reg.profiles?.[name];
	if (!entry) {
		throw new ProfileError(`profile "${name}" (from ${source}) does not exist`, EXIT.unresolved);
	}

	if (isRevoked(entry)) {
		throw new ProfileError(
			`profile "${name}" has been revoked (${entry.revoked}); it cannot be launched`,
			EXIT.revoked,
		);
	}

	const home = entry.path ?? profileHome(root, name);
	const authenticated = isAuthenticated(home);

	if (!authenticated && requireAuthenticated) {
		throw new ProfileError(
			`profile "${name}" is not authenticated: it has no credential yet`,
			EXIT.unauthenticated,
		);
	}

	return {name, home, source, authenticated};
}
