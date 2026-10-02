// mod-gh — the whole `gh` CLI for Command Code.
//
// `readOnly` is a *gate*, not a restriction: `gh_read` takes the no-prompt fast
// path (and stays available in plan mode) but may only run subcommands on a
// hard-coded read allowlist; `gh_run` covers everything else — `pr create`,
// `issue close`, `release create` — through the normal permission pipeline.

type Disposable = {dispose: () => void};
type ToolResult = {ok: true; content: {type: 'text'; text: string}[]} | {ok: false; error: string};

interface ModApi {
	addTool(tool: {
		schema: {name: string; description: string; input_schema: Record<string, unknown>};
		readOnly?: boolean;
		run: (ctx: {input: Record<string, unknown>}) => ToolResult | Promise<ToolResult>;
	}): Disposable;
	exec(options: {command: string; args?: string[]}): Promise<{stdout: string; stderr: string; code: number}>;
}

/**
 * `verb subverb` pairs (or a bare verb) that never mutate anything. A call is
 * read-only only when its first tokens match one of these exactly — anything
 * else must go through `gh_run`.
 */
export const READ_ONLY = new Set([
	'pr view', 'pr list', 'pr diff', 'pr checks', 'pr status',
	'issue view', 'issue list', 'issue status',
	'run view', 'run list', 'run watch',
	'repo view', 'repo list',
	'release view', 'release list',
	'workflow view', 'workflow list',
	'cache list',
	'label list',
	'gist list', 'gist view',
	'auth status',
	'config get', 'config list',
	'extension list',
	'secret list', 'variable list',
	'search',
	'status', 'help', 'version',
]);

/** Is `args` a read-only `gh` invocation? */
export function isReadOnly(args: readonly string[]): boolean {
	const words = args.filter(token => !token.startsWith('-'));
	if (words.length === 0) return false;
	return READ_ONLY.has(words.slice(0, 2).join(' ')) || READ_ONLY.has(words[0]);
}

async function run(cmd: ModApi, args: string[]): Promise<ToolResult> {
	try {
		const {stdout, stderr, code} = await cmd.exec({command: 'gh', args});
		const text = (stdout || '').trim();
		if (code !== 0) return {ok: false, error: `gh ${args.join(' ')} exited ${code}: ${(stderr || text).trim()}`};
		return {ok: true, content: [{type: 'text', text: text || '(no output)'}]};
	} catch (error) {
		return {ok: false, error: `could not run gh (${String(error)}). Install it and run \`gh auth login\`.`};
	}
}

const SCHEMA = {
	type: 'object',
	properties: {
		args: {
			type: 'array',
			items: {type: 'string'},
			description: 'Arguments for gh, without the binary — e.g. ["pr", "view", "12", "--json", "title,state"].',
		},
	},
	required: ['args'],
};

export default function (cmd: ModApi): void {
	cmd.addTool({
		schema: {
			name: 'gh_read',
			description:
				'Run a read-only gh command (view, list, diff, status, search…). No permission prompt, and it works ' +
				'in plan mode. Write subcommands are rejected — use gh_run for those.',
			input_schema: SCHEMA,
		},
		readOnly: true,
		run: ({input}) => {
			const args = Array.isArray(input.args) ? input.args.map(String) : [];
			if (!isReadOnly(args)) {
				return {
					ok: false,
					error: `gh_read only accepts read-only subcommands; "${args.slice(0, 2).join(' ')}" is not on the allowlist. Use gh_run instead.`,
				};
			}
			return run(cmd, args);
		},
	});

	cmd.addTool({
		schema: {
			name: 'gh_run',
			description:
				'Run any gh command, including writes (pr create, pr merge, issue close, release create…). ' +
				'Runs in default mode and goes through the normal permission prompt.',
			input_schema: SCHEMA,
		},
		run: ({input}) => run(cmd, Array.isArray(input.args) ? input.args.map(String) : []),
	});
}
