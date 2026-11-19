#!/usr/bin/env node
// The cmd-profiles command line. A thin dispatcher: every verb is implemented in the modules
// beside this file, so the CLI adds argument parsing and exit codes and nothing else.

import {defaultRoot} from './paths.mjs';
import {EXIT, ProfileError, resolveProfile} from './resolve.mjs';
import {launch} from './launch.mjs';
import {adopt, ISOLATION_NOTICE, list, provision, revoke, touch, useDefault} from './lifecycle.mjs';
import {inspectShare} from './share.mjs';
import {diagnose} from './diagnose.mjs';

function machineHome() {
	return process.env.HOME ?? process.env.USERPROFILE ?? '';
}

const USAGE = `cmd-profiles — run Command Code as more than one identity on one machine

Usage
  cmd-profiles run [--profile <name>] [--root <dir>] [--require-auth] [-- args...]
  cmd-profiles provision --name <name> --owner <text> [--root <dir>] [--json]
  cmd-profiles adopt --name <name> --owner <text> [--path <dir>] [--dry-run] [--root <dir>] [--json]
  cmd-profiles list [--root <dir>] [--json]
  cmd-profiles use <name> | --clear [--root <dir>]
  cmd-profiles revoke <name> --access|--history [--yes] [--root <dir>]
  cmd-profiles diagnose [--profile <name>] [--root <dir>] [--json]
  cmd-profiles --help

Exit codes
  0  success
  2  no profile resolved, or the named profile does not exist
  3  the profile is revoked
  4  the profile is not authenticated (only with run --require-auth, for unattended launches)
  5  the Command Code binary could not be found
`;

function parseArgs(argv) {
	const flags = {};
	const rest = [];
	let passthrough = null;

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (passthrough !== null) {
			passthrough.push(arg);
			continue;
		}
		if (arg === '--') {
			passthrough = [];
			continue;
		}
		if (arg.startsWith('--')) {
			const [key, inline] = arg.slice(2).split('=');
			const takesValue = ['profile', 'root', 'name', 'owner', 'path'].includes(key);
			if (takesValue && inline === undefined) {
				flags[key] = argv[(i += 1)];
			} else if (takesValue) {
				flags[key] = inline;
			} else {
				flags[key] = inline ?? true;
			}
			continue;
		}
		rest.push(arg);
	}

	return {flags, rest, passthrough: passthrough ?? []};
}

function emit(json, human, asJson) {
	if (asJson) process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
	else if (human) process.stdout.write(`${human}\n`);
}

function main(argv) {
	const [command, ...tail] = argv;
	if (!command || command === '--help' || command === '-h' || command === 'help') {
		process.stdout.write(USAGE);
		return 0;
	}

	const {flags, rest, passthrough} = parseArgs(tail);
	const root = flags.root ?? defaultRoot();
	const asJson = Boolean(flags.json);

	switch (command) {
		case 'run': {
			// `--require-auth` is for scripted and unattended launches, which cannot notice a
			// "no credential yet" warning in a scrollback and should fail with the documented exit 4
			// instead of starting a session that can do nothing. An interactive launch must NOT
			// require it: `run` is how a person reaches their profile to authenticate in the first
			// place, so requiring a credential there would make the first login impossible.
			const requireAuth = Boolean(flags['require-auth']);
			const resolved = resolveProfile({profile: flags.profile, root, requireAuthenticated: requireAuth});
			if (!resolved.authenticated) {
				process.stderr.write(
					`profile "${resolved.name}" has no credential yet — authenticate inside this session.\n`,
				);
			}
			// Record the launch before exec, because after `exec` this process is gone. Best-effort:
			// a failed touch must not block a session.
			touch({root, name: resolved.name});
			return launch({home: resolved.home, name: resolved.name, args: passthrough});
		}

		case 'provision': {
			if (!flags.name || !flags.owner) {
				process.stderr.write('provision needs --name <name> --owner <text>\n');
				return EXIT.unresolved;
			}
			const result = provision({root, name: flags.name, owner: flags.owner});
			const linked = result.share.cc + result.share.agents;
			const unclassified = result.plan.unclassified;
			emit(
				{
					...result,
					share: {
						linked,
						perRoot: {'.commandcode': result.share.cc, '.agents': result.share.agents},
						withheld: result.plan.withheld.length,
						unclassified,
						conflicts: result.share.conflicts,
					},
					isolation: ISOLATION_NOTICE,
				},
				`Provisioned profile "${result.name}" at ${result.home}\nOwner: ${result.owner}\n\n` +
					`Shared from the machine: ${linked} ${linked === 1 ? 'entry' : 'entries'}` +
					`  (.commandcode: ${result.share.cc}, .agents: ${result.share.agents})\n` +
					`Withheld as per-profile: ${result.plan.withheld.length}` +
					(unclassified.length
						? `\nUnrecognised and shared anyway (no pattern matched): ${unclassified.join(', ')}`
						: '') +
					(result.share.conflicts.length
						? `\nExisting links left alone: ${result.share.conflicts.join(', ')}`
						: '') +
					`\n\nNext: authenticate as this person with\n  cmd-profiles run --profile ${result.name}\n\n` +
					`${ISOLATION_NOTICE}`,
				asJson,
			);
			return 0;
		}

		case 'adopt': {
			if (!flags.name || !flags.owner) {
				process.stderr.write('adopt needs --name <name> --owner <text>\n');
				return EXIT.unresolved;
			}
			const result = adopt({
				root,
				name: flags.name,
				owner: flags.owner,
				path: flags.path ?? `${process.env.HOME}/.commandcode`,
				dryRun: Boolean(flags['dry-run']),
			});
			emit(
				result,
				result.dryRun
					? `Would adopt "${result.name}" → ${result.home}\nAuthenticated: ${result.authenticated}\nNothing was written (--dry-run).`
					: `Adopted "${result.name}" → ${result.home}\nAuthenticated: ${result.authenticated}`,
				asJson,
			);
			return 0;
		}

		case 'list': {
			const result = list({root});
			if (flags.shared) {
				// What each profile actually links, and what is wrong with it (FR-027b, FR-030).
				for (const profile of result.profiles) {
					profile.share = inspectShare(profile.path, machineHome());
				}
			}
			const human = result.profiles.length
				? `default: ${result.default ?? '(none)'}\n\n${result.profiles
						.map(
							p =>
								`  ${p.name === result.default ? '*' : ' '} ${p.name.padEnd(16)} ${String(p.owner ?? '-').padEnd(12)} ` +
								`${p.authenticated ? 'authenticated' : 'not authenticated'}${p.revoked ? `  [revoked: ${p.revoked}]` : ''}\n    ${p.path}` +
								(p.share
									? `\n    shared: ${p.share.linked.length}  dangling: ${p.share.dangling.length}  gaps: ${p.share.gaps.length}` +
										(p.share.dangling.length ? `\n    DANGLING: ${p.share.dangling.join(', ')}` : '') +
										(p.share.gaps.length ? `\n    GAP: ${p.share.gaps.join(', ')}` : '')
									: ''),
						)
						.join('\n')}`
				: 'no profiles yet — run `cmd-profiles provision --name <name> --owner <text>`';
			emit(result, human, asJson);
			return 0;
		}

		case 'use': {
			if (flags.clear) {
				const result = useDefault({root, clear: true});
				emit(result, 'cleared the default profile', asJson);
				return 0;
			}
			const name = rest[0] ?? flags.profile;
			if (!name) {
				process.stderr.write('use needs a profile name, or --clear\n');
				return EXIT.unresolved;
			}
			const result = useDefault({root, name});
			emit(result, `default profile is now "${result.default}"`, asJson);
			return 0;
		}

		case 'revoke': {
			const name = rest[0] ?? flags.name;
			if (!name) {
				process.stderr.write('revoke needs a profile name\n');
				return EXIT.unresolved;
			}
			const mode = flags.access ? 'access' : flags.history ? 'history' : null;
			const result = revoke({root, name, mode, yes: Boolean(flags.yes)});
			emit(
				result,
				result.changed ? `revoked "${result.name}" (${result.revoked})` : `"${result.name}" was already revoked`,
				asJson,
			);
			return 0;
		}

		case 'diagnose': {
			const result = diagnose({root, profile: flags.profile, realHome: machineHome()});
			const human = result.profiles
				.map(p => `  ${p.name}: ${p.findings.length ? p.findings.join(', ') : 'ok'}`)
				.join('\n');
			emit(result, `${human}\n\n${ISOLATION_NOTICE}`, asJson);
			return result.profiles.some(p => p.findings.length > 0) ? 1 : 0;
		}

		default:
			process.stderr.write(`unknown command "${command}"\n\n${USAGE}`);
			return EXIT.unresolved;
	}
}

try {
	process.exit(main(process.argv.slice(2)));
} catch (error) {
	if (error instanceof ProfileError) {
		process.stderr.write(`${error.message}\n`);
		process.exit(error.exitCode);
	}
	process.stderr.write(`${error.message ?? error}\n`);
	process.exit(1);
}
