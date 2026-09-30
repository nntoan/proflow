// Declarative patches for the vendored addyosmani/agent-skills content.
//
// Applied by `sync-upstream.mjs` AFTER the upstream tree is copied, via the
// shared engine in `scripts/lib/vendor.mjs`. Each `find` must match exactly
// once, or the sync fails — so upstream drift is caught, never shipped.
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
					'> **proflow:** run this through the `/spec` command. It adds parallel recon before\n' +
					'> the interview and a `spec-reviewer` reflection loop before approval, and stores the\n' +
					'> spec at `docs/spec/<id>/` (`SPEC.md`, `explore-brief.md`, `review-log.md`).\n',
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
];
