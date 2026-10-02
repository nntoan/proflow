// mod-orca — the whole `orca` CLI for Command Code.
//
// The same split as mod-gh: `orca_read` is read-only (no prompt, usable in plan
// mode) but restricted to a validated allowlist of read subcommands, while
// `orca_run` carries the full surface — worktrees, terminals, artifacts — through
// the normal permission pipeline.

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

/** `verb subverb` pairs (or a bare verb) that never mutate anything. */
export const READ_ONLY = new Set([
	'worktree list', 'worktree show', 'worktree current', 'worktree ps', 'worktree status',
	'terminal list', 'terminal read', 'terminal show',
	'search',
	'host list',
	'artifact list', 'artifact show',
	'repo list', 'repo show',
	'skill list', 'skill show',
	'comment list',
	'context list', 'context show',
	'config get', 'config list',
	'status', 'help', 'version',
]);

/** Is `args` a read-only `orca` invocation? */
export function isReadOnly(args: readonly string[]): boolean {
	const words = args.filter(token => !token.startsWith('-'));
	if (words.length === 0) return false;
	return READ_ONLY.has(words.slice(0, 2).join(' ')) || READ_ONLY.has(words[0]);
}

async function run(cmd: ModApi, args: string[]): Promise<ToolResult> {
	try {
		const {stdout, stderr, code} = await cmd.exec({command: 'orca', args});
		const text = (stdout || '').trim();
		if (code !== 0) return {ok: false, error: `orca ${args.join(' ')} exited ${code}: ${(stderr || text).trim()}`};
		return {ok: true, content: [{type: 'text', text: text || '(no output)'}]};
	} catch (error) {
		return {ok: false, error: `could not run orca (${String(error)}). Install the Orca CLI and make sure it is on PATH.`};
	}
}

const SCHEMA = {
	type: 'object',
	properties: {
		args: {
			type: 'array',
			items: {type: 'string'},
			description: 'Arguments for orca, without the binary — e.g. ["worktree", "list"].',
		},
	},
	required: ['args'],
};

export default function (cmd: ModApi): void {
	cmd.addTool({
		schema: {
			name: 'orca_read',
			description:
				'Run a read-only orca command (list, show, status, search…). No permission prompt, and it works in ' +
				'plan mode. Mutating subcommands are rejected — use orca_run for those.',
			input_schema: SCHEMA,
		},
		readOnly: true,
		run: ({input}) => {
			const args = Array.isArray(input.args) ? input.args.map(String) : [];
			if (!isReadOnly(args)) {
				return {
					ok: false,
					error: `orca_read only accepts read-only subcommands; "${args.slice(0, 2).join(' ')}" is not on the allowlist. Use orca_run instead.`,
				};
			}
			return run(cmd, args);
		},
	});

	cmd.addTool({
		schema: {
			name: 'orca_run',
			description:
				'Run any orca command, including writes (worktree create/rm, terminal send/create, artifacts share…). ' +
				'Runs in default mode and goes through the normal permission prompt.',
			input_schema: SCHEMA,
		},
		run: ({input}) => run(cmd, Array.isArray(input.args) ? input.args.map(String) : []),
	});
}
