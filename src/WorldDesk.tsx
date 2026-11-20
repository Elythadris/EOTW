import { useState } from "react";
import { ArrowUpRight, Bookmark, CloudRain, Crosshair, Radio, Search, Workflow } from "lucide-react";
import EventMap from "./EventMap";
import EventAssessment from "./EventAssessment";
import { Status } from "./components";
import { dateTime, sourceURL, type IntelEvent } from "./types";

type Props = {
  events: IntelEvent[];
  focusScope?: IntelEvent["scope"];
  scanAt: string | null;
  location: string;
  saved: string[];
  onAsk: (question: string, event: IntelEvent) => void;
  open: (event: IntelEvent) => void;
  save: (event: IntelEvent) => void;
  weather: (location: string) => void;
};

export default function WorldDesk({events,focusScope,scanAt,location,saved,onAsk,open,save,weather}: Props) {
  const [picked, setPicked] = useState("");
  const report = events.find(event => event.id === picked);
  const namedArea = report ? report.location : location;
  const source = report && sourceURL(report.url);
  const sourcePoint = report && report.coordinatePrecision === "source-point" &&
    ["Weather", "Earthquake", "Natural event"].includes(report.category) &&
    Number.isFinite(report.lat) && Number.isFinite(report.lon);
  const weatherPlace = sourcePoint ? `${report.lat}, ${report.lon}` : namedArea;
  const tracking = !!report && saved.includes(report.id);
  return <div className="world-desk">
    <div className="panel full-map">
      <EventMap events={events} focusScope={focusScope} scanAt={scanAt}
        onSelect={open} onInspect={event => setPicked(event.id)}/>
    </div>
    <section className="panel world-brief" aria-labelledby="world-brief-title">
      <header><Crosshair size={17} aria-hidden="true"/><h2 id="world-brief-title">Map workspace</h2></header>
      {report ? <>
        <div className="world-record" aria-live="polite">
          <div className="world-meta"><Status value={report.status}/><span>{report.category}</span></div>
          <h3>{report.title}</h3>
          <p>{namedArea && namedArea + " · "}{report.source}</p>
          <time dateTime={report.updatedAt}>{report.dateBasis === "discovery" ? "Indexed " : "Source time "}{dateTime(report.updatedAt)}</time>
          <p>{report.intelligence?.why || report.summary}</p>
          {report.mapNote && <p className="world-map-note">{report.mapNote}</p>}
        </div>
        <div className="world-actions" aria-label="Selected report actions">
          <button onClick={() => onAsk("Scan this report. What changed, and what should I monitor?",report)}><Radio size={15}/>Scan</button>
          <button onClick={() => onAsk("Investigate this report. What is established, what explanations fit the evidence, and what remains unknown?",report)}><Search size={15}/>Investigate</button>
          <button onClick={() => onAsk("Compare this report with related reports. Explain the basis for any overlap and what remains unverified.",report)}><Workflow size={15}/>Compare</button>
          <button onClick={() => onAsk("",report)}><Radio size={15}/>Ask AI</button>
          <button aria-pressed={tracking} onClick={() => save(report)}><Bookmark size={15}/>{tracking ? "Tracking" : "Track"}</button>
        </div>
        <div className="world-links">
          <a href={"/story/"+encodeURIComponent(report.id)} onClick={event => {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            open(report);
          }}>Open dossier <ArrowUpRight size={14} aria-hidden="true"/></a>
          {source && <a href={source} rel="noreferrer" target="_blank">Original source <ArrowUpRight size={14} aria-hidden="true"/></a>}
        </div>
        <EventAssessment event={report} location={location}/>
      </> : <div className="world-empty"><p>Select a marker to inspect the report, compare sources, or track it in your watchlist.</p></div>}
      {weatherPlace && <button className="world-weather" onClick={() => weather(weatherPlace)}>
        <CloudRain size={15} aria-hidden="true"/> {namedArea ? "Weather for " + namedArea : "Weather near this marker"}
      </button>}
    </section>
  </div>;
}

