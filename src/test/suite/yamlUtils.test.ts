import * as assert from "assert";
import * as yaml from "js-yaml";
import { dumpRepositoryYaml } from "../../utils/yamlUtils";

// Every expected text below is what Prettier leaves unchanged.
suite("dumpRepositoryYaml", () => {
  function assertDump(doc: unknown, expected: string) {
    const dumped = dumpRepositoryYaml(doc);
    assert.strictEqual(dumped, expected);
    assert.deepStrictEqual(yaml.load(dumped), yaml.load(expected));
  }

  test("quotes with double quotes", () => {
    assertDump(
      { command: "", colon: "a: b", hash: "x #y", yes: "yes", num: "123" },
      'command: ""\ncolon: "a: b"\nhash: "x #y"\n"yes": "yes"\nnum: "123"\n',
    );
  });

  test("uses single quotes for a string holding a double quote", () => {
    assertDump(
      {
        command:
          'sf data query --query "SELECT Id FROM Account" --target-org x # count',
        quote: '"',
        both: `'a' "c"`,
      },
      "command: 'sf data query --query \"SELECT Id FROM Account\" --target-org x # count'\n" +
        "quote: '\"'\n" +
        "both: '''a'' \"c\"'\n",
    );
  });

  test("keeps double quotes when the string needs another escape", () => {
    assertDump({ tab: 'a\t"b"' }, 'tab: "a\\t\\"b\\""\n');
  });

  test("leaves plain strings with quotes and apostrophes alone", () => {
    assertDump(
      { label: `it's "x"`, list: [`x "y"`, "it's"] },
      'label: it\'s "x"\nlist:\n  - x "y"\n  - it\'s\n',
    );
  });

  test("quotes keys, and values under a quoted key, like Prettier", () => {
    assertDump(
      { '"a": b': ['"x"'], 'k"q': '"y"' },
      '\'"a": b\':\n  - \'"x"\'\nk"q: \'"y"\'\n',
    );
  });

  test("keeps long strings on one line", () => {
    const long = "word ".repeat(40) + "end: x";
    assertDump({ long }, `long: "${long}"\n`);
  });

  test("drops trailing spaces in multi-line strings, and leaves block content as is", () => {
    assertDump({ script: 'a "q"  \n\nb \n' }, 'script: |\n  a "q"\n\n  b\n');
  });
});
