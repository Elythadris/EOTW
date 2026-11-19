import { XMLParser } from "fast-xml-parser";
import { link, plain } from "./model.mjs";

export const galUrl = "https://data.gdeltproject.org/gdeltv3/gal/feed.rss";
export const galBytes = 80 * 1024;
const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });
const topics = /\b(earthquakes?|floods?|wildfires?|storms?|hurricanes?|typhoons?|evacuat\w*|emergenc\w*|ceasefire|conflicts?|sanctions|security|elections?|whistleblowers?|uaps?|ufos?|qanon|conspiracy)\b/i;

export function galArticles(prefix) {
  if (!prefix.includes("GDELT Article List RSS Feed") || /<!DOCTYPE|<!ENTITY/i.test(prefix)) {
    throw new Error("Invalid GDELT Article List");
  }
  // A byte range can end inside an item or a UTF-8 sequence. Only parse complete RSS entries.
  const complete = prefix.match(/<item>[\s\S]*?<\/item>/g) || [];
  if (!complete.length) throw new Error("GDELT range contains no complete entries");
  const articles = [];
  const urls = new Set();
  const domains = new Map();
  for (const xml of complete) {
    const item = parser.parse(xml).item;
    const url = link(item?.link);
    const title = plain(item?.title, 260);
    if (!url || !title || !topics.test(title) || urls.has(url) || !Number.isFinite(Date.parse(item.pubDate))) continue;
    const domain = new URL(url).hostname.replace(/^www\./, "");
    if ((domains.get(domain) || 0) >= 2) continue;
    urls.add(url);
    domains.set(domain, (domains.get(domain) || 0) + 1);
    articles.push({
      title, url, source: domain, publishedAt: item.pubDate, status: "developing", category: "News discovery",
      originLabel: "Timestamp supplied by GDELT Article List.",
      summary: "Headline discovered in GDELT Article List. Open the publisher for its reporting and publication time.",
      discovered: true,
    });
    if (articles.length === 20) break;
  }
  return articles;
}
