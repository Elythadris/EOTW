# EOTW · End of the World Watch

[Open the command center](https://eotw-watch.netlify.app) to read a local briefing, check where an incident was reported, and follow the original sources. The default edition is Maui. Change the location in the watchlist to personalize the feed.

## Using EOTW

- **Command Center** brings together local, U.S. and global developments, coverage status and the event map.
- **Live Map** opens source reports from interactive geographic markers. Zoom with the controls and pan by dragging or using the arrow keys.
- **Trending 24H** ranks recent updates by recency, reported significance, growth in independent coverage and measured engagement where a provider supplies it.
- **Rabbit Hole** tracks public records, fact checks and reported claims. Each story carries a verification label and a link to the evidence.
- **Investigate** searches indexed reporting and its timelines. **Ask EOTW** retrieves relevant records and answers with citations. When model generation is unavailable, it returns labeled source matches.
- **Watchlist** saves reports, monitors topics and controls location and notifications. Anonymous browsing works immediately. Accounts can sync across devices when Netlify Identity is enabled.
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

## Data and operations

The collector wakes every five minutes UTC on published production deploys. Each adapter enforces its own check interval, validators, retry schedule and quotas. The frontend polls the stored briefing. Reader requests never trigger mass upstream collection. A successful upstream check and a story's publication time measure different things. The UI exposes both.

Normalized records and source status are stored in Netlify Blobs. The schema initializer lives in `server/feeds/migrations/`; the collector writes date-partitioned history before conditionally advancing the current snapshot. The site archives changes to indexed reports and preserves publisher attribution. It does not synthesize missing reports or republish full third-party articles. Reader profiles and model usage permits use separate stores. Private credentials belong in Netlify's Functions environment.

See the [source catalog and ranking rules](server/feeds/SOURCES.md) for provider intervals, evidence labels, retention and optional licensed integrations. See the [assistant and account guide](docs/assistant.md) for provider configuration, cost limits, citations and account sync. Optional environment settings are listed in [.env.example](.env.example).

Production checks include opening a story's original source, confirming that at least one provider has a recent successful check, and checking the schedule under the Netlify project's Functions. Day-to-day operation requires no VPS, build webhook or external scheduler. For immediate emergency instructions, follow your local authorities.
