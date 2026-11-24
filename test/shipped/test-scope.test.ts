import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";

const scopeScript = path.resolve(import.meta.dirname, "../../scripts/test.ts");

const folders = [
  "shipped",
  "act-1",
  "act-2",
  "act-3",
  "act-4",
  "fix-hallucination",
  "fix-access-leak",
];

// A repo with one passing test per folder, each named after its folder.
function repoWithEveryFolder(t: TestContext): string {
  const root = mkdtempSync(path.join(tmpdir(), "test-scope-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const folder of folders) {
    mkdirSync(path.join(root, "test", folder), { recursive: true });
    writeFileSync(
      path.join(root, "test", folder, "one.test.ts"),
      `import { test } from "node:test";\ntest("in ${folder}", () => {});\n`,
    );
  }
  return root;
}

// Runs `npm test -- <args>` as npm would, with TAP output so the test names
// can be read back. NODE_TEST_CONTEXT would make the inner run report to this
// one instead of printing.
function npmTest(root: string, ...args: string[]) {
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const result = spawnSync(
    process.execPath,
    [scopeScript, ...args, "--test-reporter=tap"],
    { cwd: root, env, encoding: "utf8" },
  );
  const ran = [...result.stdout.matchAll(/^ok \d+ - in (\S+)$/gm)].map(
    (m) => m[1],
  );
  return { status: result.status, ran, stderr: result.stderr };
}

describe("npm test -- <name>", () => {
  it("runs every folder when no name is given", (t) => {
    const { status, ran } = npmTest(repoWithEveryFolder(t));
    assert.equal(status, 0);
    assert.deepEqual(ran.toSorted(), folders.toSorted());
  });

  for (const [name, folder] of [
    ["2", "act-2"],
    ["act-2", "act-2"],
    ["4", "act-4"],
    ["fix-hallucination", "fix-hallucination"],
    ["fix-access-leak", "fix-access-leak"],
    ["shipped", "shipped"],
  ]) {
    it(`runs only test/${folder}/ for ${name}`, (t) => {
      const { status, ran } = npmTest(repoWithEveryFolder(t), name);
      assert.equal(status, 0);
      assert.deepEqual(ran, [folder]);
    });
  }

  it("marks the run so the cost log can tell test calls apart", (t) => {
    const root = repoWithEveryFolder(t);
    writeFileSync(
      path.join(root, "test", "shipped", "one.test.ts"),
      `import assert from "node:assert/strict";\nimport { test } from "node:test";\ntest("in shipped", () => assert.equal(process.env.COST_LOG_TEST, "1"));\n`,
    );
    const { status, ran } = npmTest(root, "shipped");
    assert.equal(status, 0);
    assert.deepEqual(ran, ["shipped"]);
  });

  it("refuses a name it doesn't know, listing the ones it does", (t) => {
    const { status, ran, stderr } = npmTest(repoWithEveryFolder(t), "act-5");
    assert.equal(status, 1);
    assert.deepEqual(ran, []);
    assert.match(stderr, /act-5/);
    assert.match(stderr, /1 to 4.*fix-hallucination.*fix-access-leak.*shipped/);
  });
});
