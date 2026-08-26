import { defineCommand } from 'citty';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as p from '@clack/prompts';
import yaml from 'js-yaml';
import {
  CI_PROVIDERS,
  ConfigSchema,
  DISTRIBUTIONS,
  PROJECT_TYPES,
  type CiProvider,
  type ProjectType,
} from '../config/schema.ts';
import { detectExpoScheme } from '../utils/expo.ts';

const BUILD_PROFILE_NAMES = ['preview', 'staging', 'production'] as const;

export default defineCommand({
  meta: {
    name: 'init',
    description: 'Interactively create rn-workflows.yml',
  },
  args: {
    force: {
      type: 'boolean',
      description: 'Overwrite existing rn-workflows.yml',
      default: false,
    },
    cwd: {
      type: 'string',
      description: 'Directory to create rn-workflows.yml in',
      default: process.cwd(),
    },
    yes: {
      type: 'boolean',
      description:
        'Non-interactive: skip all prompts, using flag values (or the same sane defaults the prompts use).',
      default: false,
    },
    'project-type': {
      type: 'string',
      description: `[--yes] Project type. Valid: ${PROJECT_TYPES.join(', ')}. Default: expo`,
    },
    'bundle-id': {
      type: 'string',
      description: '[--yes] iOS bundle identifier, e.g. com.myapp. Default: com.example.app',
    },
    'package-name': {
      type: 'string',
      description: '[--yes] Android package name. Default: same as --bundle-id',
    },
    scheme: {
      type: 'string',
      description:
        '[--yes] Xcode scheme (ios/<scheme>.xcworkspace). Default: auto-detected from app.json (Expo) or the bundle id tail',
    },
    ci: {
      type: 'string',
      description: `[--yes] CI provider. Valid: ${CI_PROVIDERS.join(', ')}. Default: github-actions`,
    },
    profiles: {
      type: 'string',
      description: `[--yes] Comma-separated build profiles. Valid: ${BUILD_PROFILE_NAMES.join(', ')}. Default: preview,production`,
    },
    distribution: {
      type: 'string',
      description: `[--yes] Distribution(s) for preview/staging profiles, "+"-combinable. Valid: ${DISTRIBUTIONS.filter((d) => d !== 'store').join(', ')}. Default: firebase`,
    },
  },
  async run({ args }) {
    p.intro('rn-workflows init');
    const outPath = resolve(String(args.cwd), 'rn-workflows.yml');
    if (existsSync(outPath) && !args.force) {
      p.log.error(`${outPath} already exists. Pass --force to overwrite.`);
      process.exit(1);
    }

    let projectType: ProjectType;
    let bundleId: string;
    let packageName: string;
    let scheme: string;
    let ci: CiProvider;
    let profiles: string[];
    let distributions: string[];

    if (args.yes) {
      projectType = String(args['project-type'] ?? 'expo') as ProjectType;
      if (!(PROJECT_TYPES as readonly string[]).includes(projectType)) {
        p.log.error(`Invalid --project-type "${projectType}". Valid: ${PROJECT_TYPES.join(', ')}`);
        process.exit(1);
      }

      bundleId = String(args['bundle-id'] ?? 'com.example.app');
      if (!bundleId.includes('.')) {
        p.log.error(`Invalid --bundle-id "${bundleId}" — must look like com.myapp.`);
        process.exit(1);
      }

      packageName = String(args['package-name'] ?? bundleId);

      const defaultScheme =
        (projectType === 'expo' ? detectExpoScheme(String(args.cwd)) : undefined) ??
        bundleId.split('.').pop() ??
        'App';
      scheme = String(args.scheme ?? defaultScheme);

      ci = String(args.ci ?? 'github-actions') as CiProvider;
      if (!(CI_PROVIDERS as readonly string[]).includes(ci)) {
        p.log.error(`Invalid --ci "${ci}". Valid: ${CI_PROVIDERS.join(', ')}`);
        process.exit(1);
      }

      profiles = String(args.profiles ?? 'preview,production')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const unknownProfiles = profiles.filter((name) => !BUILD_PROFILE_NAMES.includes(name as never));
      if (profiles.length === 0 || unknownProfiles.length > 0) {
        p.log.error(
          `Invalid --profiles "${profiles.join(',')}". Valid: ${BUILD_PROFILE_NAMES.join(', ')}`,
        );
        process.exit(1);
      }

      const validDistributions = DISTRIBUTIONS.filter((d) => d !== 'store');
      distributions = String(args.distribution ?? 'firebase')
        .split('+')
        .map((s) => s.trim())
        .filter(Boolean);
      const unknownDistributions = distributions.filter(
        (d) => !(validDistributions as readonly string[]).includes(d),
      );
      if (distributions.length === 0 || unknownDistributions.length > 0) {
        p.log.error(
          `Invalid --distribution "${distributions.join('+')}". Valid: ${validDistributions.join(', ')} (combine with "+")`,
        );
        process.exit(1);
      }
    } else {
      projectType = (await p.select({
        message: 'Project type',
        options: PROJECT_TYPES.map((t) => ({ value: t, label: t })),
        initialValue: 'expo' as ProjectType,
      })) as ProjectType;
      assertNotCancelled(projectType);

      bundleId = (await p.text({
        message: 'iOS bundle identifier (e.g. com.myapp)',
        placeholder: 'com.myapp',
        validate: (v) => (v && v.includes('.') ? undefined : 'Must look like com.myapp'),
      })) as string;
      assertNotCancelled(bundleId);

      packageName = (await p.text({
        message: 'Android package name',
        placeholder: bundleId,
        defaultValue: bundleId,
      })) as string;
      assertNotCancelled(packageName);

      // `expo prebuild` names the Xcode project after `expo.name`, not the bundle id.
      const defaultScheme =
        (projectType === 'expo' ? detectExpoScheme(String(args.cwd)) : undefined) ??
        bundleId.split('.').pop() ??
        'App';
      scheme = (await p.text({
        message: 'Xcode scheme (ios/<scheme>.xcworkspace)',
        placeholder: defaultScheme,
        defaultValue: defaultScheme,
      })) as string;
      assertNotCancelled(scheme);

      ci = (await p.select({
        message: 'CI provider',
        options: CI_PROVIDERS.map((c) => ({ value: c, label: c })),
        initialValue: 'github-actions' as CiProvider,
      })) as CiProvider;
      assertNotCancelled(ci);

      profiles = (await p.multiselect({
        message: 'Build profiles to generate',
        options: [
          { value: 'preview', label: 'preview (android-only, firebase)' },
          { value: 'staging', label: 'staging (android+ios, ad-hoc)' },
          { value: 'production', label: 'production (android+ios, store)' },
        ],
        initialValues: ['preview', 'production'],
        required: true,
      })) as string[];
      assertNotCancelled(profiles);

      distributions = (await p.multiselect({
        message: 'Distributions to support (affects preview/staging only)',
        options: DISTRIBUTIONS.filter((d) => d !== 'store').map((d) => ({ value: d, label: d })),
        initialValues: ['firebase'],
        required: true,
      })) as string[];
      assertNotCancelled(distributions);
    }

    const build: Record<string, unknown> = {};
    const previewDist = distributions.join('+');
    if (profiles.includes('preview')) {
      build.preview = {
        platform: 'android',
        distribution: previewDist,
        android: { buildType: 'apk' },
      };
    }
    if (profiles.includes('staging')) {
      build.staging = {
        platform: 'all',
        distribution: previewDist,
        android: { buildType: 'apk' },
        ios: { exportMethod: 'ad-hoc' },
      };
    }
    if (profiles.includes('production')) {
      build.production = {
        platform: 'all',
        distribution: 'store',
        android: { buildType: 'aab' },
        ios: { exportMethod: 'app-store' },
      };
    }

    const config = {
      project: { type: projectType, bundleId, packageName, scheme },
      ci,
      checks: { test: true, lint: true, typecheck: true },
      build,
    };

    // Non-interactive flag combos (e.g. --distribution testflight with the
    // default android-only "preview" profile) can produce a config the
    // schema itself would reject at `generate` time — catch it here instead
    // of writing a file that's guaranteed to fail later. The interactive
    // prompts predate this check and keep their existing (unvalidated)
    // behavior to avoid changing that flow's UX as a side effect.
    if (args.yes) {
      const result = ConfigSchema.safeParse(config);
      if (!result.success) {
        p.log.error('The requested flags produce an invalid rn-workflows.yml:');
        for (const issue of result.error.issues) {
          p.log.error(`  - ${issue.path.join('.') || '<root>'}: ${issue.message}`);
        }
        process.exit(1);
      }
    }

    const header = '# rn-workflows config. Run `npx rn-workflows generate` after editing.\n';
    writeFileSync(outPath, header + yaml.dump(config, { noRefs: true, lineWidth: 120 }));
    p.outro(`Wrote ${outPath}`);
  },
});

function assertNotCancelled(value: unknown): asserts value {
  if (typeof value === 'symbol') {
    p.cancel('Cancelled.');
    process.exit(0);
  }
}
