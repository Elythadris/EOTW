import { useState } from "react";
import { Activity, CircleAlert, CircleCheck, CircleDashed, CircleSlash } from "lucide-react";
import { dateTime, relative, type ScanReceipt, type SourceHealth } from "./types";

const states = [
  { key: "ok", label: "Healthy", Icon: CircleCheck },
  { key: "error", label: "Unavailable", Icon: CircleAlert },
  { key: "pending", label: "Pending", Icon: CircleDashed },
  { key: "disabled", label: "Disabled", Icon: CircleSlash },
] as const;
type Filter = SourceHealth["status"] | "all";

export default function SourceCoverage({ sources, scans, lastSuccess }: {
  sources: SourceHealth[];
  scans: ScanReceipt[];
  lastSuccess: string | null;
}) {
  const latest = scans[0];
  const [filter, setFilter] = useState<Filter>("all");
  const groups = states.map(state => ({ ...state, count: sources.filter(row => row.status === state.key).length }));
  const healthy = groups[0].count;
  const enabled = sources.filter(row => row.status !== "disabled").length;
  const visible = filter === "all" ? sources : sources.filter(row => row.status === filter);
  return (
    <section className="coverage-console" aria-label="Source coverage">
      <div className="coverage-overview">
        <div><h2>Reporting coverage</h2>
          <p><strong>{healthy}<span> / {enabled}</span></strong> enabled sources healthy</p>
        </div>
        <div className="coverage-distribution">
          <div className="coverage-scale" aria-hidden="true">
            {groups.flatMap(({key,count}) => Array.from({length:count},(_,i) =>
              <i key={key+i} className={"coverage-segment state-"+key} />))}
          </div>
          <div className="coverage-filters" role="group" aria-label="Filter providers by status">
            <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All <b>{sources.length}</b></button>
            {groups.filter(group => group.count || group.key === filter).map(({key,label,count,Icon}) =>
              <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
                <Icon size={13} className={"state-"+key} aria-hidden="true"/>{label} <b>{count}</b>
              </button>
            )}
          </div>
        </div>
      </div>
      {latest && <details className="event-investigation scan-history">
        <summary><Activity size={16} aria-hidden="true"/><span>Scheduled scan history</span></summary>
        <div className="investigation-body">
          <p>Every 10 minutes, UTC. {lastSuccess && <>Last successful scan <time dateTime={lastSuccess}>{new Date(lastSuccess).toUTCString()}</time>.</>}</p>
          <ol className="scan-receipts">{scans.map(scan => <li key={scan.startedAt}>
            <strong><time dateTime={scan.finishedAt}>{new Date(scan.finishedAt).toUTCString()}</time></strong>
            <p>{scan.succeeded} of {scan.checked} source checks succeeded. {scan.changed} archive {scan.changed === 1 ? "record" : "records"} written.
              {scan.failed > 0 && " " + scan.failed + " failed."}
              {scan.deferred > 0 && " " + scan.deferred + " deferred."}</p>
            {scan.exampleArchivedId && <a href={"/story/" + encodeURIComponent(scan.exampleArchivedId)}>Inspect an archived report</a>}
          </li>)}</ol>
        </div>
      </details>}
      <div className="source-index">
        <div className="source-index-heading"><Activity size={18}/><h2>Provider status</h2>
          <span aria-live="polite">{visible.length} {visible.length === 1 ? "source" : "sources"}</span>
        </div>
        <ul>
          {visible.map(row => {
            const state = states.find(item => item.key === row.status) || states[2];
            return <li key={row.id} className={"source-line state-"+state.key}>
              <span className="source-badge"><state.Icon size={17}/>{state.label}</span>
              <div className="source-name"><h3>{row.name}</h3>{row.detail && <p>{row.detail}</p>}</div>
              <div className="source-clock">
                <span>{row.lastSuccess ? "Last success" : "Last successful check"}</span>
                {row.lastSuccess
                  ? <time dateTime={row.lastSuccess} title={dateTime(row.lastSuccess)}>{relative(row.lastSuccess)}</time>
                  : <strong>None recorded</strong>}
                {row.status !== "disabled" && row.intervalMinutes && <small>Checks every {row.intervalMinutes} min</small>}
                {row.status === "error" && row.lastAttempt && <small>Last attempt {relative(row.lastAttempt)}</small>}
                {row.status === "error" && row.nextAttemptAt && <small>Next eligible check {dateTime(row.nextAttemptAt)}</small>}
              </div>
            </li>;
          })}
        </ul>
        {!visible.length && <p className="source-empty">No providers have this status in the latest collection.</p>}
      </div>
    </section>
  );
}
