import { simpleGit, SimpleGit, SimpleGitOptions } from "simple-git";

export type SimpleGitUnsafeOptions = SimpleGitOptions["unsafe"];

export type CreateSimpleGitOptions = {
  /** Kills a git process that prints nothing for this long */
  timeout?: SimpleGitOptions["timeout"];
  /** Trims the output of git.raw() */
  trimmed?: boolean;
  /** Lifts one simple-git guard for this instance only: set it only for a fixed value that needs it */
  unsafe?: SimpleGitUnsafeOptions;
};

/**
 * The only place where the extension creates a simple-git instance, so that every git call gets
 * the same environment. ESLint (no-restricted-imports in eslint.config.mjs) refuses an import of
 * simpleGit from 'simple-git' anywhere else in src/.
 *
 * Inherited environment: simple-git v4 removes every inherited GIT_* variable from the git
 * process, and EDITOR, VISUAL, PAGER, SSH_ASKPASS and PREFIX too, unless they are named in
 * allowEnvironment. The extension needs them as v3 passed them: GIT_ASKPASS / SSH_ASKPASS for
 * fetches and clones that need credentials, GIT_SSL_CAINFO / GIT_SSL_NO_VERIFY behind a
 * corporate proxy, GIT_CONFIG_COUNT/KEY/VALUE, GIT_DIR / GIT_WORK_TREE, GIT_SSH_COMMAND...
 * They come from the user's VS Code and shell, never from data the extension reads, so the whole
 * inherited environment goes through.
 * Limit: allowEnvironment only accepts a list of names, and simple-git turns it into a fixed set
 * when the instance is created. The values are read when each git process starts, but a guarded
 * variable (GIT_*, EDITOR...) whose name first appears in process.env after the instance was
 * created is removed. Create a new instance rather than keeping one across such a change.
 *
 * Abbreviated options: simple-git v4 also sets GIT_TEST_DISALLOW_ABBREVIATED_OPTIONS=true on
 * every git process (the fix for GHSA-858h-whjf-mvg5), so git refuses an abbreviated long
 * option such as --dry for --dry-run. The extension keeps it on (allowAbbreviatedOptions is not
 * set): every git argument must be spelled in full. The variable is inherited by what git
 * starts, so git hooks, aliases and merge drivers run by a checkout, merge or stash pop of the
 * extension that call git with an abbreviated option fail the same way.
 *
 * The argument and config guards stay on: unsafe is only set for a call that needs it.
 */
export function createSimpleGit(
  baseDir?: string,
  options: CreateSimpleGitOptions = {},
): SimpleGit {
  const simpleGitOptions: Partial<SimpleGitOptions> = {
    allowEnvironment: Object.keys(process.env),
  };
  if (baseDir) {
    simpleGitOptions.baseDir = baseDir;
  }
  if (options.timeout) {
    simpleGitOptions.timeout = options.timeout;
  }
  if (options.trimmed) {
    simpleGitOptions.trimmed = options.trimmed;
  }
  if (options.unsafe) {
    simpleGitOptions.unsafe = options.unsafe;
  }
  return simpleGit(simpleGitOptions);
}
