#!/usr/bin/env node
// Changelog generator tests: the parser, the renderer, and one end-to-end run
// against a scratch repository with tags.
//
// Run: node test/changelog.mjs

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isBreaking, parseSubject, render, slugFromRemote} from '../scripts/changelog.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checks = [];
const check = (name, fn) => {
	fn();
	checks.push(name);
};

const commit = (subject, body = '') => {
	const parsed = parseSubject(subject);
	return {...parsed, sha: 'a'.repeat(40), body, breaking: parsed.breaking || isBreaking(body)};
};

check('parses conventional subjects, scopes and the breaking marker', () => {
	assert.deepEqual(parseSubject('feat(cli): rewrite the installer'), {
		type: 'feat',
		scope: 'cli',
		breaking: false,
		description: 'rewrite the installer',
	});
	assert.deepEqual(parseSubject('fix: never install bare').scope, null);
	assert.deepEqual(parseSubject('feat(api)!: drop v1').breaking, true);
	assert.deepEqual(parseSubject('deps(npm): bump clack').type, 'deps');
});

check('subjects that are not conventional commits fall through to Other', () => {
	assert.equal(parseSubject('Update the README').type, null);
	assert.equal(parseSubject('wip: something in progress').type, null);
	assert.equal(parseSubject('v0.1.3').description, 'v0.1.3');
});

check('a BREAKING CHANGE footer counts as breaking', () => {
	assert.equal(isBreaking('Some prose\n\nBREAKING CHANGE: the CLI moved'), true);
	assert.equal(isBreaking('BREAKING-CHANGE: also accepted'), true);
	assert.equal(isBreaking('nothing breaking here'), false);
	assert.equal(isBreaking(undefined), false);
	assert.equal(commit('fix: x', 'BREAKING CHANGE: y').breaking, true);
});

check('the repo slug is read from either remote form', () => {
	assert.equal(slugFromRemote('git@github.com:nntoan/proflow.git'), 'nntoan/proflow');
	assert.equal(slugFromRemote('https://github.com/nntoan/proflow.git'), 'nntoan/proflow');
	assert.equal(slugFromRemote('https://github.com/nntoan/proflow'), 'nntoan/proflow');
	assert.equal(slugFromRemote('git@gitlab.com:x/y.git'), null);
	assert.equal(slugFromRemote(''), null);
});

check('renders grouped sections, bold scopes, commit links and the compare footer', () => {
	const markdown = render(
		[
			commit('feat(cli): rewrite the installer'),
			commit('fix: never install bare'),
			commit('chore(assets): add the hero image'),
			commit('Update something by hand'),
		],
		{repo: 'nntoan/proflow', from: 'v0.1.2', to: 'v0.1.3'},
	);

	assert.match(markdown, /- \*\*cli:\*\* rewrite the installer \[`aaaaaaa`\]\(https:\/\/github\.com\/nntoan\/proflow\/commit\/a{40}\)/);
	assert.match(markdown, /## 🐛 Bug Fixes\n\n- never install bare/);
	assert.match(markdown, /## 🧹 Chores\n\n- \*\*assets:\*\* add the hero image/);
	assert.match(markdown, /## 📌 Other\n\n- Update something by hand/);
	assert.match(markdown, /\*\*Full changelog\*\*: \[`v0\.1\.2\.\.\.v0\.1\.3`\]\(https:\/\/github\.com\/nntoan\/proflow\/compare\/v0\.1\.2\.\.\.v0\.1\.3\)/);
	// Section order is fixed, not insertion order.
	assert.ok(markdown.indexOf('🚀 Features') < markdown.indexOf('🐛 Bug Fixes'));
	assert.ok(markdown.indexOf('🐛 Bug Fixes') < markdown.indexOf('🧹 Chores'));
	assert.ok(markdown.indexOf('🧹 Chores') < markdown.indexOf('📌 Other'));
});

check('breaking changes are called out first, and still listed under their type', () => {
	const markdown = render([commit('feat!: drop v1'), commit('feat: add v2')], {repo: 'a/b', from: 'v1', to: 'v2'});
	assert.match(markdown, /^## ⚠️ Breaking Changes\n\n- drop v1/);
	assert.ok(markdown.indexOf('⚠️ Breaking Changes') < markdown.indexOf('🚀 Features'));
	// The type section stays complete — a reader scanning "Features" must not
	// miss the feature that also happens to be breaking.
	assert.match(markdown, /## 🚀 Features\n\n- drop v1[\s\S]*- add v2/);
});

check('no commits renders a single line, and links degrade without a repo', () => {
	assert.equal(render([], {from: 'v1', to: 'v2'}), 'No changes.\n');
	const bare = render([commit('feat: x')], {from: 'v1', to: 'v2'});
	assert.match(bare, /- x `aaaaaaa`$/m);
	assert.doesNotMatch(bare, /github\.com\/undefined/);
	assert.match(bare, /\*\*Full changelog\*\*: `v1\.\.\.v2`/);
});

check('end to end: it finds the previous tag and groups the real commits', () => {
	const proj = mkdtempSync(join(tmpdir(), 'proflow-changelog-'));
	const run = (...args) =>
		execFileSync('git', args, {cwd: proj, encoding: 'utf8', env: {...process.env, GIT_EDITOR: 'true'}});
	run('init', '-q');
	run('config', 'user.email', 'test@example.com');
	run('config', 'user.name', 'test');
	run('config', 'commit.gpgsign', 'false');
	run('config', 'tag.gpgsign', 'false');

	const write = (file, text) => execFileSync('sh', ['-c', `printf '%s' '${text}' > ${file}`], {cwd: proj});
	write('f', 'one');
	run('add', '-A');
	run('commit', '-qm', 'feat: first');
	run('tag', '-a', 'v1.0.0', '-m', 'v1.0.0');

	write('f', 'two');
	run('add', '-A');
	run('commit', '-qm', 'fix(cli): second');
	write('f', 'three');
	run('add', '-A');
	run('commit', '-qm', 'test: third');
	run('tag', '-a', 'v1.1.0', '-m', 'v1.1.0');

	// previousTag() is exercised here rather than called directly: it shells out
	// to git, so it must run with this scratch repo as the working directory.
	const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'changelog.mjs'), '--to', 'v1.1.0'], {
		cwd: proj,
		encoding: 'utf8',
	});
	assert.match(out, /## 🐛 Bug Fixes\n\n- \*\*cli:\*\* second/);
	assert.match(out, /## ✅ Tests\n\n- third/);
	assert.doesNotMatch(out, /first/, 'the previous release must be excluded');
	assert.match(out, /v1\.0\.0\.\.\.v1\.1\.0/);

	// A first release has no previous tag: no compare footer, but the commits
	// up to that tag are still listed.
	const first = execFileSync(process.execPath, [join(ROOT, 'scripts', 'changelog.mjs'), '--to', 'v1.0.0'], {
		cwd: proj,
		encoding: 'utf8',
	});
	assert.match(first, /## 🚀 Features\n\n- first/);
	assert.doesNotMatch(first, /Full changelog/, 'a first release has nothing to compare against');
	rmSync(proj, {recursive: true, force: true});
});

console.log(`\n✓ proflow changelog test — ${checks.length} checks passed\n`);
for (const name of checks) console.log(`  ✓ ${name}`);
console.log('');
