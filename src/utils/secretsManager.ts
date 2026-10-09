import * as vscode from "vscode";
import { getEnvFileCredential } from "./envFileCredentials";

/**
 * Where a credential was found:
 * - storage: the VS Code secret storage (entered by the user in the extension)
 * - process: an environment variable of the VS Code process
 * - envFile: the `.env` file at the root of the workspace
 */
export type SecretSource = "storage" | "process" | "envFile";

export interface ResolvedSecret {
  value: string;
  source: SecretSource;
}

export class SecretsManager {
  static instance: SecretsManager | null = null;
  context: vscode.ExtensionContext | null = null;

  static init(context: vscode.ExtensionContext): SecretsManager {
    if (!this.instance) {
      const secretManager = new SecretsManager(context);
      this.instance = secretManager;
    }
    return this.instance;
  }

  static getInstance(): SecretsManager {
    if (!this.instance) {
      throw new Error(
        "SecretsManager not initialized. Call init(context) first.",
      );
    }
    return this.instance;
  }

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  private static changeListeners: Array<() => void> = [];

  // Keys deleted during this session (a Disconnect, or a connection method the
  // user replaced by another one). The provider variables of the environment
  // are not read again for them: otherwise a Disconnect would be undone on the
  // spot by the `.env` file, with no way for the user to escape it. The flag
  // lives in memory only: a restart of VS Code, or a reconnect that stores the
  // key again, reads the environment again.
  private static environmentSuppressedKeys = new Set<string>();

  /**
   * Registers a listener notified whenever any secret is stored or deleted
   * (used to invalidate in-memory caches derived from secrets)
   */
  static onSecretChanged(listener: () => void): void {
    this.changeListeners.push(listener);
  }

  private static notifySecretChanged(): void {
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch {
        // Listeners must never break secret operations
      }
    }
  }

  /**
   * Value of a secret, from the VS Code secret storage first, then from the
   * environment (see resolveSecret).
   *
   * @param envVarNames names of the same credential as the sfdx-hardis CLI
   *   reads them (`GITHUB_TOKEN`...), looked up in the process environment and
   *   in the workspace `.env` file when nothing is stored under `key`
   */
  static async getSecret(
    key: string,
    envVarNames: readonly string[] = [],
  ): Promise<string | undefined> {
    return (await this.resolveSecret(key, envVarNames))?.value;
  }

  /**
   * Same as getSecret, telling where the value comes from. A provider uses the
   * source to stay quiet when credentials it did not ask for do not work.
   *
   * Resolution order: the VS Code secret storage (a value entered by the user
   * always wins), then the process environment, then the workspace `.env` file.
   */
  static async resolveSecret(
    key: string,
    envVarNames: readonly string[] = [],
  ): Promise<ResolvedSecret | undefined> {
    const stored = await this.instance!.context!.secrets.get(key);
    if (stored) {
      return { value: stored, source: "storage" };
    }
    return this.resolveFromEnvironment(key, envVarNames);
  }

  /**
   * The environment part of the resolution, without the secret storage.
   *
   * The key itself is always looked up in the process environment, as it has
   * always been. The provider variable names are looked up in the process
   * environment, then in the `.env` file, unless the key was deleted during
   * this session (see environmentSuppressedKeys).
   */
  static resolveFromEnvironment(
    key: string,
    envVarNames: readonly string[] = [],
    options: {
      processEnv?: Record<string, string | undefined>;
      envFile?: (name: string) => string | undefined;
      suppressedKeys?: ReadonlySet<string>;
    } = {},
  ): ResolvedSecret | undefined {
    const processEnv = options.processEnv ?? process.env;
    const envFile = options.envFile ?? getEnvFileCredential;
    const suppressedKeys =
      options.suppressedKeys ?? this.environmentSuppressedKeys;
    const fromProcess = processEnv[key];
    if (fromProcess) {
      return { value: fromProcess, source: "process" };
    }
    if (suppressedKeys.has(key)) {
      return undefined;
    }
    for (const name of envVarNames) {
      const value = processEnv[name];
      if (value) {
        return { value, source: "process" };
      }
    }
    for (const name of [key, ...envVarNames]) {
      const value = envFile(name);
      if (value) {
        return { value, source: "envFile" };
      }
    }
    return undefined;
  }

  static async setSecret(key: string, value: string): Promise<void> {
    await this.instance!.context!.secrets.store(key, value);
    this.environmentSuppressedKeys.delete(key);
    this.notifySecretChanged();
  }

  static async deleteSecret(key: string): Promise<void> {
    await this.instance!.context!.secrets.delete(key);
    this.environmentSuppressedKeys.add(key);
    this.notifySecretChanged();
  }
}
