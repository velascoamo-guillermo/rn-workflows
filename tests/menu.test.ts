import { describe, expect, it } from 'bun:test';
import { MENU_CHOICES, SETUP_CHOICES, buildSetupSteps } from '../src/commands/menu.ts';

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

describe('buildSetupSteps (#34)', () => {
  it('"all" includes the App Store Connect step, so makeSecretsStep does not throw on missing ASC vars', () => {
    // Regression: the "all" path used to omit makeAppStoreStep(), so
    // makeSecretsStep threw on 3 missing ASC vars (ASC_KEY_ID,
    // ASC_ISSUER_ID, ASC_KEY_CONTENT) instead of collecting them first.
    const ids = buildSetupSteps('all').map((s) => s.id);
    expect(ids).toContain('appstore');
  });

  it('each single-purpose choice still maps to its own step', () => {
    expect(buildSetupSteps('firebase').map((s) => s.id)).toEqual(['firebase-apps', 'service-account']);
    expect(buildSetupSteps('match').map((s) => s.id)).toEqual(['match-repo']);
    expect(buildSetupSteps('secrets').map((s) => s.id)).toEqual(['secrets']);
  });
});
