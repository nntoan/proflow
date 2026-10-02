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

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
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
	readonly session?: {
		appendCustomEntry(entry: {customType: string; data?: unknown}): unknown;
		getCustomEntries(filter: {customType: string}): {data?: unknown}[];
	};
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

// ── Footer configuration ───────────────────────────────────────────────────────

const ANSI_COLOURS: Record<string, string> = {
	black: '30', red: '31', green: '32', yellow: '33', blue: '34',
	magenta: '35', cyan: '36', white: '37', dim: '2',
};

export interface FooterConfig {
	colour: boolean;
	cost: string;
	cache: {warnBelow: number; alertBelow: number};
	context: {warnAbove: number; alertAbove: number};
}

/**
 * Footer thresholds, layered like the guard rules: built-in defaults, then
 * `~/.commandcode/proflow.json(c)`, then `.commandcode/proflow.json(c)`.
 * A malformed file never breaks the footer.
 */
export function loadFooterConfig(cwd: string, home = homedir()): FooterConfig {
	const config: FooterConfig = {
		colour: true,
		cost: ANSI_COLOURS.blue,
		cache: {warnBelow: 95, alertBelow: 80},
		context: {warnAbove: 80, alertAbove: 90},
	};
	for (const dir of [join(home, '.commandcode'), join(cwd, '.commandcode')]) {
		for (const name of ['proflow.json', 'proflow.jsonc']) {
			const file = join(dir, name);
			if (!existsSync(file)) continue;
			try {
				const footer = (parseJsonc(readFileSync(file, 'utf8')) as {
					footer?: Partial<FooterConfig> & Record<string, unknown>;
				})?.footer;
				if (!footer) continue;
				if (typeof footer.colour === 'boolean') config.colour = footer.colour;
				if (typeof footer.cost === 'string') config.cost = ANSI_COLOURS[footer.cost] ?? config.cost;
				for (const key of ['cache', 'context'] as const) {
					const layer = footer[key] as Record<string, unknown> | undefined;
					if (!layer) continue;
					for (const [name, value] of Object.entries(layer)) {
						if (typeof value === 'number') (config[key] as Record<string, number>)[name] = value;
					}
				}
			} catch {
				// Never let a config typo take the footer down.
			}
		}
	}
	return config;
}

/**
 * Context windows for the models we can name, from Command Code's own registry
 * (`reference/models.md`). A model that is not here shows tokens with no
 * percentage rather than a guess.
 */
export const CONTEXT_WINDOWS: Record<string, number> = {
	'deepseek/deepseek-v4.1-flash': 1_000_000,
	'deepseek/deepseek-v4.1-flash-fast': 1_000_000,
	'deepseek/deepseek-v4-flash-fast': 1_000_000,
	'deepseek/deepseek-v4-flash-vision-exp': 1_000_000,
	'moonshotai/Kimi-K3': 1_000_000,
};

export interface Rates {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite?: number;
	cacheWrite1h?: number;
}

/**
 * One price cell of Command Code's registry: `$0.15/$0.6 · cache $0.003`, or
 * `$0.03/$0.13 · cache $0.006 (write $0.038)` — input/output per million, then
 * the cache-read rate, then an optional cache-write rate. These are the display
 * rates: exactly the numbers the harness's `getDisplayRates` returns.
 */
export function parsePriceColumn(cell: string): Rates | null {
	const main = /\$([0-9.]+)\s*\/\s*\$([0-9.]+)/.exec(cell);
	const cache = /cache\s*\$([0-9.]+)/.exec(cell);
	if (!main || !cache) return null;
	const write = /\(write\s*\$([0-9.]+)\)/.exec(cell);
	return {
		input: Number(main[1]),
		output: Number(main[2]),
		cacheRead: Number(cache[1]),
		...(write ? {cacheWrite: Number(write[1])} : {}),
	};
}

/** The registry table's rows: `| \`model/id\` | … | $in/$out · cache $c | … |`. */
export function parseRegistry(markdown: string): Record<string, Rates> {
	const table: Record<string, Rates> = {};
	for (const line of markdown.split('\n')) {
		const model = /^\|\s*`([^`]+)`\s*\|/.exec(line);
		if (!model) continue;
		const parsed = parsePriceColumn(line);
		if (parsed) table[model[1]] = parsed;
	}
	return table;
}

/**
 * The installed Command Code registry, located from the running bundle
 * (`…/command-code/dist/cli.mjs`): a mod runs in-process, so argv[1] is the
 * harness itself. Each candidate is checked on disk; a miss means no cost.
 */
export function locateRegistry(): string | null {
	const entry = process.argv[1];
	if (!entry) return null;
	let dir = entry;
	for (let depth = 0; depth < 6; depth++) {
		dir = join(dir, '..');
		const candidate = join(dir, 'dist', 'bundled', 'command-code-knowledge', 'reference', 'models.md');
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

/** The payload directory this mod was loaded from (`…/mods/proflow.ts` → `…`). */
function payloadDir(): string | null {
	// The harness loads mods through a CJS transform, so `import.meta` may not
	// exist there (and under the test loader it does not) — `__dirname` is the
	// reliable route, with the ESM branch for a plain `node mods/proflow.ts`.
	try {
		if (typeof __dirname === 'string') return join(__dirname, '..');
	} catch {
		// fall through to the ESM route
	}
	try {
		return decodeURIComponent(new URL('..', import.meta.url).pathname);
	} catch {
		return null;
	}
}

interface RatesConfig {
	source: 'snapshot' | 'runtime';
	prices: Record<string, Rates>;
}

/** `rates` (the shipped snapshot by default) and per-model `prices` overrides. */
function loadRatesConfig(cwd: string): RatesConfig {
	let user: Record<string, unknown> = {};
	for (const name of ['proflow.jsonc', 'proflow.json']) {
		try {
			user = JSON.parse(stripJsonc(readFileSync(join(cwd, name), 'utf8'))) as Record<string, unknown>;
			break;
		} catch {
			// try the next name
		}
	}
	const prices = user.prices as Record<string, Rates> | undefined;
	return {
		source: user.rates === 'runtime' ? 'runtime' : 'snapshot',
		prices: prices && typeof prices === 'object' ? prices : {},
	};
}

/**
 * The rate table: the shipped snapshot by default, the installed registry when
 * `rates: "runtime"` is configured (or when the snapshot is missing, so a stale
 * install still prices correctly), then the user's own `prices` on top. When
 * none can be read the table is empty and the cost segment simply disappears —
 * never a figure we cannot stand behind.
 */
/**
 * Where the snapshot may live, in order: an explicit override, the installed
 * payload directory (where the installer writes it), then next to the mod. The
 * first two do not depend on the loader telling the mod its own path.
 */
function rateFiles(): string[] {
	const files: string[] = [];
	const override = process.env.PROFLOW_RATES;
	if (override) files.push(override);
	files.push(join(homedir(), '.commandcode', 'rates.json'));
	const dir = payloadDir();
	if (dir) files.push(join(dir, 'rates.json'));
	return files;
}

export function loadRates(cwd = process.cwd()): Record<string, Rates> {
	const config = loadRatesConfig(cwd);
	let table: Record<string, Rates> = {};
	if (config.source === 'snapshot') {
		for (const candidate of rateFiles()) {
			try {
				table = JSON.parse(readFileSync(candidate, 'utf8')) as Record<string, Rates>;
				break;
			} catch {
				table = {};
			}
		}
	}
	if (Object.keys(table).length === 0) {
		const file = locateRegistry();
		if (file) {
			try {
				table = parseRegistry(readFileSync(file, 'utf8'));
			} catch {
				table = {};
			}
		}
	}
	return {...table, ...config.prices};
}

/**
 * Re-read the installed registry and rewrite the machine-local snapshot. The
 * installer calls this at install time and `/proflow rates` calls it on demand,
 * so prices can be refreshed without reinstalling anything.
 */
export function refreshRates(
	target = join(homedir(), '.commandcode', 'rates.json'),
): {count: number; file: string} | null {
	const registry = locateRegistry();
	if (!registry) return null;
	let table: Record<string, Rates> = {};
	try {
		table = parseRegistry(readFileSync(registry, 'utf8'));
	} catch {
		return null;
	}
	const count = Object.keys(table).length;
	if (count === 0) return null;
	try {
		mkdirSync(join(target, '..'), {recursive: true});
		writeFileSync(target, `${JSON.stringify(table, null, '\t')}\n`);
	} catch {
		return null;
	}
	activeRates = null; // this process re-reads on the next turn
	return {count, file: target};
}

let activeRates: Record<string, Rates> | null = null;

/** The table, loaded once per process. */
function defaultRates(): Record<string, Rates> {
	activeRates ??= loadRates();
	return activeRates;
}

/**
 * A copy of the harness's estimator (`estimateSessionCostUsd` in cli.mjs), which
 * a mod cannot call — it is injected into the session config, not exported. The
 * formula is theirs verbatim, including the 1-hour cache-write tier:
 *   uncached = max(0, input - cacheRead - cacheWrite)
 *   cost = (uncached·input + output·output + cacheRead·cacheRead
 *           + (cacheWrite - min(cacheWrite1h, cacheWrite))·write
 *           + min(cacheWrite1h, cacheWrite)·write1h) / 1e6
 */
export function estimateCost(
	model: string | null,
	usage: Record<string, number>,
	table: Record<string, Rates> = defaultRates(),
): number | null {
	const rates = model ? table[model] : undefined;
	if (!rates) return null;
	const input = usage.inputTokens ?? 0;
	const output = usage.outputTokens ?? 0;
	const read = usage.cacheReadTokens ?? 0;
	const written = usage.cacheWriteTokens ?? 0;
	const written1h = usage.cacheWriteTokens1h ?? 0;
	const uncached = Math.max(0, input - read - written);
	const oneHour = Math.min(written1h, written);
	const plain = written - oneHour;
	const writeCost = rates.cacheWrite ?? 0;
	const write1hCost = rates.cacheWrite1h ?? writeCost;
	return (
		(uncached * rates.input +
			output * rates.output +
			read * rates.cacheRead +
			plain * writeCost +
			oneHour * write1hCost) /
		1e6
	);
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
	cmd.addFlag('colour', {
		type: 'boolean',
		default: true,
		description: 'Colour the footer (false strips every escape; proflow.jsonc can set this too).',
	});
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

	// One segment per mod, and the TUI collapses it to a single line — so the parts
	// that want a line of their own (the next step, the cost window) are feed rows.
	const footer = loadFooterConfig(cmd.cwd);
	let model: string | null = null;
	let effort: string | null = null;
	let contextTokens: number | null = null;
	let cacheTurn: number | null = null;
	let sessionRead = 0; // cached prompt tokens, whole session
	let sessionTotal = 0; // prompt tokens, whole session
	let turnCost = 0;
	let shownCost = 0;
	let nextStep: string | null = null;
	let active = false;

	// The footer is printed verbatim, so styling is ours. `colour: false` in the
	// config (or --mod-option colour=false) strips every escape.
	const styling = footer.colour && cmd.getFlag('colour') !== false;
	const paint = (text: string, colour: string): string => (styling ? `\u001b[${colour}m${text}\u001b[0m` : text);
	const dim = (text: string): string => paint(text, '2');
	const GREEN = '32';
	const YELLOW = '33';
	const RED = '31';

	const windowFor = (id: string | null): number | null => (id ? CONTEXT_WINDOWS[id] ?? null : null);
	const cacheColour = (hit: number): string =>
		hit >= footer.cache.warnBelow ? GREEN : hit >= footer.cache.alertBelow ? YELLOW : RED;
	const contextColour = (pct: number): string =>
		pct < footer.context.warnAbove ? GREEN : pct < footer.context.alertAbove ? YELLOW : RED;
	const count = (tokens: number): string => (tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens));

	// The session aggregate is durable: it is seeded from the session's own
	// entries, so it survives a `/reload` *and* a `--resume` — the documented
	// reload pattern for a mod with in-memory state.
	const CACHE_ENTRY = 'proflow/cache';
	const seedSessionCounters = (): void => {
		const entries = cmd.session?.getCustomEntries({customType: CACHE_ENTRY}) ?? [];
		const last = entries.at(-1)?.data as {read?: number; total?: number} | undefined;
		if (typeof last?.read === 'number' && typeof last.total === 'number') {
			sessionRead = last.read;
			sessionTotal = last.total;
		}
	};
	const persistSessionCounters = (): void => {
		cmd.session?.appendCustomEntry({customType: CACHE_ENTRY, data: {read: sessionRead, total: sessionTotal}});
	};
	seedSessionCounters();

	const refresh = (): void => {
		if (!cmd.ui.capabilities.status) return;
		if (cmd.getFlag('footer') === false || !active) {
			cmd.ui.setStatus(null);
			return;
		}
		const parts: string[] = [];
		if (model) {
			const name = model.includes('/') ? model.split('/').pop() : model;
			parts.push(`${name}${effort ? ` ${dim(`(${effort})`)}` : ''}`);
		}
		if (contextTokens !== null) {
			const window = windowFor(model);
			const pct = window ? (contextTokens / window) * 100 : null;
			const label = `ctx ${count(contextTokens)}`;
			parts.push(pct === null ? label : paint(`${label} (${pct.toFixed(1)}%)`, contextColour(pct)));
		}
		if (cacheTurn !== null) {
			parts.push(`${dim('cache')} ${paint(`${cacheTurn.toFixed(2)}%`, cacheColour(cacheTurn))}`);
		}
		if (sessionTotal > 0) {
			const avg = (sessionRead / sessionTotal) * 100;
			parts.push(`${dim('avg')} ${paint(`${avg.toFixed(2)}%`, cacheColour(avg))}`);
		}
		// The turn's cost, last — and only when the model's rates are known.
		if (shownCost > 0) parts.push(paint(`$${shownCost.toFixed(4)}/turn`, footer.cost));
		cmd.ui.setStatus(parts.length > 0 ? parts.join(dim(' · ')) : 'proflow');
	};

	/** Is this model one the cost window is configured for? */
	const onCostWindowModel = (): boolean => {
		const pattern = String(cmd.getFlag('deepseek-model') ?? '').toLowerCase();
		if (!pattern || pattern === 'off' || !model) return false;
		return model.toLowerCase().includes(pattern);
	};

	/**
	 * The peak/off-peak state, as a feed row. Re-emitted once per turn so it stays
	 * visible in the feed — a row cannot persist the way a footer segment does.
	 */
	const windowRow = (): string => {
		const windows = parseWindows(String(cmd.getFlag('deepseek-window') ?? ''));
		if (windows.length === 0) return '';
		const now = new Date();
		const {inPeak, minutes} = nextFlip(now.getUTCHours() * 60 + now.getUTCMinutes(), windows);
		const text = inPeak
			? `PEAK — off-peak in ${formatMinutes(minutes)}`
			: `off-peak (−50%) — peak in ${formatMinutes(minutes)}`;
		return paint(text, inPeak ? YELLOW : GREEN);
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
	// inspects the command itself, because custom commands emit no event. It gets a
	// feed row of its own: the footer is one line, by contract. The harness already
	// prefixes a row with the mod's name, so the message carries no label of ours.
	cmd.on('tool_queued', payload => {
		if (payload.toolName !== 'activate_skill') return;
		const name = (payload.input as {name?: string} | undefined)?.name;
		if (typeof name !== 'string') return;
		const step = LIFECYCLE.find(entry => entry.match.test(name));
		if (!step) return;
		markActive();
		if (step.next !== nextStep && cmd.getFlag('next-step') !== false) {
			cmd.ui.notify(paint(`next: ${step.next}`, GREEN));
		}
		nextStep = step.next;
		refresh();
	});

	// A turn's cost is the sum of the requests inside it: the bucket resets when a
	// turn starts, and the previous turn's value stays visible until the next one.
	cmd.on('turn_start', () => {
		turnCost = 0;
	});

	// Once per turn: keep the cost window visible in the feed (a feed row cannot
	// persist the way a footer segment does), and persist the session counters so
	// the average survives the next reload or resume.
	cmd.on('turn_end', () => {
		if (sessionTotal > 0) persistSessionCounters();
		if (active && cmd.getFlag('deepseek') !== false && onCostWindowModel()) {
			const row = windowRow();
			if (row) cmd.ui.notify(row);
		}
	});

	// Every field is read from the payload the harness actually sends —
	// {usage: {inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
	// cacheWriteTokens1h?}, model, effort} — with the camel/lower-snake spellings
	// kept as fallbacks for other providers. The cost is *not* in the payload: the
	// harness estimates it only when writing the session, so we replicate that
	// estimator from the tokens and the registry rates.
	cmd.on('model_request_end', payload => {
		const usage = (payload.usage ?? {}) as Record<string, number>;
		const read = usage.cacheReadTokens ?? usage.cacheReadInputTokens ?? usage.cache_read_input_tokens ?? 0;
		const written = usage.cacheWriteTokens ?? usage.cacheCreationInputTokens ?? usage.cache_creation_input_tokens ?? 0;
		const input = usage.inputTokens ?? usage.input_tokens ?? 0;
		if (typeof payload.model === 'string') model = payload.model;
		if (typeof payload.effort === 'string') effort = payload.effort;

		// `inputTokens` is the whole prompt for some providers and only the uncached
		// remainder for others. Deriving the uncached part makes the rate correct
		// either way, and never counts the cached tokens twice.
		if (input > 0) {
			const uncached = read + written <= input ? input - read - written : input;
			const total = uncached + read + written;
			cacheTurn = (read / total) * 100;
			sessionRead += read;
			sessionTotal += total;
			contextTokens = input;
		}
		const cost = estimateCost(model, usage);
		if (cost !== null) {
			turnCost += cost;
			shownCost = turnCost;
		}
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
		argumentHint: '[rates]',
		handler: ({args}: {args?: string} = {}) => {
			if (String(args ?? '').trim() === 'rates') {
				const result = refreshRates();
				return {
					message: result
						? `proflow rates — wrote ${result.count} models to ${result.file}`
						: 'proflow rates — no installed Command Code registry found; the footer reads it live instead.',
				};
			}
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
					`  rates        ${existsSync(join(homedir(), '.commandcode', 'rates.json')) ? 'snapshot' : 'live registry'}`,
					`  config       ${config || '(none — run the installer to create one)'}`,
				].join('\n'),
			};
		},
	});
}

// Exported for the tests; Command Code loads the default export.
export const __internals = {DENY, CONFIRM, LIFECYCLE};
