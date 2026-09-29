// proflow — Command Code integration for addyosmani/agent-skills.
//
// One mod file that turns the 25 production-grade engineering skills into a
// first-class Command Code workflow pack:
//
//   * /spec /to-plan /build /test /to-review /ship — the DEFINE → PLAN → BUILD →
//     VERIFY → REVIEW → SHIP lifecycle commands (proflow names, collision-safe:
//     Command Code already owns /plan and /review).
//   * the `agent_skills` tool — progressive disclosure for the bundled skills,
//     shared reference checklists, and specialist personas. The model lists the
//     catalog, then loads exactly the workflow it needs.
//   * a byte-stable catalog appended to the system prompt, so the model knows
//     what is available without paying for every skill body up front.
//
// The skill/reference/persona/command Markdown ships inside this package and is
// read relative to this file, so the mod is self-contained: `cmd mods add` on the
// package is the whole install. If the same skills are also installed natively
// (`cmd skills add addyosmani/agent-skills`), the command prompts fall back to
// Command Code's own `activate_skill` tool instead.

import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

declare const __dirname: string | undefined;

// ── Minimal local view of the ModApi this mod uses ─────────────────────────────
// Kept local so the package has no load-time dependency on @commandcode/harness.
type Disposable = {dispose: () => void};

type ToolResult =
	| {ok: true; content: {type: 'text'; text: string}[]}
	| {ok: false; error: string};

interface ModApi {
	readonly name: string;
	readonly cwd: string;
	addCommand(command: {
		name: string;
		description?: string;
		argumentHint?: string;
		handler: (ctx: {args: string; cwd: string}) => {prompt?: string; message?: string} | void;
	}): Disposable;
	addTool(tool: {
		schema: {name: string; description: string; input_schema: Record<string, unknown>};
		readOnly?: boolean;
		run: (ctx: {input: Record<string, unknown>}) => ToolResult | Promise<ToolResult>;
	}): Disposable;
	addFlag(
		name: string,
		options: {type: 'boolean' | 'string'; default?: boolean | string; description?: string},
	): Disposable;
	getFlag(name: string): boolean | string | undefined;
	hooks(hooks: {
		appendSystemPrompt?: () => string | undefined;
		// Captures the latest typed prompt so tool-loaded skills can resolve
		// $ARGUMENTS. Returning nothing passes the prompt through untouched.
		transformInput?: (ctx: {text: string}) => void;
	}): Disposable;
	on(event: string, handler: () => void): Disposable;
}

// ── Package layout (resolved relative to this file) ────────────────────────────
// jiti injects __dirname in its CommonJS transform (the normal load path). The
// import.meta.url branch keeps the mod working if it is ever loaded as ESM.
function resolveRoot(): string {
	if (typeof __dirname !== 'undefined' && __dirname) return resolve(__dirname, '..');
	try {
		const url = (import.meta as {url?: string})?.url;
		if (typeof url === 'string' && url.startsWith('file:')) {
			return resolve(dirname(fileURLToPath(url)), '..');
		}
	} catch {
		// import.meta unavailable — fall through.
	}
	return process.cwd();
}

const ROOT = resolveRoot();
const SKILLS_DIR = join(ROOT, 'skills');
const REFERENCES_DIR = join(ROOT, 'references');
const AGENTS_DIR = join(ROOT, 'agents');
const COMMANDS_DIR = join(ROOT, 'commands');

interface Doc {
	readonly name: string;
	readonly description: string;
	readonly body: string;
}

// ── Frontmatter + discovery ────────────────────────────────────────────────────
function parseFrontmatter(raw: string): {attrs: Record<string, string>; body: string} {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
	if (!match) return {attrs: {}, body: raw.trim()};
	const attrs: Record<string, string> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (!kv) continue;
		let value = kv[2].trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		attrs[kv[1]] = value;
	}
	return {attrs, body: raw.slice(match[0].length).trim()};
}

function readDoc(filePath: string, fallbackName: string): Doc {
	const {attrs, body} = parseFrontmatter(readFileSync(filePath, 'utf8'));
	return {
		name: attrs.name || fallbackName,
		description: attrs.description || '',
		body,
	};
}

function listSkillDocs(): Doc[] {
	if (!existsSync(SKILLS_DIR)) return [];
	const docs: Doc[] = [];
	for (const entry of readdirSync(SKILLS_DIR).sort()) {
		const skillFile = join(SKILLS_DIR, entry, 'SKILL.md');
		try {
			if (statSync(join(SKILLS_DIR, entry)).isDirectory() && existsSync(skillFile)) {
				docs.push(readDoc(skillFile, entry));
			}
		} catch {
			// A skill that cannot be read is skipped rather than failing the load.
		}
	}
	return docs;
}

function listMarkdown(dir: string): Doc[] {
	if (!existsSync(dir)) return [];
	const docs: Doc[] = [];
	for (const entry of readdirSync(dir).sort()) {
		if (!entry.endsWith('.md')) continue;
		try {
			docs.push(readDoc(join(dir, entry), entry.replace(/\.md$/, '')));
		} catch {
			// Skipped: an unreadable file never breaks mod loading.
		}
	}
	return docs;
}

const SKILLS = listSkillDocs();
const REFERENCES = listMarkdown(REFERENCES_DIR);
const PERSONAS = listMarkdown(AGENTS_DIR);

const findByName = (docs: readonly Doc[], name: string): Doc | undefined => {
	const target = name.trim().toLowerCase().replace(/\.md$/, '');
	return docs.find(doc => doc.name.toLowerCase() === target);
};

const label = (docs: readonly Doc[]): string =>
	docs.map(doc => doc.name).join(', ') || '(none found)';

// ── Argument substitution ──────────────────────────────────────────────────────
// Commands use Command Code's native custom-command grammar, so a workflow file
// can place the argument exactly where the author wants it. Skill bodies use the
// skill grammar instead — it has no bare `$1` form, so SQL/`$50` inside a skill
// or reference is never mistaken for a placeholder.
function tokenizeArgs(input: string): string[] {
	const tokens: string[] = [];
	let current = '';
	let quote: '"' | "'" | null = null;
	for (const ch of input.trim()) {
		if (quote) {
			if (ch === quote) quote = null;
			else current += ch;
		} else if (ch === '"' || ch === "'") {
			quote = ch;
		} else if (/\s/.test(ch)) {
			if (current) {
				tokens.push(current);
				current = '';
			}
		} else {
			current += ch;
		}
	}
	if (current) tokens.push(current);
	return tokens;
}

// $ARGUMENTS / $@ / $1..$N / ${N} / ${N:-default} / ${@} / ${@:N} / ${@:N:L}
const COMMAND_PLACEHOLDER =
	/\$\{@(?::-(?<adef>[^}]*)|:(?<aslice>\d+)(?::(?<alen>\d+))?)?\}|\$\{(?<bname>ARGUMENTS|@|\d+)(?::-(?<bdef>[^}]*))?\}|\$(?<cname>ARGUMENTS|@|\d+)/g;

function substituteCommand(body: string, args: string): {text: string; substituted: boolean} {
	const tokens = tokenizeArgs(args);
	const all = args.trim();
	const at = (n: number): string => tokens[n - 1] ?? '';
	let substituted = false;

	const text = body.replace(COMMAND_PLACEHOLDER, (...parts) => {
		const match = parts[0] as string;
		const groups = parts[parts.length - 1] as Record<string, string | undefined>;
		substituted = true;

		if (groups.adef !== undefined || groups.aslice !== undefined || match.startsWith('${@')) {
			if (groups.adef !== undefined) return all || groups.adef;
			if (groups.aslice !== undefined) {
				const start = Number(groups.aslice) - 1;
				const end = groups.alen === undefined ? undefined : start + Number(groups.alen);
				return tokens.slice(start, end).join(' ');
			}
			return all;
		}
		if (groups.bname !== undefined) {
			if (groups.bname === 'ARGUMENTS' || groups.bname === '@') return all || (groups.bdef ?? '');
			const value = at(Number(groups.bname));
			return value || (groups.bdef ?? value);
		}
		if (groups.cname !== undefined) {
			if (groups.cname === 'ARGUMENTS' || groups.cname === '@') return all;
			return at(Number(groups.cname));
		}
		return match;
	});

	return {text, substituted};
}

// $ARGUMENTS / $ARGUMENTS[N] / ${N} / ${COMMANDCODE_*} / ${CLAUDE_*}
const SKILL_PLACEHOLDER = /\$ARGUMENTS(?:\[(\d+)\])?|\$\{(\d+)\}|\$\{(COMMANDCODE|CLAUDE)_([A-Z_]+)\}/g;

function substituteSkill(
	body: string,
	request: string,
	ctx: {skillDir?: string; projectDir: string},
): string {
	const tokens = tokenizeArgs(request);
	return body.replace(SKILL_PLACEHOLDER, (match, argIndex, posIndex, namespace, key) => {
		if (argIndex !== undefined) return tokens[Number(argIndex)] ?? '';
		if (posIndex !== undefined) return tokens[Number(posIndex)] ?? '';
		if (namespace !== undefined) {
			if (key === 'SKILL_DIR' && ctx.skillDir) return ctx.skillDir;
			if (key === 'PROJECT_DIR') return ctx.projectDir;
			return match; // SESSION_ID / EFFORT / unknown — leave untouched
		}
		return request; // bare $ARGUMENTS
	});
}

// ── Catalog (injected into the system prompt; byte-stable) ─────────────────────
const truncate = (text: string, max: number): string =>
	text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

const PHASES: {phase: string; skills: string[]}[] = [
	{phase: 'Define', skills: ['interview-me', 'idea-refine', 'spec-driven-development', 'constraint-driven-development']},
	{phase: 'Plan', skills: ['planning-and-task-breakdown']},
	{phase: 'Build', skills: ['incremental-implementation', 'test-driven-development', 'context-engineering', 'source-driven-development', 'doubt-driven-development', 'frontend-ui-engineering', 'api-and-interface-design']},
	{phase: 'Verify', skills: ['browser-testing-with-devtools', 'debugging-and-error-recovery']},
	{phase: 'Review', skills: ['code-review-and-quality', 'code-simplification', 'security-and-hardening', 'performance-optimization']},
	{phase: 'Ship', skills: ['git-workflow-and-versioning', 'ci-cd-and-automation', 'deprecation-and-migration', 'documentation-and-adrs', 'observability-and-instrumentation', 'shipping-and-launch']},
	{phase: 'Meta', skills: ['using-agent-skills']},
];

const skillByName = new Map(SKILLS.map(doc => [doc.name, doc]));

const describe = (name: string): string => {
	const doc = skillByName.get(name);
	return doc ? `${name} — ${truncate(doc.description, 90)}` : name;
};

function buildCatalog(): string {
	const lines: string[] = [];
	lines.push(
		`proflow · agent-skills is loaded (${SKILLS.length} skills). Lifecycle commands: ` +
			'/spec <goal> · /to-plan <goal> · /build [auto] · /test [scope] · /to-review [scope] · /ship [scope].',
	);
	lines.push(
		'Use the `agent_skills` tool to work with this pack: action "list" (full catalog), ' +
			'"load" (a skill workflow by name), "reference" (a shared checklist), ' +
			'"persona" (a specialist review persona). Load the relevant skill BEFORE non-trivial work.',
	);
	lines.push(
		'For routing, load "using-agent-skills"; it maps intent to the smallest applicable workflow.',
	);
	for (const {phase, skills} of PHASES) {
		lines.push(`${phase}:\n  ${skills.map(describe).join('\n  ')}`);
	}
	// Any skill a future sync adds that the phase map does not know about still
	// shows up in the catalog.
	const listed = new Set(PHASES.flatMap(group => group.skills));
	const unlisted = SKILLS.filter(doc => !listed.has(doc.name));
	if (unlisted.length > 0) {
		lines.push(`Other:\n  ${unlisted.map(doc => describe(doc.name)).join('\n  ')}`);
	}
	lines.push(`Shared reference checklists (action "reference"): ${label(REFERENCES)}.`);
	lines.push(`Specialist personas (action "persona"): ${label(PERSONAS)}.`);
	return lines.join('\n');
}

const CATALOG = buildCatalog();

// ── The mod ────────────────────────────────────────────────────────────────────
export default function (cmd: ModApi): void {
	// The most recent typed prompt, used to resolve $ARGUMENTS when the model
	// loads a skill. Cleared at the end of each run so a slash-command turn (which
	// never passes through transformInput) can't substitute a stale request.
	let lastRequest = '';

	cmd.addFlag('catalog', {
		type: 'boolean',
		default: true,
		description: 'Inject the agent-skills catalog into the system prompt.',
	});

	// Lifecycle commands. Each prompt is the workflow Markdown in commands/*.md,
	// with the user's argument appended the way native custom commands do.
	const COMMANDS: {name: string; file: string}[] = [
		{name: 'spec', file: 'spec.md'},
		{name: 'to-plan', file: 'to-plan.md'},
		{name: 'build', file: 'build.md'},
		{name: 'test', file: 'test.md'},
		{name: 'to-review', file: 'to-review.md'},
		{name: 'ship', file: 'ship.md'},
	];

	const render = (body: string, args: string): string => {
		// Native behavior: placeholders substitute in place; a body with none gets
		// the arguments appended as an `ARGUMENTS:` footer.
		const {text, substituted} = substituteCommand(body, args);
		const trimmed = args.trim();
		return trimmed && !substituted ? `${text}\n\nARGUMENTS: ${trimmed}` : text;
	};

	for (const {name, file} of COMMANDS) {
		let description = `proflow: /${name}`;
		let argumentHint: string | undefined;
		let body = '';
		try {
			const {attrs, body: parsed} = parseFrontmatter(
				readFileSync(join(COMMANDS_DIR, file), 'utf8'),
			);
			description = attrs.description || description;
			argumentHint = attrs['argument-hint'];
			body = parsed;
		} catch {
			body = `proflow: the workflow definition for /${name} was not found at ${join(COMMANDS_DIR, file)}. Reinstall the proflow package.`;
		}
		cmd.addCommand({
			name,
			description,
			argumentHint,
			handler: ({args}) => ({prompt: render(body, args)}),
		});
	}

	// The progressive-disclosure surface for the bundled skills.
	cmd.addTool({
		schema: {
			name: 'agent_skills',
			description:
				'Work with the proflow agent-skills pack (25 engineering skills). ' +
				'action "list" returns the full catalog; "load" returns a skill workflow by name ' +
				'(e.g. spec-driven-development, test-driven-development, code-review-and-quality); ' +
				'"reference" returns a shared checklist (e.g. definition-of-done, security-checklist); ' +
				'"persona" returns a specialist review persona (e.g. code-reviewer, security-auditor). ' +
				'Call this before non-trivial work to load the workflow you should follow.',
			input_schema: {
				type: 'object',
				properties: {
					action: {
						type: 'string',
						enum: ['list', 'load', 'reference', 'persona'],
						description: 'What to return.',
					},
					name: {
						type: 'string',
						description:
							'Skill, reference, or persona name (required for load/reference/persona).',
					},
					arguments: {
						type: 'string',
						description:
							'Optional: the user request or task scope, substituted for $ARGUMENTS in the loaded skill body. Defaults to the current user prompt.',
					},
				},
				required: ['action'],
			},
		},
		readOnly: true,
		run: ({input}) => {
			const action = typeof input.action === 'string' ? input.action : '';
			const name = typeof input.name === 'string' ? input.name : '';
			const request =
				typeof input.arguments === 'string' && input.arguments.trim()
					? input.arguments
					: lastRequest;
			const text = (value: string): ToolResult => ({
				ok: true,
				content: [{type: 'text', text: value}],
			});

			if (action === 'list') return text(CATALOG);

			if (action === 'load') {
				const doc = findByName(SKILLS, name);
				if (!doc) {
					return {
						ok: false,
						error: `Unknown skill "${name}". Available skills: ${label(SKILLS)}.`,
					};
				}
				const body = substituteSkill(doc.body, request, {
					skillDir: join(SKILLS_DIR, doc.name),
					projectDir: cmd.cwd,
				});
				return text(`# Skill: ${doc.name}\n\n${doc.description}\n\n${body}`);
			}

			if (action === 'reference') {
				const doc = findByName(REFERENCES, name);
				if (!doc) {
					return {
						ok: false,
						error: `Unknown reference "${name}". Available references: ${label(REFERENCES)}.`,
					};
				}
				return text(`# Reference: ${doc.name}\n\n${doc.body}`);
			}

			if (action === 'persona') {
				const doc = findByName(PERSONAS, name);
				if (!doc) {
					return {
						ok: false,
						error: `Unknown persona "${name}". Available personas: ${label(PERSONAS)}.`,
					};
				}
				return text(`# Persona: ${doc.name}\n\n${doc.body}`);
			}

			return {
				ok: false,
				error: `Unknown action "${action}". Use one of: list, load, reference, persona.`,
			};
		},
	});

	// A human-facing status line: /proflow prints what is installed.
	cmd.addCommand({
		name: 'proflow',
		description: 'Show the proflow agent-skills pack status',
		handler: () => ({
			message:
				`${CATALOG}\n\nInstalled from: ${ROOT}\n` +
				`Catalog injection: ${cmd.getFlag('catalog') === false ? 'off' : 'on'} ` +
				'(toggle with --mod-option catalog=false).',
		}),
	});

	// Byte-stable catalog so the model reaches for the right skill by default, plus
	// the typed-input capture that feeds $ARGUMENTS into tool-loaded skills.
	cmd.hooks({
		appendSystemPrompt: () =>
			cmd.getFlag('catalog') === false ? undefined : CATALOG,
		transformInput: ({text}) => {
			lastRequest = text;
			// Returning nothing lets the prompt through unchanged — pure capture.
		},
	});
	cmd.on('run_end', () => {
		lastRequest = '';
	});
}

// Exported for the smoke test only; Command Code loads the default export.
export const __placeholders = {tokenizeArgs, substituteCommand, substituteSkill};
