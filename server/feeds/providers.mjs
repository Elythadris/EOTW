import { gdacs } from "./gdacs.mjs";
import { alertArea } from "./alert-area.mjs";
import { nwsKeys } from "./detection.mjs";
import { galArticles, galBytes, galUrl } from "./gal.mjs";
import { editorialRows } from "./editorial.mjs";
import { XMLParser } from "fast-xml-parser";
import { date, plain, record } from "./model.mjs";

export const SCAN_MINUTES = 10;

const agent = "EOTW/1.0 (+https://github.com/Elythadris/EOTW)";
const xml = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
});
const array = (obj, key) => {
  if (!Array.isArray(obj?.[key]))
    throw new Error("Unexpected provider response");
  return obj[key];
};
const object = (text) => JSON.parse(text);
const point = (geom) => (geom?.type === "Point" ? geom.coordinates : null);
function mapPoint(geom) {
  if (geom?.type !== "Polygon") return point(geom);
  const ring = geom.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4) return null;
  // An upstream boundary vertex is approximate; never invent an affected area's center.
  return ring[0];
}
export function usgs(text) {
  return array(object(text), "features").map((item) => {
    const p = item.properties,
      felt = p.felt;
    return {
      title: p.title,
      url: p.url,
      source: "USGS",
      origin: { magnitude: p.mag, pager: p.alert || null, series: typeof item.id === "string" ? "usgs:" + item.id : null },
      publishedAt: p.time,
      updatedAt: p.updated,
      category: "Earthquake",
      summary:
        p.mag == null
          ? p.place
          : "Magnitude " + p.mag + " earthquake. " + (p.place || ""),
      status: p.status === "reviewed" ? "confirmed" : "developing",
      location: p.place,
      coords: point(item.geometry),
      natural: true,
      severity: p.mag >= 6 ? "high" : p.mag >= 5 ? "moderate" : "routine",
      severityReason: p.mag >= 5 ? "USGS magnitude " + p.mag : "",
      interest: felt,
      interestType: "USGS felt reports",
    };
  });
}
export function nws(text) {
  return array(object(text), "features")
    .filter(
      (item) =>
        item.properties?.status === "Actual" &&
        item.properties?.messageType !== "Cancel",
    )
    .map((item) => {
      const p = item.properties;
      const states = [
        ...new Set(
          (p.geocode?.UGC || []).map((code) => String(code).slice(0, 2)),
        ),
      ];
      return {
        state: states.length === 1 ? states[0] : null,
        boundary: item.geometry?.type === "Polygon",
        title: p.headline || p.event,
        summary: p.description,
        url: item.id || p["@id"],
        source: "National Weather Service",
        alertArea: alertArea(item.geometry),
        origin: {
          ...nwsKeys(p), event: p.event, severity: p.severity, urgency: p.urgency, certainty: p.certainty,
          onset: date(p.onset || p.effective), incidentStart: date(p.sent),
          issued: (p.parameters?.VTEC || []).some(code => /^\/O\.NEW\./.test(code)),
          references: (p.references || []).map(ref => ref?.["@id"]).filter(url =>
            typeof url === "string" && url.startsWith("https://api.weather.gov/alerts/")).slice(0, 8),
        },
        publishedAt: p.sent,
        expiresAt: p.ends || p.expires,
        category: "Weather",
        scope: "us",
        location: p.areaDesc,
        coords: mapPoint(item.geometry),
        natural: true,
        status: "confirmed",
        severity: /^(Extreme|Severe)$/i.test(p.severity)
          ? "high"
          : p.severity === "Moderate"
            ? "moderate"
            : "routine",
        severityReason: "NWS-designated " + p.severity + " severity",
        originLabel: "NWS issued this alert.",
      };
    });
}
function eonet(text) {
  return array(object(text), "events").flatMap((item) => {
    const history = [...(item.geometry || [])]
      .filter((g) => date(g.date))
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const latest = history.at(-1);
    if (!latest) return [];
    const place = item.title.includes(" - ")
      ? item.title.split(" - ").at(-1)
      : "";
    const kind =
      item.categories?.map((c) => c.title).join(", ") || "Natural event";
    return [
      {
        url: item.link,
        source: "NASA EONET",
        origin: { kind, magnitude: latest.magnitudeValue, unit: latest.magnitudeUnit, series: "eonet:" + item.id },
        title: item.title,
        summary: item.description || kind + " tracked by NASA EONET.",
        category: "Natural event",
        status: "confirmed",
        location: place,
        coords: mapPoint(latest),
        natural: true,
        boundary: latest.type === "Polygon",
        publishedAt: history[0].date,
        updatedAt: latest.date,
        originLabel: "First observation listed by EONET.",
        sources: item.sources?.map((s) => ({ name: s.id, url: s.url })),
      },
    ];
  });
}
export function rss(text, options) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("Unsupported XML declaration");
  const channel = xml.parse(text).rss?.channel;
  if (!channel || !channel.title) throw new Error("Invalid RSS response");
  const items = channel.item == null ? [] : [channel.item].flat();
  return items.slice(0, options.limit || 35).map((item) => ({
    source: options.name,
    title: item.title,
    url: item.link,
    publishedAt: typeof item.pubDate === "string" ? item.pubDate.replace(/ CEST$/, " +0200").replace(/ CET$/, " +0100") : item["dc:date"],
    location: options.location || "",
    category: options.category,
    scope: options.scope,
    county: options.county,
    state: options.state,
    country: options.country,
    placeTags: item.category,
    topicClaim: options.topicClaim === true,
    status: options.official ? "confirmed" : "developing",
    summary: options.official ? plain(item.description, 360) : "",
    ...(options.byline && item["dc:creator"]
      ? { source: plain(item["dc:creator"], 48) + " · " + options.name }
      : {}),
  }));
}
const atom = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  trimValues: true,
});
function conversation(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("Unsupported XML declaration");
  const feed = atom.parse(text).feed;
  if (!feed?.title) throw new Error("Invalid Atom feed");
  return [feed.entry || []]
    .flat()
    .slice(0, 20)
    .map((item) => {
      const links = [item.link || []].flat();
      const author = [item.author || []].flat()[0]?.name?.split(",")[0];
      return {
        title:
          typeof item.title === "string" ? item.title : item.title?.["#text"],
        url: links.find((l) => l["@rel"] === "alternate" || !l["@rel"])?.[
          "@href"
        ],
        source: (author ? author + " · " : "") + "The Conversation",
        category: "Analysis",
        publishedAt: item.published,
        updatedAt: item.updated,
        status: "developing",
        placeTags: [item.category || []].flat().map((c) => c["@term"]),
      };
    });
}
function federal(text) {
  return array(object(text), "results").map((item) => ({
    source: "Federal Register",
    title: item.title,
    url: item.html_url,
    summary: item.abstract,
    publishedAt: item.publication_date,
    category: "Government",
    scope: "us",
    location: "United States",
    country: "US",
    status: "confirmed",
    originLabel: "Federal Register publication date (UTC day).",
  }));
}
function gdelt(text) {
  const result = object(text);
  if (
    result.articles === undefined &&
    result &&
    Object.keys(result).length === 0
  )
    return [];
  return array(result, "articles").map((item) => {
    const seen = item.seendate?.replace(
      /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
      "$1-$2-$3T$4:$5:$6Z",
    );
    return {
      title: item.title,
      url: item.url,
      source: item.domain,
      category: "News discovery",
      publishedAt: seen,
      summary:
        "Headline indexed by GDELT. Open the publisher for its reporting and original publication time.",
      originLabel: "Report first observed by GDELT.",
      discovered: true,
      status: "developing",
    };
  });
}
function guardian(text) {
  const payload = object(text).response;
  if (payload?.status !== "ok")
    throw new Error("Guardian response unavailable");
  return array(payload, "results").map((item) => ({
    source: "The Guardian",
    title: item.webTitle,
    url: item.webUrl,
    publishedAt: item.webPublicationDate,
    scope: item.sectionId === "us-news" ? "us" : "global",
    category: item.sectionName,
    status: "developing",
  }));
}
const rssSource = (id, name, url, options) => ({
  id,
  name,
  url,
  parse: (text) => rss(text, { ...options, name }),
});
const query =
  '(earthquake OR hurricane OR wildfire OR ceasefire OR sanctions OR ransomware OR outage OR "bank failure" OR "sovereign default" OR whistleblower OR QAnon OR UFO OR "government secrecy" OR "conspiracy theory") sourcelang:english';
const endpoint =
  "https://api.gdeltproject.org/api/v2/doc/doc?" +
  new URLSearchParams({
    query,
    mode: "ArtList",
    format: "json",
    sort: "DateDesc",
    maxrecords: "50",
    timespan: "1d",
  });
export function definitions(env = process.env) {
  const disabled = new Set(
    (env.DISABLED_FEEDS || "").split(",").map((v) => v.trim()),
  );
  return [
    {
      id: "nws-hi",
      name: "NWS Hawaiʻi",
      url: "https://api.weather.gov/alerts/active?area=HI&status=actual",
      parse: nws,
      replace: true,
    },
    {
      id: "nws-us",
      name: "NWS severe U.S. alerts",
      url: "https://api.weather.gov/alerts/active?severity=Severe%2CExtreme&status=actual",
      parse: nws,
      replace: true,
    },
    {
      id: "usgs",
      name: "USGS earthquakes",
      url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
      parse: usgs,
      replace: true,
    },
    {
      id: "eonet",
      name: "NASA EONET",
      url: "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=40&days=14",
      parse: eonet,
      replace: true,
    },
    rssSource(
      "maui",
      "County of Maui",
      "https://www.mauicounty.gov/RSSFeed.aspx?ModID=1&CID=0",
      {
        location: "Maui County, Hawaiʻi",
        county: "15009",
        scope: "us",
        category: "County bulletin",
        official: true,
        limit: 28,
      },
    ),
    rssSource(
      "hiema",
      "Hawaiʻi Emergency Management Agency",
      "https://dod.hawaii.gov/hiema/feed/",
      {
        location: "Hawaiʻi",
        state: "HI",
        scope: "us",
        category: "State bulletin",
        official: true,
      },
    ),
    {
      id: "editorial",
      name: "EOTW editorial desk",
      url: "https://raw.githubusercontent.com/Elythadris/EOTW/refs/heads/main/editorial/records.json",
      maxBytes: 400_000,
      parse: editorialRows,
    },
    ...[
      ["maui-mema", "Maui County - News Flash - MEMA News Flash", "MEMA-News-Flash-50"],
      ["maui-water", "Maui County - News Flash - Water Department", "Water-Department-7"],
      ["maui-road", "Maui County - News Flash - Road Notifications", "Road-Notifications-3"],
    ].map(([id, name, channel]) => rssSource(
      id, name, "https://www.mauicounty.gov/RSSFeed.aspx?CID=" + channel + "&ModID=1",
      { location: "Maui County, Hawaiʻi", county: "15009", scope: "us", category: "County bulletin", official: true },
    )),
    {
      id: "gdacs", name: "Global Disaster Awareness and Coordination System, GDACS",
      url: "https://www.gdacs.org/xml/rss.xml", parse: gdacs, replace: true, maxBytes: 2100000,
    },
    rssSource("un-geneva", "United Nations Office at Geneva", "https://www.ungeneva.org/news-media/press-items-list/rss.xml",
      {scope:"global",category:"UN press bulletin",official:true,limit:25}),
    {
      id: "federal",
      name: "Federal Register",
      url: "https://www.federalregister.gov/api/v1/documents.json?per_page=20&order=newest",
      parse: federal,
    },
    rssSource(
      "scicheck",
      "FactCheck.org · SciCheck",
      "https://www.factcheck.org/scicheck/feed/",
      { scope: "us", category: "Fact check", topicClaim: true },
    ),
    {
      id: "uap-records",
      name: "Federal Register UAP records",
      url: "https://www.federalregister.gov/api/v1/documents.json?conditions%5Bterm%5D=%22unidentified%20anomalous%20phenomena%22&order=newest&per_page=10",
      parse: (text) =>
        federal(text).map((item) => ({
          ...item,
          topicClaim: true,
          category: "Public record",
        })),
    },
    rssSource(
      "justice",
      "U.S. Department of Justice",
      "https://www.justice.gov/news/rss?type=press_release",
      {
        country: "US",
        scope: "us",
        category: "Justice bulletin",
        official: true,
        limit: 18,
      },
    ),
    {
      id: "conversation",
      name: "The Conversation · U.S. edition",
      url: "https://theconversation.com/us/articles.atom",
      parse: conversation,
    },
    rssSource("voices", "Global Voices", "https://globalvoices.org/feed/", {
      scope: "global",
      category: "World",
      byline: true,
    }),
    {
      id: "gdelt",
      name: "GDELT news discovery",
      url: endpoint,
      parse: gdelt,
    },
    {
      id: "guardian",
      name: "The Guardian Open Platform",
      url:
        "https://content.guardianapis.com/search?" +
        new URLSearchParams({
          section: "world|us-news",
          "order-by": "newest",
          "page-size": "20",
          "api-key": env.GUARDIAN_API_KEY || "",
        }),
      headers: {},
      parse: guardian,
      disabled: !env.GUARDIAN_API_KEY
        ? "A licensed Guardian API key is required."
        : null,
    },
    {
      id: "reddit",
      name: "Reddit discussion links",
      replace: true,
      transient: true,
      disabled:
        env.REDDIT_APPROVED !== "true" ||
        !env.REDDIT_CLIENT_ID ||
        !env.REDDIT_CLIENT_SECRET ||
        !env.REDDIT_USER_AGENT
          ? "Requires approved Reddit API access and a registered user agent."
          : null,
    },
  ].map((provider) => ({
    ...provider,
    minutes: SCAN_MINUTES,
    disabled: disabled.has(provider.id)
      ? "Turned off by the site operator."
      : provider.disabled,
  }));
}

async function body(response, max = 3500000) {
  if (Number(response.headers.get("content-length")) > max)
    throw new Error("Upstream response exceeded size limit");
  const stream = response.body?.getReader();
  if (!stream) throw new Error("Empty upstream response");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await stream.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await stream.cancel();
        throw new Error("Upstream response exceeded size limit");
      }
      chunks.push(value);
    }
  } finally {
    stream.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}
class SourceError extends Error {
  constructor(status, retryAfter) {
    super("Upstream HTTP " + status);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
async function request(url, init, fetcher) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(6500),
    });
    if (response.ok || response.status === 304) return response;
    const header = response.headers.get("retry-after");
    const value =
      header && /^\d+$/.test(header)
        ? Date.now() + Number(header) * 1000
        : Date.parse(header || "");
    await response.body?.cancel();
    if (attempt || ![502, 503, 504].includes(response.status) || header)
      throw new SourceError(
        response.status,
        Number.isFinite(value) ? value : null,
      );
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
async function reddit(env, fetcher) {
  const basic = Buffer.from(
    env.REDDIT_CLIENT_ID + ":" + env.REDDIT_CLIENT_SECRET,
  ).toString("base64");
  const token = object(
    await body(
      await request(
        "https://www.reddit.com/api/v1/access_token",
        {
          method: "POST",
          headers: {
            "User-Agent": env.REDDIT_USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: "Basic " + basic,
          },
          body: "grant_type=client_credentials&scope=read",
          redirect: "error",
        },
        fetcher,
      ),
      32000,
    ),
  );
  if (!token.access_token) throw new Error("Reddit authorization unavailable");
  const response = await request(
    "https://oauth.reddit.com/r/UFOs+conspiracy/hot?limit=20&raw_json=1",
    {
      headers: {
        "User-Agent": env.REDDIT_USER_AGENT,
        Authorization: "Bearer " + token.access_token,
      },
      redirect: "error",
    },
    fetcher,
  );
  const children = array(object(await body(response)).data, "children");
  return children
    .map((child) => child.data)
    .filter(
      (p) =>
        p?.permalink?.startsWith("/r/") &&
        !p.stickied &&
        !p.over_18 &&
        !p.removed_by_category &&
        p.author !== "[deleted]",
    )
    .map((p) => ({
      title: p.title,
      url: "https://www.reddit.com" + p.permalink,
      source: "Reddit",
      category: "Discussion",
      status: "speculation",
      publishedAt: p.created_utc * 1000,
      topicClaim: true,
      transient: true,
      interest: p.num_comments,
      interestType: "public discussion comments",
      summary:
        "Unverified community discussion in r/" +
        plain(p.subreddit, 45) +
        ". Open the original thread for context.",
    }));
}
export async function fetchProvider(
  provider,
  state = {},
  { fetcher = fetch, now = Date.now(), env = process.env } = {},
) {
  // Bound the entire provider chain, including retries, OAuth, alternate feeds and bodies.
  // Netlify scheduled invocations must also commit the archive within their 30-second limit.
  const budget = AbortSignal.timeout(12_000);
  const boundedFetch = (url, init) => fetcher(url, {
    ...init,
    signal: AbortSignal.any([budget, init.signal]),
  });
  const headers = { "User-Agent": agent, ...provider.headers };
  if (state.etag) headers["If-None-Match"] = state.etag;
  if (state.modified) headers["If-Modified-Since"] = state.modified;
  if (provider.id === "reddit")
    return {
      events: (await reddit(env, boundedFetch))
        .map((v) => record(v, now))
        .filter(Boolean),
    };
  const fetchPrimary = async () => {
    const response = await request(
      provider.url,
      { headers, redirect: provider.headers ? "error" : "follow" },
      boundedFetch,
    );
    if (response.status === 304) return { unchanged: true };
    const raw = provider.parse(await body(response, provider.maxBytes), now);
    const events = raw.map((item) => record(item, now)).filter(Boolean);
    if (raw.length && !events.length) throw new Error("No valid records in upstream response");
    return { events, etag: response.headers.get("etag"), modified: response.headers.get("last-modified") };
  };
  if (provider.id !== "gdelt") return fetchPrimary();
  let primaryRetryAfter = state.primaryRetryAfter || 0;
  if (primaryRetryAfter <= now) {
    try {
      return { ...await fetchPrimary(), primaryRetryAfter: 0 };
    } catch (error) {
      primaryRetryAfter = error?.retryAfter || 0;
    }
  }
  const rangeHeaders = { "User-Agent": agent, Range: "bytes=0-" + (galBytes - 1) };
  if (state.galEtag) rangeHeaders["If-None-Match"] = state.galEtag;
  try {
    const response = await request(galUrl, { headers: rangeHeaders }, boundedFetch);
    const detail = "GDELT DOC unavailable. Serving a topical sample from the GDELT Article List RSS feed.";
    if (response.status === 304) return { unchanged: true, primaryRetryAfter, detail };
    const length = Number(response.headers.get("content-length"));
    const bounded = response.status === 206
      ? /^bytes 0-\d+\/\d+$/.test(response.headers.get("content-range") || "")
      : response.status === 200 && length > 0 && length <= galBytes;
    if (!bounded) {
      await response.body?.cancel();
      throw new Error("GDELT Article List did not honor the bounded request");
    }
    const events = galArticles(await body(response, galBytes)).map((item) => record(item, now)).filter(Boolean);
    return { events, primaryRetryAfter, galEtag: response.headers.get("etag"), detail,
      etag: state.etag || null, modified: state.modified || null };
  } catch (error) {
    error.primaryRetryAfter = primaryRetryAfter;
    throw error;
  }
}
