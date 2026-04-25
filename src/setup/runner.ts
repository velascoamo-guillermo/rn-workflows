import * as p from '@clack/prompts';
import type { Step, SetupContext, StepResult } from './types.ts';

export async function runSteps(steps: Step[], ctx: SetupContext): Promise<void> {
  for (const step of steps) {
    if (ctx.dryRun) {
      p.log.step(`[dry-run] ${step.label}`);
      continue;
    }
    let result: StepResult;
    try {
      result = await step.run(ctx);
    } catch (err) {
      p.log.error(`${step.label}: ${(err as Error).message}`);
      throw err;
    }
    if (result.skipped) {
      p.log.step(`↩ skipped: ${step.label}${result.note ? ` (${result.note})` : ''}`);
    } else {
      p.log.step(`✓ ${step.label}${result.note ? ` — ${result.note}` : ''}`);
    }
  }
}
