// Launching Command Code under a profile.
//
// The isolation mechanism is the home directory: HOME (and USERPROFILE, so a future Windows port
// inherits the same contract) point the binary at a different home. Everything else — PATH,
// SSH_AUTH_SOCK, TERM — is inherited untouched, because a profile must still find the same git,
// node and commandcode binaries it found before.
//
// One inherited thing cannot be left alone: version-control identity. See ADR 0003.

import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {EXIT, ProfileError} from './resolve.mjs';

/**
 * The machine's version-control configuration, as the launching shell sees it.
 *
 * A profile home has no `.gitconfig`, so the machine's `includeIf` authorship routing — which lives
 * inside that file — is absent there. Git does not complain about the absence: it falls back to
 * `user@hostname`, so every commit made through this launcher would be silently mis-attributed.
 * Verified: a commit under a profile home exits 0 and is authored as `user@hostname`.
 *
 * The value must therefore come from the *launching* environment, never from the profile. An
 * explicit `GIT_CONFIG_GLOBAL` the caller already set is preserved: they have said where their
 * configuration is, and overriding it would be the same class of mistake.
 *
 * A path that does not exist is harmless — git treats a missing global config as empty — so this
 * stays unconditional rather than probing the filesystem on every launch.
 */
export function gitConfigGlobal(baseEnv = process.env) {
	if (baseEnv.GIT_CONFIG_GLOBAL && baseEnv.GIT_CONFIG_GLOBAL.trim() !== '') return baseEnv.GIT_CONFIG_GLOBAL;
	const home = baseEnv.HOME;
	if (typeof home !== 'string' || home.trim() === '') return undefined;
	return join(home, '.gitconfig');
}

/**
 * The environment a launch runs with.
 *
 * Exported so a test can assert the contract without starting a process.
 */
export function buildEnv({home, name, baseEnv = process.env}) {
	const env = {
		...baseEnv,
		HOME: home,
		USERPROFILE: home,
		CMD_PROFILES_PROFILE: name,
		// Per-profile update control (spec FR-016): provisioning one person must not silently
		// change the Command Code version another person runs.
		COMMANDCODE_SKIP_UPDATES: '1',
	};

	// Resolved from `baseEnv`, before HOME is replaced, because that is where the machine's
	// configuration lives. FR-015 and ADR 0003.
	const gitConfig = gitConfigGlobal(baseEnv);
	if (gitConfig) env.GIT_CONFIG_GLOBAL = gitConfig;

	return env;
}

/** Where the binary comes from: an explicit override, else `commandcode` on PATH. */
export function binaryFrom(env = process.env) {
	return env.CMD_PROFILES_BIN && env.CMD_PROFILES_BIN.trim() !== '' ? env.CMD_PROFILES_BIN : 'commandcode';
}

/**
 * Run the binary under a profile, inheriting stdio, and return its exit code.
 *
 * `spawnSync` with `stdio: 'inherit'` rather than `exec`: the agent needs the terminal, and its
 * exit code is the outcome the caller reports.
 */
export function launch({home, name, args = [], baseEnv = process.env}) {
	const binary = binaryFrom(baseEnv);
	const result = spawnSync(binary, args, {
		env: buildEnv({home, name, baseEnv}),
		stdio: 'inherit',
	});

	if (result.error) {
		if (result.error.code === 'ENOENT') {
			throw new ProfileError(
				`could not find the Command Code binary "${binary}": install it, or set CMD_PROFILES_BIN to its path`,
				EXIT.binaryMissing,
			);
		}
		throw new ProfileError(`could not start "${binary}": ${result.error.message}`, EXIT.binaryMissing);
	}

	// A signal-terminated child has a null status; report it as 1 rather than as success.
	if (result.status === null) return 1;
	return result.status;
}
