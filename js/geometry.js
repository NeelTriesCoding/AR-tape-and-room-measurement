// Small vector toolkit. Points are [x, y, z] in metres, y is up (ARCore local space is gravity aligned).
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => len(sub(a, b));
export const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const mid = (a, b) => scale(add(a, b), 0.5);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const DEG = 180 / Math.PI;

export function pathLength(pts, closed = false) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) s += dist(pts[pts.length - 1], pts[0]);
  return s;
}

// Newell's method: works for any planar polygon in 3D, any orientation.
export function polygon(pts) {
  let nx = 0, ny = 0, nz = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const mag = Math.hypot(nx, ny, nz);
  return { area: mag / 2, normal: mag ? [nx / mag, ny / mag, nz / mag] : [0, 1, 0] };
}

export function centroid(pts) {
  const c = [0, 0, 0];
  pts.forEach(p => { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; });
  return scale(c, 1 / pts.length);
}

export function angleAt(a, b, c) {
  const u = sub(a, b), v = sub(c, b);
  const d = len(u) * len(v);
  if (!d) return null;
  return Math.acos(clamp(dot(u, v) / d, -1, 1)) * DEG;
}

// Height of the point on the vertical line through `base` that comes closest to the camera ray.
// Same trick commercial apps use to measure height when there is no surface to hit at the top.
export function verticalHeight(base, origin, dir) {
  const U = [0, 1, 0];
  const w0 = sub(base, origin);
  const b = dot(U, dir), c = dot(dir, dir), d = dot(U, w0), e = dot(dir, w0);
  const den = c - b * b;
  if (den < 1e-6) return null;
  const t = (b * e - c * d) / den;
  const s = (e - b * d) / den;
  if (s <= 0) return null; // behind the camera
  return t;
}

// Snap a new point relative to the previous one: plumb (vertical) within 5°, level within 3°.
export function snapPoint(prev, p) {
  const v = sub(p, prev);
  const L = len(v);
  if (L < 0.02) return { p, kind: null };
  const horiz = Math.hypot(v[0], v[2]);
  if (horiz < L * Math.sin(5 / DEG)) return { p: [prev[0], p[1], prev[2]], kind: 'plumb' };
  if (Math.abs(v[1]) < L * Math.sin(3 / DEG)) return { p: [p[0], prev[1], p[2]], kind: 'level' };
  return { p, kind: null };
}

// Angle of a segment above or below horizontal, in degrees.
export function inclination(a, b) {
  const v = sub(b, a);
  const L = len(v);
  return L ? Math.asin(Math.min(1, Math.abs(v[1]) / L)) * DEG : 0;
}

// Where a ray meets an infinite plane (point p0, normal n). Null if parallel, behind, or absurdly far.
export function rayPlane(o, d, p0, n, maxT = 15) {
  const den = dot(d, n);
  if (Math.abs(den) < 1e-4) return null;
  const t = dot(sub(p0, o), n) / den;
  if (t <= 0.05 || t > maxT) return null;
  return add(o, scale(d, t));
}

export const distToPlane = (p, p0, n) => Math.abs(dot(sub(p, p0), n));

// World point seen at normalised view coords (x, y in 0..1, top-left origin) at view-space depth d.
// proj is the view's projection matrix, worldFromView its transform matrix (both column-major).
export function unproject(proj, worldFromView, x, y, d) {
  const nx = x * 2 - 1, ny = 1 - y * 2;
  const X = d * (nx + proj[8]) / proj[0];
  const Y = d * (ny + proj[9]) / proj[5];
  const w = mulMat4(worldFromView, [X, Y, -d, 1]);
  return [w[0], w[1], w[2]];
}

// Spread of recent samples: largest distance from their mean, in metres.
export function spread(list) {
  if (list.length < 2) return 0;
  const c = centroid(list);
  return Math.max(...list.map(p => dist(p, c)));
}

export function rotateByQuat(v, q) {
  // v' = v + 2w(q×v) + 2 q×(q×v)
  const qv = [q.x, q.y, q.z];
  const t = scale(cross(qv, v), 2);
  return add(add(v, scale(t, q.w)), cross(qv, t));
}

// Column-major 4x4 times [x, y, z, w]
export function mulMat4(m, v) {
  const [x, y, z, w] = v;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    m[3] * x + m[7] * y + m[11] * z + m[15] * w,
  ];
}

// 2D layout of a planar polygon (for the top-down room sketch)
export function flatten(pts) {
  const { normal } = polygon(pts);
  let u = sub(pts[1], pts[0]);
  u = norm(sub(u, scale(normal, dot(u, normal))));
  const v = cross(normal, u);
  return pts.map(p => { const d = sub(p, pts[0]); return [dot(d, u), dot(d, v)]; });
}
