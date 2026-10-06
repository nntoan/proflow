// T7 of tasks/plan.md — /proflow's holiday surface, through the real factory.
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MOD = join(here, '..', 'packages', 'proflow', 'mods', 'proflow.ts');
const staged = join(tmpdir(), `proflow-cmd-${process.pid}.mts`);
writeFileSync(staged, readFileSync(MOD, 'utf8'));
let mod;
try {
	mod = await import(pathToFileURL(staged).href);
} finally {
	unlinkSync(staged);
}

const checks = [];
const check = (name, fn) => {
	fn();
	checks.push(name);
	console.log(`  \u001b[32m✓\u001b[0m ${name}`);
};
let failed = false;

const tempHome = () => mkdtempSync(join(tmpdir(), 'proflow-cmd-'));
function boot({home, holidaysFlag = ''}) {
	const commands = new Map();
	const flags = new Map();
	process.env.HOME = home;
	const cmd = {
		cwd: home,
		addCommand: c => commands.set(c.name, c),
		addFlag: (name, options) => flags.set(name, options),
		getFlag: name => (name === 'deepseek-holidays' ? holidaysFlag : flags.get(name)?.default),
		hooks: () => ({dispose() {}}),
		on: () => ({dispose() {}}),
		ui: {capabilities: {status: false}, setStatus: () => ({dispose() {}}), notify() {}, async confirm() { return true; }},
		session: {appendCustomEntry() {}, getCustomEntries: () => []},
	};
	mod.default(cmd);
	return {commands, flags};
}

try {
	check('T7: the command advertises both refreshes', () => {
		const {commands} = boot({home: tempHome()});
		assert.equal(commands.get('proflow').argumentHint, '[--refresh-rates|--refresh-holidays]');
	});

	check('T7: --refresh-holidays runs the script and prints its line', () => {
		const home = tempHome();
		mkdirSync(join(home, '.commandcode', 'scripts'), {recursive: true});
		writeFileSync(join(home, '.commandcode', 'scripts', 'holidays.mjs'),
			"console.log('holidays: wrote 7 days for 2026 → ' + process.argv[process.argv.length - 1]);\n");
		const {commands} = boot({home});
		assert.match(commands.get('proflow').handler({args: '--refresh-holidays'}).message, /^holidays: wrote 7 days for 2026 → /);
	});

	check('T7: a missing script reports a failure, not a crash', () => {
		const {commands} = boot({home: tempHome()});
		assert.match(commands.get('proflow').handler({args: '--refresh-holidays'}).message, /^holidays: (failed|timed out)/);
	});

	check('T7: the flag is registered, inert, and says where off-peak days come from', () => {
		const {flags} = boot({home: tempHome()});
		const flag = flags.get('deepseek-holidays');
		assert.ok(flag, 'still registered, so a config that sets it is not a hard failure');
		assert.match(flag.description, /Ignored — off-peak days come from ~\/\.commandcode\/holidays-cn\.json/);
	});

	check('T7: a non-empty value surfaces once, with the pinned literal', () => {
		const {commands} = boot({home: tempHome(), holidaysFlag: '2026-10-05'});
		const message = commands.get('proflow').handler({args: ''}).message;
		assert.match(message, /deepseek-holidays: 2026-10-05/, message);
		assert.match(message, /ignored — off-peak days come from ~\/\.commandcode\/holidays-cn\.json/);
		assert.match(message, /refresh with \/proflow --refresh-holidays/);
	});

	check('T7: an empty value says nothing (the default stays silent)', () => {
		const {commands} = boot({home: tempHome(), holidaysFlag: ''});
		assert.doesNotMatch(commands.get('proflow').handler({args: ''}).message, /deepseek-holidays/);
	});
} catch (error) {
	failed = true;
	console.error(`  \u001b[31m✗\u001b[0m ${error.message}`);
}
console.log(`\n${failed ? '\u001b[31m✗ failed' : '\u001b[32m✓ passed'}\u001b[0m — ${checks.length} check(s)`);
process.exit(failed ? 1 : 0);
