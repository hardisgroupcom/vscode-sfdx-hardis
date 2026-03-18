import * as vscode from "vscode";
import { LwcPanelManager } from "../lwc-panel-manager";
import { Commands } from "../commands";
import { Logger } from "../logger";
import { t } from "../i18n/i18n";
import { execSfdxJsonWithProgress } from "../utils";

export function registerShowSoqlBuilder(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showSoqlBuilder",
    async () => {
      const lwcManager = LwcPanelManager.getInstance();

      const panel = lwcManager.getOrCreatePanel("s-soql-builder", {});
      panel.updateTitle(t("soqlBuilderTitle"));

      panel.clearExistingOnMessageListeners();
      panel.onMessage(async (type: string, data: any) => {
        switch (type) {
          case "loadObjects": {
            try {
              const result = await execSfdxJsonWithProgress(
                "sf sobject list --json",
                {},
                t("soqlBuilderLoadingObjects"),
              );
              const objects: string[] = (result?.result?.sobjects || [])
                .map((o: any) => o.name || o)
                .filter((name: string) => name && typeof name === "string")
                .sort();
              panel.sendMessage({
                type: "objectsLoaded",
                data: { objects },
              });
            } catch (e: any) {
              Logger.log(`SOQL Builder: failed to load objects: ${e?.message}`);
              panel.sendMessage({
                type: "objectsLoadError",
                data: { message: e?.message || String(e) },
              });
            }
            break;
          }

          case "loadFields": {
            const { sobjectName } = data || {};
            if (!sobjectName) {
              break;
            }
            try {
              const result = await execSfdxJsonWithProgress(
                `sf sobject describe --sobject ${sobjectName} --json`,
                {},
                t("soqlBuilderLoadingFields"),
              );
              const fields: any[] = (result?.result?.fields || []).map(
                (f: any) => ({
                  name: f.name,
                  label: f.label,
                  type: f.type,
                  referenceTo: f.referenceTo || [],
                }),
              );
              fields.sort((a, b) =>
                (a.label || a.name).localeCompare(b.label || b.name),
              );
              panel.sendMessage({
                type: "fieldsLoaded",
                data: { sobjectName, fields },
              });
            } catch (e: any) {
              Logger.log(
                `SOQL Builder: failed to load fields for ${sobjectName}: ${e?.message}`,
              );
              panel.sendMessage({
                type: "fieldsLoadError",
                data: { sobjectName, message: e?.message || String(e) },
              });
            }
            break;
          }

          case "runQuery": {
            const { query } = data || {};
            if (!query) {
              break;
            }
            // Validate basic safety: must be a SELECT query
            const trimmed = query.trim().toUpperCase();
            if (!trimmed.startsWith("SELECT")) {
              panel.sendMessage({
                type: "queryError",
                data: { message: t("soqlBuilderOnlySelectAllowed") },
              });
              break;
            }
            try {
              const result = await execSfdxJsonWithProgress(
                `sf data query --query "${query.replace(/"/g, '\\"')}" --json`,
                {},
                t("soqlBuilderRunningQuery"),
              );
              const records: any[] = result?.result?.records || [];
              const totalSize: number = result?.result?.totalSize ?? records.length;
              panel.sendMessage({
                type: "queryResults",
                data: { records, totalSize },
              });
            } catch (e: any) {
              Logger.log(`SOQL Builder: query failed: ${e?.message}`);
              panel.sendMessage({
                type: "queryError",
                data: { message: e?.message || String(e) },
              });
            }
            break;
          }
        }
      });
    },
  );
  commands.disposables.push(disposable);
}
