// mod-codegraph — read-only CodeGraph tools for Command Code.
//
// A mod tool marked `readOnly: true` takes the no-prompt fast path and stays
// available in plan mode, where MCP tools are hidden and hooks are skipped —
// which is exactly when a code graph helps most. No MCP server, no
// `Shell(codegraph *)` allow-rule, no settings.json edits.

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

async function codegraph(cmd: ModApi, args: string[]): Promise<ToolResult> {
	try {
		const {stdout, stderr, code} = await cmd.exec({command: 'codegraph', args});
		const text = (stdout || '').trim();
		if (code !== 0) {
			return {ok: false, error: `codegraph ${args.join(' ')} exited ${code}: ${(stderr || text).trim() || '(no output)'}`};
		}
		return {ok: true, content: [{type: 'text', text: text || '(no output)'}]};
	} catch (error) {
		return {
			ok: false,
			error: `could not run codegraph (${String(error)}). Install it with \`npm i -g @colbymchenry/codegraph\`.`,
		};
	}
}

export default function (cmd: ModApi): void {
	cmd.addTool({
		schema: {
			name: 'codegraph_explore',
			description:
				'Ask the CodeGraph index a question about this repository and get the relevant symbols plus the ' +
				'call paths between them, in one call. Use it before grep/read when a `.codegraph/` directory exists.',
			input_schema: {
				type: 'object',
				properties: {query: {type: 'string', description: 'What to look up: a symbol, a file, or a question.'}},
				required: ['query'],
			},
		},
		readOnly: true,
		run: ({input}) => codegraph(cmd, ['explore', String(input.query ?? '')]),
	});

	cmd.addTool({
		schema: {
			name: 'codegraph_node',
			description: 'Read one node from the CodeGraph index — the line-numbered source of a symbol or file.',
			input_schema: {
				type: 'object',
				properties: {symbol: {type: 'string', description: 'The symbol or file to read.'}},
				required: ['symbol'],
			},
		},
		readOnly: true,
		run: ({input}) => codegraph(cmd, ['node', String(input.symbol ?? '')]),
	});

	cmd.addTool({
		schema: {
			name: 'codegraph_status',
			description: 'Report the CodeGraph index status for this repository (indexed files, freshness).',
			input_schema: {type: 'object', properties: {}},
		},
		readOnly: true,
		run: () => codegraph(cmd, ['status']),
	});
}
