import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { editorialRows } from "../server/feeds/editorial.mjs";
import { combine, record } from "../server/feeds/model.mjs";
import { definitions, fetchProvider } from "../server/feeds/providers.mjs";
import { parseFeedParams } from "../server/feeds/store.mjs";

const publishedAt = "2026-01-10T10:00:00Z";
const revisedAt = "2026-01-12T10:00:00Z";
const now = Date.parse("2026-01-13T00:00:00Z");
const sample = {
  slug: "2026-01-10-test-record",
  type: "original",
  title: "Fixture title",
  summary: "Fixture abstract.",
  byline: "Test author",
  publishedAt,
  updatedAt: publishedAt,
  sources: [{ name: "Test source", url: "https://example.org/source" }],
};
const parse = (overrides = {}) => editorialRows(JSON.stringify([{ ...sample, ...overrides }]), now)[0];
test("published manifest has real article files and validates before deployment", async () => {
  const manifest = await readFile(new URL("../editorial/records.json", import.meta.url), "utf8");
  const rows = editorialRows(manifest);
  for (const row of rows) {
    const file = row.url.split("/").at(-1);
    const path = new URL("../editorial/reports/" + file, import.meta.url);
    assert.ok((await stat(path)).isFile());
    assert.ok((await readFile(path, "utf8")).trim().length > 0);
  }
});
test("editorial identities survive revisions and predictions remain speculative", () => {
  const old = record(parse(), now);
  const next = record(parse({ title: "Revised title", updatedAt: revisedAt }), now);
  const merged = combine(old, next, "2026-01-13T00:00:00.000Z");
  assert.equal(old.id, next.id);
  assert.match(merged.url, /github\.com\/Elythadris\/EOTW\/blob\/main\/editorial\/reports\//);
  assert.equal(merged.byline, sample.byline);
  assert.equal(merged.timeline.at(-1).at, "2026-01-12T10:00:00.000Z");
  assert.match(merged.timeline.at(-2).text, /Fixture title/);
  assert.equal(combine(merged, old, revisedAt).title, next.title);
  assert.equal(parse({ type: "prediction", status: "confirmed" }).status, "speculation");
  assert.equal(parse({ type: "investigation" }).category, "Investigation");
});
test("records require independent HTTPS citations, a byline, valid dates and known types", () => {
  assert.throws(() => parse({ sources: [] }));
  assert.throws(() => parse({ byline: " " }));
  assert.throws(() => parse({ publishedAt: "2026-02-30T00:00:00Z" }));
  assert.throws(() => parse({ type: "constructor" }));
  assert.throws(() => parse({ sources: [{ name: "Self", url: parse().url }] }));
  assert.throws(() => parse({ sources: [{ name: "Bad", url: "javascript:alert(1)" }] }));
  assert.throws(() => parse({ updatedAt: "2025-12-31T00:00:00Z" }));
  assert.throws(() => parse({ updatedAt: "2099-01-10T10:00:00Z" }));
  assert.throws(() => editorialRows(JSON.stringify([sample, sample]), now));
  assert.throws(() => parse({ type: "correction" }));
  const supersedes = { name: "Original record", url: "https://example.org/report" };
  const correction = record(parse({ type: "correction", supersedes }), now);
  assert.deepEqual(correction.supersedes, supersedes);
  assert.ok(correction.sources.some((ref) => ref.url === supersedes.url));
});
test("a malformed entry rejects the whole poll so a prior working feed can remain available", async () => {
  const provider = definitions({}).find((p) => p.id === "editorial");
  const fetcher = async () => Response.json([sample, { ...sample, slug: "../bad" }]);
  await assert.rejects(fetchProvider(provider, {}, { now, fetcher }));
  assert.equal(parseFeedParams(new URL("https://example.org/api/feed?view=archive&type=prediction")).type, "prediction");
  assert.throws(() => parseFeedParams(new URL("https://example.org/api/feed?view=archive&type=unknown")));
});
