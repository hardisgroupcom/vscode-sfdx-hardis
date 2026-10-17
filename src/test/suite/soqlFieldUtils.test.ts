import * as assert from "assert";
import {
  findSoqlQueryRange,
  resolveSoqlSelection,
  SoqlParentRelationship,
  SoqlResolveError,
  SoqlSchema,
} from "../../utils/soqlFieldUtils";

// A small org: Contact -> Account -> User, Account has Contacts and Invoices__r,
// Task.What can point to several objects
const PARENTS: Record<string, Record<string, SoqlParentRelationship>> = {
  task: { what: { field: "WhatId", target: null, polymorphic: true } },
  contact: {
    account: { field: "AccountId", target: "Account" },
    owner: { field: "OwnerId", target: "User" },
  },
  account: {
    owner: { field: "OwnerId", target: "User" },
    region__r: { field: "Region__c", target: "Region__c" },
  },
  invoice__c: { account__r: { field: "Account__c", target: "Account" } },
};
const CHILDREN: Record<string, Record<string, string>> = {
  account: { contacts: "Contact", invoices__r: "Invoice__c" },
};
const OBJECTS = ["Account", "Contact", "User", "Invoice__c", "Region__c"];
const FIELDS: Record<string, string[]> = {
  account: ["Status__c", "Industry"],
  contact: ["Level__c"],
  user: ["Badge__c"],
  invoice__c: ["Amount__c"],
  region__c: ["Code__c"],
};

const schema: SoqlSchema = {
  async parentRelationship(objectName, relationshipName) {
    return (
      PARENTS[objectName.toLowerCase()]?.[relationshipName.toLowerCase()] ||
      null
    );
  },
  async childRelationship(objectName, relationshipName) {
    return (
      CHILDREN[objectName.toLowerCase()]?.[relationshipName.toLowerCase()] ||
      null
    );
  },
  async objectName(name) {
    return OBJECTS.find((o) => o.toLowerCase() === name.toLowerCase()) || null;
  },
  async fieldName(objectName, fieldName) {
    return (
      (FIELDS[objectName.toLowerCase()] || []).find(
        (f) => f.toLowerCase() === fieldName.toLowerCase(),
      ) || null
    );
  },
};

// The selection is written in the text between | characters (or a single | for a cursor)
async function resolve(textWithSelection: string) {
  const start = textWithSelection.indexOf("|");
  const second = textWithSelection.indexOf("|", start + 1);
  const end = second < 0 ? start : second - 1;
  const text = textWithSelection.replace(/\|/g, "");
  return resolveSoqlSelection(text, start, end, schema);
}

async function resolveError(textWithSelection: string): Promise<string> {
  try {
    await resolve(textWithSelection);
  } catch (error) {
    assert.ok(error instanceof SoqlResolveError);
    return (error as SoqlResolveError).code;
  }
  assert.fail("A field was found");
}

function field(apiName: string, custom = true) {
  const [objectName, fieldName] = apiName.split(".");
  return { kind: "field", objectName, fieldName, apiName, custom };
}

suite("Field selected in a SOQL query", () => {
  test("finds a field of the object of an inline Apex query", async () => {
    assert.deepStrictEqual(
      await resolve(
        "List<Account> a = [SELECT Id, |Status__c| FROM Account WHERE Name = 'x'];",
      ),
      field("Account.Status__c"),
    );
  });

  test("uses the word under the cursor and fixes the case of the names", async () => {
    assert.deepStrictEqual(
      await resolve("[select id, stat|us__c from account]"),
      field("Account.Status__c"),
    );
  });

  test("finds fields in the WHERE, GROUP BY and ORDER BY clauses", async () => {
    assert.deepStrictEqual(
      await resolve(
        "[SELECT Id FROM Account WHERE |Status__c| = 'Open' ORDER BY Name]",
      ),
      field("Account.Status__c"),
    );
    assert.deepStrictEqual(
      await resolve(
        "[SELECT COUNT(Id) total FROM Account GROUP BY |Status__c|]",
      ),
      field("Account.Status__c"),
    );
    assert.deepStrictEqual(
      await resolve("[SELECT Id FROM Account ORDER BY |Status__c| DESC]"),
      field("Account.Status__c"),
    );
  });

  test("follows parent relationships to the object of the field", async () => {
    assert.deepStrictEqual(
      await resolve("[SELECT Account.Owner.|Badge__c| FROM Contact]"),
      field("User.Badge__c"),
    );
    assert.deepStrictEqual(
      await resolve("[SELECT Account.|Region__r.Code__c| FROM Contact]"),
      field("Region__c.Code__c"),
    );
  });

  test("reads a selected relationship as its lookup field", async () => {
    assert.deepStrictEqual(
      await resolve("[SELECT Account.|Region__r|.Code__c FROM Contact]"),
      field("Account.Region__c"),
    );
    assert.deepStrictEqual(
      await resolve("[SELECT |Account|.Name FROM Contact]"),
      field("Contact.AccountId", false),
    );
  });

  test("reads a child relationship subquery on its child object", async () => {
    assert.deepStrictEqual(
      await resolve(
        "[SELECT Id, (SELECT |Level__c| FROM Contacts), Status__c FROM Account]",
      ),
      field("Contact.Level__c"),
    );
    assert.deepStrictEqual(
      await resolve(
        "[SELECT Id, (SELECT |Amount__c| FROM Invoices__r) FROM Account]",
      ),
      field("Invoice__c.Amount__c"),
    );
    // A field of the parent query after the subquery
    assert.deepStrictEqual(
      await resolve(
        "[SELECT Id, (SELECT Level__c FROM Contacts), |Status__c| FROM Account]",
      ),
      field("Account.Status__c"),
    );
  });

  test("reads a semi-join subquery on its own object", async () => {
    assert.deepStrictEqual(
      await resolve(
        "[SELECT Id FROM Account WHERE Id IN (SELECT AccountId FROM Contact WHERE |Level__c| = 'A')]",
      ),
      field("Contact.Level__c"),
    );
  });

  test("removes an alias or the object name before a field", async () => {
    assert.deepStrictEqual(
      await resolve("[SELECT a.|Status__c| FROM Account a]"),
      field("Account.Status__c"),
    );
    assert.deepStrictEqual(
      await resolve("[SELECT Account.|Status__c| FROM Account]"),
      field("Account.Status__c"),
    );
  });

  test("reads a selected object after FROM as the object", async () => {
    assert.deepStrictEqual(await resolve("[SELECT Id FROM |Invoice__c|]"), {
      kind: "object",
      objectName: "Invoice__c",
    });
  });

  test("finds queries in strings and in .soql files", async () => {
    assert.deepStrictEqual(
      await resolve(
        "String q = 'SELECT Id, |Status__c| FROM Account WHERE Name = \\'' + n + '\\'';",
      ),
      field("Account.Status__c"),
    );
    assert.deepStrictEqual(
      await resolve("SELECT Id,\n  |Level__c|\nFROM Contact\nLIMIT 10\n"),
      field("Contact.Level__c"),
    );
  });

  test("reads the strings of a query held in an Apex string", async () => {
    assert.deepStrictEqual(
      await resolve(
        "Database.query('SELECT Id FROM Account WHERE Name = \\'Acme\\' AND |Status__c| = true');",
      ),
      field("Account.Status__c"),
    );
  });

  test("follows a query split over concatenated strings", async () => {
    const query =
      "String q = 'SELECT Id, |Status__c| ' +\n  'FROM Account ' +\n  'WHERE Industry = null';";
    assert.deepStrictEqual(await resolve(query), field("Account.Status__c"));
    assert.deepStrictEqual(
      await resolve(
        "String q = 'SELECT Id ' +\n  'FROM Contact ' +\n  'WHERE |Level__c| = null';",
      ),
      field("Contact.Level__c"),
    );
  });

  test("uses the name right before the end of the query", async () => {
    assert.deepStrictEqual(
      await resolve("[SELECT Id FROM Account ORDER BY Status__c|];"),
      field("Account.Status__c"),
    );
  });

  test("leaves out a comma or a parenthesis caught in the selection", async () => {
    assert.deepStrictEqual(
      await resolve("[SELECT |Status__c,| Industry FROM Account]"),
      field("Account.Status__c"),
    );
    assert.deepStrictEqual(
      await resolve(
        "[SELECT Id, (SELECT Id FROM Contacts ORDER BY |Level__c)|, Industry FROM Account]",
      ),
      field("Contact.Level__c"),
    );
  });

  test("does not take a custom field starting like a date literal for one", async () => {
    assert.deepStrictEqual(
      await resolve("[SELECT |Next_Step__c| FROM Account]"),
      field("Account.Next_Step__c"),
    );
    assert.deepStrictEqual(
      await resolve(
        "[SELECT Id FROM Account WHERE |Last_Contacted__c| = null]",
      ),
      field("Account.Last_Contacted__c"),
    );
  });

  test("tells a standard field from a custom one", async () => {
    assert.deepStrictEqual(
      await resolve("[SELECT |Industry| FROM Account]"),
      field("Account.Industry", false),
    );
  });

  test("refuses what is not a field", async () => {
    assert.strictEqual(await resolveError("Integer |i| = 0;"), "noQuery");
    assert.strictEqual(
      await resolveError("[SELECT Id FROM Account WHERE Id IN :|ids|]"),
      "notAField",
    );
    assert.strictEqual(
      await resolveError("[SELECT |COUNT|(Id) FROM Account]"),
      "notAField",
    );
    assert.strictEqual(
      await resolveError("[SELECT COUNT(Id) |total| FROM Account]"),
      "notAField",
    );
    assert.strictEqual(
      await resolveError(
        "[SELECT Id FROM Account WHERE CreatedDate = |LAST_N_DAYS|:7]",
      ),
      "notAField",
    );
    assert.strictEqual(
      await resolveError("[SELECT Id FROM Account |LIMIT| 10]"),
      "notAField",
    );
    assert.strictEqual(
      await resolveError("[SELECT |Id, Name| FROM Account]"),
      "notAField",
    );
    assert.strictEqual(
      await resolveError(
        "[SELECT TYPEOF What WHEN Account THEN |Status__c| END FROM Task]",
      ),
      "unsupportedTypeof",
    );
  });

  test("says when a relationship can not be followed", async () => {
    assert.strictEqual(
      await resolveError("[SELECT Unknown__r.|Code__c| FROM Account]"),
      "unresolvedRelationship",
    );
    assert.strictEqual(
      await resolveError("[SELECT What.|Status__c| FROM Task]"),
      "polymorphicRelationship",
    );
  });

  test("does not take Order.Name for an ORDER BY clause", async () => {
    // OrderItem.Order is unknown to the small schema: the relationship is followed, not refused
    assert.strictEqual(
      await resolveError("[SELECT Order.|Code__c| FROM OrderItem]"),
      "unresolvedRelationship",
    );
  });

  test("finds the range of the query around the cursor", () => {
    const text =
      "x = [SELECT Id FROM Account]; y = [SELECT Name FROM Contact];";
    const range = findSoqlQueryRange(text, text.indexOf("Name"));
    assert.deepStrictEqual(
      range && text.slice(range.start, range.end),
      "SELECT Name FROM Contact",
    );
    assert.strictEqual(findSoqlQueryRange(text, text.indexOf("y =")), null);
  });
});
