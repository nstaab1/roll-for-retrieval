// The member lookup turns an asker's name into the visibilities they may see.
// The members file is the only place the access rule lives. These tests need no
// key and no network.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import {
  allowedVisibilities,
  loadMembers,
  membersPath,
  type MembersFile,
} from "../../src/members.ts";

const sample: MembersFile = {
  roles: {
    "barovia-dm": ["barovia/party", "barovia/dm"],
    "barovia-player": ["barovia/party"],
    "toe-wittine-dm": ["toe-wittine/party", "toe-wittine/dm"],
    "toe-wittine-player": ["toe-wittine/party"],
  },
  members: {
    dm: ["barovia-dm", "toe-wittine-dm"],
    both: ["barovia-player", "toe-wittine-player"],
    barovian: ["barovia-player"],
  },
};

function writeMembers(t: TestContext, contents: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "members-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "members.json");
  writeFileSync(file, JSON.stringify(contents));
  return file;
}

function load(t: TestContext, contents: unknown = sample) {
  return loadMembers(writeMembers(t, contents));
}

describe("allowedVisibilities", () => {
  it("gives a player their campaign's party", (t) => {
    assert.deepEqual(allowedVisibilities(load(t), "barovian"), [
      "barovia/party",
    ]);
  });

  it("joins the visibilities of every role a member holds", (t) => {
    assert.deepEqual(allowedVisibilities(load(t), "both"), [
      "barovia/party",
      "toe-wittine/party",
    ]);
    assert.deepEqual(allowedVisibilities(load(t), "dm"), [
      "barovia/dm",
      "barovia/party",
      "toe-wittine/dm",
      "toe-wittine/party",
    ]);
  });

  it("lists a visibility once when two roles both grant it", (t) => {
    const members = load(t, {
      roles: { a: ["shared", "x"], b: ["shared", "y"] },
      members: { pat: ["a", "b"] },
    });

    assert.deepEqual(allowedVisibilities(members, "pat"), ["shared", "x", "y"]);
  });

  it("gives a missing member nothing", (t) => {
    const members = load(t);

    assert.deepEqual(allowedVisibilities(members, undefined), []);
    assert.deepEqual(allowedVisibilities(members, ""), []);
    assert.deepEqual(allowedVisibilities(members, "  "), []);
  });

  it("gives an unknown member nothing", (t) => {
    const members = load(t);

    assert.deepEqual(allowedVisibilities(members, "stranger"), []);
    assert.deepEqual(allowedVisibilities(members, "toString"), []);
    assert.deepEqual(allowedVisibilities(members, "__proto__"), []);
  });

  it("never lets the asker name a role", (t) => {
    const members = load(t);

    assert.deepEqual(allowedVisibilities(members, "barovia-dm"), []);
    assert.deepEqual(allowedVisibilities(members, "barovia/dm"), []);
  });

  it("matches a member's name whatever its case or spacing", (t) => {
    assert.deepEqual(allowedVisibilities(load(t), " Barovian "), [
      "barovia/party",
    ]);
  });

  it("gives a member with no roles nothing", (t) => {
    const members = load(t, { ...sample, members: { idle: [] } });

    assert.deepEqual(allowedVisibilities(members, "idle"), []);
  });
});

describe("loadMembers", () => {
  it("refuses a member holding a role the file doesn't define", (t) => {
    assert.throws(
      () =>
        load(t, { ...sample, members: { pat: ["barovia-dungeon-master"] } }),
      /"pat" holds role "barovia-dungeon-master", which .* doesn't define/,
    );
  });

  it("refuses a file with no roles or no members", (t) => {
    assert.throws(() => load(t, { members: {} }), /"roles"/);
    assert.throws(() => load(t, { roles: {} }), /"members"/);
  });

  it("refuses a role or a member that isn't a list of strings", (t) => {
    assert.throws(
      () =>
        load(t, { ...sample, roles: { ...sample.roles, odd: "barovia/dm" } }),
      /role "odd"/,
    );
    assert.throws(
      () => load(t, { ...sample, members: { pat: "barovia-player" } }),
      /member "pat"/,
    );
  });

  it("refuses two members whose names differ only by case", (t) => {
    assert.throws(
      () =>
        load(t, {
          ...sample,
          members: { Pat: ["barovia-player"], pat: ["barovia-dm"] },
        }),
      /"Pat" and "pat"/,
    );
  });

  it("refuses a members file that doesn't exist", (t) => {
    const missing = path.join(
      path.dirname(writeMembers(t, sample)),
      "nobody.json",
    );

    assert.throws(() => loadMembers(missing), /No members file at .*nobody/);
  });
});

describe("the shipped members file", () => {
  const members = loadMembers(membersPath());

  it("gives nathan both campaigns, DM content included", () => {
    assert.deepEqual(allowedVisibilities(members, "nathan"), [
      "barovia/dm",
      "barovia/party",
      "toe-wittine/dm",
      "toe-wittine/party",
    ]);
  });

  it("gives the player at both tables both parties and no DM content", () => {
    assert.deepEqual(allowedVisibilities(members, "katie"), [
      "barovia/party",
      "toe-wittine/party",
    ]);
  });

  it("seats five players at Barovia and four at Toe Wittine", () => {
    const seatedAt = (visibility: string) =>
      ["scott", "hannah", "katie", "justin", "jess", "millie", "adam", "sarah"]
        .filter((name) =>
          allowedVisibilities(members, name).includes(visibility),
        )
        .sort();

    assert.deepEqual(seatedAt("barovia/party"), [
      "hannah",
      "jess",
      "justin",
      "katie",
      "scott",
    ]);
    assert.deepEqual(seatedAt("toe-wittine/party"), [
      "adam",
      "katie",
      "millie",
      "sarah",
    ]);
    assert.deepEqual(seatedAt("barovia/dm"), []);
    assert.deepEqual(seatedAt("toe-wittine/dm"), []);
  });
});
