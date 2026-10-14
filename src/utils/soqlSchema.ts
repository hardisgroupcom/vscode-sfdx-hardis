import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { execSfdxJson, getWorkspaceRoot } from "../utils";
import { Logger } from "../logger";
import { t } from "../i18n/i18n";
import { GLOB_IGNORE_PATTERNS } from "./projectUtils";
import { SoqlSchema, relationshipFieldName } from "./soqlFieldUtils";
import { quote } from "../commands/showMetadataDependencies";

// Answers the schema questions of a SOQL query: the fields of the project first (no org call),
// then the describe of the object in the org, then the Salesforce naming rules.
export function createSoqlSchema(username: string | null): SoqlSchema {
  const project = new ProjectFields();
  const org = new OrgDescribes(username);
  return {
    async parentRelationship(objectName, relationshipName) {
      const local = await project.parentRelationship(
        objectName,
        relationshipName,
      );
      if (local) {
        return local;
      }
      const standardTarget = standardParentTarget(objectName, relationshipName);
      if (standardTarget) {
        return {
          field: relationshipFieldName(relationshipName),
          target: standardTarget,
        };
      }
      const described = await org.parentRelationship(
        objectName,
        relationshipName,
      );
      if (described) {
        return described;
      }
      // Without the org, a standard relationship is usually named after its object (Account, Contact)
      if (!/__r$/i.test(relationshipName)) {
        return {
          field: relationshipFieldName(relationshipName),
          target: relationshipName,
        };
      }
      return null;
    },
    async childRelationship(objectName, relationshipName) {
      return (
        (await project.childRelationship(objectName, relationshipName)) ||
        STANDARD_CHILD_RELATIONSHIPS[relationshipName.toLowerCase()] ||
        (await org.childRelationship(objectName, relationshipName)) ||
        guessChildObject(relationshipName)
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

// Standard relationships whose object is not their name
const STANDARD_PARENT_TARGETS: Record<string, string> = {
  owner: "User",
  createdby: "User",
  lastmodifiedby: "User",
  manager: "User",
  delegatedapprover: "User",
  reportsto: "Contact",
  convertedaccount: "Account",
  convertedcontact: "Contact",
  convertedopportunity: "Opportunity",
  pricebook2: "Pricebook2",
  product2: "Product2",
  recordtype: "RecordType",
  profile: "Profile",
  userrole: "UserRole",
};

const STANDARD_CHILD_RELATIONSHIPS: Record<string, string> = {
  contacts: "Contact",
  opportunities: "Opportunity",
  cases: "Case",
  childaccounts: "Account",
  opportunitylineitems: "OpportunityLineItem",
  opportunitycontactroles: "OpportunityContactRole",
  accountcontactrelations: "AccountContactRelation",
  tasks: "Task",
  events: "Event",
  activityhistories: "ActivityHistory",
  openactivities: "OpenActivity",
  attachments: "Attachment",
  notes: "Note",
  assets: "Asset",
  contracts: "Contract",
  orders: "Order",
  orderitems: "OrderItem",
  quotes: "Quote",
  quotelineitems: "QuoteLineItem",
  casecomments: "CaseComment",
  feeds: "FeedItem",
  histories: "FieldHistory",
  users: "User",
};

function standardParentTarget(
  objectName: string,
  relationshipName: string,
): string | null {
  const name = relationshipName.toLowerCase();
  // Parent and MasterRecord point to the same object: Account.Parent is an Account
  if (name === "parent" || name === "masterrecord") {
    return objectName;
  }
  return STANDARD_PARENT_TARGETS[name] || null;
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
  ): Promise<{ field: string; target: string | null } | null> {
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
    const relationship = relationshipName.replace(/__r$/i, "").toLowerCase();
    const parent = objectName.toLowerCase();
    const objects = await this.listFiles();
    for (const [key, entry] of objects) {
      const fields = await this.fields(key);
      if (
        fields.some(
          (field) =>
            field.relationshipName?.toLowerCase() === relationship &&
            field.referenceTo?.toLowerCase() === parent,
        )
      ) {
        return entry.name;
      }
    }
    return null;
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
  ): Promise<{ field: string; target: string | null } | null> {
    const lower = relationshipName.toLowerCase();
    const fields: any[] = (await this.describe(objectName))?.fields || [];
    const field = fields.find(
      (candidate) => candidate?.relationshipName?.toLowerCase() === lower,
    );
    if (!field) {
      return null;
    }
    // A polymorphic relationship (Owner: User or Group) is read as its usual object
    const targets: string[] = Array.isArray(field.referenceTo)
      ? field.referenceTo
      : [];
    const target = targets.includes("User") ? "User" : targets[0] || null;
    return { field: field.name, target };
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
