import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { findKey, modelIdFor } from "../../src/hosted.ts";

const example = path.resolve(import.meta.dirname, "../../.env.example");

// A scratch .env holding `contents`, or no file at all when it's undefined.
function envFile(t: TestContext, contents?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "hosted-key-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, ".env");
  if (contents !== undefined) writeFileSync(file, contents);
  return file;
}

describe("finding the hosted key", () => {
  it("reads an OpenRouter key from the environment", (t) => {
    const key = findKey({ OPENROUTER_API_KEY: "sk-or-env" }, envFile(t));
    assert.deepEqual(key, {
      provider: "openrouter",
      key: "sk-or-env",
      from: "environment",
    });
  });

  it("reads an OpenAI key from the environment", (t) => {
    const key = findKey({ OPENAI_API_KEY: "sk-env" }, envFile(t));
    assert.equal(key?.provider, "openai");
    assert.equal(key?.key, "sk-env");
  });

  it("picks OpenRouter when both keys are set", (t) => {
    const key = findKey(
      { OPENAI_API_KEY: "sk-env", OPENROUTER_API_KEY: "sk-or-env" },
      envFile(t),
    );
    assert.equal(key?.provider, "openrouter");
  });

  it("falls back to .env when the environment has no key", (t) => {
    const key = findKey({}, envFile(t, "OPENAI_API_KEY=sk-file\n"));
    assert.deepEqual(key, {
      provider: "openai",
      key: "sk-file",
      from: ".env",
    });
  });

  it("prefers the environment's key over a different one in .env", (t) => {
    const key = findKey(
      { OPENAI_API_KEY: "sk-env" },
      envFile(t, "OPENROUTER_API_KEY=sk-or-file\n"),
    );
    assert.equal(key?.provider, "openai");
    assert.equal(key?.from, "environment");
  });

  it("finds no key in a copy of .env.example that hasn't been filled in", () => {
    assert.equal(findKey({}, example), undefined);
  });

  it("finds no key when there is no .env", (t) => {
    assert.equal(findKey({ OPENAI_API_KEY: "" }, envFile(t)), undefined);
  });
});

describe("a model id on each provider", () => {
  it("keeps OpenRouter's vendor prefix", () => {
    assert.equal(
      modelIdFor("openrouter", "openai/gpt-4o-mini"),
      "openai/gpt-4o-mini",
    );
  });

  it("drops the openai/ prefix on an OpenAI key", () => {
    assert.equal(modelIdFor("openai", "openai/gpt-4o-mini"), "gpt-4o-mini");
  });

  it("refuses an OpenRouter-only model on an OpenAI key, and says why", () => {
    assert.throws(() => modelIdFor("openai", "cohere/rerank-v3.5"), {
      message: /cohere\/rerank-v3\.5.*OpenRouter key/,
    });
  });
});
