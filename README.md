# EOTW · End of the World Watch

[Open the command center](https://eotw-watch.netlify.app) to see which public warnings and incidents qualify for attention, what changed, and which sources support each assessment. The default edition is Maui. Change the location in the watchlist to personalize the feed.

## Using EOTW

- **Command Center** opens with a source-linked situation briefing, collection health, scan time and regional threat levels. Open a regional signal to see the reasons for its score and what to monitor next. Escalation compares changes to the same incident. Anomaly detection compares observed activity with previously collected samples and shows when the baseline is still forming.
- **Live Map** groups spatially close reports as you zoom. Explore categorized incidents, published NWS warning areas when supplied, and individual report timelines. Coverage depends on the coordinates supplied by each source.
- **Hot 24** ranks significant new reports and material changes within a rolling 24-hour window. Open a ranked report to see its qualifying source time, ranking reasons and intelligence assessment.
- **Rabbit Hole** separates public records, reported claims and speculation. Open a claim to inspect verification status, source credibility and any documented supporting or contrary evidence.
- **Investigate** searches indexed reporting and its timelines. **Ask EOTW** retrieves relevant records and answers with citations. When model generation is unavailable, it returns labeled source matches.
- **Watchlist** saves reports, monitors topics and controls location and notifications. Opt-in alerts while the app is open announce qualifying new or worsening incidents that match your preferences. Anonymous browsing works immediately. Accounts can sync across devices when Netlify Identity is enabled.
- **Archive** searches the historical records collected by this installation. Permanent story URLs have server-rendered share metadata and a non-JavaScript source link. An automatically generated sitemap includes archived reporting.

## Run and deploy

Requires Node.js 24 and npm. A Netlify project linked to this repository supplies the Functions runtime, Scheduled Functions, CDN and Blobs. The deployed frontend uses React, TypeScript and Vite. All reporting updates occur after deployment without rebuilding the site.

| Command | Purpose |
| --- | --- |
| `npm ci` | Install the locked dependencies |
| `npx netlify-cli dev` | Run the application with Functions and emulated Blobs |
| `npx netlify-cli functions:invoke collect` | Run one collection against the development environment |
| `npm test` | Exercise ingestion, search, citations, rate limits, profiles and metadata |
| `npm run build` | Type-check and build the static site to `dist/` |
| `npx playwright install chromium && npm run test:ui` | Test desktop and mobile user flows against an existing production build |
| `node server/feeds/smoke.mjs` | Check current upstream availability from the executing host |

Import the repository into Netlify and select `main`. Netlify reads the command, publish directory, Functions path and cache headers from `netlify.toml`. The production command runs unit tests before publishing. Deploy Previews also run browser tests. GitHub Actions provides the same checks for pull requests. A fresh project starts with an empty archive. Its first successful scheduled collection supplies the initial briefing.

## Publish original material

Editors can add sourced original reporting, investigations, predictions and corrections through the [editorial collection](editorial/README.md). The scheduled collector reads published records from GitHub. A change confined to the editorial directory updates the archive without rebuilding the frontend. The published UAP public-record review illustrates how attributed evidence and counterevidence appear in Rabbit Hole.

## Data and operations

Netlify runs the production collector on each ten-minute UTC boundary. Each enabled provider is checked with its validators unless an upstream retry deadline defers it. Open **Source health → Scheduled scan history** to inspect source outcomes, durable archive writes and a changed record from a completed scan. The visible dashboard checks for updated signals and the situation briefing every 45 seconds. A separate scheduled function maintains a cited AI edition for Maui under the shared daily quota. When the evidence changes, readers receive a briefing derived from the current sources while the next AI edition is pending. Reader requests never trigger mass upstream collection. A successful upstream check and a story's publication time measure different things. The UI exposes both.

Normalized records and source status are stored in Netlify Blobs. The schema initializer lives in `server/feeds/migrations/`; the collector writes date-partitioned history before conditionally advancing the current snapshot. The site archives changes to indexed reports and preserves publisher attribution. It does not synthesize missing reports or republish full third-party articles. Reader profiles and model usage permits use separate stores. Private credentials belong in Netlify's Functions environment. Expand **Intelligence assessment** in a report to compare verified material, allegations, possible explanations, evidence on each side, and unresolved questions. The existing model and quotas support AI-assisted assessments. Source-based assessments remain available when the model is unavailable.

See the [source catalog and ranking rules](server/feeds/SOURCES.md) for provider intervals, evidence labels, retention and optional licensed integrations. See the [assistant and account guide](docs/assistant.md) for provider configuration, cost limits, citations and account sync. Optional environment settings are listed in [.env.example](.env.example).

Production checks include opening a story's original source, confirming that at least one provider has a recent successful check, and checking the schedule under the Netlify project's Functions. Day-to-day operation requires no VPS, build webhook or external scheduler. For immediate emergency instructions, follow your local authorities.
