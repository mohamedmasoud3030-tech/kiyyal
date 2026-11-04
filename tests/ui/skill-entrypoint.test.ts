import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('keeps the project-local UI skill examples runnable from the repository root', () => {
  const root = process.cwd();
  const markdown = readFileSync(resolve(root, '.agents/skills/ui-ux-pro-max/SKILL.md'), 'utf8');
  expect(markdown).not.toContain('CLAUDE_PLUGIN_ROOT');
  expect(markdown).not.toContain('.claude/skills/ui-ux-pro-max');

  const commands = [...markdown.matchAll(/python3 "([^"]+\/search\.py)"/g)];
  expect(commands.length).toBeGreaterThanOrEqual(1);
  for (const [, script] of commands) {
    expect(script).toBe('.agents/skills/ui-ux-pro-max/scripts/search.py');
    expect(existsSync(resolve(root, script))).toBe(true);
  }
});
