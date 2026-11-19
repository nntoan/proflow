// The Orca launch contract.
//
// On a shared host, Orca runs a session with `orca terminal create --command "<something>"`. There is
// no environment flag on `terminal create` (see docs/orca.md), so the command string is the entire
// integration surface: a typo here is a launch that runs the wrong profile, or none.
//
// It lives in src/ rather than in the test so the test can import what ships. A test that defines its
// own copy of a contract passes no matter what the real path does — which is exactly the defect
// `/speckit-converge` found in this file's original location.

import {assertProfileName} from './paths.mjs';

/**
 * The command an operator runs on the shared host to launch one profile.
 *
 * The profile name is validated first. That is defence in depth rather than the only guard: the name
 * rules already forbid slashes, spaces and shell metacharacters, so by the time a name reaches this
 * template there is nothing left that could break out of the quoted argument.
 *
 * **Why this is exported but never called by shipped code.** Nothing in `src/` invokes it, and that is
 * intentional: the command string is executed by *Orca on the host*, not by this package. The function
 * exists so the value has one definition that `test/orca-command.mjs` can assert the docs against —
 * `docs/README.md` and `docs/orca.md` print the command for a human to copy, and a stale doc would tell
 * an operator to run the wrong thing. Before this lived in `src/`, that test defined its own copy of
 * the string and could not fail no matter what the docs said.
 *
 * If a `cmd-profiles orca` subcommand is ever added, this is the function it should call — the export
 * is the seam for that, not dead code to be removed.
 */
export function orcaLaunchCommand(name) {
	assertProfileName(name);
	return `orca terminal create --title "CC: ${name}" --command "cmd-profiles run --profile ${name}"`;
}
