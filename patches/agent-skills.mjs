// Declarative patches for the vendored addyosmani/agent-skills content.
//
// Applied by `sync-upstream.mjs` AFTER the upstream tree is copied, via the
// shared engine in `tools/vendor.mjs`. Each `find` must match exactly
// once, or the sync fails — so upstream drift is caught, never shipped.
//
// The vendored agents, too: upstream omits `tools:`, which Claude Code treats as
// "every tool" but this harness needs declared explicitly — without it a sub-agent
// invents Claude-style names (Read, Bash) and dies on `No tool named Read exists`.
// Each agent gets exactly the tools its job needs; reviewers stay read-only.
//
// We do NOT fork the 25 skills: only `spec-driven-development` needs aligning,
// because it prescribes saving module specs at the project root, which
// contradicts proflow's `docs/spec/<id>/` convention. That skill is reachable
// three ways (our `agent_skills` tool, native `activate_skill`, and
// `/skill:spec-driven-development`), all reading this one file — so patching it
// here fixes every load path.

export default [
	{
		file: 'skills/spec-driven-development/SKILL.md',
		// Point the skill at proflow's flow (recon + reflection) without
		// rewriting its body.
		replaces: [
			{
				find: '# Spec-Driven Development\n',
				with:
					'# Spec-Driven Development\n\n' +
					'> **proflow:** run this through the `/spec` command. Specs live at `docs/spec/<id>/`\n' +
					'> (`SPEC.md` with its `explore-brief.md` and `review-log.md` siblings), and before the spec\n' +
					'> is approved it goes through the `spec-reflection` skill — a `spec-reviewer` pass with a\n' +
					'> logged decision for every finding.\n',
			},
			// L65: the capability map + module specs live under docs/spec/<id>/,
			// not at the project root.
			{
				find:
					"Save the approved map at the project root and each module's spec alongside it, " +
					'named by module id (`SPEC-identity.md`, `SPEC-billing.md`) — the map, not filename ' +
					'guessing, is the index of what exists.',
				with:
					"Save the approved capability map and each module's spec under `docs/spec/<id>/` — " +
					'one directory per spec (`SPEC.md`, `explore-brief.md`, `review-log.md`); the map, ' +
					'not filename guessing, is the index of what exists.',
			},
			// L249: name the canonical location in the verification checklist.
			{
				find: '- [ ] The spec is saved to a file in the repository',
				with: '- [ ] The spec is saved to `docs/spec/<id>/SPEC.md` (never a repository-root `SPEC.md`)',
			},
		],
	},

	// Agents whose job needs the tool list declared, per the note above.
	{
		file: 'agents/spec-reviewer.md',
		// Reads a spec and the code it cites; never writes.
		replaces: [
			{
				find: 'name: spec-reviewer\n',
				with: 'name: spec-reviewer\ntools: glob, grep, read_file, shell_command\n',
			},
		],
	},
	{
		file: 'agents/code-reviewer.md',
		// Reads a diff and the surrounding code; never writes.
		replaces: [
			{
				find: 'name: code-reviewer\n',
				with: 'name: code-reviewer\ntools: glob, grep, read_file, shell_command\n',
			},
		],
	},
	{
		file: 'agents/security-auditor.md',
		// Reads code and configuration; never writes.
		replaces: [
			{
				find: 'name: security-auditor\n',
				with: 'name: security-auditor\ntools: glob, grep, read_file, shell_command\n',
			},
		],
	},
	{
		file: 'agents/web-performance-auditor.md',
		// Reads pages, bundles and config; never writes.
		replaces: [
			{
				find: 'name: web-performance-auditor\n',
				with: 'name: web-performance-auditor\ntools: glob, grep, read_file, shell_command\n',
			},
		],
	},
	{
		file: 'agents/test-engineer.md',
		// Writes and runs tests, so it needs write access as well.
		replaces: [
			{
				find: 'name: test-engineer\n',
				with: 'name: test-engineer\ntools: glob, grep, read_file, write_file, edit_file, shell_command\n',
			},
		],
	},

	// Every task traces to the spec; every gate to a spec open question.
	{file: 'skills/planning-and-task-breakdown/SKILL.md', replaces: [
			{find: '**Never overwrite an incomplete plan.**', with: '**Record the tasks with the harness\'s `todo_write` tool, not only in the file.** The file is the durable resume state; the tool is what the user watches live, and every call replaces the entire list, so send all of it.\n\n**Every task traces to the spec; every gate traces to a spec open question.** A plan that blocks a task on something the spec does not list as an open question is invalid — that is how an invented requirement becomes a false dependency, and it has already happened once here.\n\n**Never overwrite an incomplete plan.**'},
	]},
];
