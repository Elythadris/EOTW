import { test } from "node:test";
import assert from "node:assert/strict";
import { gdacs } from "../server/feeds/gdacs.mjs";
import { record } from "../server/feeds/model.mjs";

const now=Date.parse("2026-11-19T22:25:00Z");
const feed = (...items) => '<?xml version="1.0"?><rss xmlns:gdacs="http://www.gdacs.org" xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#" xmlns:georss="http://www.georss.org/georss"><channel><title>GDACS RSS information</title>'+items.join("")+'</channel></rss>';
function item(overrides={}) {
  const f = {type:"FL",id:"1100000",episode:"2",overall:"Orange",tier:"Orange",current:"true",temporary:"false",added:"Tue, 17 Nov 2026 07:24:32 GMT",
    revised:"Thu, 19 Nov 2026 20:01:01 GMT",from:"Mon, 16 Nov 2026 01:00:00 GMT",to:"Thu, 19 Nov 2026 01:00:00 GMT",
    country:"South Africa",point:"-26.904354 27.456125",...overrides};
  const url=f.url || "http://www.gdacs.org/report.aspx?eventtype="+f.type+"&amp;eventid="+f.id;
  return "<item><title>Unverified population estimate in source headline</title><description>Example exposure estimate: 70 thousand.</description>"+
    "<link>"+url+"</link><gdacs:eventtype>"+f.type+"</gdacs:eventtype><gdacs:eventid>"+f.id+"</gdacs:eventid><gdacs:episodeid>"+f.episode+"</gdacs:episodeid>"+
    "<gdacs:alertlevel>"+f.overall+"</gdacs:alertlevel><gdacs:episodealertlevel>"+f.tier+"</gdacs:episodealertlevel><gdacs:temporary>"+f.temporary+"</gdacs:temporary>"+
    "<gdacs:iscurrent>"+f.current+"</gdacs:iscurrent><gdacs:fromdate>"+f.from+"</gdacs:fromdate><gdacs:todate>"+f.to+"</gdacs:todate>"+
    "<pubDate>"+f.added+"</pubDate><gdacs:datemodified>"+f.revised+"</gdacs:datemodified><gdacs:country>"+f.country+"</gdacs:country>"+
    (f.expiry ? "<gdacs:expires>"+f.expiry+"</gdacs:expires>" : "")+
    (f.eventName ? "<gdacs:eventname>"+f.eventName+"</gdacs:eventname>" : "")+
    (f.point !== null ? "<georss:point>"+f.point+"</georss:point>" : "<geo:Point><geo:lat>0</geo:lat><geo:long>-90</geo:long></geo:Point>")+"</item>";
}
test("current non-seismic episodes use source dates, canonical report, coordinates and attributed impact class", () => {
  const [row]=gdacs("\uFEFF"+feed(item()),now);
  assert.equal(row.source,"Global Disaster Awareness and Coordination System, GDACS");
  assert.equal(row.url,"https://www.gdacs.org/report.aspx?eventtype=FL&eventid=1100000");
  assert.equal(row.gdacs.eventId,"1100000"); assert.equal(row.gdacs.level,"orange");
  assert.equal(row.expiresAt,null); assert.equal(row.gdacs.freshUntil,"2026-11-20T00:00:00.000Z");
  assert.equal(row.publishedAt,"2026-11-17T07:24:32.000Z"); assert.equal(row.updatedAt,"2026-11-19T20:01:01.000Z");
  assert.deepEqual(row.coords,[27.456125,-26.904354]); assert.equal(row.scope,"global"); assert.equal(row.severity,"moderate");
  assert.match(row.summary,/potential humanitarian impact/); assert.doesNotMatch(row.title+" "+row.summary,/population|70 thousand|casualt/i);
  const normalized=record(row,now);
  assert.equal(normalized.lon,row.coords[0]); assert.equal(normalized.updatedAt,row.updatedAt);
  assert.equal(normalized.observedAt,null); assert.ok(normalized.id.startsWith("2026-11-17-"));
});
test("both alert tiers must be orange/red and the currently published episode drives the class", () => {
  for (const overrides of [{overall:"Green"},{tier:"Green"},{tier:""},{current:"false"},{temporary:"true"},{type:"EQ"},{type:"UNKNOWN"}]) {
    assert.deepEqual(gdacs(feed(item(overrides)),now),[]);
  }
  const [row]=gdacs(feed(item({type:"TC",overall:"Red",tier:"Orange",eventName:"Example-26",country:"United States",point:null})),now);
  assert.equal(row.scope,"us"); assert.deepEqual(row.coords,[-90,0]); assert.equal(row.gdacs.overallLevel,"red");
  assert.match(row.title,/Tropical cyclone Example-26/); assert.match(row.summary,/overall event class is red/);
  for (const type of ["FL","VO","DR","TC","WF"]) assert.equal(gdacs(feed(item({type,tier:"Red",overall:"Red"})),now)[0].severity,"high");
});
test("expired, stale, future and malformed observations fail closed", () => {
  for (const overrides of [
    {to:"Wed, 18 Nov 2026 23:59:59 GMT"},
    {expiry:"Thu, 19 Nov 2026 21:00:00 GMT"},{expiry:"invalid"},
    {from:"Fri, 20 Nov 2026 05:00:00 GMT"},{to:"Wed, 11 Nov 2026 01:00:00 GMT"},
    {from:"invalid"},{revised:"invalid"},{added:"invalid"},
    {revised:"Fri, 20 Nov 2026 23:59:00 GMT"},
    {added:"Wed, 11 Nov 2026 07:00:00 GMT",revised:"Fri, 13 Nov 2026 07:00:00 GMT"},
  ]) assert.deepEqual(gdacs(feed(item(overrides)),now),[]);
  const [limited]=gdacs(feed(item({expiry:"Thu, 19 Nov 2026 23:00:00 GMT"})),now);
  assert.equal(limited.gdacs.freshUntil,limited.expiresAt);
});
test("downgrades, cancellations and duplicate episode revisions use one stable event key",()=>{
  const old=item({episode:"1",revised:"Thu, 19 Nov 2026 19:00:00 GMT",tier:"Red",overall:"Red"});
  const inactive=item({episode:"2",current:"false"});
  const downgrade=item({episode:"2",tier:"Green"});
  for (const other of [inactive,downgrade]) {
    assert.equal(gdacs(feed(old,other),now).length,0);
    assert.equal(gdacs(feed(other,old),now).length,0);
  }
  const result=gdacs(feed(old,item(),item()),now);
  assert.equal(result.length,1); assert.equal(result[0].gdacs.episodeId,"2");
  assert.equal(record(result[0],now).id,record(gdacs(feed(old),now)[0],now).id);
});
test("empty feed succeeds and XML, mismatched IDs, unsafe URLs and invalid coordinates are handled",()=>{
  assert.deepEqual(gdacs(feed(),now),[]);
  assert.throws(()=>gdacs('<!DOCTYPE rss>'+feed(),now));
  assert.throws(()=>gdacs("<rss><channel></rss>",now));
  assert.throws(()=>gdacs(feed().replace("GDACS RSS information","Elsewhere"),now));
  assert.throws(()=>gdacs("a".repeat(2100001),now));
  for (const url of [
    "https://elsewhere.example/report.aspx?eventtype=FL&amp;eventid=1100000",
    "https://www.gdacs.org/report.aspx?eventtype=FL&amp;eventid=22",
    "https://www.gdacs.org/profile.aspx?eventtype=FL&amp;eventid=1100000",
  ]) assert.deepEqual(gdacs(feed(item({url})),now),[]);
  assert.equal(gdacs(feed(item({point:"-92 222"})),now)[0].coords,null);
});
