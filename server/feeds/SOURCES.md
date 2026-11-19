# Source coverage and operation

The production collector wakes every five minutes UTC. An adapter runs when its own next-check time is due. A successful check can return zero reports. The dashboard exposes each provider's most recent successful poll and its health. Publication times come from the source. GDELT entries use its observation time and say so in the timeline.

| Provider | Check interval | Coverage |
| --- | --- | --- |
| NWS | 5 minutes | Active Hawaiʻi alerts and severe or extreme alerts across the U.S. |
| USGS | 5 minutes | Magnitude 2.5 or greater earthquakes from the past day |
| NASA EONET | 30 minutes | Open natural events observed in the last 14 days |
| County of Maui and Hawaiʻi EMA | 15 minutes | County news releases and state emergency management bulletins |
| Federal Register | 1 hour | Recently published U.S. public notices and regulations |
| Federal Register UAP records | 6 hours | Public documents indexed for the phrase “unidentified anomalous phenomena” |
| U.S. Department of Justice | 30 minutes | Public press releases on U.S. cases and agency actions |
| The Conversation, U.S. edition | 30 minutes | Source-linked national and international analysis from researchers |
| Global Voices | 30 minutes | Headlines, bylines and links to international reporting |
| FactCheck.org SciCheck | 1 hour | Links to published science fact checks |
| GDELT DOC | 30 minutes | English-language news discovery around hazards, conflicts, secrecy and tracked narratives |
| Guardian Open Platform | 30 minutes | Headlines from World and US News when licensed access is configured |
| Reddit Data API | 15 minutes | Approved, public discussion links from r/UFOs and r/conspiracy |

The archive starts with the upstream records available during the first collection. Coverage grows as new records arrive. EOTW preserves published records, source links and changes to indexed titles and summaries. Provider coverage limits and outages affect completeness. Search uses case- and accent-insensitive matching. Archive queries page through UTC date partitions, including sparsely matching historical dates. An empty result with a continuation cursor means that earlier partitions still exist.

When the GDELT DOC API is unavailable, the collector requests the first 80 KiB of the official GDELT Article List RSS feed. It uses complete items matching topical headline terms, with at most two results from each domain and 20 per poll. The fallback supplies publisher URLs, headlines and GDELT feed timestamps. The health panel records which path supplied the collection. Coverage of the rolling 15-minute feed is sampled at EOTW's 30-minute GDELT interval. DOC backoff applies independently of the fallback. [GDELT Article List documentation](https://blog.gdeltproject.org/announcing-the-gdelt-article-list-rss-feed/)

EOTW’s repository-managed editorial feed is checked every five minutes. Its publication schema, evidence requirements, and corrections workflow are documented in the [editorial guide](../../editorial/README.md).

## Configuration

Netlify provides the reporting Blobs store in production. The initial document migration opens a versioned empty state on first use. The collector writes a consistent snapshot after updating the archive. Conditional writes protect collector retries. The dashboard reads that snapshot independently of deployments and upstream outages. Standard reads are cached at the CDN for 30 seconds with query-aware variation. The archive keeps historical non-social reports when weather alerts expire, move out of a provider's active list or a provider is disabled.

Use DISABLED_FEEDS to disable individual provider IDs, separated by commas. The IDs are editorial, nws-hi, nws-us, usgs, eonet, maui, hiema, federal, uap-records, justice, conversation, voices, scicheck, gdelt, guardian and reddit. An upstream 429 defers the next poll, honoring Retry-After. Other consecutive failures apply exponential backoff. Cached public records continue to be available. A source that misses three expected checks (at least twenty minutes) is marked overdue.

Set GUARDIAN_API_KEY to a key licensed for the site's intended use. For Reddit, supply REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET and REDDIT_USER_AGENT using the app's registered identity. Set REDDIT_APPROVED=true only after obtaining approval for the actual public display use case. The collector uses app-only OAuth, displays public discussion metadata, excludes adult and removed posts, replaces its short-lived list every poll and excludes it from the durable archive. Responses with social entries bypass the CDN cache. Disabling Reddit and running the collector drops the transient data from the current snapshot.

## Reading the rankings

Recency contributes up to 48 points, losing one point per elapsed hour. Severe and extreme NWS warnings and earthquakes of magnitude 6 or greater add 48 points. Moderate NWS warnings and earthquakes of magnitude 5 or greater add 20. Each additional publisher indexed for an identically titled story on the same UTC date contributes four points for its first 24 hours, up to 16. Public interest uses the base-two log of one plus the published USGS felt-report count or Reddit discussion comment count, capped at 12. The UI gets the component reasons with each record. Most reporting has no public-interest observation. The briefing reserves slots for urgent items, recent coverage across different categories and each geographic scope. Trending uses the 24-hour scoring order.

A confirmed label on an official bulletin describes issuance of the bulletin. Automatically located earthquakes remain developing until USGS review. Reported claims, public records about claims and community speculation retain their own evidence labels. Hazards use an upstream point or a representative vertex of the published polygon. The details identify which geometry supplied the marker. News stories with an unambiguous country tag or a single explicitly stated country location can show a country reference marker. National and local government bulletins can carry a broad jurisdiction marker. Markers use public-domain Natural Earth country labels and United States Census TIGERweb regional internal points, rounded to one decimal degree. The accompanying note names the precision and basis. Reporting with uncertain geography has no marker. Briefing geography uses the selected place name against the reporting metadata. Earthquake place strings also recognize U.S. states. GDELT publisher country is never used as evidence of an event's location.

## Source references

- [NWS API](https://www.weather.gov/documentation/services-web-api), [USGS GeoJSON](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php), [EONET v3](https://eonet.gsfc.nasa.gov/docs/v3)
- [County of Maui](https://www.mauicounty.gov/RSSFeed.aspx?ModID=1&CID=0), [Hawaiʻi EMA](https://dod.hawaii.gov/hiema/feed/), [Federal Register API](https://www.federalregister.gov/developers/documentation/api/v1)
- [Natural Earth map data](https://www.naturalearthdata.com/about/terms-of-use/), [Census TIGERweb](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer)
- [Justice Department news](https://www.justice.gov/news/rss?type=press_release), [The Conversation US edition](https://theconversation.com/us/articles.atom)
- [Global Voices and its attribution terms](https://globalvoices.org/about/global-voices-attribution-policy/), [SciCheck](https://www.factcheck.org/scicheck/)
- [GDELT DOC](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/), [Guardian access and licensing](https://open-platform.theguardian.com/access/), [Reddit API terms](https://redditinc.com/policies/data-api-terms)
- [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/), [Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/)

Run the read-only adapter probe with node server/feeds/smoke.mjs. It prints status and normalized record count for each adapter. Use node --test tests/ingest.test.mjs for deterministic regression tests that exercise collection, deduplication, revision retention, pagination, verification labels, archive retrieval, social retention and endpoint validation.
