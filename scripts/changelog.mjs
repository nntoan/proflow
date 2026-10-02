#!/usr/bin/env node
// Build a release changelog from the conventional commits between two refs, so
// the GitHub release reads like a release-please one and every line traces back
// to an atomic commit.
//
//   node scripts/changelog.mjs --to v0.1.3 [--from v0.1.2] [--repo owner/name]
//                             [--output RELEASE_NOTES.md]
//
// With no `--from`, the previous `v*` tag reachable from `--to` is used (the
// tag being released is excluded), falling back to the root commit. The repo
// slug comes from `origin` unless `--repo` is given; without it, entries carry
// no commit links.

import {execFileSync} from 'node:child_process';
import {realpathSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

/** Section order and titles. `chore`/`docs`/`test` are kept: this history is
 *  built from atomic commits, and hiding them would leave the notes empty. */
export const SECTIONS = [
	{type: 'feat', title: '🚀 Features'},
	{type: 'fix', title: '🐛 Bug Fixes'},
	{type: 'perf', title: '⚡ Performance'},
	{type: 'refactor', title: '♻️ Refactoring'},
	{type: 'docs', title: '📚 Documentation'},
	{type: 'test', title: '✅ Tests'},
	{type: 'build', title: '📦 Build'},
	{type: 'ci', title: '🤖 CI'},
	{type: 'deps', title: '⬆️ Dependencies'},
	{type: 'revert', title: '⏪ Reverts'},
	{type: 'style', title: '💄 Style'},
	{type: 'chore', title: '🧹 Chores'},
];

export const OTHER_SECTION = '📌 Other';

const KNOWN = new Set(SECTIONS.map(section => section.type));

/** `feat(cli)!: drop the legacy flag` → its parts. Non-conventional subjects pass through. */
export function parseSubject(subject) {
	const match = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(subject);
	if (!match || !KNOWN.has(match[1])) {
		return {type: null, scope: null, breaking: false, description: subject};
	}
	return {
		type: match[1],
		scope: match[2] ?? null,
		breaking: Boolean(match[3]),
		description: match[4],
	};
}

/** A `BREAKING CHANGE:` footer counts as breaking too. */
export function isBreaking(body) {
	return /^BREAKING[ -]CHANGE:/m.test(body ?? '');
}

/** `owner/name` from a remote URL, in either the ssh or https form. */
export function slugFromRemote(url) {
	const match = /(?:github\.com[:/])([^/]+)\/(.+?)(?:\.git)?$/.exec((url ?? '').trim());
	return match ? `${match[1]}/${match[2]}` : null;
}

function git(args) {
	// stderr is captured, not inherited: a missing `origin` (or an unknown ref)
	// must not spray git's error text into the release notes or the CI log.
	return execFileSync('git', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
}

/** The most recent `v*` tag reachable from `to`, excluding `to` itself. */
export function previousTag(to) {
	try {
		return git(['describe', '--tags', '--abbrev=0', '--match', 'v*', `${to}^`]);
	} catch {
		return null;
	}
}

/** Commits in `from..to`, newest first, merges skipped. With `from = null` the
 *  whole history up to `to` is used — a first release has no earlier boundary,
 *  and `root..to` would wrongly exclude the root commit itself. */
export function readCommits(from, to) {
	const format = '%H%x1f%s%x1f%b%x1e';
	const range = from ? `${from}..${to}` : to;
	const raw = git(['log', '--no-merges', `--pretty=format:${format}`, range]);
	return raw
		.split('\x1e')
		.map(chunk => chunk.replace(/^\n+/, ''))
		.filter(Boolean)
		.map(chunk => {
			const [sha, subject, body] = chunk.split('\x1f');
			const parsed = parseSubject(subject ?? '');
			return {...parsed, sha, body: body ?? '', breaking: parsed.breaking || isBreaking(body)};
		});
}

/** The markdown body for a release. */
export function render(commits, {repo = null, from = null, to = null} = {}) {
	if (commits.length === 0) return 'No changes.\n';

	const link = sha => (repo ? `[\`${sha.slice(0, 7)}\`](https://github.com/${repo}/commit/${sha})` : `\`${sha.slice(0, 7)}\``);
	const entry = commit => {
		const scope = commit.scope ? `**${commit.scope}:** ` : '';
		return `- ${scope}${commit.description} ${link(commit.sha)}`;
	};

	const lines = [];
	const breaking = commits.filter(commit => commit.breaking);
	if (breaking.length > 0) {
		lines.push('## ⚠️ Breaking Changes', '', ...breaking.map(entry), '');
	}

	for (const section of [...SECTIONS, {type: null, title: OTHER_SECTION}]) {
		const group = commits.filter(commit => commit.type === section.type);
		if (group.length === 0) continue;
		lines.push(`## ${section.title}`, '', ...group.map(entry), '');
	}

	if (repo && from && to) {
		lines.push(`**Full changelog**: [\`${from}...${to}\`](https://github.com/${repo}/compare/${from}...${to})`);
	} else if (from && to) {
		lines.push(`**Full changelog**: \`${from}...${to}\``);
	}
	return `${lines.join('\n').trimEnd()}\n`;
}

function usage() {
	console.log(`Build a release changelog from the conventional commits between two refs.

  node scripts/changelog.mjs --to <ref> [--from <ref>] [--repo owner/name] [--output <file>]
                             [--repo-from-remote] [--help]`);
}

function main(argv) {
	const opts = {};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--help' || arg === '-h') return usage();
		if (arg === '--from') opts.from = argv[++i];
		else if (arg === '--to') opts.to = argv[++i];
		else if (arg === '--repo') opts.repo = argv[++i];
		else if (arg === '--output') opts.output = argv[++i];
		else {
			console.error(`unknown option: ${arg}`);
			process.exitCode = 1;
			return;
		}
	}

	const to = opts.to ?? 'HEAD';
	// `git describe` excludes the release tag itself, so `--to v0.1.2` resolves to
	// `v0.1.1`. A first release has no previous tag: `anchor` stays null and the
	// notes cover everything up to `to`. An explicit `--from` equal to `--to`
	// would be an empty range, so it re-detects instead.
	let anchor = opts.from ?? previousTag(to) ?? null;
	if (anchor === to) anchor = previousTag(to) ?? null;

	let repo = opts.repo ?? null;
	if (!repo) {
		try {
			repo = slugFromRemote(git(['remote', 'get-url', 'origin']));
		} catch {
			repo = null;
		}
	}

	const commits = readCommits(anchor, to);
	// A first release has no previous tag: there is nothing to compare against,
	// so the footer is dropped rather than pointing at a bare commit sha.
	const markdown = render(commits, {repo, from: anchor, to});
	if (opts.output) {
		writeFileSync(opts.output, markdown);
		console.log(`wrote ${opts.output} — ${commits.length} commit(s), ${anchor ? `${anchor}..${to}` : `everything up to ${to}`}`);
	} else {
		process.stdout.write(markdown);
	}
}

/** True when this file is the process entry point. The paths are *resolved* first:
 *  an invocation through a symlink (a bin shim) would otherwise exit silently. */
function invokedDirectly() {
	if (!process.argv[1]) return false;
	try {
		return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
}

if (invokedDirectly()) main(process.argv.slice(2));
