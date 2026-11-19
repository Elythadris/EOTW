import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { geoGraticule, geoNaturalEarth1, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import countries from 'world-atlas/countries-110m.json'
import { Maximize, Minus, Plus, X } from 'lucide-react'
import type { IntelEvent } from './types'
import './event-map.css'

const width = 900
const height = 440
const projection = geoNaturalEarth1().scale(160).translate([width / 2, height / 2 + 18])
const path = geoPath(projection)
const atlas = countries as unknown as Topology<{ countries: GeometryCollection }>
const land = feature(atlas, atlas.objects.countries).features.map(country => ({
  id: String(country.id), d: path(country) || '',
}))
const grid = path(geoGraticule().step([30, 30])()) || ''
const limit = (value: number, max: number) => Math.max(-max, Math.min(max, value))
type View = { k: number, x: number, y: number }
const initial: View = { k: 1, x: 0, y: 0 }
const oceans = [
  { name: 'PACIFIC OCEAN', at: [-139, -5] }, { name: 'ATLANTIC OCEAN', at: [-30, -22] },
  { name: 'INDIAN OCEAN', at: [80, -29] },
]

type Props = { events: IntelEvent[], onSelect: (event: IntelEvent) => void, compact?: boolean }

export default function EventMap({ events, onSelect, compact = false }: Props) {
  const [view, setView] = useState<View>(initial)
  const [selection, setSelection] = useState<string | null>(null)
  const ref = useRef<SVGSVGElement>(null)
  const drag = useRef<{ clientX: number, clientY: number, start: View } | null>(null)
  const infoId = useId()
  const patternId = useId()
  const points = useMemo(() => events.flatMap(event => {
    if (event.lat === null || event.lon === null || !Number.isFinite(event.lat) || !Number.isFinite(event.lon)) return []
    const point = projection([event.lon, event.lat])
    return point ? [{ event, point }] : []
  }), [events])
  const groups = useMemo(() => {
    const cells = new Map<string, typeof points>()
    for (const point of points) {
      const key = Math.round(point.point[0] * view.k / 19) + ':' + Math.round(point.point[1] * view.k / 19)
      const cell = cells.get(key)
      if (cell) cell.push(point)
      else cells.set(key, [point])
    }
    return Array.from(cells, ([key, members]) => ({ key, members, x: members[0].point[0], y: members[0].point[1] }))
  }, [points, view.k])
  const selected = groups.find(group => group.key === selection)
  const closeGroup = useRef<HTMLButtonElement>(null)
  const lastMarker = useRef<SVGGElement | null>(null)
  useEffect(() => { if (selection) closeGroup.current?.focus() }, [selection])
  function dismiss() {
    setSelection(null)
    lastMarker.current?.focus()
  }
  function move(dx: number, dy: number) {
    setView(v => ({ ...v, x: limit(v.x + dx, (v.k - 1) * width / 2), y: limit(v.y + dy, (v.k - 1) * height / 2) }))
  }
  function zoom(factor: number) {
    setSelection(null)
    setView(v => {
      const k = Math.max(1, Math.min(10, v.k * factor))
      return { k, x: limit(v.x * k / v.k, (k - 1) * width / 2), y: limit(v.y * k / v.k, (k - 1) * height / 2) }
    })
  }
  return <div className={'eotw-map' + (compact ? ' is-compact' : '')}>
    <svg className="eotw-map-canvas" viewBox={'0 0 ' + width + ' ' + height} ref={ref} role="group"
      aria-label="Interactive world event map" aria-describedby={infoId} tabIndex={0}
      style={{ touchAction: view.k > 1 ? 'none' : 'pan-y' }}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return
        const directions: Record<string, [number, number]> = { ArrowRight: [-48, 0], ArrowLeft: [48, 0], ArrowUp: [0, 48], ArrowDown: [0, -48] }
        if (e.key in directions && view.k > 1) { e.preventDefault(); move(...directions[e.key]) }
        if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(1.6) }
        if (e.key === '-') { e.preventDefault(); zoom(1 / 1.6) }
      }}
      onPointerDown={e => {
        if (view.k === 1 || e.button !== 0 || (e.target as Element).closest('[role="button"]')) return
        drag.current = { clientX: e.clientX, clientY: e.clientY, start: view }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={e => {
        const d = drag.current
        const scale = ref.current?.getScreenCTM()?.a
        if (!d || !scale) return
        setView({ ...d.start, x: limit(d.start.x + (e.clientX - d.clientX) / scale, (d.start.k - 1) * width / 2),
          y: limit(d.start.y + (e.clientY - d.clientY) / scale, (d.start.k - 1) * height / 2) })
      }}
      onPointerUp={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}>
      <defs><pattern id={patternId} width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".62" fill="#637274" opacity=".42" /></pattern></defs>
      <rect width={width} height={height} fill={'url(#' + patternId + ')'} />
      <g transform={`translate(${width / 2 + view.x} ${height / 2 + view.y}) scale(${view.k}) translate(${-width / 2} ${-height / 2})`}>
        <path d={grid} fill="none" stroke="#3a4244" strokeDasharray="2.4 3.5" strokeWidth=".85" vectorEffect="non-scaling-stroke"/>
        {land.map((country, index) => <path key={index} d={country.d} className="eotw-country" vectorEffect="non-scaling-stroke"/>)}
        {oceans.map(o => {
          const p = projection(o.at as [number, number])!
          return <text key={o.name} x={p[0]} y={p[1]} className="eotw-ocean" textAnchor="middle" fontSize={10 / Math.sqrt(view.k)}>{o.name}</text>
        })}
        {groups.map(g => {
          const high = g.members.some(m => m.event.severity === 'high')
          const color = high ? '#ff6a55' : '#ffc07b'
          const label = g.members.length === 1 ? g.members[0].event.title : g.members.length + ' events near ' + (g.members[0].event.location || 'this point')
          const activate = (el: SVGGElement) => {
            if (g.members.length === 1) onSelect(g.members[0].event)
            else { lastMarker.current = el; setSelection(g.key) }
          }
          return <g key={g.key} role="button" tabIndex={0} className="eotw-marker" aria-label={label}
            transform={`translate(${g.x} ${g.y}) scale(${1 / view.k})`}
            onClick={e => activate(e.currentTarget)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(e.currentTarget) } }}>
            <title>{label}</title><circle r="14" fill="transparent"/>
            <circle className="eotw-halo" r={g.members.length > 1 ? 9 : 7} fill={color} fillOpacity=".14" stroke={color} strokeOpacity=".65" strokeWidth=".9" />
            {g.members.length === 1 ? <circle r="3.5" fill={color}/> : <><circle r="7.5" fill="#342b25" /><text fill={color} textAnchor="middle" y="3.3" fontSize="9.5" fontWeight="700">{g.members.length}</text></>}
          </g>
        })}
      </g>
    </svg>
    <div className="eotw-controls" role="group" aria-label="Map zoom">
      <button type="button" aria-label="Zoom in" title="Zoom in" disabled={view.k >= 10} onClick={() => zoom(1.6)}><Plus size={17}/></button>
      <button type="button" aria-label="Zoom out" title="Zoom out" disabled={view.k <= 1} onClick={() => zoom(1 / 1.6)}><Minus size={17}/></button>
      {view.k > 1 && <button type="button" aria-label="Reset world view" title="Reset world view" onClick={() => { setSelection(null); setView(initial) }}><Maximize size={15}/></button>}
    </div>
    {selected && <div className="eotw-cluster" onKeyDown={e => { if (e.key === 'Escape') dismiss() }}>
      <div><strong>{selected.members.length} reports in this area</strong><button type="button" ref={closeGroup} aria-label="Close map reports" onClick={dismiss}><X size={16}/></button></div>
      {selected.members.map(({ event }) => <button key={event.id} onClick={() => { setSelection(null); onSelect(event) }}>{event.title}</button>)}
    </div>}
    <div className="eotw-map-caption"><span><i/> {points.length} mapped {points.length === 1 ? 'report' : 'reports'}</span><span>Natural Earth</span></div>
    <span id={infoId} className="map-sr">Select a marker to explore its reports. Use the plus and minus buttons to zoom. When zoomed in, drag the map or use the arrow keys.</span>
  </div>
}
