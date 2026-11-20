import { useEffect, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { dateTime, sourceURL, type IntelEvent } from "./types";
import "./assessment.css";

type Point = { text: string; citationIds: string[] };
type Citation = { id: string; title: string; source: string; url: string };
type Explanation = { label: string; explanation: string; support: Point[]; against: Point[]; test: string };
type Assessment = {
  eventId: string;
  mode: "ai" | "sources";
  updatedAt: string;
  notice: string;
  facts: Point[];
  allegations: Point[];
  significance: Point[];
  hypotheses: Explanation[];
  implications: Point[];
  unknowns: string[];
  watch: Point[];
  citations: Citation[];
};

function Points({ points, citations }: { points: Point[]; citations: Citation[] }) {
  return <ul className="assessment-points">
    {points.map((point, index) => (
      <li key={index}>{point.text} {point.citationIds.map(id => {
        const reference = citations.find(citation => citation.id === id);
        const url = reference && sourceURL(reference.url);
        return url && reference ? <a key={id} href={url} target="_blank" rel="noreferrer"
          className="assessment-cite" aria-label={"Source " + id + ", " + reference.source + ", " + reference.title}
          title={reference.title}>[{id}]</a> : null;
      })}</li>
    ))}
  </ul>;
}

function Analysis({ report }: { report: Assessment }) {
  const points = (rows: Point[]) => <Points points={rows} citations={report.citations} />;
  return <div className="investigation-body">
    <div className="investigation-mode">
      <strong>{report.mode === "ai" ? "AI-assisted assessment" : "Source-based assessment"}</strong>
      {report.updatedAt && <time dateTime={report.updatedAt}>{dateTime(report.updatedAt)}</time>}
    </div>
    {report.notice && <p className="assessment-note">{report.notice}</p>}
    <section><h4>What the sources establish</h4>
      {report.facts.length ? points(report.facts) : <p>Independent confirmation is unavailable in the indexed sources.</p>}
    </section>
    {!!report.allegations.length && <section><h4>Reported allegations</h4>{points(report.allegations)}</section>}
    {!!report.significance.length && <section><h4>Why it matters</h4>{points(report.significance)}</section>}
    <section><h4>{report.mode === "ai" ? "Hypotheses to investigate" : "Explanations to investigate"}</h4>
      {report.hypotheses.length ? report.hypotheses.map((item, index) => (
        <div className="assessment-hypothesis" key={index}>
          <h5>{item.label}</h5><p>{item.explanation}</p>
          <div><strong>Supporting evidence</strong>{item.support.length ? points(item.support) : <p>No supporting evidence is indexed for this explanation.</p>}</div>
          <div><strong>Contrary evidence</strong>{item.against.length ? points(item.against) : <p>No contrary evidence is indexed for this explanation.</p>}</div>
          {item.test && <div><strong>What would help resolve it</strong><p>{item.test}</p></div>}
        </div>
      )) : <p>The available reporting is too limited to distinguish explanations.</p>}
    </section>
    {!!report.implications.length && <section><h4>Possible implications</h4>{points(report.implications)}</section>}
    {!!report.unknowns.length && <section><h4>What remains unknown</h4>
      <ul>{report.unknowns.map((line,index) => <li key={index}>{line}</li>)}</ul></section>}
    {!!report.watch.length && <section><h4>What to watch next</h4>{points(report.watch)}</section>}
    {!!report.citations.length && <section><h4>Sources used</h4>
      <ol className="assessment-references">{report.citations.map(citation => {
        const href = sourceURL(citation.url);
        return href && <li key={citation.id}><a href={href} target="_blank" rel="noreferrer">
          <span>[{citation.id}] {citation.source}</span> {citation.title}</a></li>;
      })}</ol>
    </section>}
  </div>;
}

export default function EventAssessment({ event, location }: { event: IntelEvent; location: string }) {
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [record, setRecord] = useState<{key: string; report?: Assessment; error?: boolean} | null>(null);
  const revision = [event.id, event.updatedAt, event.intelligence?.changeKey, event.sources?.length, event.timeline?.length, location].join("|");
  const completed = record?.key === revision && !!record.report;
  useEffect(() => {
    if (!open || completed) return;
    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(() => controller.abort(), 28000);
    const fetchReport = async () => {
      try {
        const query = new URLSearchParams({ id: event.id, location });
        const response = await fetch("/api/assessment?" + query, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw Error("Assessment unavailable");
        const data: Assessment = await response.json();
        if (data.eventId !== event.id || !["ai","sources"].includes(data.mode) ||
          ![data.facts, data.allegations, data.significance, data.implications, data.unknowns,
            data.watch, data.hypotheses, data.citations].every(Array.isArray)) throw Error("Invalid assessment");
        if (active) setRecord({key:revision,report:data});
      } catch {
        if (active) setRecord({key:revision,error:true});
      } finally { window.clearTimeout(timer); }
    };
    void fetchReport();
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [open, completed, revision, retry, event.id, location]);
  const current = record?.key === revision ? record : null;
  return <details className="event-investigation" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary><Search size={16} aria-hidden="true"/><span>Intelligence assessment</span><ChevronDown size={15} aria-hidden="true"/></summary>
    {open && (current?.report ? <Analysis report={current.report}/> :
      current?.error ? <div className="investigation-status" role="status">
        The assessment could not be loaded. <button className="small-link" onClick={() => {setRecord(null); setRetry(n => n + 1);}}>Retry assessment</button>
      </div> : <p className="investigation-status" role="status">Checking the indexed sources…</p>)}
  </details>;
}
