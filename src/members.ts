// The member lookup: who may see what. The members file maps each member to
// their roles and each role to the visibilities it may see. It is the only
// place the access rule lives, so a second campaign, or a company's second
// team, is more rows in the file and never more code. The asker names
// themselves and never their role.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// The members file as it sits on disk: role to visibilities, member to roles.
export interface MembersFile {
  roles: Record<string, string[]>;
  members: Record<string, string[]>;
}

// A loaded members file: each member's name, lowercased, to the visibilities
// their roles allow, sorted and without repeats.
export type Members = ReadonlyMap<string, readonly string[]>;

// The shipped members file, in the folder the command runs from, which npm
// makes the repo root.
export const membersFileName = "members.json";

export function membersPath(): string {
  return path.resolve(membersFileName);
}

// Reads and checks a members file. Throws on a member holding a role the file
// doesn't define, since a typo there would quietly change who sees what.
export function loadMembers(file: string): Members {
  if (!existsSync(file)) {
    throw new Error(
      `No members file at ${file}. The workshop's is ${membersFileName}.`,
    );
  }
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const roles = listsOf(parsed, "roles", "role", file);
  const members = listsOf(parsed, "members", "member", file);

  const allowed = new Map<string, string[]>();
  const spelledAs = new Map<string, string>();
  for (const [name, memberRoles] of members) {
    const key = memberKey(name);
    const earlier = spelledAs.get(key);
    if (earlier !== undefined) {
      throw new Error(
        `${file} lists "${earlier}" and "${name}", which name the same member. Keep one.`,
      );
    }
    spelledAs.set(key, name);
    const visibilities = new Set<string>();
    for (const role of memberRoles) {
      const granted = roles.get(role);
      if (!granted) {
        throw new Error(
          `${file}: "${name}" holds role "${role}", which "roles" doesn't define. Add it to "roles" or fix the name.`,
        );
      }
      for (const visibility of granted) visibilities.add(visibility);
    }
    allowed.set(key, [...visibilities].sort());
  }
  return allowed;
}

// The visibilities a member may see. A missing or unknown member gets none.
export function allowedVisibilities(
  members: Members,
  name: string | undefined,
): string[] {
  if (name === undefined) return [];
  return [...(members.get(memberKey(name)) ?? [])];
}

// Names match whatever their case or spacing, so an asker who names Katie
// is katie.
function memberKey(name: string): string {
  return name.trim().toLowerCase();
}

// One of the file's two maps, checked: every value a list of strings.
function listsOf(
  parsed: unknown,
  field: "roles" | "members",
  kind: string,
  file: string,
): Map<string, string[]> {
  const value =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)[field]
      : undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${file} has no "${field}" object.`);
  }
  const lists = new Map<string, string[]>();
  for (const [name, list] of Object.entries(value)) {
    if (
      !Array.isArray(list) ||
      !list.every((item) => typeof item === "string")
    ) {
      throw new Error(`${file}: ${kind} "${name}" must be a list of strings.`);
    }
    lists.set(name, list);
  }
  return lists;
}
