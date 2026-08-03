/**
 * citty runs the parent command's `run()` *after* a matched subcommand, so the
 * interactive menu would open (and hang the process) once e.g. `generate`
 * finished. Only show the menu when no subcommand was requested.
 */
export function shouldRunMenu(
  positionals: readonly unknown[],
  subCommandNames: readonly string[],
): boolean {
  const first = positionals[0];
  return typeof first !== 'string' || !subCommandNames.includes(first);
}
