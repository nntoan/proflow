// Resolution. The assertion that matters most here is negative: no path falls back to the real
// home. A silent fallback would run a person's session as whoever owns ~/.commandcode, so the
// absence of that fallback is asserted directly rather than assumed from the happy path.
//
// Run: node test/resolve.mjs

import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {EXIT, ProfileError, resolveProfile, selectName} from '../src/resolve.mjs';
import {emptyRegistry} from '../src/registry.mjs';

const checks = [];
const check = (name, fn) => {
	fn();
	checks.push(name);
};

const tmp = mkdtempSync(join(tmpdir(), 'cmd-profiles-resolve-'));
const root = join(tmp, 'root');

const reg = emptyRegistry();
reg.profiles.work = {path: join(tmp, 'home-work'), owner: 'ada', adopted: false, revoked: null};
reg.profiles.personal = {path: join(tmp, 'home-personal'), owner: 'ada', adopted: false, revoked: null};
reg.profiles.gone = {path: join(tmp, 'home-gone'), owner: 'bob', adopted: false, revoked: 'access'};
reg.default = 'work';

check('selectName applies flag, then env, then default', () => {
	assert.deepEqual(selectName({profile: 'personal', env: {CMD_PROFILES_PROFILE: 'work'}, reg}), {
		name: 'personal',
		source: 'flag',
	});
	assert.deepEqual(selectName({profile: undefined, env: {CMD_PROFILES_PROFILE: 'personal'}, reg}), {
		name: 'personal',
		source: 'env',
	});
	assert.deepEqual(selectName({profile: undefined, env: {}, reg}), {name: 'work', source: 'default'});
});

check('selectName invents no fallback when nothing supplies a name', () => {
	const bare = {...emptyRegistry()};
	assert.deepEqual(selectName({profile: undefined, env: {}, reg: bare}), {name: null, source: 'none'});
	// An empty string is an absent value, not a profile named "".
	assert.deepEqual(selectName({profile: '  ', env: {CMD_PROFILES_PROFILE: '  '}, reg: bare}), {
		name: null,
		source: 'none',
	});
});

check('the flag beats the environment beats the default, in resolution', () => {
	const viaFlag = resolveProfile({
		profile: 'personal',
		root,
		env: {CMD_PROFILES_PROFILE: 'work'},
		registry: reg,
	});
	assert.equal(viaFlag.name, 'personal');
	assert.equal(viaFlag.source, 'flag');

	const viaEnv = resolveProfile({root, env: {CMD_PROFILES_PROFILE: 'personal'}, registry: reg});
	assert.equal(viaEnv.name, 'personal');
	assert.equal(viaEnv.source, 'env');

	const viaDefault = resolveProfile({root, env: {}, registry: reg});
	assert.equal(viaDefault.name, 'work');
	assert.equal(viaDefault.source, 'default');
});

check('no selection is an error with its own exit code — never a fallback to ~/.commandcode', () => {
	const bare = {...emptyRegistry()};
	assert.throws(
		() => resolveProfile({root, env: {}, registry: bare}),
		error => {
			assert.ok(error instanceof ProfileError);
			assert.equal(error.exitCode, EXIT.unresolved);
			assert.match(error.message, /no profile selected/);
			// The failure must not name a home at all: naming one is how a fallback starts.
			assert.doesNotMatch(error.message, /\.commandcode/);
			return true;
		},
	);
});

check('an unknown profile names it and exits 2', () => {
	assert.throws(
		() => resolveProfile({profile: 'ghost', root, env: {}, registry: reg}),
		error => {
			assert.equal(error.exitCode, EXIT.unresolved);
			assert.match(error.message, /profile "ghost" \(from flag\) does not exist/);
			return true;
		},
	);
});

check('a revoked profile cannot be launched, whatever its credential state', () => {
	assert.throws(
		() => resolveProfile({profile: 'gone', root, env: {}, registry: reg}),
		error => {
			assert.equal(error.exitCode, EXIT.revoked);
			assert.match(error.message, /revoked \(access\)/);
			return true;
		},
	);
});

check('an unauthenticated profile resolves, and reports itself as such', () => {
	const resolved = resolveProfile({profile: 'work', root, env: {}, registry: reg});
	assert.equal(resolved.authenticated, false);
});

check('authentication is only enforced when the caller asks for it', () => {
	assert.throws(
		() => resolveProfile({profile: 'work', root, env: {}, registry: reg, requireAuthenticated: true}),
		error => {
			assert.equal(error.exitCode, EXIT.unauthenticated);
			assert.match(error.message, /not authenticated/);
			return true;
		},
	);
});

check('the resolved home is the profile home, and distinct per profile', () => {
	const a = resolveProfile({profile: 'work', root, env: {}, registry: reg});
	const b = resolveProfile({profile: 'personal', root, env: {}, registry: reg});
	assert.notEqual(a.home, b.home);
	assert.ok(a.home.endsWith('home-work'));
	assert.ok(b.home.endsWith('home-personal'));
});

check('US3/AC1 — a flagless launch from the environment reaches the right HOME, not just the right name', () => {
	// `selectName` is unit-tested above, but a name is not a directory. This asserts the whole chain:
	// no `--profile`, a `CMD_PROFILES_PROFILE`, and the resolved *home* lands on that profile.
	const viaEnv = resolveProfile({root, env: {CMD_PROFILES_PROFILE: 'personal'}, registry: reg});
	assert.equal(viaEnv.name, 'personal');
	assert.equal(
		viaEnv.home,
		join(tmp, 'home-personal'),
		'a flagless launch must reach the profile directory, not merely select its name',
	);
	assert.notEqual(viaEnv.home, join(tmp, 'home-work'));
});

check('US3/AC1 — a flagless launch falls back to the machine default and reaches its HOME', () => {
	const viaDefault = resolveProfile({root, env: {}, registry: reg});
	assert.equal(viaDefault.source, 'default');
	assert.equal(viaDefault.home, join(tmp, 'home-work'), 'the default profile is work, so its home must be used');
});

check('US3/AC3 — an explicit flag beats the environment AND the default, and says so', () => {
	// All three sources disagree; the flag must win and the reported source must make that visible, so
	// an operator looking at a session knows why it is running where it is.
	const resolved = resolveProfile({
		profile: 'personal',
		root,
		env: {CMD_PROFILES_PROFILE: 'work'},
		registry: {...reg, default: 'work'},
	});
	assert.equal(resolved.name, 'personal');
	assert.equal(resolved.source, 'flag', 'the source must be reported, not inferred by the caller');
	assert.equal(resolved.home, join(tmp, 'home-personal'));
});

console.log(`\n✓ cmd-profiles resolve — ${checks.length} checks passed\n`);
for (const name of checks) console.log(`  ✓ ${name}`);
console.log('');
