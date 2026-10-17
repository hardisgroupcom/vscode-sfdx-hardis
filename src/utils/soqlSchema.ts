import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { execSfdxJson, getWorkspaceRoot } from "../utils";
import { Logger } from "../logger";
import { t } from "../i18n/i18n";
import { GLOB_IGNORE_PATTERNS } from "./projectUtils";
import { mapWithConcurrency } from "./concurrency";
import { quote } from "./shellQuote";
import {
  SoqlParentRelationship,
  SoqlSchema,
  relationshipFieldName,
} from "./soqlFieldUtils";

// Answers the schema questions of a SOQL query: the fields of the project first (no org call),
// then the describe of the object in the org, then, without an org, the standard relationships
// and the Salesforce naming rules.
export function createSoqlSchema(username: string | null): SoqlSchema {
  const project = new ProjectFields();
  const org = new OrgDescribes(username);
  return {
    async parentRelationship(objectName, relationshipName) {
      return (
        (await project.parentRelationship(objectName, relationshipName)) ||
        (await org.parentRelationship(objectName, relationshipName)) ||
        offlineParentRelationship(objectName, relationshipName)
      );
    },
    async childRelationship(objectName, relationshipName) {
      return (
        (await project.childRelationship(objectName, relationshipName)) ||
        (await org.childRelationship(objectName, relationshipName)) ||
        offlineChildObject(objectName, relationshipName)
      );
    },
    async objectName(name) {
      return (await project.objectName(name)) || (await org.objectName(name));
    },
    async fieldName(objectName, fieldName) {
      return (
        (await project.fieldName(objectName, fieldName)) ||
        (await org.fieldName(objectName, fieldName))
      );
    },
  };
}

// Standard relationships whose object is not their name. Written as Salesforce names them,
// looked up in lower case: SOQL ignores case
const STANDARD_PARENT_TARGETS: Record<string, string> = byLowerCaseName({
  Owner: "User",
  CreatedBy: "User",
  LastModifiedBy: "User",
  Manager: "User",
  DelegatedApprover: "User",
  ReportsTo: "Contact",
  ConvertedAccount: "Account",
  ConvertedContact: "Contact",
  ConvertedOpportunity: "Opportunity",
  Pricebook2: "Pricebook2",
  Product2: "Product2",
  RecordType: "RecordType",
  Profile: "Profile",
  UserRole: "UserRole",
});

// Relationships that can point to several objects: only TYPEOF can read their fields
const POLYMORPHIC_RELATIONSHIPS = new Set(
  ["What", "Who", "RelatedTo"].map((name) => name.toLowerCase()),
);

// Objects whose Parent is an object of the same type (Account.Parent is an Account).
// Elsewhere Parent points to another object (EmailMessage: Case) or to several (Attachment)
const SELF_PARENT_OBJECTS = new Set(
  ["Account", "Asset", "Campaign", "Case"].map((name) => name.toLowerCase()),
);

const STANDARD_CHILD_RELATIONSHIPS: Record<string, string> = byLowerCaseName({
  Contacts: "Contact",
  Opportunities: "Opportunity",
  Cases: "Case",
  ChildAccounts: "Account",
  OpportunityLineItems: "OpportunityLineItem",
  OpportunityContactRoles: "OpportunityContactRole",
  AccountContactRelations: "AccountContactRelation",
  Tasks: "Task",
  Events: "Event",
  ActivityHistories: "ActivityHistory",
  OpenActivities: "OpenActivity",
  Attachments: "Attachment",
  Notes: "Note",
  Assets: "Asset",
  Contracts: "Contract",
  Orders: "Order",
  OrderItems: "OrderItem",
  Quotes: "Quote",
  QuoteLineItems: "QuoteLineItem",
  CaseComments: "CaseComment",
  Users: "User",
});

// Child objects named after their parent: Account has AccountFeed and AccountHistory,
// Invoice__c has Invoice__Feed and Invoice__History
const SUFFIXED_CHILD_RELATIONSHIPS: Record<string, string> = byLowerCaseName({
  Feeds: "Feed",
  Histories: "History",
});

function byLowerCaseName(
  names: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(names).map(([name, value]) => [name.toLowerCase(), value]),
  );
}

// Without the org: the standard relationships, else a relationship named after its object
function offlineParentRelationship(
  objectName: string,
  relationshipName: string,
): SoqlParentRelationship | null {
  const name = relationshipName.toLowerCase();
  const field = relationshipFieldName(relationshipName);
  if (POLYMORPHIC_RELATIONSHIPS.has(name)) {
    return { field, target: null, polymorphic: true };
  }
  if (
    name === "masterrecord" ||
    (name === "parent" && SELF_PARENT_OBJECTS.has(objectName.toLowerCase()))
  ) {
    return { field, target: objectName };
  }
  // The Parent of another object is only known by the org
  if (name === "parent") {
    return null;
  }
  const target = STANDARD_PARENT_TARGETS[name];
  if (target) {
    return { field, target };
  }
  // A standard relationship is usually named after its object (Account, Contact)
  if (!/__r$/i.test(relationshipName)) {
    return { field, target: relationshipName };
  }
  return null;
}

function offlineChildObject(
  objectName: string,
  relationshipName: string,
): string | null {
  const name = relationshipName.toLowerCase();
  const suffix = SUFFIXED_CHILD_RELATIONSHIPS[name];
  if (suffix) {
    return /__c$/i.test(objectName)
      ? objectName.replace(/__c$/i, `__${suffix}`)
      : `${objectName}${suffix}`;
  }
  return (
    STANDARD_CHILD_RELATIONSHIPS[name] || guessChildObject(relationshipName)
  );
}

// Opportunities -> Opportunity, Invoices__r stays unknown: its object is not in its name
function guessChildObject(relationshipName: string): string | null {
  if (/__r$/i.test(relationshipName)) {
    return null;
  }
  if (/ies$/i.test(relationshipName)) {
    return relationshipName.replace(/ies$/i, "y");
  }
  return relationshipName.replace(/s$/i, "");
}

interface FieldInfo {
  name: string;
  relationshipName: string | null;
  referenceTo: string | null;
}

// Fields of the objects of the project, read from their .field-meta.xml files on demand
class ProjectFields {
  private filesByObject: Promise<
    Map<string, { name: string; files: string[] }>
  > | null = null;
  private fieldsByObject = new Map<string, Promise<FieldInfo[]>>();
  private childObjects: Promise<Map<string, string>> | null = null;

  async objectName(name: string): Promise<string | null> {
    const objects = await this.listFiles();
    return objects.get(name.toLowerCase())?.name || null;
  }

  async fieldName(
    objectName: string,
    fieldName: string,
  ): Promise<string | null> {
    const fields = await this.fields(objectName);
    const lower = fieldName.toLowerCase();
    return (
      fields.find((field) => field.name.toLowerCase() === lower)?.name || null
    );
  }

  async parentRelationship(
    objectName: string,
    relationshipName: string,
  ): Promise<SoqlParentRelationship | null> {
    // The relationship of a lookup is named after its field (Account__c -> Account__r):
    // the relationshipName of the XML file is the name of the child relationship, on the other side
    const lookupField = relationshipFieldName(relationshipName).toLowerCase();
    const fields = await this.fields(objectName);
    const field = fields.find(
      (candidate) =>
        candidate.referenceTo && candidate.name.toLowerCase() === lookupField,
    );
    return field ? { field: field.name, target: field.referenceTo } : null;
  }

  // The object holding the lookup field of a custom child relationship (Invoices__r)
  async childRelationship(
    objectName: string,
    relationshipName: string,
  ): Promise<string | null> {
    if (!/__r$/i.test(relationshipName)) {
      return null;
    }
    const relationship = relationshipName.replace(/__r$/i, "");
    const children = await this.childRelationships();
    return children.get(childKey(objectName, relationship)) || null;
  }

  // Child objects by parent object and relationship name, read once from all the objects of the project
  private childRelationships(): Promise<Map<string, string>> {
    if (!this.childObjects) {
      this.childObjects = (async () => {
        const children = new Map<string, string>();
        const objects = [...(await this.listFiles())];
        await mapWithConcurrency(
          objects,
          async ([key, entry]) => {
            for (const field of await this.fields(key)) {
              if (field.relationshipName && field.referenceTo) {
                const childOf = childKey(
                  field.referenceTo,
                  field.relationshipName,
                );
                if (!children.has(childOf)) {
                  children.set(childOf, entry.name);
                }
              }
            }
          },
          8,
        );
        return children;
      })();
    }
    return this.childObjects;
  }

  private listFiles(): Promise<Map<string, { name: string; files: string[] }>> {
    if (!this.filesByObject) {
      this.filesByObject = (async () => {
        const objects = new Map<string, { name: string; files: string[] }>();
        const uris = await vscode.workspace.findFiles(
          "**/objects/*/{fields/*.field-meta.xml,*.object-meta.xml}",
          GLOB_IGNORE_PATTERNS,
        );
        for (const uri of uris) {
          const parts = uri.fsPath.split(/[\\/]/);
          const isField = parts[parts.length - 2] === "fields";
          const objectName = parts[parts.length - (isField ? 3 : 2)];
          const key = objectName.toLowerCase();
          const entry = objects.get(key) || { name: objectName, files: [] };
          if (isField) {
            entry.files.push(uri.fsPath);
          }
          objects.set(key, entry);
        }
        return objects;
      })();
    }
    return this.filesByObject;
  }

  private fields(objectName: string): Promise<FieldInfo[]> {
    const key = objectName.toLowerCase();
    let fields = this.fieldsByObject.get(key);
    if (!fields) {
      fields = (async () => {
        const entry = (await this.listFiles()).get(key);
        return Promise.all(
          (entry?.files || []).map(async (file) => {
            const xml = await fs.promises
              .readFile(file, "utf8")
              .catch(() => "");
            return {
              name: path.basename(file).replace(/\.field-meta\.xml$/, ""),
              relationshipName: xmlValue(xml, "relationshipName"),
              referenceTo: xmlValue(xml, "referenceTo"),
            };
          }),
        );
      })();
      this.fieldsByObject.set(key, fields);
    }
    return fields;
  }
}

function childKey(parentObject: string, relationshipName: string): string {
  return `${parentObject.toLowerCase()}|${relationshipName.toLowerCase()}`;
}

function xmlValue(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>\\s*([^<]+?)\\s*</${tag}>`).exec(xml);
  return match ? match[1] : null;
}

// Describes of the objects in the org, read once per VS Code session
const DESCRIBES = new Map<string, Promise<any | null>>();

class OrgDescribes {
  constructor(private readonly username: string | null) {}

  async objectName(name: string): Promise<string | null> {
    return (await this.describe(name))?.name || null;
  }

  async fieldName(
    objectName: string,
    fieldName: string,
  ): Promise<string | null> {
    const lower = fieldName.toLowerCase();
    const fields: any[] = (await this.describe(objectName))?.fields || [];
    return (
      fields.find((field) => field?.name?.toLowerCase() === lower)?.name || null
    );
  }

  async parentRelationship(
    objectName: string,
    relationshipName: string,
  ): Promise<SoqlParentRelationship | null> {
    const lower = relationshipName.toLowerCase();
    const fields: any[] = (await this.describe(objectName))?.fields || [];
    const field = fields.find(
      (candidate) => candidate?.relationshipName?.toLowerCase() === lower,
    );
    if (!field) {
      return null;
    }
    const targets: string[] = Array.isArray(field.referenceTo)
      ? field.referenceTo
      : [];
    // Owner (User or Group) is read as a User; any other relationship to several objects
    // (What on Task) can not be followed
    if (targets.includes("User")) {
      return { field: field.name, target: "User" };
    }
    if (targets.length > 1) {
      return { field: field.name, target: null, polymorphic: true };
    }
    return { field: field.name, target: targets[0] || null };
  }

  async childRelationship(
    objectName: string,
    relationshipName: string,
  ): Promise<string | null> {
    const lower = relationshipName.toLowerCase();
    const children: any[] =
      (await this.describe(objectName))?.childRelationships || [];
    return (
      children.find((child) => child?.relationshipName?.toLowerCase() === lower)
        ?.childSObject || null
    );
  }

  private describe(objectName: string): Promise<any | null> {
    if (!this.username) {
      return Promise.resolve(null);
    }
    const key = `${this.username}|${objectName.toLowerCase()}`;
    let describe = DESCRIBES.get(key);
    if (!describe) {
      describe = this.readDescribe(objectName);
      DESCRIBES.set(key, describe);
      // A failed describe (org expired, object unknown) is asked again next time
      describe.then((result) => {
        if (!result) {
          DESCRIBES.delete(key);
        }
      });
    }
    return describe;
  }

  private async readDescribe(objectName: string): Promise<any | null> {
    if (!/^\w+$/.test(objectName)) {
      return null;
    }
    try {
      const response = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: t("soqlFieldReadingObject", { object: objectName }),
        },
        () =>
          execSfdxJson(
            `sf sobject describe --sobject ${objectName} --target-org ${quote(this.username || "")}`,
            { cwd: getWorkspaceRoot(), fail: false, output: false },
          ),
      );
      return response?.status === 0 ? response.result || null : null;
    } catch (error: any) {
      Logger.log(`Error describing ${objectName}: ${error?.message || error}`);
      return null;
    }
  }
}
