// proflow — Command Code integration for addyosmani/agent-skills.
//
// Tools and behaviour only: the skills, commands, references and personas are
// installed natively, so this mod adds just the three things native files cannot:
//
//   1. a three-tier dangerous-command guard (deny / confirm / allow), extensible
//      from `proflow.json(c)` in the user and project scopes;
//   2. one footer segment — cache-hit rate, the peak/off-peak cost window, and
//      the next lifecycle step, learned by watching `activate_skill`;
//   3. `/proflow`, a status command.

import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

// ── Minimal local view of the ModApi this mod uses ─────────────────────────────
// Kept local so the package has no load-time dependency on @commandcode/harness.
type Disposable = {dispose: () => void};
type HookResult = {block?: boolean; additionalContext?: string} | undefined;

interface ModApi {
	readonly name: string;
	readonly cwd: string;
	addCommand(command: {
		name: string;
		description?: string;
		handler: () => {message?: string; prompt?: string} | void;
	}): Disposable;
	addFlag(
		name: string,
		options: {type: 'boolean' | 'string'; default?: boolean | string; description?: string},
	): Disposable;
	getFlag(name: string): boolean | string | undefined;
	hooks(hooks: {
		beforeToolCall?: (input: {
			toolCallId: string;
			toolName: string;
			input: Record<string, unknown>;
		}) => HookResult | Promise<HookResult>;
		onSessionStart?: () => void;
		onSessionEnd?: () => void;
	}): Disposable;
	on(event: string, handler: (payload: Record<string, unknown>) => void): Disposable;
	readonly ui: {
		setStatus(text: string | null): Disposable;
		notify(message: string): void;
		readonly capabilities: {status: boolean};
		confirm(options: {title: string; message?: string}): Promise<boolean>;
	};
}

// ── The guard ──────────────────────────────────────────────────────────────────
//
// Three tiers, checked in this order: allow (a user waiver) beats deny beats
// confirm. Every pattern is a RegExp tested against the raw shell command.

const DENY = [
	// Recursive destroy of a root-ish target (a plain `rm -rf` is only *confirm*).
	/\brm\b[^|;&\n]*\s(\/|\/\*|~|\$HOME|\.\.)(\s|$)/,
	/\bsudo\b[^|;&\n]*\brm\s+-[a-z]*r/,
	/\bfind\s+\/[^|;&\n]*(-delete|-exec\s+rm)/,
	// Raw device / filesystem destruction.
	/\bdd\b[^|;&\n]*\bof=\/dev\/(sd|nvme|disk|hd|loop|rdisk)/,
	/\bmkfs(\.[a-z0-9]+)?\b/,
	/\bwipefs\b/,
	/>\s*\/dev\/(sd|nvme|disk|hd|loop|rdisk)/,
	// /dev/null swaps and permission nukes.
	/\bmv\s+(\/\*|~|\/[a-z]+)\s+\/dev\/null/,
	/\bchmod\s+-R\s+777\s+\//,
	/\bchown\s+-R\b[^|;&\n]*\s\/\s*$/,
	// Fork bomb.
	/:\(\)\s*\{\s*:\|:&\s*\}\s*;:/,
	// Pipe-to-shell (remote or decoded payload straight into a shell).
	/\b(curl|wget|fetch)\b[^|;&\n]*\|\s*(sudo\s+)?(sh|bash|zsh|dash)\b/,
	/\bbase64\s+(-d|--decode)\b[^|;&\n]*\|\s*(sh|bash|zsh)\b/,
	/\beval\s+["'`]?\$\((curl|wget|fetch)\b/,
	// Covering tracks / secret exfiltration.
	/\bhistory\s+-c\b/,
	/>\s*~?\/?\.(bash|zsh)_history/,
	/\brm\b[^|;&\n]*\.(bash|zsh)_history/,
	/(~|\$HOME)\/\.ssh\/[^|;&\n]*\|\s*(curl|nc|wget)/,
	/\benv\b\s*\|\s*(curl|nc|wget)/,
	// Git history rewrite on a protected branch.
	/\bgit\s+push\b[^|;&\n]*--force[^|;&\n]*\b(main|master)\b/,
	/\bgit\s+push\b[^|;&\n]*\b(main|master)\b[^|;&\n]*--force/,
	/\bgit\s+filter-branch\b/,
	/\bgit\s+reflog\s+expire\s+--expire=now\s+--all\b/,
];

const CONFIRM = [
	// Destructive but often intentional.
	/\brm\s+-[a-z]*r[a-z]*\b/,
	/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*[fd]x?[a-z]*|checkout\s+--\s+\.|restore\s+\.)/,
	/\bgit\s+push\b[^|;&\n]*--force\b/,
	/\bgit\s+(commit|push)\b[^|;&\n]*--no-verify\b/,
	// Publishing and releases.
	/\bnpm\s+(publish|unpublish)\b/,
	/\bgh\s+release\s+(create|delete)\b/,
	// Containers, clusters, cloud.
	/\bdocker\s+system\s+prune\b/,
	/\bdocker\s+rm\s+-f\b/,
	/\bdocker\s+volume\s+rm\b/,
	/\bdocker\s+compose\b[^|;&\n]*\bdown\b[^|;&\n]*-v\b/,
	/\bkubectl\s+delete\b/,
	/\bterraform\s+(destroy|apply\b[^|;&\n]*-auto-approve)/,
	/\baws\s+s3\s+(rb\b[^|;&\n]*--force|rm\b[^|;&\n]*--recursive)/,
	// Data.
	/\b(DROP|TRUNCATE)\s+(TABLE|DATABASE)\b/i,
	/\bDELETE\s+FROM\b(?![^;]*\bWHERE\b)/i,
	/\bredis-cli\b[^|;&\n]*\b(FLUSHALL|FLUSHDB)\b/i,
	// Host control.
	/\b(shutdown|reboot|halt|poweroff)\b/,
	/\bkill\s+-9\s+-1\b/,
	/\bkillall5\b/,
	/\bchmod\s+-R\s+777\b/,
];

/** Strip JSONC comments and trailing commas, then parse. No dependency. */
export function parseJsonc(text: string): unknown {
	let out = '';
	let inString = false;
	let quote = '';
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i];
		const next = text[i + 1];
		if (inString) {
			out += ch;
			if (ch === '\\') {
				out += next ?? '';
				i += 1;
			} else if (ch === quote) {
				inString = false;
			}
			continue;
		}
		if (ch === '"' || ch === "'") {
			inString = true;
			quote = ch;
			out += ch;
			continue;
		}
		if (ch === '/' && next === '/') {
			while (i < text.length && text[i] !== '\n') i += 1;
			out += '\n';
			continue;
		}
		if (ch === '/' && next === '*') {
			i += 2;
			while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
			i += 1;
			continue;
		}
		out += ch;
	}
	return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

interface GuardRules {
	deny: RegExp[];
	confirm: RegExp[];
	allow: RegExp[];
}

/** Built-ins, then user, then project — later layers append. */
export function loadRules(cwd: string, home = homedir()): GuardRules {
	const rules: GuardRules = {deny: [...DENY], confirm: [...CONFIRM], allow: []};
	const layers = [join(home, '.commandcode'), join(cwd, '.commandcode')];
	for (const dir of layers) {
		for (const name of ['proflow.json', 'proflow.jsonc']) {
			const file = join(dir, name);
			if (!existsSync(file)) continue;
			try {
				const parsed = parseJsonc(readFileSync(file, 'utf8')) as {
					guard?: {deny?: string[]; confirm?: string[]; allow?: string[]};
				};
				for (const tier of ['deny', 'confirm', 'allow'] as const) {
					for (const pattern of parsed?.guard?.[tier] ?? []) {
						rules[tier].push(new RegExp(pattern));
					}
				}
			} catch {
				// A malformed config never breaks the guard; built-ins still apply.
			}
		}
	}
	return rules;
}

/** Which tier a command lands in. allow beats deny beats confirm. */
export function tierOf(command: string, rules: GuardRules): 'allow' | 'deny' | 'confirm' | null {
	if (rules.allow.some(re => re.test(command))) return 'allow';
	if (rules.deny.some(re => re.test(command))) return 'deny';
	if (rules.confirm.some(re => re.test(command))) return 'confirm';
	return null;
}

// ── The footer ─────────────────────────────────────────────────────────────────

const LIFECYCLE: {match: RegExp; next: string}[] = [
	{match: /^spec-reflection$/, next: '/to-plan'},
	{match: /^spec-driven-development$/, next: '/to-plan'},
	{match: /^planning-and-task-breakdown$/, next: '/build'},
	{match: /^(incremental-implementation|test-driven-development|debugging-and-error-recovery)$/, next: '/to-review'},
	{match: /^(code-review-and-quality|code-simplification|security-and-hardening)$/, next: '/ship'},
];

/** `01:00-04:00,06:00-10:00` (UTC) → peak windows in minutes. */
export function parseWindows(spec: string): [number, number][] {
	const windows: [number, number][] = [];
	for (const part of spec.split(',')) {
		const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(part.trim());
		if (!m) continue;
		windows.push([Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])]);
	}
	return windows;
}

/** Is `now` (minutes since UTC midnight) inside any window? */
export function inWindow(now: number, windows: [number, number][]): boolean {
	return windows.some(([from, to]) => (from <= to ? now >= from && now < to : now >= from || now < to));
}

/** Whether we are inside a window now, and the minutes until the next boundary. */
export function nextFlip(now: number, windows: [number, number][]): {inPeak: boolean; minutes: number} {
	const inPeak = inWindow(now, windows);
	let best = Infinity;
	for (const [from, to] of windows) {
		for (const edge of [from, to]) {
			const delta = (edge - now + 1440) % 1440 || 1440;
			if (delta < best) best = delta;
		}
	}
	return {inPeak, minutes: best === Infinity ? 0 : best};
}

export function formatMinutes(minutes: number): string {
	if (minutes <= 0) return 'now';
	const h = Math.floor(minutes / 60);
	const m = Math.round(minutes % 60);
	return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

// ── The mod ────────────────────────────────────────────────────────────────────

export default function (cmd: ModApi): void {
	cmd.addFlag('guard', {
		type: 'string',
		default: 'all',
		description: 'Dangerous-command guard: off | deny | all',
	});
	cmd.addFlag('footer', {type: 'boolean', default: true, description: 'Show the proflow footer segment.'});
	cmd.addFlag('next-step', {type: 'boolean', default: true, description: 'Show the next lifecycle step.'});
	cmd.addFlag('deepseek', {type: 'boolean', default: true, description: 'Show the peak/off-peak cost window.'});
	cmd.addFlag('deepseek-window', {
		type: 'string',
		default: '01:00-04:00,06:00-10:00',
		description: 'Peak windows in UTC, comma-separated (Mon–Fri).',
	});
	cmd.addFlag('deepseek-model', {
		type: 'string',
		default: 'deepseek',
		description: 'Model id pattern for the cost window.',
	});
	cmd.addFlag('deepseek-holidays', {
		type: 'string',
		default: '',
		description: 'Extra peak dates (YYYY-MM-DD), comma-separated.',
	});

	const rules = loadRules(cmd.cwd);

	// One segment per mod, so every part is composed into a single line.
	let cacheTurn: number | null = null;
	let cacheAvg: number | null = null;
	let nextStep: string | null = null;
	let active = false;
	const refresh = (): void => {
		if (!cmd.ui.capabilities.status) return;
		if (cmd.getFlag('footer') === false || !active) {
			cmd.ui.setStatus(null);
			return;
		}
		const parts = ['proflow'];
		if (cacheTurn !== null) {
			const avg = cacheAvg === null ? '' : ` • avg ${cacheAvg.toFixed(2)}%`;
			parts.push(`cache ${cacheTurn.toFixed(2)}%${avg}`);
		}
		const model = String(cmd.getFlag('deepseek-model') ?? '');
		if (cmd.getFlag('deepseek') !== false && model && model !== 'off') {
			const windows = parseWindows(String(cmd.getFlag('deepseek-window') ?? ''));
			if (windows.length > 0) {
				const now = new Date();
				const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
				const {inPeak, minutes: until} = nextFlip(minutes, windows);
				parts.push(
					inPeak
						? `PEAK • off-peak in ${formatMinutes(until)}`
						: `off-peak (−50%) • peak in ${formatMinutes(until)}`,
				);
			}
		}
		if (nextStep && cmd.getFlag('next-step') !== false) parts.push(`next: ${nextStep}`);
		cmd.ui.setStatus(parts.join(' · '));
	};

	// Active = proflow is actually in use: a lifecycle skill ran, or the tree
	// already holds a proflow artifact. An idle session shows nothing.
	const markActive = (): void => {
		if (active) return;
		active = true;
		refresh();
	};
	for (const probe of [join(cmd.cwd, 'docs', 'spec'), join(cmd.cwd, 'tasks')]) {
		if (existsSync(probe)) {
			active = true;
			break;
		}
	}

	// The next step comes from the skill a command activated — the mod never
	// inspects the command itself, because custom commands emit no event.
	cmd.on('tool_queued', payload => {
		if (payload.toolName !== 'activate_skill') return;
		const name = (payload.input as {name?: string} | undefined)?.name;
		if (typeof name !== 'string') return;
		const step = LIFECYCLE.find(entry => entry.match.test(name));
		if (!step) return;
		nextStep = step.next;
		markActive();
		refresh();
	});

	// Cache-hit rate from the usage the harness reports per model request.
	cmd.on('model_request_end', payload => {
		const usage = (payload.usage ?? {}) as Record<string, number>;
		const read = usage.cacheReadInputTokens ?? usage.cache_read_input_tokens ?? 0;
		const created = usage.cacheCreationInputTokens ?? usage.cache_creation_input_tokens ?? 0;
		const input = usage.inputTokens ?? usage.input_tokens ?? 0;
		const total = read + created + input;
		if (!total) return;
		const hit = (read / total) * 100;
		cacheTurn = hit;
		cacheAvg = cacheAvg === null ? hit : (cacheAvg * 4 + hit) / 5;
		markActive();
		refresh();
	});

	cmd.hooks({
		beforeToolCall: async ({toolName, input}) => {
			const mode = String(cmd.getFlag('guard') ?? 'all');
			if (mode === 'off') return undefined;
			if (toolName !== 'shell_command' && toolName !== 'Bash') return undefined;
			const command = typeof input.command === 'string' ? input.command : '';
			if (!command) return undefined;
			const tier = tierOf(command, mode === 'deny' ? {...rules, confirm: []} : rules);
			if (tier !== 'deny' && tier !== 'confirm') return undefined;
			if (tier === 'confirm') {
				const approved = await cmd.ui.confirm({
					title: 'proflow guard',
					message: `This command can destroy data:\n\n${command}\n\nRun it?`,
				});
				if (approved) return undefined;
				return {block: true, additionalContext: `Blocked by the proflow guard (not confirmed): ${command}`};
			}
			return {
				block: true,
				additionalContext:
					`Blocked by the proflow guard — this command can destroy the machine or leak secrets:\n${command}\n` +
					'Ask the user to run it themselves if it is truly intended.',
			};
		},
		onSessionEnd: () => cmd.ui.setStatus(null),
	});

	cmd.addCommand({
		name: 'proflow',
		description: 'Show the proflow guard, footer, and config status',
		handler: () => {
			const config = [
				join(homedir(), '.commandcode', 'proflow.jsonc'),
				join(cmd.cwd, '.commandcode', 'proflow.jsonc'),
			]
				.filter(existsSync)
				.join(', ');
			return {
				message: [
					'proflow harness mod',
					`  guard        ${cmd.getFlag('guard')} (${rules.deny.length} deny · ${rules.confirm.length} confirm · ${rules.allow.length} allow)`,
					`  footer       ${cmd.getFlag('footer') === false ? 'off' : 'on'}`,
					`  next-step    ${cmd.getFlag('next-step') === false ? 'off' : 'on'}${nextStep ? ` (next: ${nextStep})` : ''}`,
					`  cost window  ${cmd.getFlag('deepseek-window')}`,
					`  config       ${config || '(none — run the installer to create one)'}`,
				].join('\n'),
			};
		},
	});
}

// Exported for the tests; Command Code loads the default export.
export const __internals = {DENY, CONFIRM, LIFECYCLE};
