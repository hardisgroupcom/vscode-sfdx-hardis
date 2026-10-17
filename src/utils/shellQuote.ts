// Command line values are always quoted for the shell that runs the command: double quotes for
// cmd.exe on Windows, single quotes elsewhere, because /bin/sh expands $ and backticks inside double
// quotes (a Report folder named unfiled$public would become "unfiled")
export function quote(
  value: string,
  platform: string = process.platform,
): string {
  if (platform === "win32") {
    return `"${String(value).replace(/"/g, '\\"')}"`;
  }
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
