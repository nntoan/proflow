#!/usr/bin/env node
// Smoke test for the proflow mod. Loads mods/proflow.ts with a mock ModApi and
// exercises every surface it registers — no Command Code session required.
//
// Run: node test/smoke.mjs   (Node 22.6+ strips the mod's TypeScript types)

import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The mod resolves its package root from __dirname (jiti injects it) or, as a
// fallback, the working directory — so run the test from the package root.
process.chdir(ROOT);

const commands = new Map();
const tools = new Map();
const flags = new Map();
const hooks = [];
const events = new Map();

const cmd = {
	name: 'proflow',
	cwd: process.cwd(),
	addCommand(command) {
		assert.ok(!commands.has(command.name), `duplicate command /${command.name}`);
		commands.set(command.name, command);
		return {dispose() {}};
	},
	addTool(tool) {
		assert.ok(!tools.has(tool.schema.name), `duplicate tool ${tool.schema.name}`);
		tools.set(tool.schema.name, tool);
		return {dispose() {}};
	},
	addFlag(name, options) {
		flags.set(name, options.default);
		return {dispose() {}};
	},
	getFlag(name) {
		return flags.get(name);
	},
	hooks(hook) {
		hooks.push(hook);
		return {dispose() {}};
	},
	on(event, handler) {
		events.set(event, handler);
		return {dispose() {}};
	},
};

const modSource = readFileSync(join(ROOT, 'mods', 'proflow.ts'), 'utf8');
const modUrl =
	'data:text/javascript;base64,' +
	Buffer.from(stripTypeScriptTypes(modSource, {mode: 'strip'})).toString('base64');
const mod = await import(modUrl);
assert.equal(typeof mod.default, 'function', 'mod must default-export a factory');
mod.default(cmd);

const checks = [];
const check = (name, fn) => {
	fn();
	checks.push(name);
};

check('registers the lifecycle commands', () => {
	for (const name of ['brainstorm', 'spec', 'to-plan', 'build', 'test', 'to-review', 'ship']) {
		assert.ok(commands.has(name), `missing /${name}`);
	}
});

check('commands have descriptions and argument hints', () => {
	assert.match(commands.get('spec').description, /spec/i);
	assert.equal(commands.get('build').argumentHint, '[auto]');
	assert.equal(commands.get('spec').argumentHint, '<goal | ticket | version>');
});

check('registers the agent_skills tool as read-only', () => {
	const tool = tools.get('agent_skills');
	assert.ok(tool, 'agent_skills tool missing');
	assert.equal(tool.readOnly, true);
	assert.deepEqual(tool.schema.input_schema.properties.action.enum, [
		'list',
		'load',
		'reference',
		'persona',
	]);
});

const run = input => tools.get('agent_skills').run({input});

check('agent_skills list returns the catalog', () => {
	const result = run({action: 'list'});
	assert.equal(result.ok, true);
	const text = result.content[0].text;
	assert.match(text, /spec-driven-development/);
	assert.match(text, /personas/i);
});

check('agent_skills loads every bundled skill', () => {
	const skillDirs = readdirSync(join(ROOT, 'skills')).filter(name =>
		existsSync(join(ROOT, 'skills', name, 'SKILL.md')),
	);
	assert.ok(skillDirs.length >= 25, `expected >=25 skills, found ${skillDirs.length}`);
	for (const name of skillDirs) {
		const result = run({action: 'load', name});
		assert.equal(result.ok, true, `load ${name} failed`);
		assert.ok(result.content[0].text.length > 200, `${name} body too short`);
	}
});

check('agent_skills loads a reference and a persona', () => {
	const ref = run({action: 'reference', name: 'definition-of-done'});
	assert.equal(ref.ok, true);
	assert.match(ref.content[0].text, /Reference: definition-of-done/);

	const persona = run({action: 'persona', name: 'code-reviewer'});
	assert.equal(persona.ok, true);
	assert.match(persona.content[0].text, /Persona: code-reviewer/);
});

check('agent_skills reports unknown names instead of throwing', () => {
	const missing = run({action: 'load', name: 'nope'});
	assert.equal(missing.ok, false);
	assert.match(missing.error, /Unknown skill/);

	const badAction = run({action: 'bogus'});
	assert.equal(badAction.ok, false);
	assert.match(badAction.error, /Unknown action/);
});

check('ships the spec-reviewer persona and the /brainstorm command', () => {
	const persona = run({action: 'persona', name: 'spec-reviewer'});
	assert.equal(persona.ok, true);
	assert.match(persona.content[0].text, /Spec Reviewer/);

	const brainstorm = commands.get('brainstorm').handler({args: 'offline notes', cwd: ROOT});
	assert.match(brainstorm.prompt, /idea-refine/);
	assert.match(brainstorm.prompt, /ARGUMENTS: offline notes/);
});

check('/spec recons, reflects with spec-reviewer, and gates on approval', () => {
	const spec = commands.get('spec').handler({args: 'PROJ-7 SSO', cwd: ROOT});
	assert.match(spec.prompt, /docs\/spec\/<id>\/SPEC\.md/);
	assert.match(spec.prompt, /explore-brief\.md/);
	assert.match(spec.prompt, /review-log\.md/);
	assert.match(spec.prompt, /subagent_type: "explore"/);
	assert.match(spec.prompt, /spec-reviewer/);
	assert.match(spec.prompt, /ask_user_question/);
	assert.match(spec.prompt, /Ask first/);
	assert.match(spec.prompt, /codegraph explore/);
	assert.match(spec.prompt, /ARGUMENTS: PROJ-7 SSO/);
	assert.doesNotMatch(spec.prompt, /top-level `SPEC\.md` is accepted/);
});

check('lifecycle commands return their workflow and template arguments', () => {
	const spec = commands.get('spec').handler({args: 'add SSO login', cwd: ROOT});
	assert.match(spec.prompt, /spec-driven-development/);
	assert.match(spec.prompt, /ARGUMENTS: add SSO login/);

	// build.md places $ARGUMENTS inline, so it substitutes in place — no footer.
	const buildAuto = commands.get('build').handler({args: 'auto', cwd: ROOT});
	assert.match(buildAuto.prompt, /incremental-implementation/);
	assert.match(buildAuto.prompt, /test-driven-development/);
	assert.match(buildAuto.prompt, /`auto` selects the mode/);
	assert.doesNotMatch(buildAuto.prompt, /\$ARGUMENTS/);
	assert.doesNotMatch(buildAuto.prompt, /ARGUMENTS: auto/);

	const buildBare = commands.get('build').handler({args: '', cwd: ROOT});
	assert.doesNotMatch(buildBare.prompt, /\$ARGUMENTS/);
	assert.doesNotMatch(buildBare.prompt, /ARGUMENTS:/);

	const ship = commands.get('ship').handler({args: '', cwd: ROOT});
	assert.match(ship.prompt, /shipping-and-launch/);
	assert.match(ship.prompt, /agent/);
});

check('command grammar matches Command Code native placeholders', () => {
	const {substituteCommand} = mod.__placeholders;
	const body =
		'ALL=$ARGUMENTS | A1=$1 | B2=${2} | DEF=${2:-fb} | MISS=${4:-m} | ' +
		'SLICE=${@:2} | SLICELEN=${@:2:1} | AT=${@} | ATDEF=${@:-none} | EMPTY=${@:9}';

	const nonEmpty = substituteCommand(body, 'alpha "beta gamma" delta');
	assert.match(nonEmpty.text, /ALL=alpha "beta gamma" delta/);
	assert.match(nonEmpty.text, /A1=alpha/);
	assert.match(nonEmpty.text, /B2=beta gamma/);
	assert.match(nonEmpty.text, /DEF=beta gamma/);
	assert.match(nonEmpty.text, /MISS=m/);
	assert.match(nonEmpty.text, /SLICE=beta gamma delta/);
	assert.match(nonEmpty.text, /SLICELEN=beta gamma \|/);
	assert.match(nonEmpty.text, /AT=alpha "beta gamma" delta/);
	assert.match(nonEmpty.text, /ATDEF=alpha "beta gamma" delta/);
	assert.match(nonEmpty.text, /EMPTY=$/);
	assert.equal(nonEmpty.substituted, true);

	const empty = substituteCommand('x=${3:-d} y=$1 z=$ARGUMENTS', '');
	assert.match(empty.text, /^x=d y= z=$/);

	assert.equal(substituteCommand('no placeholders here', 'abc').substituted, false);
});

check('skill grammar resolves $ARGUMENTS and leaves other ${...} alone', () => {
	const {substituteSkill} = mod.__placeholders;
	const out = substituteSkill(
		'idea=$ARGUMENTS first=$ARGUMENTS[0] pos=${1} dir=${COMMANDCODE_SKILL_DIR} ' +
			'proj=${CLAUDE_PROJECT_DIR} sql=$1 other=${HOME} code=${userId}',
		'add wishlist',
		{skillDir: '/p/skills/idea-refine', projectDir: '/proj'},
	);
	assert.match(out, /idea=add wishlist/);
	assert.match(out, /first=add/);
	assert.match(out, /pos=wishlist/);
	assert.match(out, /dir=\/p\/skills\/idea-refine/);
	assert.match(out, /proj=\/proj/);
	assert.match(out, /sql=\$1 /); // no bare $N form in skill grammar
	assert.match(out, /other=\$\{HOME\}/);
	assert.match(out, /code=\$\{userId\}/);
});

check('skills are served untouched when they contain no placeholders', () => {
	const result = run({action: 'load', name: 'api-and-interface-design'});
	assert.equal(result.ok, true);
	// ${userId}:${amount} must survive — it is code, not a placeholder.
	assert.match(result.content[0].text, /\$\{userId\}:\$\{amount\}/);
});

check('tool-loaded skills resolve $ARGUMENTS from the captured prompt', () => {
	hooks[0].transformInput({text: 'refine an idea: offline-first notes'});
	const captured = run({action: 'load', name: 'idea-refine'});
	assert.equal(captured.ok, true);
	assert.match(captured.content[0].text, /offline-first notes/);
	assert.doesNotMatch(captured.content[0].text, /\$ARGUMENTS/);

	// An explicit `arguments` value wins over the captured prompt.
	const explicit = run({
		action: 'load',
		name: 'idea-refine',
		arguments: 'build a kanban board',
	});
	assert.match(explicit.content[0].text, /build a kanban board/);
});

check('run_end clears the captured prompt', () => {
	events.get('run_end')();
	const result = run({action: 'load', name: 'idea-refine'});
	assert.doesNotMatch(result.content[0].text, /offline-first notes/);
	assert.doesNotMatch(result.content[0].text, /\$ARGUMENTS/);
});

check('/proflow reports the pack status', () => {
	const info = commands.get('proflow').handler({args: '', cwd: ROOT});
	assert.match(info.message, /25 skills/);
});

check('the catalog hook is byte-stable and lists skills', () => {
	assert.equal(hooks.length, 1);
	const first = hooks[0].appendSystemPrompt();
	const second = hooks[0].appendSystemPrompt();
	assert.equal(first, second, 'catalog must be byte-stable');
	assert.match(first, /agent_skills/);
	assert.match(first, /shipping-and-launch/);
	assert.match(first, /\/brainstorm/);
	assert.match(first, /docs\/spec\//);
});

check('the catalog lists every bundled skill', () => {
	const catalog = hooks[0].appendSystemPrompt();
	for (const name of readdirSync(join(ROOT, 'skills'))) {
		if (!existsSync(join(ROOT, 'skills', name, 'SKILL.md'))) continue;
		assert.ok(catalog.includes(name), `catalog is missing ${name}`);
	}
});

check('catalog flag disables the hook', () => {
	flags.set('catalog', false);
	assert.equal(hooks[0].appendSystemPrompt(), undefined);
	flags.set('catalog', true);
});

console.log(`\n✓ proflow smoke test — ${checks.length} checks passed\n`);
for (const name of checks) console.log(`  ✓ ${name}`);
console.log('');
