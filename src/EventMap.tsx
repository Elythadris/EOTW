import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { geoArea, geoCentroid, geoGraticule, geoNaturalEarth1, geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import countries from "world-atlas/countries-110m.json";
import { ArrowUpRight, Crosshair, Globe2, Layers, Maximize, Minus, Plus, X } from "lucide-react";
import type { IntelEvent } from "./types";
import "./event-map.css";

type Pair = [number, number];
type Scope = IntelEvent["scope"];
type Camera = { x: number; y: number; k: number };
type Size = { w: number; h: number };
type Kind = "weather" | "seismic" | "natural" | "reporting";
type PointReport = { event: IntelEvent; kind: Kind; xy: Pair; area: string };
type Group = { x: number; y: number; members: PointReport[] };
type Priority = "high" | "elevated" | "watch" | "routine";
type Label = { name: string; at: Pair; type: "continent" | "ocean" | "country" | "island" };
type Props = { events: IntelEvent[]; onSelect: (e: IntelEvent) => void; compact?: boolean; scanAt?: string | null; focusScope?: Scope };

const projection = geoNaturalEarth1().scale(150).translate([0, 0]);
const path = geoPath(projection);
const globeBounds = path.bounds({ type: "Sphere" });
const globeWidth = globeBounds[1][0] - globeBounds[0][0];
const globeHeight = globeBounds[1][1] - globeBounds[0][1];
const world: Camera = { x: 0, y: 0, k: 1 };
const atlas = countries as unknown as Topology<{ countries: GeometryCollection<{ name?: string }>; land: GeometryCollection }>;
const land = path(feature(atlas, atlas.objects.land)) || "";
const borders = path(mesh(atlas, atlas.objects.countries, (a, b) => a !== b)) || "";
const grid = path(geoGraticule().step([30, 30])()) || "";
const detailGrid = path(geoGraticule().step([10, 10])()) || "";
const equator = path({ type: "LineString", coordinates: [[-179.99, 0], [-90, 0], [0, 0], [90, 0], [179.99, 0]] }) || "";
const names: Record<Kind, string> = { weather: "Weather", seismic: "Earthquakes", natural: "Natural hazards", reporting: "Reported incidents" };
const priorityNames: Record<Priority, string> = { high: "High priority", elevated: "Elevated", watch: "Watch", routine: "Routine" };
const priorityOrder: Record<Priority, number> = { high: 3, elevated: 2, watch: 1, routine: 0 };
const scopeName: Record<Scope, string> = { local: "Local area", us: "United States", global: "World" };
const kinds = Object.keys(names) as Kind[];

function reference(name: string, lon: number, lat: number, type: Label["type"]): Label {
  return { name, at: projection([lon, lat])!, type };
}
const continents = [
  reference("North America", -103, 50, "continent"), reference("South America", -59, -15, "continent"),
  reference("Europe", 20, 56, "continent"), reference("Africa", 20, 8, "continent"),
  reference("Asia", 91, 48, "continent"), reference("Australia", 134, -25, "continent"),
];
const oceans = [
  reference("Pacific Ocean", -136, -7, "ocean"), reference("Atlantic Ocean", -35, 16, "ocean"),
  reference("Indian Ocean", 77, -30, "ocean"),
];
const islands = [
  reference("Maui", -156.33, 20.80, "island"), reference("Oʻahu", -157.97, 21.47, "island"),
  reference("Hawaiʻi", -155.50, 19.61, "island"), reference("Kauaʻi", -159.52, 22.05, "island"),
  reference("Molokaʻi", -157.02, 21.14, "island"), reference("Lānaʻi", -156.93, 20.83, "island"),
];
const countriesByArea: Label[] = feature(atlas, atlas.objects.countries).features
  .sort((a, b) => geoArea(b) - geoArea(a))
  .map(c => ({ name: String(c.properties?.name || ""), at: projection(geoCentroid(c))!, type: "country" }));

function kindOf(event: IntelEvent): Kind {
  if (event.category === "Weather") return "weather";
  if (event.category === "Earthquake") return "seismic";
  if (event.category === "Natural event") return "natural";
  return "reporting";
}
function priority(event: IntelEvent): Priority {
  return event.intelligence?.level || (event.severity === "high" ? "high" : event.severity === "moderate" ? "elevated" : "routine");
}
function byPriority(a: PointReport, b: PointReport) {
  return priorityOrder[priority(b.event)] - priorityOrder[priority(a.event)]
    || (b.event.intelligence?.score || 0) - (a.event.intelligence?.score || 0)
    || b.event.updatedAt.localeCompare(a.event.updatedAt) || a.event.id.localeCompare(b.event.id);
}
function areaGeometry(e: IntelEvent) {
  if (!e.alertArea || e.source !== "National Weather Service") return null;
  const coordinates = e.alertArea.coordinates.map(p => p.map((ring, i) => {
    const large = geoArea({ type: "Polygon", coordinates: [ring] }) > 2 * Math.PI;
    return (i === 0 ? large : !large) ? [...ring].reverse() : ring;
  }));
  return { type: "MultiPolygon" as const, coordinates };
}
function makePoints(events: IntelEvent[], now: number) {
  const result = new Map<string, PointReport>();
  for (const event of events) {
    if (result.has(event.id)) continue;
    const geometry = !event.expiresAt || Date.parse(event.expiresAt) > now ? areaGeometry(event) : null;
    const xy = event.lon !== null && event.lat !== null && Number.isFinite(event.lon) && Number.isFinite(event.lat)
      && Math.abs(event.lon) <= 180 && Math.abs(event.lat) <= 90 ? projection([event.lon, event.lat])
      : geometry ? path.centroid(geometry) : null;
    if (xy && xy.every(Number.isFinite)) result.set(event.id, { event, kind: kindOf(event), xy, area: geometry ? path(geometry) || "" : "" });
  }
  return [...result.values()].sort(byPriority);
}
function constrain(c: Camera, size: Size, base: number): Camera {
  const k = Math.min(36, Math.max(1, c.k));
  const dx = Math.max(0, (globeWidth - size.w / (base * k)) / 2);
  const dy = Math.max(0, (globeHeight - size.h / (base * k)) / 2);
  return { k, x: Math.max(-dx, Math.min(dx, c.x)), y: Math.max(-dy, Math.min(dy, c.y)) };
}
function fit(points: PointReport[], size: Size, base: number, max: number): Camera {
  if (!points.length) return world;
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const { xy: [x, y] } of points) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  const k = Math.min(max, (size.w - 86) / (Math.max(1, right - left) * base), (size.h - 85) / (Math.max(1, bottom - top) * base));
  return constrain({ x: (left + right) / 2, y: (top + bottom) / 2, k }, size, base);
}
function toScreen([x, y]: Pair, c: Camera, size: Size, base: number): Pair {
  return [size.w / 2 + (x - c.x) * base * c.k, size.h / 2 + (y - c.y) * base * c.k];
}
function clustered(points: PointReport[], camera: Camera, size: Size, base: number) {
  const groups: Group[] = [];
  for (const p of points) {
    const [x, y] = toScreen(p.xy, camera, size, base);
    if (x < -12 || y < -12 || x > size.w + 12 || y > size.h + 12) continue;
    const near = groups.find(g => Math.hypot(g.x - x, g.y - y) < 24);
    if (near) near.members.push(p);
    else groups.push({ x, y, members: [p] });
  }
  return groups;
}
function labelsFor(camera: Camera, size: Size, base: number, groups: Group[]) {
  const candidates = camera.k < 1.85 ? [...continents, ...oceans] : [...(camera.k >= 7 ? islands : []), ...countriesByArea, ...oceans];
  const placed: { l: Label; x: number; y: number; half: number }[] = [];
  for (const l of candidates) {
    if (!l.name || !l.at) continue;
    const [x, cy] = toScreen(l.at, camera, size, base);
    const half = l.name.length * (l.type === "continent" ? (size.w < 520 ? 2.75 : 3.65) : 3);
    if (x < half + 4 || x > size.w - half - 4) continue;
    for (const offset of [0, -13, 13, -25, 25]) {
      const y = cy + offset;
      if (y < 13 || y > size.h - 9 || (size.w < 400 && l.type === "ocean" && l.name === "Atlantic Ocean")) continue;
      if (placed.some(p => Math.abs(y - p.y) < 13 && Math.abs(x - p.x) < half + p.half + 3)) continue;
      if (groups.some(g => Math.abs(y - g.y) < 16 && Math.abs(x - g.x) < half + 10)) continue;
      placed.push({ l, x, y, half }); break;
    }
  }
  return placed;
}
function useCamera(target: Camera, dragging: boolean) {
  const [camera, setCamera] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const start = current.current;
    const publish = (next: Camera) => { current.current = next; setCamera(next); };
    if (dragging || window.matchMedia("(prefers-reduced-motion: reduce)").matches || (start.x === target.x && start.y === target.y && start.k === target.k)) {
      publish(target); return;
    }
    let frame = 0;
    const at = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - at) / 280);
      const t = 1 - (1 - progress) ** 3;
      publish({ x: start.x + (target.x - start.x) * t, y: start.y + (target.y - start.y) * t, k: Math.exp(Math.log(start.k) * (1 - t) + Math.log(target.k) * t) });
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target.x, target.y, target.k, dragging]);
  return camera;
}

const Basemap = memo(function Basemap({ landId, detailed }: { landId: string; detailed: boolean }) {
  const [fineLand, setFineLand] = useState("");
  useEffect(() => {
    if (!detailed || fineLand) return;
    let mounted = true;
    void import("world-atlas/land-50m.json").then(({ default: data }) => {
      if (!mounted) return;
      const topology = data as unknown as Topology<{ land: GeometryCollection }>;
      setFineLand(path(feature(topology, topology.objects.land)) || "");
    }).catch(() => { /* The bundled overview coastline remains available offline. */ });
    return () => { mounted = false; };
  }, [detailed, fineLand]);
  const href = "#" + landId;
  return <>
    <defs><path id={landId} d={detailed && fineLand ? fineLand : land} vectorEffect="non-scaling-stroke" /></defs>
    <path className="eotw-grid" d={detailed ? detailGrid : grid} />
    <path className="eotw-equator" d={equator} />
    <use href={href} className="eotw-shelf shelf-outer" />
    <use href={href} className="eotw-shelf shelf-mid" />
    <use href={href} className="eotw-shelf shelf-inner" />
    <use href={href} fill={"url(#" + landId + "-fill)"} className="eotw-coast" />
    {!detailed && <use href={href} fill={"url(#" + landId + "-grain)"} stroke="none" />}
    <path d={borders} className="eotw-border" />
  </>;
});
function Glyph({ kind, r = 4 }: { kind: Kind; r?: number }) {
  if (kind === "seismic") return <circle r={r} />;
  if (kind === "weather") return <path d={`M0 ${-r-1} ${r+1} 0 0 ${r+1} ${-r-1} 0Z`} />;
  if (kind === "natural") return <path d={`M0 ${-r-1} ${r+1} ${r} ${-r-1} ${r}Z`} />;
  return <rect x={-r} y={-r} width={r*2} height={r*2} rx=".8" />;
}
function place(e: IntelEvent) { return e.location || scopeName[e.scope]; }

export default function EventMap({ events, onSelect, compact = false, scanAt = null, focusScope }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<Size>({ w: 800, h: 392 });
  useEffect(() => {
    const node = svg.current;
    if (!node) return;
    const measure = () => {
      const { width: w, height: h } = node.getBoundingClientRect();
      if (w && h) setSize(s => s.w === w && s.h === h ? s : { w, h });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const landId = "atlas-" + useId().replace(/[^a-z\d-]/gi, "");
  const infoId = landId + "-instructions";
  const scope = focusScope || "global";
  const [hidden, setHidden] = useState<Kind[]>([]);
  const [showAreas, setShowAreas] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [viewName, setViewName] = useState<string | null>(null);
  const [manual, setManual] = useState<Camera | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sweep, setSweep] = useState(0);
  const previousScan = useRef(scanAt);
  const drag = useRef<{ x: number; y: number; start: Camera } | null>(null);
  const previousMarker = useRef<SVGGElement | null>(null);
  const closePanel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setManual(null); setViewName(null); setPicked(null); setHover(null);
  }, [focusScope]);
  useEffect(() => {
    if (!scanAt) return;
    const previous = Date.parse(previousScan.current || "");
    const stamp = Date.parse(scanAt);
    const age = Date.now() - stamp;
    if (stamp > previous && age >= -60000 && age < 20 * 60000) setSweep(n => n + 1);
    previousScan.current = scanAt;
  }, [scanAt]);
  useEffect(() => { if (picked) closePanel.current?.focus({ preventScroll: true }); }, [picked]);

  const all = useMemo(() => makePoints(events, Date.now()), [events, scanAt]);
  const scoped = useMemo(() => focusScope ? all.filter(p => p.event.scope === focusScope) : all, [all, focusScope]);
  const points = useMemo(() => scoped.filter(p => !hidden.includes(p.kind)), [scoped, hidden]);
  const areas = useMemo(() => points.filter(p => p.area), [points]);
  const base = Math.max(0.1, Math.min((size.w - 14) / globeWidth, (size.h - 14) / globeHeight));
  const automatic = useMemo(() => scope === "global" ? world : fit(scoped, size, base, scope === "local" ? 18 : 5), [scope, scoped, size, base]);
  const target = constrain(manual || automatic, size, base);
  const camera = useCamera(target, dragging);
  const groups = useMemo(() => clustered(points, camera, size, base), [points, camera, size, base]);
  const labels = useMemo(() => labelsFor(camera, size, base, groups), [camera, size, base, groups]);
  const selected = groups.find(g => picked && g.members.some(p => p.event.id === picked));
  const preview = !selected && groups.find(g => hover && g.members.some(p => p.event.id === hover));
  const s = base * camera.k;
  const region = viewName || scopeName[scope];
  const layerKinds = kinds.filter(kind => scoped.some(p => p.kind === kind));
  const local = useMemo(() => all.filter(p => p.event.scope === "local"), [all]);
  const applicableAreas = scoped.some(p => p.area);
  const priorities = [...new Set(points.map(p => priority(p.event)))].sort((a, b) => priorityOrder[b] - priorityOrder[a]);

  function clear() { setPicked(null); setHover(null); }
  function dismiss() {
    clear();
    const marker = previousMarker.current;
    (marker?.isConnected ? marker : svg.current)?.focus({ preventScroll: true });
  }
  function move(dx: number, dy: number) {
    clear(); setManual(constrain({ ...target, x: target.x + dx / (base * target.k), y: target.y + dy / (base * target.k) }, size, base));
  }
  function zoom(factor: number) {
    clear(); setManual(constrain({ ...target, k: target.k * factor }, size, base));
  }
  function center(pointsToFit: PointReport[], maximum: number, name: string) {
    clear(); setViewName(name); setManual(fit(pointsToFit, size, base, maximum));
  }
  function pick(group: Group, node: SVGGElement) {
    previousMarker.current = node; setPicked(group.members[0].event.id); setHover(null);
  }
  function flipLayer(kind: Kind) {
    clear(); setHidden(state => state.includes(kind) ? state.filter(k => k !== kind) : [...state, kind]);
  }

  return <section className={"eotw-map" + (compact ? " is-compact" : "")} aria-label="Report atlas">
    <div className="eotw-plate">
      <svg ref={svg} className="eotw-map-canvas" viewBox={`0 0 ${size.w} ${size.h}`}
        aria-label="Interactive world event map" aria-describedby={infoId} role="group" tabIndex={0}
        data-zoomed={target.k > 1.01} data-dragging={dragging}
        style={{ touchAction: target.k > 1.01 ? "none" : "pan-y" }}
        onKeyDown={e => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "+" || e.key === "=") { e.preventDefault(); zoom(1.7); }
          if (e.key === "-") { e.preventDefault(); zoom(1 / 1.7); }
          const dirs: Record<string, Pair> = { ArrowRight: [48, 0], ArrowLeft: [-48, 0], ArrowUp: [0, -48], ArrowDown: [0, 48] };
          if (target.k > 1.01 && dirs[e.key]) { e.preventDefault(); move(...dirs[e.key]); }
        }}
        onPointerDown={e => {
          if (target.k <= 1.01 || e.button !== 0 || (e.target as Element).closest('[role="button"]')) return;
          clear(); drag.current = { x: e.clientX, y: e.clientY, start: camera }; setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={e => {
          const d = drag.current;
          if (!d) return;
          setManual(constrain({ ...d.start, x: d.start.x - (e.clientX - d.x) / (base * d.start.k), y: d.start.y - (e.clientY - d.y) / (base * d.start.k) }, size, base));
        }}
        onPointerUp={() => { drag.current = null; setDragging(false); }}
        onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
        onPointerCancel={() => { drag.current = null; setDragging(false); }}>
        <defs>
          <linearGradient id={landId + "-fill"} gradientUnits="userSpaceOnUse" x1="-100" y1="-190" x2="50" y2="205">
            <stop stopColor="#68858b" /><stop offset=".48" stopColor="#436773" /><stop offset="1" stopColor="#345460" />
          </linearGradient>
          <pattern id={landId + "-grain"} width="4.5" height="4.5" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r=".52" fill="#daece4" opacity=".17" />
          </pattern>
        </defs>
        <g aria-hidden="true" transform={`translate(${size.w/2-camera.x*s} ${size.h/2-camera.y*s}) scale(${s})`}>
          <Basemap landId={landId} detailed={camera.k > 2.1} />
          {showAreas && areas.map(p => <path key={p.event.id} className="eotw-alert-area" d={p.area} fillRule="evenodd"><title>{p.event.title} · official NWS warning area</title></path>)}
        </g>
        <g className="eotw-map-labels" aria-hidden="true">
          {labels.map(({ l, x, y }) => <text key={l.type + l.name} x={x} y={y} className={"ml-" + l.type}>{l.name}</text>)}
        </g>
        {[...groups].reverse().map(g => {
          const { event, kind } = g.members[0];
          const tone = priority(event), group = g.members.length > 1;
          const active = selected === g || preview === g;
          const r = group ? Math.min(14, 9 + Math.log2(g.members.length)) : tone === "high" ? 8 : tone === "elevated" ? 6.5 : 5;
          const label = (group ? g.members.length + " reports near " + place(event) : event.title + " · " + place(event)) + " · " + priorityNames[tone];
          return <g key={event.id} role="button" tabIndex={0} aria-label={label} aria-pressed={selected === g}
            className={"eotw-marker mp-" + tone + (active ? " is-active" : "")} transform={`translate(${g.x} ${g.y})`}
            onPointerEnter={e => { if (e.pointerType !== "touch") setHover(event.id); }} onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(event.id)} onBlur={() => setHover(null)}
            onClick={e => pick(g, e.currentTarget)}
            onKeyDown={e => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(g, e.currentTarget); }
              if (e.key === "Escape") { e.preventDefault(); clear(); }
            }}>
            <title>{label}</title>
            <circle r={Math.max(14, r + 3)} fill="transparent" />
            {(tone === "high" || active) && <circle className="eotw-priority-ring" r={r + 3.2} />}
            <circle r={r + .5} className="eotw-pin-halo" />
            {group ? <text className="eotw-pin-count" y=".4">{g.members.length}</text> : <g fill="currentColor"><Glyph kind={kind} r={tone === "high" ? 4.1 : 3.25} /></g>}
          </g>;
        })}
      </svg>
      <div className="eotw-map-index" aria-hidden="true"><Globe2 size={14} /><span>{region}</span></div>
      <div className="eotw-map-north" aria-label="North is up"><span>N</span><svg width="11" height="15" viewBox="0 0 12 17" aria-hidden="true"><path d="M6 0 11.3 16 6 12 0.7 16Z" fill="#bce3dd"/><path d="M6 0v12l5.3 4Z" fill="#547987"/></svg></div>
      {sweep > 0 && <div key={sweep} className="eotw-scan-sweep" aria-hidden="true" />}
      {preview && <div className="eotw-map-tip" aria-hidden="true" style={{ left: Math.max(6, Math.min(size.w - Math.min(206, size.w - 12) - 6, preview.x - 50)), top: preview.y < 67 ? preview.y + 15 : undefined, bottom: preview.y >= 67 ? size.h - preview.y + 15 : undefined }}>
        <strong>{place(preview.members[0].event)}</strong><span>{priorityNames[priority(preview.members[0].event)]} · {preview.members.length === 1 ? preview.members[0].event.category : preview.members.length + " reports"}</span>
      </div>}
      {points.length === 0 && <p className="eotw-map-empty" role="status">{scoped.length ? "All report layers hidden" : scope === "global" ? "No mapped reports in this feed" : "No mapped reports in " + (scope === "us" ? "the United States" : "the local area")}</p>}
    </div>
    <div className="eotw-map-dock">
      <span className="eotw-map-total"><strong>{points.length}</strong> mapped {points.length === 1 ? "report" : "reports"}</span>
      <div className="eotw-controls" role="group" aria-label="Map zoom">
        <button type="button" aria-label="Zoom out" title="Zoom out" disabled={target.k <= 1.01} onClick={() => zoom(1 / 1.7)}><Minus size={16}/></button>
        <button type="button" aria-label="Zoom in" title="Zoom in" disabled={target.k >= 36} onClick={() => zoom(1.7)}><Plus size={16}/></button>
        {!focusScope && local.length > 0 && <button type="button" aria-label="Focus local reports" title="Focus local reports" onClick={() => center(local, 18, "Local area")}><Crosshair size={16}/></button>}
        <button type="button" aria-label="Reset world view" title="Reset world view" disabled={target.k <= 1.01} onClick={() => { clear(); setViewName("World"); setManual(world); }}><Maximize size={15}/></button>
      </div>
    </div>
    {selected && <section className="eotw-cluster" aria-label="Selected map reports" onKeyDown={e => { if (e.key === "Escape") dismiss(); }}>
      <div className="eotw-cluster-head"><div><small>{selected.members.length === 1 ? "Selected report" : selected.members.length + " reports near"}</small><strong>{place(selected.members[0].event)}</strong></div><button type="button" ref={closePanel} aria-label="Close map reports" onClick={dismiss}><X size={17}/></button></div>
      <div className="eotw-cluster-list">{selected.members.map(({ event }) => <button type="button" key={event.id} className="eotw-open-report" onClick={() => onSelect(event)}>
        <span><small>{priorityNames[priority(event)]} · {event.source}</small><strong>{event.title}</strong>
          {(event.mapNote || event.coordinatePrecision === "country" || event.coordinatePrecision === "region") && <em>{event.mapNote || "Approximate regional location"}</em>}
        </span><ArrowUpRight size={16} aria-hidden="true"/></button>)}</div>
      {target.k < 35.9 && <button type="button" className="eotw-area-focus" onClick={() => center(selected.members, Math.min(36, Math.max(4, target.k * 2.8)), place(selected.members[0].event))}><Crosshair size={14}/> Zoom to this area</button>}
    </section>}
    {(layerKinds.length > 0 || applicableAreas) && <div className="eotw-map-layers" role="group" aria-label="Map layers">
      <Layers className="eotw-layer-icon" size={14} aria-hidden="true"/>
      {layerKinds.map(kind => <button key={kind} type="button" aria-label={"Show " + names[kind].toLowerCase()} aria-pressed={!hidden.includes(kind)} onClick={() => flipLayer(kind)}>
        <svg viewBox="-7 -7 14 14" aria-hidden="true" width="13" height="13" fill="currentColor"><Glyph kind={kind}/></svg>{names[kind]}
      </button>)}
      {applicableAreas && <button type="button" aria-label="Show official warning areas" aria-pressed={showAreas} onClick={() => setShowAreas(v => !v)}><i className="eotw-area-swatch"/>Warning areas</button>}
    </div>}
    <div className="eotw-map-caption"><div className="eotw-priority-key" aria-label="Map priority legend">{priorities.map(tone => <span key={tone} className={"mp-" + tone}><i/>{priorityNames[tone]}</span>)}</div><span className="eotw-atlas-source">Natural Earth</span></div>
    <span id={infoId} className="map-sr">Select a marker for its location, priority and source reports. Marker shapes indicate report type. Larger rings indicate higher priority. Numbers show grouped reports. Use plus and minus to zoom. Drag or press the arrow keys to pan when zoomed in.</span>
  </section>;
}
