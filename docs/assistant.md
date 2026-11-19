# Ask EOTW and reader accounts

Ask EOTW searches the site's ingested public reporting at request time. It retrieves the selected story, recent records for the current view and matching archive entries. It sends up to six relevant records to the configured model. Social posts are excluded from the model material. Publication dates, source labels and timeline excerpts travel with each record. An empty search produces an explicit empty result.

The answer service requires a known source ID and a matching verbatim excerpt for each generated paragraph. It creates numbered links from stored publisher URLs. An evidence match verifies the origin of an excerpt. Readers can inspect the linked report to assess the model's interpretation. When a provider is disabled, a daily limit is reached or an answer fails validation, the endpoint returns attributed headlines with `mode: "sources"`.

## Model settings

Production deployments on eligible Netlify plans can use the hosted AI Gateway. After the first production deploy, Netlify injects the OpenAI-compatible environment variables when team AI features are enabled. The server uses the OpenAI SDK with the injected credentials. Check the team's AI Gateway usage and model availability in Netlify. [Netlify AI Gateway](https://docs.netlify.com/build/ai-gateway/overview/)

| Optional Functions variable | Purpose |
| --- | --- |
| `AI_MODEL` | Defaults to `gpt-4.1-mini`. The selected model must support Chat Completions, JSON object output and the completion-token limit. |
| `AI_API_KEY` | Use your own compatible provider. The key stays in Netlify Functions. |
| `AI_BASE_URL` | Set with `AI_API_KEY` for an alternative provider's HTTPS API base. With a custom key alone the SDK uses the OpenAI v1 API. |
| `AI_DAILY_LIMIT` | Site-wide maximum model attempts per UTC day. Default 25, allowed range 0–500. Set to 0 for source-only operation. |
| `AI_VISITOR_DAILY_LIMIT` | Maximum model attempts per originating network IP per UTC day. Default 5, allowed range 0–30. |
| `EOTW_IDENTITY_ENABLED` | Set to `true` after enabling Identity in the Netlify dashboard to offer account sync. |

Apply variables in the Functions scope and redeploy. Keep model credentials scoped to production. Deploy previews serve attributed source matches. Model requests use a 12-second timeout, a ceiling of 650 completion tokens, bounded inputs and zero SDK retries. The service claims immutable daily permits before sending a request. A timeout or interrupted request can consume a permit. A reservation failure returns source matches. Requests from the same network share the visitor allowance. Netlify also limits the public ask endpoint to 12 requests per minute per domain and IP.

The last six conversation turns (up to 650 characters each), question, selected location, filters and source excerpts may be sent to the configured model. The service does not send guest cookies or raw IP addresses to the model. Selecting a provider determines the applicable data terms. [OpenAI Chat Completions API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)

## Reader storage

Guest preferences use a random, host-only HTTP-only cookie with a one-year lifetime. The server derives a storage key from the cookie's digest. Clearing the cookie loses access to that guest profile. Preferences and history live in the scoped Netlify Blobs store with schema version 1; deployment previews use isolated stores. Each profile may hold 200 story IDs, 32 topics, a location, a notification preference and the most recent 24 messages. The PUT endpoint accepts `If-Match` with the ETag from GET to detect competing updates and returns 412 on a conflict.

To enable cross-device accounts, turn on Netlify Identity for the project, configure registration and the email or OAuth providers you want to support, then set `EOTW_IDENTITY_ENABLED=true` in Functions and redeploy. Confirm sign-in, confirmation and recovery on a deployed HTTPS origin. Open Watchlist to sign in or create an account. The server resolves the verified Identity user for every profile request. Guest and account profiles have separate storage keys. [Netlify Identity](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/overview/)

## Verification

The Node tests exercise guest isolation, verified account storage, conditional writes, JSON limits, same-origin checks, citation matching, source-only responses and concurrent daily reservations. Live provider credentials and deployed Identity email or OAuth configuration are required to verify those external flows.

## Automatic Situation Briefing

The Command Center reads `GET /api/situation?location=Maui`. The endpoint returns three sections, with a list of source IDs for each point. The citation index carries the publisher, original URL, publication time, region and EOTW story ID. `updatedAt` is the feed check time. `generatedAt` is the time of the model run. Source-only responses leave `generatedAt` empty.

The independent `briefing-digest` scheduled function checks two minutes after the five-minute collection interval. On a published production deployment it can reserve one generation attempt per six-hour UTC window. Only qualified local, US and global signals enter a situation briefing. The seven-day window excludes expired notices, speculation and social posts. When no signal qualifies locally the response says so. Materially unchanged evidence reuses the saved edition. Every generated point must cite an indexed source and match a short excerpt. A new lead, changed lead tier, changed high-priority incident set, or revised or expired cited report causes the dashboard to show the current source briefing immediately. A failed scheduled attempt does not delay this read-time update. A reporting-store outage can serve a recent retained edition with its stale flag. [Netlify scheduled functions](https://docs.netlify.com/build/functions/scheduled-functions/)

`AI_BRIEFING_DAILY_LIMIT` controls the scheduler’s own allowance, default four, range zero to four. Each scheduled attempt also consumes one of the site-wide `AI_DAILY_LIMIT` permits shared with Ask EOTW. The scheduler uses a nine-second provider timeout, zero SDK retries and a maximum 850 completion tokens inside Netlify’s 30-second scheduled-function limit. Daily quotas count attempts, including failed responses. Public GETs and browser refreshes use cached or source-only reporting. The scheduled edition covers Maui. A custom location receives the same regional source selection and current source-linked monitoring criteria.

The analyst can retrieve the Signals view, ranked public reports, bounded matched overlap groups and explicitly attributed evidence or counterevidence in reviewed editorial records. A shared time and place is described as reporting overlap. External source links alone establish neither corroboration nor a contradiction.
