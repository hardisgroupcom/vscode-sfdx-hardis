import * as assert from "assert";
import { PullRequest } from "../../utils/gitProviders/types";
import {
  anyMergeConflict,
  hasMergeConflicts,
  mapAzureMergeStatus,
  mapGitHubMergeable,
  mapGitLabMergeStatus,
} from "../../utils/gitProviders/mergeStatus";
import { BranchStrategyMermaidBuilder } from "../../utils/pipeline/branchStrategyMermaidBuilder";

function pr(overrides: Partial<PullRequest> & { number: number }): PullRequest {
  return {
    id: overrides.number,
    title: `PR ${overrides.number}`,
    description: "",
    sourceBranch: `feature/story-${overrides.number}`,
    targetBranch: "integration",
    authorLabel: "someone",
    state: "open",
    webUrl: `https://git.example.com/pr/${overrides.number}`,
    jobsStatus: "success",
    createdAt: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

const BRANCHES_AND_ORGS = [
  {
    branchName: "integration",
    level: 1,
    mergeTargets: [],
    instanceUrl: "",
  },
];

function buildDiagram(pullRequests: PullRequest[], threshold = 3): string {
  const builder = new BranchStrategyMermaidBuilder(
    BRANCHES_AND_ORGS,
    true,
    pullRequests,
    null,
    "light",
    threshold,
  );
  return builder.build({ format: "string", withMermaidTag: false }) as string;
}

suite("Merge conflicts on the DevOps Pipeline diagram", () => {
  suite("provider payload mapping", () => {
    test("GitHub GraphQL mergeable", () => {
      assert.strictEqual(mapGitHubMergeable("CONFLICTING"), "conflicts");
      assert.strictEqual(mapGitHubMergeable("MERGEABLE"), "mergeable");
      assert.strictEqual(mapGitHubMergeable("UNKNOWN"), "unknown");
      assert.strictEqual(mapGitHubMergeable(undefined), "unknown");
      assert.strictEqual(mapGitHubMergeable(null), "unknown");
    });

    test("Gitea sends mergeable as a boolean", () => {
      assert.strictEqual(mapGitHubMergeable(false), "conflicts");
      assert.strictEqual(mapGitHubMergeable(true), "mergeable");
    });

    test("GitLab reads only the conflict values of detailed_merge_status", () => {
      assert.strictEqual(
        mapGitLabMergeStatus({ detailed_merge_status: "conflict" }),
        "conflicts",
      );
      assert.strictEqual(
        mapGitLabMergeStatus({ detailed_merge_status: "broken_status" }),
        "conflicts",
      );
      assert.strictEqual(
        mapGitLabMergeStatus({ detailed_merge_status: "mergeable" }),
        "mergeable",
      );
      // Blocked for another reason: not a conflict, and not "mergeable" either
      assert.strictEqual(
        mapGitLabMergeStatus({ detailed_merge_status: "not_approved" }),
        "unknown",
      );
      assert.strictEqual(
        mapGitLabMergeStatus({ detailed_merge_status: "checking" }),
        "unknown",
      );
    });

    test("GitLab falls back on merge_status", () => {
      assert.strictEqual(
        mapGitLabMergeStatus({ merge_status: "cannot_be_merged" }),
        "conflicts",
      );
      assert.strictEqual(
        mapGitLabMergeStatus({ merge_status: "can_be_merged" }),
        "mergeable",
      );
      assert.strictEqual(
        mapGitLabMergeStatus({ merge_status: "unchecked" }),
        "unknown",
      );
      assert.strictEqual(mapGitLabMergeStatus({}), "unknown");
    });

    test("Azure DevOps PullRequestAsyncStatus", () => {
      assert.strictEqual(mapAzureMergeStatus({ mergeStatus: 2 }), "conflicts");
      assert.strictEqual(mapAzureMergeStatus({ mergeStatus: 3 }), "mergeable");
      // Queued, rejected by policy and internal failure are not conflicts
      assert.strictEqual(mapAzureMergeStatus({ mergeStatus: 1 }), "unknown");
      assert.strictEqual(mapAzureMergeStatus({ mergeStatus: 4 }), "unknown");
      assert.strictEqual(mapAzureMergeStatus({ mergeStatus: 5 }), "unknown");
      assert.strictEqual(mapAzureMergeStatus({}), "unknown");
    });

    test("only an explicit conflict verdict counts", () => {
      assert.strictEqual(hasMergeConflicts(pr({ number: 1 })), false);
      assert.strictEqual(
        hasMergeConflicts(pr({ number: 1, mergeStatus: "unknown" })),
        false,
      );
      assert.strictEqual(
        hasMergeConflicts(pr({ number: 1, mergeStatus: "conflicts" })),
        true,
      );
      assert.strictEqual(hasMergeConflicts(null), false);
      assert.strictEqual(
        anyMergeConflict([
          pr({ number: 1 }),
          pr({ number: 2, mergeStatus: "conflicts" }),
        ]),
        true,
      );
      assert.strictEqual(anyMergeConflict([pr({ number: 1 })]), false);
    });
  });

  suite("diagram rendering", () => {
    test("a conflicting Pull Request chip is marked, a clean one is not", () => {
      const diagram = buildDiagram([
        pr({ number: 11, mergeStatus: "conflicts" }),
        pr({ number: 12, mergeStatus: "mergeable" }),
      ]);
      const conflictChip = diagram
        .split("\n")
        .find((line) => line.includes("#11"));
      const cleanChip = diagram
        .split("\n")
        .find((line) => line.includes("#12"));
      assert.ok(
        conflictChip,
        "the conflicting Pull Request must be on the diagram",
      );
      assert.ok(cleanChip, "the clean Pull Request must be on the diagram");
      assert.ok(
        conflictChip!.includes("hardis-chip-conflict"),
        `conflict chip should be marked: ${conflictChip}`,
      );
      assert.ok(
        conflictChip!.includes("hardis-conflict-glyph"),
        `conflict chip should carry the warning glyph: ${conflictChip}`,
      );
      assert.ok(
        !cleanChip!.includes("hardis-chip-conflict"),
        `clean chip should stay untouched: ${cleanChip}`,
      );
    });

    test("the job status of a conflicting Pull Request is kept", () => {
      const diagram = buildDiagram([
        pr({ number: 21, mergeStatus: "conflicts", jobsStatus: "failed" }),
      ]);
      const chip = diagram.split("\n").find((line) => line.includes("#21"));
      assert.ok(chip!.includes("hardis-status-failed"), chip);
      assert.ok(chip!.includes("hardis-chip-conflict"), chip);
    });

    test("nothing is marked when no provider verdict is available", () => {
      const diagram = buildDiagram([pr({ number: 31 }), pr({ number: 32 })]);
      assert.ok(!diagram.includes("hardis-chip-conflict"), diagram);
    });

    test("a folded feature group is marked when one of its Pull Requests conflicts", () => {
      const diagram = buildDiagram(
        [
          pr({ number: 41, createdAt: "2026-08-01T10:00:00Z" }),
          pr({
            number: 42,
            createdAt: "2026-08-02T10:00:00Z",
            mergeStatus: "conflicts",
          }),
          pr({ number: 43, createdAt: "2026-08-03T10:00:00Z" }),
        ],
        1,
      );
      const groupLine = diagram
        .split("\n")
        .find(
          (line) =>
            line.includes("FeaturesGroup") && line.includes("hardis-chip"),
        );
      assert.ok(groupLine, "the folded group link must be on the diagram");
      assert.ok(
        groupLine!.includes("hardis-chip-conflict"),
        `the folded group should carry the conflict marker: ${groupLine}`,
      );
    });
  });
});
