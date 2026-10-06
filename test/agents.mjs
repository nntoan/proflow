// Pins the frontmatter of the agents we ship.
//
// Upstream omits `tools:`, which Claude Code reads as "every tool" but this harness
// needs declared: without it a sub-agent invents Claude-style names (Read, Bash) and
// dies on `No tool named Read exists`, returning its malformed call as the answer.
// patches/agent-skills.mjs re-applies the declarations on every upstream sync, so a
// `npm run sync` cannot silently undo what this suite asserts.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const DIR = fileURLToPath(new URL('../packages/proflow/agents/', import.meta.url));
const PATCHES = fileURLToPath(new URL('../patches/agent-skills.mjs', import.meta.url));
const VALID = new Set(['*']);
const AGENTS = ['code-reviewer', 'security-auditor', 'test-engineer', 'web-performance-auditor'];

const checks = [];
const check = (name, fn) => {
	fn();
	checks.push(name);
	console.log(`  \u001b[32m✓\u001b[0m ${name}`);
};

let failed = false;
try {
	check('every shipped agent declares the tools it may use', () => {
		const files = readdirSync(DIR).filter(file => file.endsWith('.md'));
		assert.ok(files.length >= AGENTS.length, `expected the shipped agents, found ${files.length}`);
		for (const file of files) {
			const text = readFileSync(join(DIR, file), 'utf8');
			const declared = /^tools:\s*(.+)$/m.exec(text);
			assert.ok(declared, `${file} must declare tools: — the harness needs an explicit list`);
			const tools = declared[1].split(',').map(tool => tool.trim().replace(/^"|"$/g, '')).filter(Boolean);
			assert.ok(tools.length > 0, `${file} declares an empty tool list`);
			for (const tool of tools) {
				assert.ok(VALID.has(tool), `${file} names "${tool}", which is not a harness tool`);
			}
		}
	});

	check('the declarations are declarative, so a sync cannot undo them', () => {
		const patch = readFileSync(PATCHES, 'utf8');
		for (const name of ['code-reviewer', 'security-auditor', 'test-engineer', 'web-performance-auditor']) {
			assert.ok(patch.includes(`agents/${name}.md`), `patches/agent-skills.mjs must patch agents/${name}.md`);
		}
		assert.match(patch, /tools: "\*"/, 'the patch must carry the grant');
	});
	check('the agent we own is an overlay, and declares its tools there', () => {
		// Not vendored any more: upstream dropped it, and the sync applies patches before restoring
		// overlays, so a patch for that path can only fail.
		const overlay = readFileSync(fileURLToPath(new URL('../overlays/agents/spec-reviewer.md', import.meta.url)), 'utf8');
		assert.match(overlay, /^tools: "\*"$/m, 'the overlay must declare its grant');
		assert.ok(!readFileSync(PATCHES, 'utf8').includes('agents/spec-reviewer.md'), 'and no patch may target it');
	});

} catch (error) {
	failed = true;
	console.error(`  \u001b[31m✗\u001b[0m ${error.message}`);
}

console.log(`\n${failed ? '\u001b[31m✗' : '\u001b[32m✓'}\u001b[0m proflow agent frontmatter — ${checks.length} check(s)${failed ? ' before the failure' : ' passed'}`);
process.exit(failed ? 1 : 0);
