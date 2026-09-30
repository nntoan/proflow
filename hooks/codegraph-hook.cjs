#!/usr/bin/env node
'use strict';
/**
 * proflow — CodeGraph hook (mirrors the Claude Code + GitNexus wiring).
 *
 *   PreToolUse  — when the agent runs a grep/glob/shell search in a repo that
 *                 has a `.codegraph/` index, run `codegraph explore "<query>"`
 *                 and hand the graph context back as additionalContext, so the
 *                 search result arrives pre-enriched.
 *   PostToolUse — after a git history mutation (commit/merge/rebase/cherry-pick/
 *                 pull), nudge about index freshness.
 *
 * Command Code specifics this adapts for (vs the Claude Code original):
 *   - canonical tool names are `grep` / `glob` / `shell_command`;
 *   - the hook payload has no `tool_output.exit_code`, so PostToolUse cannot
 *     gate on success and simply notes the mutation;
 *   - hooks are skipped entirely in plan mode, where MCP tools are hidden too —
 *     so this hook only helps default-mode usage (`/spec` recon additionally
 *     calls `codegraph explore` over the shell, which also works in plan mode).
 *
 * Fails open: any uncertainty (no index, no CLI, bad JSON, timeout) exits
 * silently with no output, which Command Code reads as "no opinion".
 */

const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');

const MAX_CONTEXT = 4000;

function readInput() {
	try {
		return JSON.parse(fs.readFileSync(0, 'utf8'));
	} catch {
		return {};
	}
}

/** Walk up from `start` looking for a `.codegraph/` index directory. */
function findIndexDir(start) {
	let dir = path.resolve(start || process.cwd());
	for (let i = 0; i < 6; i += 1) {
		if (fs.existsSync(path.join(dir, '.codegraph'))) return path.join(dir, '.codegraph');
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

let cliChecked = false;
let cliPresent = false;
function hasCli() {
	if (!cliChecked) {
		cliChecked = true;
		try {
			const finder = process.platform === 'win32' ? 'where' : 'which';
			cliPresent = spawnSync(finder, ['codegraph'], {stdio: 'ignore'}).status === 0;
		} catch {
			cliPresent = false;
		}
	}
	return cliPresent;
}

/** Pull a search query out of the tool input, per tool. */
function extractQuery(toolName, toolInput) {
	if (toolName === 'grep') {
		return typeof toolInput.pattern === 'string' ? toolInput.pattern : null;
	}
	if (toolName === 'glob') {
		const raw = typeof toolInput.pattern === 'string' ? toolInput.pattern : '';
		const match = raw.match(/[*\/]([A-Za-z][A-Za-z0-9_-]{2,})/);
		return match ? match[1] : null;
	}
	if (toolName === 'shell_command' || toolName === 'Bash') {
		const command = typeof toolInput.command === 'string' ? toolInput.command : '';
		if (!/\brg\b|\bgrep\b/.test(command)) return null;
		const tokens = command.split(/\s+/);
		let seen = false;
		for (const token of tokens) {
			if (!seen) {
				if (/\brg$|\bgrep$/.test(token)) seen = true;
				continue;
			}
			if (token.startsWith('-')) continue;
			const cleaned = token.replace(/['"]/g, '');
			return cleaned.length >= 3 ? cleaned : null;
		}
		return null;
	}
	return null;
}

function runExplore(query, cwd) {
	try {
		const child = spawnSync('codegraph', ['explore', query], {
			encoding: 'utf8',
			timeout: 7000,
			cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		});
		if (child.error || child.status !== 0) return '';
		return (child.stdout || '').trim();
	} catch {
		return '';
	}
}

function emit(hookEventName, additionalContext) {
	console.log(JSON.stringify({hookSpecificOutput: {hookEventName, additionalContext}}));
}

function handlePreToolUse(input) {
	const cwd = input.cwd || process.cwd();
	if (!findIndexDir(cwd) || !hasCli()) return;

	const toolName = input.tool_name || '';
	if (toolName !== 'grep' && toolName !== 'glob' && toolName !== 'shell_command' && toolName !== 'Bash') {
		return;
	}
	const query = extractQuery(toolName, input.tool_input || {});
	if (!query || query.length < 3) return;

	const context = runExplore(query, cwd);
	if (!context) return;
	emit('PreToolUse', `[codegraph] graph context for "${query}":\n\n${context.slice(0, MAX_CONTEXT)}`);
}

function handlePostToolUse(input) {
	const toolName = input.tool_name || '';
	if (toolName !== 'shell_command' && toolName !== 'Bash') return;

	const command = (input.tool_input || {}).command || '';
	if (!/\bgit\s+(commit|merge|rebase|cherry-pick|pull)\b/.test(command)) return;

	const cwd = input.cwd || process.cwd();
	if (!findIndexDir(cwd)) return;

	emit(
		'PostToolUse',
		'[codegraph] git history changed. CodeGraph auto-syncs on file edits; run `codegraph sync` if the index looks stale.',
	);
}

function main() {
	try {
		const input = readInput();
		if (input.hook_event_name === 'PreToolUse') handlePreToolUse(input);
		else if (input.hook_event_name === 'PostToolUse') handlePostToolUse(input);
	} catch {
		// fail open — stay silent
	}
}

main();
