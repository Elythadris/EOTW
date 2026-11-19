# Source coverage and operation

The production collector wakes every five minutes UTC. An adapter runs when its own next-check time is due. A successful check can return zero reports. The dashboard exposes each provider's most recent successful poll and its health. Publication times come from the source. GDELT entries use its observation time and say so in the timeline.

| Provider | Check interval | Coverage |
| --- | --- | --- |
| NWS | 5 minutes | Active Hawaiʻi alerts and severe or extreme alerts across the U.S. |
| USGS | 5 minutes | Magnitude 2.5 or greater earthquakes from the past day |
| NASA EONET | 30 minutes | Open natural events observed in the last 14 days |
| County of Maui and Hawaiʻi EMA | 15 minutes | County news releases, dedicated MEMA, Water Department and Road Notifications channels, and state emergency management bulletins |
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

Use DISABLED_FEEDS to disable individual provider IDs, separated by commas. The IDs are editorial, nws-hi, nws-us, usgs, eonet, maui, maui-mema, maui-water, maui-road, hiema, federal, uap-records, justice, conversation, voices, scicheck, gdelt, guardian and reddit. An upstream 429 defers the next poll, honoring Retry-After. Other consecutive failures apply exponential backoff. Cached public records continue to be available. A source that misses three expected checks (at least twenty minutes) is marked overdue.

Set GUARDIAN_API_KEY to a key licensed for the site's intended use. For Reddit, supply REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET and REDDIT_USER_AGENT using the app's registered identity. Set REDDIT_APPROVED=true only after obtaining approval for the actual public display use case. The collector uses app-only OAuth, displays public discussion metadata, excludes adult and removed posts, replaces its short-lived list every poll and excludes it from the durable archive. Responses with social entries bypass the CDN cache. Disabling Reddit and running the collector drops the transient data from the current snapshot.

## Reading the rankings

Recency contributes up to 48 points, losing one point per elapsed hour. Severe and extreme NWS warnings and earthquakes of magnitude 6 or greater add 48 points. Moderate NWS warnings and earthquakes of magnitude 5 or greater add 20. Each additional publisher indexed for an identically titled story on the same UTC date contributes four points for its first 24 hours, up to 16. Public interest uses the base-two log of one plus the published USGS felt-report count or Reddit discussion comment count, capped at 12. The UI gets the component reasons with each record. Most reporting has no public-interest observation. The briefing reserves slots for urgent items, recent coverage across different categories and each geographic scope. These broad briefing ranks also support browsing routine records in the archive.

A confirmed label on an official bulletin describes issuance of the bulletin. Automatically located earthquakes remain developing until USGS review. Reported claims, public records about claims and community speculation retain their own evidence labels. Hazards use an upstream point or a representative vertex of the published polygon. The details identify which geometry supplied the marker. News stories with an unambiguous country tag or a single explicitly stated country location can show a country reference marker. National and local government bulletins can carry a broad jurisdiction marker. Markers use public-domain Natural Earth country labels and United States Census TIGERweb regional internal points, rounded to one decimal degree. The accompanying note names the precision and basis. Reporting with uncertain geography has no marker. Briefing geography uses the selected place name against the reporting metadata. Earthquake place strings also recognize U.S. states. GDELT publisher country is never used as evidence of an event's location.

## Significant signals

The signal desk screens active source records and groups sibling notices. Each qualifying incident includes its source, reason, geographic scope, priority components, and a specific item to monitor. The archive retains routine reports and their editions. A place in the historical archive does not by itself qualify a report for the desk.

### Priority criteria

| Component | Maximum | Evidence used |
| --- | --- | --- |
| Impact | 30 | Type of civil disruption, observed natural hazard scale or active protective action |
| Severity | 20 | Source severity, USGS measurement and PAGER designation, or a documented consequential change |
| Urgency | 20 | NWS CAP urgency, or elapsed time since the source updated an already significant event |
| Credibility | 15 | An official report, recognized reporting outlet, or EOTW editorial publication with cited materials |
| Proximity | 5 | An explicit match to the selected place |
| Acceleration | 10 | A material escalation, accelerating coverage on distinct domains or a measured rise in USGS public felt reports |

The priority score sums these six components. Scores of 40–62 are Watch, 63–78 Elevated, and 79 or above High. Coverage, certainty and timing rules can cap the level. The numeric score ranks reports for attention. It has no statistical interpretation as an event probability.

- Weather screening uses the official CAP fields for severity, urgency and certainty. An active severe warning can be Expected or Immediate. A watch or legacy record missing urgency or certainty can rise only to Watch. An unexpired warning whose urgency is below Immediate or whose certainty is below Likely can rise only to Elevated. Advisories, statements, tests and canceled notices stay outside the signal desk.
- Seismic screening requires magnitude 6 globally, magnitude 5 for explicitly local reports, or a non-green USGS PAGER impact alert. Reports older than the active window drop out. EONET observations currently qualify through reported winds of at least 64 knots or wildfire extent of at least 10,000 acres. An open event without a qualifying measure remains discoverable through the map and archive.
- Public reporting must name a consequence in its headline and have a recognized reporting or official source. Rules cover protective orders, unsafe water, hazard-related road closures, widespread utility disruption, cyber incidents with reported population or service effects, financial restrictions, civilian consequences of conflict, unrest with curfews or public-service disruption, formal diplomacy and public health actions. Speculation, social engagement, drills, hypothetical outcomes and retrospective reporting cannot establish a threat. Exact phrase matching can miss significant developments, especially when the title lacks context or language coverage.
- A region’s level describes its strongest qualifying report. A local flood warning can determine the U.S. label while affecting only its named zones. Quiet requires a recent successful collection and coverage across relevant primary sources. For Maui, both NWS Hawaiʻi and the dedicated MEMA feed must be healthy. Custom locations with no direct coverage can return Unknown.

### Material changes and Hot 24

The collector preserves observation and change history in its versioned reporting store. A source update becomes a material escalation when a comparable earlier scan shows stronger CAP severity or urgency, an upgraded warning, a substantive upward USGS magnitude revision or raised PAGER level, or a large qualifying EONET storm or fire increase. A revised publication can also move from routine to a specifically documented civil disruption. Initial imports, stale replays, source recovery batches, routine edits and time decay do not establish a change. The interface can use a stable incident key and material version to suppress duplicate notifications.

NWS VTEC office, phenomenon, significance, event number and year identify a warning family. The collector tracks zone-specific revisions using the listed UGC areas and source references. Split zones from one episode share a representative card with links to the individual bulletins. Every original notice is retained in the archive. Successful NWS checks replace active membership, including removals before expiry. Legacy notices can be grouped when their NWS headline and issue timestamp match exactly.

A recent significant signal enters Hot 24 only with observed acceleration. A material upward revision qualifies. Coverage growth requires reports from at least two additional publisher domains within six hours and more additions than in the preceding six hours. USGS felt reports can qualify when the reported count at least doubles with 50 or more new submissions across comparable observations. These observations measure reporting or public response and can include syndication. A separately labelled narrative trend needs accelerated publisher coverage or an editorial correction explicitly linked to a previously observed claim. Narrative activity never raises regional danger by itself.

### Baselines and related reports

The baseline monitor counts distinct newly observed USGS magnitude 4.5+ earthquakes and two NWS warning series, severe or extreme warnings across the U.S. and warnings in Hawaiʻi. It uses UTC hour buckets and records which five-minute collection slots succeeded. Backlogged reports, first ingestions, repeated VTEC zones, source recovery and stale observations do not increase the counts. The first three complete UTC hours of today must elapse before any comparison. Every hour compared today and every hour in a historical reference day requires at least 10 successful slots out of 12. Reference days must be complete and at least seven of the preceding 14 days must satisfy coverage checks.

For each series, the comparison uses the same elapsed UTC hours on eligible days. A flag requires at least four observations and at least twice the historical median (with a minimum comparison base of one). The count must also exceed or equal the median plus the largest of three, three scaled median absolute deviations, or twice the square root of the median plus one. A confidence label describes baseline coverage. Seven to eleven eligible days earn Moderate, twelve or more High. Seasonality, changing bulletin practices, publisher selection and normal clustering can influence the result. A flag identifies unusually frequent observations in these feeds and provides no forecast of the next incident.

Related-report suggestions require a matching specific topic and named geographic area, within twelve hours, across distinct publisher domains. General national jurisdictions and duplicate warning bulletins are excluded. A shared place and time are evidence of co-occurrence only.

The signals endpoint returns exact counts before pagination. The top-level `total` respects the requested scope and search. The `intelligence` object summarizes every region. Each region supplies a count and up to four representative event IDs. `activeWarnings` counts distinct, qualifying, active official NWS warning episodes. `scanned` counts active source records screened, including routine reports. A missing baseline or empty Hot 24 list is a normal state.

## Source references

- [NWS API](https://www.weather.gov/documentation/services-web-api), [USGS GeoJSON](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php), [EONET v3](https://eonet.gsfc.nasa.gov/docs/v3)
- [County of Maui](https://www.mauicounty.gov/RSSFeed.aspx?ModID=1&CID=0), [Hawaiʻi EMA](https://dod.hawaii.gov/hiema/feed/), [Federal Register API](https://www.federalregister.gov/developers/documentation/api/v1)
- [Natural Earth map data](https://www.naturalearthdata.com/about/terms-of-use/), [Census TIGERweb](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer)
- [Justice Department news](https://www.justice.gov/news/rss?type=press_release), [The Conversation US edition](https://theconversation.com/us/articles.atom)
- [Global Voices and its attribution terms](https://globalvoices.org/about/global-voices-attribution-policy/), [SciCheck](https://www.factcheck.org/scicheck/)
- [GDELT DOC](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/), [Guardian access and licensing](https://open-platform.theguardian.com/access/), [Reddit API terms](https://redditinc.com/policies/data-api-terms)
- [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/), [Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/)

Run the read-only adapter probe with node server/feeds/smoke.mjs. It prints status and normalized record count for each adapter. Use node --test tests/ingest.test.mjs for deterministic regression tests that exercise collection, deduplication, revision retention, pagination, verification labels, archive retrieval, social retention and endpoint validation.
