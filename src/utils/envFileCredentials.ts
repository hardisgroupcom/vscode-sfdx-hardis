import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { Logger } from "../logger";

/**
 * Provider credentials read from the `.env` file at the root of the opened
 * repository, named as the sfdx-hardis CLI reads them in a CI/CD pipeline.
 *
 * A developer whose `.env` already holds working credentials is connected to
 * the git and ticketing providers without entering anything, and the commands
 * launched by the extension receive the same values as if they were stored.
 *
 * SECURITY: these values are secrets. They are never written to the VS Code
 * secret storage, never displayed, and never logged: only the names of the
 * variables found are traced.
 */

/** Environment variables of each provider credential, as the CLI reads them */
export const PROVIDER_ENV_VAR_NAMES = {
  githubToken: ["GITHUB_TOKEN", "CI_SFDX_HARDIS_GITHUB_TOKEN"],
  gitlabToken: ["CI_SFDX_HARDIS_GITLAB_TOKEN"],
  azureToken: ["CI_SFDX_HARDIS_AZURE_TOKEN", "SYSTEM_ACCESSTOKEN"],
  bitbucketToken: ["CI_SFDX_HARDIS_BITBUCKET_TOKEN"],
  bitbucketEmail: ["CI_SFDX_HARDIS_BITBUCKET_EMAIL"],
  jiraHost: ["JIRA_HOST"],
  jiraPat: ["JIRA_PAT"],
  jiraEmail: ["JIRA_EMAIL"],
  jiraToken: ["JIRA_TOKEN"],
  serviceNowUrl: ["SERVICENOW_URL"],
  serviceNowUsername: ["SERVICENOW_USERNAME"],
  serviceNowPassword: ["SERVICENOW_PASSWORD"],
  ahaApiKey: ["AHA_API_KEY"],
} as const;

/**
 * The only variables ever read from the file. A project `.env` holds many
 * other things (API keys of other tools, feature flags...) that have no
 * business in the extension memory.
 */
export const ENV_FILE_CREDENTIAL_KEYS: ReadonlySet<string> = new Set(
  Object.values(PROVIDER_ENV_VAR_NAMES).flat(),
);

const ENV_FILE_NAME = ".env";

let envFileCache: {
  filePath: string;
  values: Record<string, string>;
} | null = null;

const changeListeners: Array<() => void> = [];

/**
 * Value of a provider credential variable in the workspace `.env` file, or
 * undefined when the file, the variable or the workspace is missing.
 */
export function getEnvFileCredential(name: string): string | undefined {
  if (!ENV_FILE_CREDENTIAL_KEYS.has(name)) {
    return undefined;
  }
  const filePath = getEnvFilePath();
  if (!filePath) {
    return undefined;
  }
  if (!envFileCache || envFileCache.filePath !== filePath) {
    envFileCache = {
      filePath,
      values: readEnvFileCredentials(filePath),
    };
  }
  return envFileCache.values[name] || undefined;
}

/**
 * Registers a listener notified whenever the workspace `.env` file changes
 * (used to invalidate in-memory caches derived from its credentials)
 */
export function onEnvFileChanged(listener: () => void): void {
  changeListeners.push(listener);
}

/** Forgets the parsed file, so the next read parses it again */
export function invalidateEnvFileCache(): void {
  envFileCache = null;
}

/**
 * Watches the workspace `.env` file so a credential added, changed or removed
 * while VS Code is open is picked up without a restart.
 */
export function watchEnvFile(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return;
  }
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(folder, ENV_FILE_NAME),
  );
  const onChange = () => {
    invalidateEnvFileCache();
    Logger.log(
      `${ENV_FILE_NAME} changed: provider credentials will be read again`,
    );
    for (const listener of changeListeners) {
      try {
        listener();
      } catch {
        // Listeners must never break the watcher
      }
    }
  };
  watcher.onDidChange(onChange);
  watcher.onDidCreate(onChange);
  watcher.onDidDelete(onChange);
  context.subscriptions.push(watcher);
}

/**
 * Reads the provider credentials of a `.env` file. A missing or unreadable
 * file is an empty result: most projects have none.
 */
export function readEnvFileCredentials(
  filePath: string,
): Record<string, string> {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return {};
  }
  const values = parseEnvFile(content, ENV_FILE_CREDENTIAL_KEYS);
  const found = Object.keys(values);
  if (found.length > 0) {
    // Names only: the values are credentials
    Logger.log(
      `Read ${found.length} provider credential variable(s) from ${filePath}: ${found.join(", ")}`,
    );
  }
  return values;
}

/**
 * Parses the content of a `.env` file, keeping only the allowed variables.
 *
 * Supported: `KEY=value`, `KEY='value'`, `KEY="value"`, `export KEY=value`,
 * comments (`#`) and blank lines, CRLF line endings, values containing `=`.
 * In a double-quoted value, `\n` stands for a line break, like dotenv. An
 * unquoted value stops at a ` #` comment. The last definition of a variable
 * wins, and an empty value is the same as no value.
 */
export function parseEnvFile(
  content: string,
  allowedKeys: ReadonlySet<string>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match = line.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/,
    );
    if (!match) {
      continue;
    }
    const key = match[1];
    if (!allowedKeys.has(key)) {
      continue;
    }
    const value = parseEnvValue(match[2]);
    if (value) {
      values[key] = value;
    } else {
      delete values[key];
    }
  }
  return values;
}

function parseEnvValue(rawValue: string): string {
  const value = rawValue.trim();
  if (value.length >= 2) {
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      const inner = value.slice(1, -1);
      return quote === '"' ? inner.replace(/\\n/g, "\n") : inner;
    }
  }
  // Unquoted: a comment may follow the value, separated by whitespace
  return value.replace(/\s+#.*$/, "").trim();
}

function getEnvFilePath(): string | null {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return null;
  }
  return path.join(folder.uri.fsPath, ENV_FILE_NAME);
}
