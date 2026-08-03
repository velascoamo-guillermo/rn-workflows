import { describe, expect, it } from 'bun:test';
import { shouldRunMenu } from '../src/utils/cli.ts';

const SUBCOMMANDS = ['init', 'generate', 'setup'];

describe('shouldRunMenu', () => {
  it('opens the menu when no subcommand is given', () => {
    expect(shouldRunMenu([], SUBCOMMANDS)).toBe(true);
  });

  it('does not open the menu after a subcommand ran', () => {
    expect(shouldRunMenu(['generate'], SUBCOMMANDS)).toBe(false);
    expect(shouldRunMenu(['init'], SUBCOMMANDS)).toBe(false);
    expect(shouldRunMenu(['setup'], SUBCOMMANDS)).toBe(false);
  });

  it('opens the menu for unknown positionals', () => {
    expect(shouldRunMenu(['nope'], SUBCOMMANDS)).toBe(true);
  });
});
