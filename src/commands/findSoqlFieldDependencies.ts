import * as vscode from "vscode";
import { Commands } from "../commands";
import { getDefaultTargetOrgUsername } from "../utils";
import { t } from "../i18n/i18n";
import {
  resolveSoqlSelection,
  SoqlResolveError,
  SoqlSelectionTarget,
} from "../utils/soqlFieldUtils";
import { createSoqlSchema } from "../utils/soqlSchema";

// Right-click on a field selected in a SOQL query (inline Apex query, query string, .soql file):
// the Metadata Dependencies panel opens on that field, as for a metadata file
export function registerFindSoqlFieldDependencies(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.findSoqlFieldDependencies",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const document = editor.document;
      const username =
        (await getDefaultTargetOrgUsername().catch(() => null)) || null;
      let target: SoqlSelectionTarget;
      try {
        target = await resolveSoqlSelection(
          document.getText(),
          document.offsetAt(editor.selection.start),
          document.offsetAt(editor.selection.end),
          createSoqlSchema(username),
        );
      } catch (error: any) {
        vscode.window.showWarningMessage(resolveErrorMessage(error));
        return;
      }
      await openDependencies(target, username);
    },
  );
  commands.disposables.push(disposable);
}

async function openDependencies(
  target: SoqlSelectionTarget,
  username: string | null,
) {
  if (target.kind === "object") {
    showDependencies("CustomObject", target.objectName, username);
    return;
  }
  if (target.custom) {
    showDependencies("CustomField", target.apiName, username);
    return;
  }
  // Salesforce dependency data does not hold standard fields: the object is the closest answer
  const findObject = t("soqlFieldFindObject", { object: target.objectName });
  const choice = await vscode.window.showWarningMessage(
    t("soqlFieldStandardField", { name: target.apiName }),
    findObject,
  );
  if (choice === findObject) {
    showDependencies("CustomObject", target.objectName, username);
  }
}

function showDependencies(type: string, name: string, username: string | null) {
  vscode.commands.executeCommand(
    "vscode-sfdx-hardis.showMetadataDependencies",
    { type, name, username: username || undefined, direction: "used-by" },
  );
}

function resolveErrorMessage(error: any): string {
  if (!(error instanceof SoqlResolveError)) {
    return error?.message || String(error);
  }
  switch (error.code) {
    case "notAField":
      return t("soqlFieldNotAField", { text: error.details.text || "" });
    case "unsupportedTypeof":
      return t("soqlFieldTypeofNotSupported", {
        text: error.details.text || "",
      });
    case "unresolvedRelationship":
      return t("soqlFieldUnresolvedRelationship", {
        object: error.details.object || "",
        relationship: error.details.relationship || "",
      });
    case "polymorphicRelationship":
      return t("soqlFieldPolymorphicRelationship", {
        object: error.details.object || "",
        relationship: error.details.relationship || "",
      });
    default:
      return t("soqlFieldNoQuery");
  }
}
