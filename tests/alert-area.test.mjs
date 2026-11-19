import assert from "node:assert/strict";
import test from "node:test";
import { alertArea } from "../server/feeds/alert-area.mjs";

test("warning overlays preserve separate polygons and holes", () => {
  const exterior = [[0,0],[0,2],[2,2],[0,0]], hole = [[0.2,1],[0.3,1.2],[0.25,1.2],[0.2,1]];
  const polygon = {type:"Polygon", coordinates:[exterior, hole]};
  assert.deepEqual(alertArea(polygon), {type:"MultiPolygon", coordinates:[[exterior, hole]]});
  assert.deepEqual(alertArea({type:"MultiPolygon",coordinates:[[exterior],[exterior]]}).coordinates.length, 2);
});

test("omit invalid or overly detailed warning areas instead of drawing an approximation", () => {
  for (const coordinates of [[], [[[0,0],[0,1],[181,2],[0,0]]], [[[0,0],[0,2],[2,2],[1,0]]], [Array(1501).fill([0,0])]]) {
    assert.equal(alertArea({type:"Polygon",coordinates}), undefined);
  }
  assert.equal(alertArea({type:"Point",coordinates:[-156,20]}), undefined);
});
