import { describe, expect, it } from 'bun:test';
import { MENU_CHOICES, SETUP_CHOICES } from '../src/commands/menu.ts';

describe('menu choices', () => {
  it('exports MENU_CHOICES array with required options', () => {
    const values = MENU_CHOICES.map((c) => c.value);
    expect(values).toContain('init');
    expect(values).toContain('generate');
    expect(values).toContain('setup');
    expect(values).toContain('add_testers');
    expect(values).toContain('remove_testers');
    expect(values).toContain('add_device');
    expect(values).toContain('remove_device');
    expect(values).toContain('regenerate_certs');
    expect(values).toContain('view_profiles');
    expect(values).toContain('view_devices');
    expect(values).toContain('configure_apple_auth');
    expect(values).toContain('exit');
  });

  it('exports SETUP_CHOICES array with required options', () => {
    const values = SETUP_CHOICES.map((c) => c.value);
    expect(values).toContain('firebase');
    expect(values).toContain('match');
    expect(values).toContain('secrets');
    expect(values).toContain('all');
    expect(values).toContain('back');
  });
});
