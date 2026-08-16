import * as vscode from "vscode";

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

  static async getSecret(key: string): Promise<string | undefined> {
    const value = await this.instance!.context!.secrets.get(key);
    return value || process.env[key] || undefined;
  }

  static async setSecret(key: string, value: string): Promise<void> {
    await this.instance!.context!.secrets.store(key, value);
    this.notifySecretChanged();
  }

  static async deleteSecret(key: string): Promise<void> {
    await this.instance!.context!.secrets.delete(key);
    this.notifySecretChanged();
  }
}
