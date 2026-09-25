import * as yaml from "js-yaml";

/**
 * YAML for a file of the repository, written the way Prettier writes it.
 *
 * js-yaml quotes strings with single quotes by default, `command: ''` for an
 * empty one, and Prettier, which MegaLinter runs on every Pull Request of a
 * project built with sfdx-hardis, rewrites them with double quotes. The fix
 * lands as a commit of its own on the contributor's branch, and a Pull Request
 * whose head is a bot commit waits for checks that never start. Double quotes,
 * and long strings kept on one line, leave Prettier nothing to change.
 */
export function dumpRepositoryYaml(
  doc: unknown,
  options: yaml.DumpOptions = {},
): string {
  return yaml.dump(doc, { quotingType: '"', lineWidth: -1, ...options });
}
