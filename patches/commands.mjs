// Declarative adaptation rules for vendoring addyosmani/agent-skills' commands
// (`.claude/commands/*.md`) as proflow's lifecycle commands. Consumed by
// `scripts/sync-upstream.mjs` through the shared engine in `tools/vendor.mjs`.
//
// Upstream's commands are thin wrappers that invoke a skill by name. proflow
// changes only what has to change for Command Code:
//
//   1. the Claude plugin namespace — `agent-skills:spec-driven-development`
//      becomes `spec-driven-development` (the skills are installed natively, so
//      they are advertised and activated by their own names);
//   2. the canonical spec location — `docs/spec/<id>/`, never a root `SPEC.md`;
//   3. the subagent/persona mechanics in `/ship` (Command Code's `agent` tool
//      and the personas installed under `.commandcode/agents/`).
//
// There is deliberately **no activation preamble**: Command Code advertises every
// skill by name and activates it on demand, so "Invoke the X skill." is enough.
// Every `find` must match exactly once — upstream drift fails the sync loudly.

/** Upstream file name (without `.md`) → proflow command name (without `.md`). */
export const rename = {
	plan: 'to-plan',
	review: 'to-review',
};

export default [
	{
		file: 'commands/spec.md',
		replaces: [
			{
				find: 'Invoke the agent-skills:spec-driven-development skill.',
				with: 'Invoke the spec-driven-development skill.',
			},
			{
				find: 'Save the spec as SPEC.md in the project root and confirm with the user before proceeding.',
				with:
					'Save the spec to `docs/spec/<id>/SPEC.md` (never a repository-root `SPEC.md`) and confirm\n' +
					'with the user before proceeding.',
			},
		],
	},
	{
		file: 'commands/to-plan.md',
		replaces: [
			{
				find: 'Invoke the agent-skills:planning-and-task-breakdown skill.',
				with: 'Invoke the planning-and-task-breakdown skill.',
			},
			{
				find: 'Read the existing spec (SPEC.md or equivalent) and the relevant codebase sections. Then:',
				with:
					'Read the existing spec — prefer `docs/spec/<id>/SPEC.md`, with its `explore-brief.md` and\n' +
					'`review-log.md` siblings — and the relevant codebase sections. A repository-root `SPEC.md` is\n' +
					'not canonical; if several `docs/spec/<id>/` directories exist, ask which one this plan is for.\n' +
					'Then:',
			},
		],
	},
	{
		file: 'commands/build.md',
		replaces: [
			{
				find: 'Invoke the agent-skills:incremental-implementation skill alongside agent-skills:test-driven-development.',
				with: 'Invoke the incremental-implementation skill alongside test-driven-development.',
			},
			{
				find: '1. **Require a spec.** Look only for a spec at a known path: `SPEC.md` at the repo root, `docs/SPEC.md`, or a file under `spec/`. A README or arbitrary doc does **not** count.',
				with:
					'1. **Require a spec.** Prefer the canonical location `docs/spec/<id>/SPEC.md`; fall back to `docs/SPEC.md` or a file under `spec/`. A repository-root `SPEC.md`, a README, or an arbitrary doc does **not** count. If more than one `docs/spec/<id>/SPEC.md` exists, ask which one this build is for.',
			},
			{
				find: '(`SPEC.md`, `docs/SPEC.md`, `spec/*`, `tasks/plan.md`, `tasks/todo.md`)',
				with: '(`docs/spec/*`, `docs/SPEC.md`, `spec/*`, `tasks/plan.md`, `tasks/todo.md`)',
			},
			{
				find: 'If there is no `tasks/plan.md`, invoke agent-skills:planning-and-task-breakdown to generate one.',
				with: 'If there is no `tasks/plan.md`, invoke the planning-and-task-breakdown skill to generate one.',
			},
			{
				find: '→ follow agent-skills:debugging-and-error-recovery\n',
				with: '→ follow the debugging-and-error-recovery skill\n',
			},
			{
				find: '→ follow agent-skills:doubt-driven-development and get explicit sign-off before continuing',
				with: '→ follow the doubt-driven-development skill and get explicit sign-off before continuing',
			},
			{
				find: 'If any step fails, follow the agent-skills:debugging-and-error-recovery skill.',
				with: 'If any step fails, follow the debugging-and-error-recovery skill.',
			},
		],
	},
	{
		file: 'commands/test.md',
		replaces: [
			{
				find: 'Invoke the agent-skills:test-driven-development skill.',
				with: 'Invoke the test-driven-development skill.',
			},
			{
				find: 'For browser-related issues, also invoke agent-skills:browser-testing-with-devtools to verify with Chrome DevTools MCP.',
				with:
					'For browser-related issues, also invoke the browser-testing-with-devtools skill and verify\n' +
					'with the Chrome DevTools MCP server when it is configured.\n' +
					'\n' +
					'Report the evidence: the command you ran, the failing output before the fix, the passing\n' +
					'output after, and the regression-suite result. "Looks right" is not evidence.',
			},
		],
	},
	{
		file: 'commands/to-review.md',
		replaces: [
			{
				find: 'Invoke the agent-skills:code-review-and-quality skill.',
				with: 'Invoke the code-review-and-quality skill.',
			},
			{
				find: '(Use security-and-hardening skill)',
				with: '(invoke the security-and-hardening skill)',
			},
			{
				find: '(Use performance-optimization skill)',
				with: '(invoke the performance-optimization skill)',
			},
			{
				find:
					'Categorize findings as Critical, Important, or Suggestion.\n' +
					'Output a structured review with specific file:line references and fix recommendations.',
				with:
					'Categorize findings as Critical, Important, or Suggestion. Read the tests first — they reveal\n' +
					'intent and coverage. Output a structured review with specific `file:line` references and\n' +
					'concrete fix recommendations.',
			},
		],
	},
	{
		file: 'commands/ship.md',
		replaces: [
			{
				find: 'Invoke the agent-skills:shipping-and-launch skill.',
				with: 'Invoke the shipping-and-launch skill.',
			},
			{
				find:
					'Spawn three subagents concurrently using the Agent tool. **Issue all three Agent tool calls in a single assistant turn so they execute in parallel** — sequential calls defeat the purpose of this command.\n' +
					'\n' +
					'In Claude Code, each call passes `subagent_type` matching the persona\'s `name` field:',
				with:
					'Spawn three subagents concurrently with the `agent` tool. **Issue all three `agent` calls in a\n' +
					'single assistant turn so they execute in parallel** — sequential calls defeat the purpose of\n' +
					'this command. Pass each persona\'s name as `subagent_type`; the personas are installed under\n' +
					'`.commandcode/agents/`, so the names below resolve directly:',
			},
			{
				find:
					'Constraints (from Claude Code\'s subagent model):\n' +
					'- Subagents cannot spawn other subagents — do not let one persona delegate to another.\n' +
					'- Each subagent gets its own context window and returns only its report to this main session.\n' +
					'- If you need teammates that talk to each other instead of just reporting back, use Claude Code Agent Teams and reference these personas as teammate types (see `references/orchestration-patterns.md`).\n' +
					'\n',
				with: 'A subagent cannot spawn subagents — do not let one persona delegate to another.\n\n',
			},
			{
				find:
					'**Persona resolution.** If you\'ve defined your own `code-reviewer`, `security-auditor`, or `test-engineer` in `.claude/agents/` or `~/.claude/agents/`, those take precedence over this plugin\'s versions — `/ship` picks up your customizations automatically. This is intentional: plugin subagents sit at the bottom of Claude Code\'s scope priority table, so user-level definitions win by design.\n' +
					'\n',
				with: '',
			},
			{
				find: 'or invoke the accessibility checklist).',
				with: 'or read the `accessibility-checklist` reference).',
			},
		],
	},
	{
		file: 'commands/constraints.md',
		replaces: [
			{
				find: 'Invoke the agent-skills:constraint-driven-development skill.',
				with: 'Invoke the constraint-driven-development skill.',
			},
		],
	},
	{
		file: 'commands/code-simplify.md',
		replaces: [
			{
				find: 'Invoke the agent-skills:code-simplification skill.',
				with: 'Invoke the code-simplification skill.',
			},
		],
	},
];
