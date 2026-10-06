// Declarative adaptation rules for vendoring muon-m2/magento2-tools (a Claude
// Code plugin) into proflow's optional `magento2` component. Consumed by
// `sync-magento2.mjs` together with the shared engine in `tools/vendor.mjs`.
//
// Rule groups:
//   1. namespacing        `context` -> `m2-context` (dir + `name:` + refs), so the
//                         36 generic upstream names can't shadow anything.
//   2. cross-skill refs   `magento2-tools:fix` -> `m2-fix`, and bare backticked
//                         `` `fix` `` -> `` `m2-fix` ``.
//   3. plugin-root paths  ${CLAUDE_PLUGIN_ROOT}/skills/X/... ->
//                         ${COMMANDCODE_SKILL_DIR}/../m2-X/... (Command Code
//                         installs skills flat, so the plugin root IS the skills
//                         directory).
//   4. config/memory      .claude/m2.json -> .commandcode/m2.json, CLAUDE.md ->
//                         AGENTS.md.
//   5. agents             `reviewer`/`explorer` -> `m2-reviewer`/`m2-explorer`
//                         (file names, `name:`, and the ~51 prose references),
//                         with Claude tool ids mapped to Command Code's.
//   6. dev-only files     unreferenced upstream dev tooling is excluded.
//
// Everything except `normalizeDescription` is a plain regex/data rule.

export const skillPrefix = 'm2-';
export const commandPrefix = 'm2-';
export const agentRename = {reviewer: 'm2-reviewer', explorer: 'm2-explorer'};

// Unreferenced upstream dev/CI tooling — verified to have no callers in an
// installed tree (see docs/adr/0001-magento2-integration.md).
export const exclude = ['gen-routing.sh'];

export const agentTools = {
	Glob: 'glob',
	Grep: 'grep',
	Read: 'read_file',
	Write: 'write_file',
	Edit: 'edit_file',
	MultiEdit: 'edit_file',
	LS: 'read_directory',
	Bash: 'shell_command',
	WebFetch: 'web_fetch',
	WebSearch: 'web_search',
	TodoWrite: 'todo_write',
};

/** Generic regex rules applied to every vendored text file. */
export function genericRules() {
	return [
		[
			/\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/([a-z0-9-]+)\//g,
			(_m, s) => `\${COMMANDCODE_SKILL_DIR}/../${skillPrefix}${s}/`,
		],
		[/\$\{CLAUDE_PLUGIN_ROOT\}\/agents\//g, '${COMMANDCODE_SKILL_DIR}/../../agents/'],
		[/\$\{CLAUDE_PLUGIN_ROOT\}/g, '${COMMANDCODE_SKILL_DIR}/..'],
		[/magento2-tools:([a-z0-9-]+)/g, (_m, s) => `${skillPrefix}${s}`],
		[/\.claude\/m2\.json/g, '.commandcode/m2.json'],
		[/\.claude\/\.cache/g, '.commandcode/.cache'],
		[/\.claude\/settings\.json/g, '.commandcode/settings.json'],
		// Claude's ask tool id, renamed to the harness's. The transform never mapped it,
		// so the one gate that named a tool named one that does not exist here.
		[/\bAskUserQuestion\b/g, 'ask_user_question'],
		[/\bCLAUDE\.md\b/g, 'AGENTS.md'],
		// proflow conventions: no stale sibling path into the pre-rename
		// `context` skill directory.
		[/\.\.\/\.\.\/context\//g, '../../m2-context/'],
		// Lookbehind keeps an already-renamed `m2-reviewer` from becoming `m2-m2-reviewer`.
		[/(?<![\w-])reviewer\b/g, agentRename.reviewer],
		[/(?<![\w-])explorer\b/g, agentRename.explorer],
	];
}

/**
 * proflow-level conventions applied LAST — the shared artifact root. These must
 * run *after* the bare-backticked skill-name namespacing: upstream ships a `docs`
 * skill, so `docs` in backticks means the skill, while `.docs` means the artifact
 * directory. Retargeting `.docs` → `docs` any earlier would let the namespacing
 * rule turn it into `` `m2-docs` ``.
 */
export function lateRules() {
	return [
		// `.docs` → `docs` wherever it is a path segment. The lookbehind spares
		// `{ctx.docs_root}` (no word boundary between `s` and `_`) and the
		// lookahead spares a longer word.
		[/(?<![\w.])\.docs\b/g, 'docs'],
		// After the rule above, that one upstream sentence reads "`docs/` or
		// `docs/`"; keep the prose meaningful.
		[
			/- `docs\/` or `docs\/` \(some users elide the leading dot\)/g,
			'- either spelling, with or without the leading dot',
		],
	];
}

/** Apply the generic rules, bare backticked skill-name namespacing, then the late rules. */
export function transform(text, skillNames, file = '') {
	let out = text;
	for (const [pattern, replace] of genericRules()) out = out.replace(pattern, replace);
	// The bare namespace form — a `case` label, a `startswith(...)` argument, an
	// elided `/magento2-tools:…` — is any `magento2-tools:` with no skill name
	// after the colon, so the named rule above never sees it. `guard-docs-path.sh`
	// is the one file allowed to keep the namespace, so it is exempt.
	if (!/guard-docs-path\.sh$/.test(file)) {
		out = out.replace(/magento2-tools:(?![a-z0-9-])/g, skillPrefix);
	}
	for (const name of skillNames) out = out.split(`\`${name}\``).join(`\`${skillPrefix}${name}\``);
	for (const [pattern, replace] of lateRules()) out = out.replace(pattern, replace);
	return out;
}

/** Rewrite a `tools:` frontmatter line (Claude ids -> Command Code ids). */
export function mapTools(text) {
	return text.replace(/^tools:[ \t]*(.*)$/m, (_line, list) => {
		const mapped = list
			.split(',')
			.map(t => t.trim())
			.filter(Boolean)
			.map(t => agentTools[t] || t)
			.join(', ');
		return `tools: ${mapped}`;
	});
}

/**
 * Upstream writes `description:` as a plain multi-line scalar. Command Code's
 * YAML parser rejects that when a continuation line contains ": " (e.g. "... the
 * full lifecycle: requirement analysis ..."), silently dropping the skill.
 * Normalise to a folded block scalar; leave `>-`/`|` values alone.
 */
export function normalizeDescription(text) {
	const fm = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(text);
	if (!fm) return text;
	const lines = fm[2].split(/\r?\n/);
	const idx = lines.findIndex(line => /^description:/.test(line));
	if (idx === -1) return text;
	let end = idx + 1;
	while (end < lines.length && !/^[A-Za-z0-9_-]+:/.test(lines[end])) end += 1;
	const inline = lines[idx].replace(/^description:[ \t]*/, '');
	if (/^[>|]/.test(inline)) return text;
	const value = [inline, ...lines.slice(idx + 1, end).map(line => line.trim())].filter(Boolean).join(' ');
	const rebuilt = [...lines.slice(0, idx), 'description: >-', `    ${value}`, ...lines.slice(end)];
	return fm[1] + rebuilt.join('\n') + fm[3] + text.slice(fm[0].length);
}

/** Set the frontmatter `name:` (skills get the namespaced name). */
export function setName(text, name) {
	return text.replace(/^name:[ \t]*.*$/m, `name: ${name}`);
}

/** Hook scripts: Command Code tool ids + env for the `.docs/` guard. */
export function adaptHook(text) {
	return text
		.replace('Write|Edit)', 'write_file|edit_file|Write|Edit)')
		.replace(
			'project_root="${CLAUDE_PROJECT_DIR:-}"',
			'project_root="${COMMANDCODE_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-}}"',
		);
}
