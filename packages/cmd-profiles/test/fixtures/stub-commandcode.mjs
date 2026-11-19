#!/usr/bin/env node
// Stands in for the Command Code binary so the launcher can be proven offline, with no
// credentials and no network. Prints one JSON line describing the environment it was handed,
// and optionally writes it to STUB_OUT so a test can read it while stdio is inherited.

import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';

const home = process.env.HOME;
const report = {
	home: home ?? null,
	userprofile: process.env.USERPROFILE ?? null,
	profile: process.env.CMD_PROFILES_PROFILE ?? null,
	skipUpdates: process.env.COMMANDCODE_SKIP_UPDATES ?? null,
	path: process.env.PATH ?? null,
	sshAuthSock: process.env.SSH_AUTH_SOCK ?? null,
	args: process.argv.slice(2),
	// The vendor's real location: Command Code composes $HOME + "/.commandcode" for its state.
	// Checking `home/auth.json` here would let a launcher that looks in the wrong place still pass.
	authenticated: Boolean(home) && existsSync(join(home, '.commandcode', 'auth.json')),
};

const line = JSON.stringify(report);
if (!process.env.STUB_QUIET) process.stdout.write(`${line}\n`);
if (process.env.STUB_OUT) writeFileSync(process.env.STUB_OUT, `${line}\n`);
process.exit(Number(process.env.STUB_EXIT_CODE ?? 0));
