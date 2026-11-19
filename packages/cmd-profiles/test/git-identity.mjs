// Version-control identity through a profile — ADR 0003, FR-015.
//
// The assertion that matters is the AUTHOR OF A REAL COMMIT, not the presence of
// GIT_CONFIG_GLOBAL. A presence check passes for the broken case: git does not refuse to commit
// without an identity, it silently authors the commit as user@hostname. So the tests here set up a
// throwaway repo, commit through the launcher's environment, and read the commit back.
//
// Run: node test/git-identity.mjs

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildEnv, gitConfigGlobal} from '../src/launch.mjs';

const checks = [];
const check = (name, fn) => {
	fn();
	checks.push(name);
};

const tmp = mkdtempSync(join(tmpdir(), 'cmd-profiles-git-'));

/** A repo with one staged file, ready to commit. */
function stagedRepo(label) {
	const repo = join(tmp, `repo-${label}`);
	mkdirSync(repo, {recursive: true});
	execFileSync('git', ['init', '-q', '.'], {cwd: repo});
	writeFileSync(join(repo, 'f.txt'), label);
	execFileSync('git', ['add', 'f.txt'], {cwd: repo});
	return repo;
}

/** Run a git command under an environment, returning trimmed stdout. */
function git(args, {cwd, env}) {
	return execFileSync('git', args, {cwd, env, encoding: 'utf8'}).trim();
}

/** A machine home that actually has an identity, like a developer's. */
function machineHome(label) {
	const home = join(tmp, `machine-${label}`);
	mkdirSync(home, {recursive: true});
	writeFileSync(
		join(home, '.gitconfig'),
		'[user]\n\tname = Machine User\n\temail = machine@example.com\n',
	);
	return home;
}

check('gitConfigGlobal points at the launching shell home, not the profile', () => {
	const machine = machineHome('a');
	assert.equal(gitConfigGlobal({HOME: machine}), join(machine, '.gitconfig'));
});

check('gitConfigGlobal preserves an explicit value the caller already set', () => {
	assert.equal(
		gitConfigGlobal({HOME: '/some/home', GIT_CONFIG_GLOBAL: '/custom/gitconfig'}),
		'/custom/gitconfig',
	);
});

check('gitConfigGlobal returns undefined when there is no home to derive from', () => {
	assert.equal(gitConfigGlobal({}), undefined);
});

check('buildEnv carries GIT_CONFIG_GLOBAL derived from the base env, not the profile', () => {
	const machine = machineHome('b');
	const env = buildEnv({home: '/profile/home', name: 'work', baseEnv: {HOME: machine}});
	assert.equal(env.HOME, '/profile/home', 'the profile home still wins for HOME');
	assert.equal(
		env.GIT_CONFIG_GLOBAL,
		join(machine, '.gitconfig'),
		'GIT_CONFIG_GLOBAL must come from the machine home, never /profile/home',
	);
	assert.notEqual(env.GIT_CONFIG_GLOBAL, join('/profile/home', '.gitconfig'));
});

check('THE REGRESSION — a commit through a profile is authored by the machine identity', () => {
	const machine = machineHome('c');
	const profile = join(tmp, 'profile-c');
	mkdirSync(profile, {recursive: true});
	const repo = stagedRepo('c');

	const env = buildEnv({home: profile, name: 'work', baseEnv: {HOME: machine, PATH: process.env.PATH}});
	git(['commit', '-qm', 'test'], {cwd: repo, env});

	const author = git(['log', '-1', '--format=%an <%ae>'], {cwd: repo, env});
	assert.equal(author, 'Machine User <machine@example.com>');

	// The specific failure ADR 0003 exists to prevent.
	const hostname = execFileSync('hostname', {encoding: 'utf8'}).trim();
	const user = process.env.USER ?? process.env.USERNAME ?? '';
	assert.doesNotMatch(author, new RegExp(`@${hostname.replace(/\./g, '\\.')}`));
	if (user) assert.doesNotMatch(author, new RegExp(`^${user} `), 'must not fall back to user@hostname');
});

check('CONTROL — without GIT_CONFIG_GLOBAL the same commit IS mis-attributed', () => {
	// This asserts the bug is real and that the previous check is not passing vacuously. If git
	// ever stops falling back to user@hostname, this control fails and the test above should be
	// re-examined rather than trusted.
	const machine = machineHome('d');
	const profile = join(tmp, 'profile-d');
	mkdirSync(profile, {recursive: true});
	const repo = stagedRepo('d');

	const brokenEnv = {
		...process.env,
		HOME: profile,
		USERPROFILE: profile,
	};
	delete brokenEnv.GIT_CONFIG_GLOBAL;

	git(['commit', '-qm', 'test'], {cwd: repo, env: brokenEnv});
	const author = git(['log', '-1', '--format=%ae'], {cwd: repo, env: brokenEnv});

	assert.notEqual(
		author,
		'machine@example.com',
		'without the variable the machine identity must be lost — if this changes, re-check the fix',
	);
});

check('includeIf routing still applies through a profile', () => {
	const machine = join(tmp, 'machine-routing');
	mkdirSync(machine, {recursive: true});
	// `hasconfig:remote.*.url` is the form this project's own machine uses, and unlike `gitdir:` it
	// does not break on the /var -> /private/var symlink macOS resolves temp paths through.
	writeFileSync(
		join(machine, '.gitconfig'),
		'[user]\n\tname = Fallback\n\temail = fallback@example.com\n' +
			'[includeIf "hasconfig:remote.*.url:git@github.com:acme/**"]\n' +
			`\tpath = ${join(machine, 'work.gitconfig')}\n`,
	);
	writeFileSync(
		join(machine, 'work.gitconfig'),
		'[user]\n\tname = Work User\n\temail = work@example.com\n',
	);

	const profile = join(tmp, 'profile-routing');
	mkdirSync(profile, {recursive: true});
	const repo = stagedRepo('routed');
	execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/thing.git'], {cwd: repo});

	const env = buildEnv({home: profile, name: 'work', baseEnv: {HOME: machine, PATH: process.env.PATH}});
	git(['commit', '-qm', 'test'], {cwd: repo, env});

	assert.equal(
		git(['log', '-1', '--format=%an <%ae>'], {cwd: repo, env}),
		'Work User <work@example.com>',
		'includeIf routing must survive: the whole point is per-repository identity, not one identity',
	);
});

console.log(`\n✓ cmd-profiles git identity — ${checks.length} checks passed\n`);
for (const name of checks) console.log(`  ✓ ${name}`);
console.log('');
