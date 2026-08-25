import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  countFileLines,
  LINE_COUNT_MAX_BYTES,
} from "../../commands/showDataWorkbench";

/**
 * Unit tests of the exported files / logs line counter of the Data Workbench.
 *
 * The counter reads the file by chunks and lets Buffer.indexOf() find the
 * newlines, so it never holds a large export in memory. Every case below is
 * also run with a chunk size of a few bytes, so the newlines land on both
 * sides of a chunk boundary and a chunk can hold none at all.
 */

const TINY_CHUNK = 4;

let tmpDir: string;

function writeTempFile(name: string, content: string): string {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

async function count(filePath: string, chunkBytes?: number) {
  const size = fs.statSync(filePath).size;
  return countFileLines(filePath, size, chunkBytes);
}

suite("Data Workbench line counter", () => {
  suiteSetup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hardis-line-count-"));
  });

  suiteTeardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 });
  });

  const cases: Array<{ label: string; content: string; expected: number }> = [
    { label: "an empty file", content: "", expected: 0 },
    { label: "a single line without newline", content: "Id,Name", expected: 1 },
    { label: "a single line with newline", content: "Id,Name\n", expected: 1 },
    {
      label: "three lines, trailing newline",
      content: "Id,Name\n001,Acme\n002,Globex\n",
      expected: 3,
    },
    {
      label: "three lines, no trailing newline",
      content: "Id,Name\n001,Acme\n002,Globex",
      expected: 3,
    },
    {
      label: "CRLF line endings",
      content: "Id,Name\r\n001,Acme\r\n",
      expected: 2,
    },
    {
      label: "consecutive newlines (empty lines)",
      content: "Id,Name\n\n\n001,Acme\n",
      expected: 4,
    },
    { label: "only newlines", content: "\n\n\n", expected: 3 },
  ];

  for (const { label, content, expected } of cases) {
    test(`counts ${label}`, async () => {
      const filePath = writeTempFile(
        `${label.replace(/[^a-z0-9]+/gi, "-")}.csv`,
        content,
      );
      assert.strictEqual(
        await count(filePath),
        expected,
        `${label}: wrong count with the default chunk size`,
      );
      assert.strictEqual(
        await count(filePath, TINY_CHUNK),
        expected,
        `${label}: wrong count when the newlines cross chunk boundaries`,
      );
    });
  }

  test("counts a file spanning many chunks", async () => {
    // Fixed-width lines, so a chunk size of LINE_BYTES makes every chunk end
    // exactly on a newline, and one of LINE_BYTES - 1 never does
    const LINE_BYTES = 16;
    const lines = 5000;
    const filePath = writeTempFile(
      "many-chunks.csv",
      Array.from({ length: lines }, (_, i) =>
        String(i).padStart(LINE_BYTES - 1, "0"),
      ).join("\n") + "\n",
    );
    assert.strictEqual(await count(filePath), lines);
    assert.strictEqual(await count(filePath, LINE_BYTES), lines);
    assert.strictEqual(await count(filePath, LINE_BYTES - 1), lines);
  });

  test("counts a file larger than the default chunk size", async () => {
    // The default chunk is 1 MB, so this file is read in several passes
    const line = "0".repeat(99);
    const lines = 30000;
    const filePath = writeTempFile(
      "over-one-chunk.csv",
      `${Array.from({ length: lines }, () => line).join("\n")}\n`,
    );
    assert.ok(
      fs.statSync(filePath).size > 1024 * 1024,
      "the fixture should be larger than one chunk",
    );
    assert.strictEqual(await count(filePath), lines);
  });

  test("returns null instead of reading a file above the size cap", async () => {
    const filePath = writeTempFile("big.csv", "Id,Name\n001,Acme\n");
    assert.strictEqual(
      await countFileLines(filePath, LINE_COUNT_MAX_BYTES + 1),
      null,
      "a file declared above the cap should not be counted",
    );
  });

  test("returns 0 for a missing file instead of throwing", async () => {
    assert.strictEqual(
      await countFileLines(path.join(tmpDir, "does-not-exist.csv"), 42),
      0,
    );
  });
});
