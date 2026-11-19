// Keep the source's complete geometry or omit the overlay. A partial ring can
// put people on the wrong side of a warning boundary.
export function alertArea(geometry) {
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) return;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polygons) || !polygons.length || polygons.length > 24) return;
  let vertices = 0;
  const coordinates = [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length || polygon.length > 16) return;
    const rings = [];
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4 || (vertices += ring.length) > 1500) return;
      const points = [];
      for (const position of ring) {
        if (!Array.isArray(position)) return;
        const [lon, lat] = position;
        if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return;
        points.push([lon, lat]);
      }
      const first = points[0], last = points.at(-1);
      if (first[0] !== last[0] || first[1] !== last[1]) return;
      rings.push(points);
    }
    coordinates.push(rings);
  }
  return { type: "MultiPolygon", coordinates };
}
