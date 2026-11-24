import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { describe, it, type TestContext } from "node:test";
import {
  fakeClips,
  hostedKeyEnv,
  lineFor,
  readyMachine,
  runDoctor,
  type Machine,
} from "../fake-machine.ts";

const fetchScript = path.resolve(
  import.meta.dirname,
  "../../scripts/fetch-clips.ts",
);

// A release: the clips at `/<file>`, served the way GitHub does, after one
// redirect. Anything else is a 404. Records every path asked for.
async function release(
  t: TestContext,
  clips: Record<string, string>,
): Promise<{ url: string; requests: string[] }> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    requests.push(url);
    if (url.startsWith("/download/")) {
      res.writeHead(302, { location: url.replace("/download/", "/cdn/") });
      return res.end();
    }
    const contents = clips[url.replace("/cdn/", "")];
    if (contents === undefined) {
      res.writeHead(404);
      return res.end("Not Found");
    }
    res.writeHead(200, { "content-type": "audio/mpeg" });
    res.end(contents);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/download`, requests };
}

// Asynchronous, because a synchronous spawn would block the release server
// above from answering the script.
async function runFetch(machine: Machine, url: string) {
  const run = promisify(execFile);
  const env = { ...machine.env, CLIPS_URL: url };
  const result = await run(process.execPath, [fetchScript], {
    cwd: machine.root,
    env,
    encoding: "utf8",
  }).then(
    (r) => ({ status: 0, ...r }),
    (error: { code?: number; stdout: string; stderr: string }) => ({
      status: error.code ?? 1,
      stdout: error.stdout,
      stderr: error.stderr,
    }),
  );
  const lines = result.stdout.trimEnd().split("\n");
  return { status: result.status, lines, stderr: result.stderr };
}

function emptyAudio(machine: Machine): void {
  rmSync(machine.audio, { recursive: true, force: true });
}

describe("npm run fetch-clips", () => {
  it("downloads every clip in the manifest into audio/, and the doctor is then READY", async (t) => {
    const machine = readyMachine(t);
    emptyAudio(machine);
    const { url } = await release(t, fakeClips);

    const { status, lines, stderr } = await runFetch(machine, url);

    assert.equal(status, 0, `${lines.join("\n")}\n${stderr}`);
    assert.deepEqual(readdirSync(machine.audio).toSorted(), [
      "barovia-2025-12-23-blinsky-missing-order.mp3",
      "barovia-2025-12-29-windmill-finale.mp3",
      "toe-wittine-session-3-mimic-chest.mp3",
    ]);
    for (const [file, contents] of Object.entries(fakeClips)) {
      assert.equal(
        readFileSync(path.join(machine.audio, file), "utf8"),
        contents,
      );
      assert.match(lineFor(lines, file), /^✓ /);
    }
    assert.equal(lines.at(-1), "3 sample clips in audio/.");

    Object.assign(machine.env, hostedKeyEnv());
    const doctor = runDoctor(machine);
    assert.equal(doctor.status, 0, doctor.lines.join("\n"));
    assert.equal(doctor.lines.at(-1), "READY");
  });

  it("leaves a clip that is already there alone", async (t) => {
    const machine = readyMachine(t);
    const { url, requests } = await release(t, fakeClips);

    const { status, lines } = await runFetch(machine, url);

    assert.equal(status, 0, lines.join("\n"));
    assert.deepEqual(requests, []);
    assert.match(
      lineFor(lines, "windmill"),
      /^✓ barovia-2025-12-29-windmill-finale\.mp3 already in audio\//,
    );
  });

  it("replaces a clip whose checksum is wrong", async (t) => {
    const machine = readyMachine(t);
    const stale = path.join(
      machine.audio,
      "toe-wittine-session-3-mimic-chest.mp3",
    );
    rmSync(stale);
    writeFileSync(stale, "an older cut");
    const { url, requests } = await release(t, fakeClips);

    const { status } = await runFetch(machine, url);

    assert.equal(status, 0);
    assert.deepEqual(requests, [
      "/download/toe-wittine-session-3-mimic-chest.mp3",
      "/cdn/toe-wittine-session-3-mimic-chest.mp3",
    ]);
    assert.equal(readFileSync(stale, "utf8"), "the mimic chest");
  });

  it("keeps a download that fails its checksum out of audio/ and exits 1", async (t) => {
    const machine = readyMachine(t);
    emptyAudio(machine);
    const { url } = await release(t, {
      ...fakeClips,
      "barovia-2025-12-29-windmill-finale.mp3": "a different cut",
    });

    const { status, lines } = await runFetch(machine, url);

    assert.equal(status, 1);
    assert.match(
      lineFor(lines, "windmill"),
      /^✗ barovia-2025-12-29-windmill-finale\.mp3 downloaded with the wrong checksum/,
    );
    assert.ok(
      !existsSync(
        path.join(machine.audio, "barovia-2025-12-29-windmill-finale.mp3"),
      ),
    );
    assert.deepEqual(readdirSync(machine.audio).toSorted(), [
      "barovia-2025-12-23-blinsky-missing-order.mp3",
      "toe-wittine-session-3-mimic-chest.mp3",
    ]);
    assert.match(lines.at(-1)!, /^1 of 3 sample clips not fetched\. /);
  });

  it("names the URL when the release has no such file", async (t) => {
    const machine = readyMachine(t);
    emptyAudio(machine);
    const { url } = await release(t, {});

    const { status, lines } = await runFetch(machine, url);

    assert.equal(status, 1);
    assert.match(
      lineFor(lines, "windmill"),
      /^✗ barovia-2025-12-29-windmill-finale\.mp3: 404 Not Found from http:\/\/127\.0\.0\.1:\d+\/download\/barovia-2025-12-29-windmill-finale\.mp3/,
    );
    assert.match(lines.at(-1)!, /^3 of 3 sample clips not fetched\. /);
  });
});
