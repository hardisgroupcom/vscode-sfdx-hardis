import * as assert from "assert";
import {
  findTicketsInPullRequest,
  ticketExcerpt,
} from "../../utils/pipeline/ticketSourceUtils";
import { extractTicketIdsFromText } from "../../utils/pipeline/pastedListUtils";

/**
 * Where the tickets of a Pull Request were found (the tooltip of a ticket id in the DevOps
 * Pipeline), and the ticket ids of a list pasted to select Pull Requests for a promotion.
 */

// A ticketing provider reading ABC-123 identifiers, as getTicketsFromString does
const getTicketsFromString = async (text: string) =>
  [...text.matchAll(/[A-Z]+-\d+/g)].map((match) => ({
    provider: "JIRA" as any,
    id: match[0],
    url: `https://jira.example.com/browse/${match[0]}`,
  }));

suite("Ticket sources", () => {
  test("the text around a ticket, on one line, cut with ...", () => {
    assert.strictEqual(
      ticketExcerpt("Fix CRM-12 now", "crm-12"),
      "Fix CRM-12 now",
    );
    const long = `${"a".repeat(80)} see CRM-12\nfor the ${"b".repeat(80)}`;
    const excerpt = ticketExcerpt(long, "CRM-12", 10) || "";
    // 10 characters on each side, the line break turned into a space
    assert.strictEqual(excerpt, "...aaaaa see CRM-12 for the b...");
    assert.strictEqual(ticketExcerpt("nothing", "CRM-12"), null);
    assert.strictEqual(ticketExcerpt("CRM-12", ""), null);
  });

  test("a ticket lists every place of the Pull Request it was found, once", async () => {
    const tickets = await findTicketsInPullRequest(
      {
        title: "CRM-1042 Record the supplier",
        description: "Needs CRM-1040 first. Done for CRM-1042.",
        sourceBranch: "feature/CRM-1042-supplier",
      },
      getTicketsFromString,
    );
    assert.deepStrictEqual(
      tickets.map((ticket) => ticket.id),
      ["CRM-1042", "CRM-1040"],
    );
    assert.deepStrictEqual(
      tickets[0].foundIn?.map((place) => place.source),
      ["title", "description", "branch"],
    );
    assert.strictEqual(
      tickets[1].foundIn?.[0].excerpt,
      "Needs CRM-1040 first. Done for CRM-1042.",
    );
    assert.deepStrictEqual(
      await findTicketsInPullRequest({}, getTicketsFromString),
      [],
    );
  });
});

suite("Ticket ids of a pasted list", () => {
  test("read with the ticketing provider of the project", async () => {
    const provider: any = { getTicketsFromString };
    assert.deepStrictEqual(
      await extractTicketIdsFromText(
        "OK: CRM-12, CRM-13 and CRM-12 again",
        async () => provider,
      ),
      ["CRM-12", "CRM-13"],
    );
  });

  test("read as ABC-123 without a ticketing provider", async () => {
    assert.deepStrictEqual(
      await extractTicketIdsFromText(
        "Prod list:\nproj-12 Supplier\nPROJ-13, not x-1 nor ABCDEFGHIJK-1 nor 2026-11",
        async () => null,
      ),
      ["proj-12", "PROJ-13"],
    );
  });

  test("an empty text or a failing provider gives nothing", async () => {
    assert.deepStrictEqual(
      await extractTicketIdsFromText("  ", async () => null),
      [],
    );
    assert.deepStrictEqual(
      await extractTicketIdsFromText("CRM-12", async () => {
        throw new Error("no provider");
      }),
      [],
    );
  });
});
