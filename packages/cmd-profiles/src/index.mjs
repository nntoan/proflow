// The public surface. Deliberately re-exports rather than re-implements: the CLI, the tests, and
// any future consumer all go through the same functions.

export {EXIT, ProfileError, resolveProfile, selectName} from './resolve.mjs';
export {binaryFrom, buildEnv, launch} from './launch.mjs';
export {adopt, ISOLATION_NOTICE, list, provision, revoke, touch, useDefault} from './lifecycle.mjs';
export {diagnose} from './diagnose.mjs';
export {AGENTS_CORE_PATTERNS, CC_CORE_PATTERNS, applyShare, inspectShare, isWithheld, planShare, withheldPatterns} from './share.mjs';
export {orcaLaunchCommand} from './orca.mjs';
export {assertProfileName, defaultRoot, profileHome, profilesDir, registryPath} from './paths.mjs';
export {
	CC_STATE_DIR,
	ccStateDir,
	credentialPath,
	emptyRegistry,
	isAuthenticated,
	isRevoked,
	readRegistry,
	removeProfile,
	updateRegistry,
	upsertProfile,
	validateRegistry,
	writeRegistry,
	SCHEMA_VERSION,
} from './registry.mjs';
