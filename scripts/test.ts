// `npm test -- <name>` runs one folder of test/. `npm test` runs them all.
// Any flags after the name go straight to `node --test`. Every hosted call a
// test makes is marked in the cost log, so the cost summary can leave it out.
import { spawnSync } from "node:child_process";

// test/shipped/ tests the code every attendee gets from the starter. Each other
// folder holds the tests one checkpoint's code makes pass, in workshop order.
export const testFolders = [
  "shipped",
  "act-1",
  "act-2",
  "act-3",
  "act-4",
  "fix-hallucination",
  "fix-access-leak",
] as const;

const accepted =
  "1 to 4, act-1 to act-4, fix-hallucination, fix-access-leak or shipped";

function folderFor(name: string): string | undefined {
  const folder = /^[1-4]$/.test(name) ? `act-${name}` : name;
  return (testFolders as readonly string[]).includes(folder)
    ? folder
    : undefined;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const name = args.find((arg) => !arg.startsWith("-"));
  const flags = args.filter((arg) => arg !== name);

  let pattern = "test/**/*.test.ts";
  if (name !== undefined) {
    const folder = folderFor(name);
    if (!folder) {
      console.error(`No test folder for "${name}". Use ${accepted}.`);
      process.exit(1);
    }
    pattern = `test/${folder}/**/*.test.ts`;
  }

  const result = spawnSync(process.execPath, ["--test", ...flags, pattern], {
    stdio: "inherit",
    env: { ...process.env, COST_LOG_TEST: "1" },
  });
  process.exitCode = result.status ?? 1;
}
