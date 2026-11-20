import { weatherEvidence } from "../weather.mjs";
import { financeEvidence } from "../finance/market.mjs";
import { RequestError } from "./http.mjs";

const providers = { weather: weatherEvidence, finance: financeEvidence };
const short = (value, max) => typeof value === "string" ? value.trim().slice(0,max) : "";

export function inputContext(value) {
  if (value == null) return undefined;
  if (value.kind === "finance" && typeof value.symbol === "string" && /^[A-Z0-9]{2,16}$/.test(value.symbol))
    return {kind:"finance", symbol:value.symbol};
  if (value.kind === "weather" && Number.isFinite(value.latitude) && Number.isFinite(value.longitude) &&
    Math.abs(value.latitude) <= 90 && Math.abs(value.longitude) <= 180)
    return {kind:"weather",latitude:Math.round(value.latitude*100)/100,longitude:Math.round(value.longitude*100)/100};
  throw new RequestError(400,"Invalid weather or finance selection.");
}

export async function selectedEvidence(context, readers = providers) {
  const rows = context.kind === "finance"
    ? await readers.finance(context.symbol)
    : await readers.weather(context);
  const result=[];
  for (const row of Array.isArray(rows) ? rows.slice(0,6) : []) {
    try {
      const url = new URL(row.url);
      if (url.protocol !== "https:" || url.username || url.password) continue;
      const title=short(row.title,200), source=short(row.source,100), excerpt=short(row.excerpt,800);
      if (!title || !source || !excerpt) continue;
      const stamp=Date.parse(row.publishedAt || "");
      result.push({
        id:String(result.length+1),title,source,excerpt,url:url.href,
        publishedAt:Number.isFinite(stamp) ? new Date(stamp).toISOString() : null,
        kind:context.kind === "finance" ? "market data" : "weather bulletin",
        scope:"global",status:"reported by source",timeline:[],
      });
    } catch { /* Ignore an incomplete record. */ }
  }
  return result;
}
