# Publish to the EOTW archive

Publish an original report, investigation, prediction or correction through GitHub. The production collector checks the registry on the main branch every five minutes. The published article has a durable GitHub link, and the archive assigns it a shareable EOTW story URL.

1. Add the full article as Markdown under `editorial/reports/<slug>.md`. Include its headline, byline, publication time, reporting, evidence, and any material uncertainty. Readers can open this document from the EOTW story page.
2. Add its metadata to the array in `editorial/records.json`. Commit the article and its entry together. Keep the original slug and publication timestamp for all future editions.
3. Confirm the source health panel reports a successful EOTW editorial check. Search the archive by headline or choose its editorial type. Netlify skips the site build when only the editorial directory changes.

An empty registry represents an edition with no published records. Each update must remain valid as a whole. A broken record produces a source-health error and the last successful edition remains readable. The registry accepts at most 100 records and 400 KB. Older items that leave the registry remain in the historical archive.

| Field | Meaning |
| --- | --- |
| `slug` | The UTC publication date followed by a short lowercase hyphenated identifier. It is also the permanent article filename, without its Markdown extension. |
| `type` | `original`, `investigation`, `prediction`, or `correction`. |
| `title`, `summary`, `byline` | A headline of up to 240 characters, a sourced abstract of up to 640, and a named author or responsible desk of up to 80. |
| `publishedAt`, `updatedAt` | Actual UTC timestamps with a calendar date, a time including seconds, and a trailing Z. At initial publication, use the same timestamp for both. Use the revision time for subsequent editions. |
| `sources` | Between one and nine independent evidence references. Each object carries a human-readable `name` and an HTTPS `url`. Cite the primary material supporting the published report. |
| `scope`, `location` | Optional. Scope can be `us` or `global`. Provide a place label only when supported by the reporting. |
| `status` | Optional. Use `confirmed`, `developing`, or `speculation`. The default is `developing`, and predictions always carry the speculation label. |
| `supersedes` | Required for corrections. Supply the `name` and HTTPS `url` of the publication being corrected. Other types can use it when formally replacing an earlier publication. |

For a material correction, publish a correction entry with its own date and slug, link the earlier report through `supersedes`, and add a correction notice and link to the earlier Markdown article. Update the earlier summary and revision timestamp when the correction affects its abstract. EOTW keeps the former headline and summary in the edition timeline.

The collector reads this repository's public raw registry. Browsers cannot submit entries to the collector. Collaborators with permission to change the production branch control publication. Run `node --test tests/ingest-editorial.test.mjs` on a remote runner to validate the registry and confirm every referenced article file exists.
