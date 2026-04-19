import { defineCommand } from 'citty';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as p from '@clack/prompts';
import yaml from 'js-yaml';
import {
  CI_PROVIDERS,
  DISTRIBUTIONS,
  PROJECT_TYPES,
  type CiProvider,
  type ProjectType,
} from '../config/schema.ts';

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
  },
  async run({ args }) {
    p.intro('rn-workflows init');
    const outPath = resolve(String(args.cwd), 'rn-workflows.yml');
    if (existsSync(outPath) && !args.force) {
      p.log.error(`${outPath} already exists. Pass --force to overwrite.`);
      process.exit(1);
    }

    const projectType = (await p.select({
      message: 'Project type',
      options: PROJECT_TYPES.map((t) => ({ value: t, label: t })),
      initialValue: 'expo' as ProjectType,
    })) as ProjectType;
    assertNotCancelled(projectType);

    const bundleId = (await p.text({
      message: 'iOS bundle identifier (e.g. com.myapp)',
      placeholder: 'com.myapp',
      validate: (v) => (v && v.includes('.') ? undefined : 'Must look like com.myapp'),
    })) as string;
    assertNotCancelled(bundleId);

    const packageName = (await p.text({
      message: 'Android package name',
      placeholder: bundleId,
      defaultValue: bundleId,
    })) as string;
    assertNotCancelled(packageName);

    const ci = (await p.select({
      message: 'CI provider',
      options: CI_PROVIDERS.map((c) => ({ value: c, label: c })),
      initialValue: 'github-actions' as CiProvider,
    })) as CiProvider;
    assertNotCancelled(ci);

    const profiles = (await p.multiselect({
      message: 'Build profiles to generate',
      options: [
        { value: 'preview', label: 'preview (android-only, firebase)' },
        { value: 'staging', label: 'staging (android+ios, testflight + firebase)' },
        { value: 'production', label: 'production (android+ios, store)' },
      ],
      initialValues: ['preview', 'production'],
      required: true,
    })) as string[];
    assertNotCancelled(profiles);

    const distributions = (await p.multiselect({
      message: 'Distributions to support (affects preview/staging only)',
      options: DISTRIBUTIONS.filter((d) => d !== 'store').map((d) => ({ value: d, label: d })),
      initialValues: ['firebase'],
      required: true,
    })) as string[];
    assertNotCancelled(distributions);

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
        distribution: distributions.includes('firebase')
          ? 'testflight+firebase'
          : 'testflight',
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
      project: { type: projectType, bundleId, packageName },
      ci,
      build,
    };

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
