// 盤面の幾何。座標は m、点は [x, z]。面のデータは { floor: 輪, walls: [輪, ...], lane: [[x, z, 進行度], ...] }
// ブラウザでは window.Geom、node では module.exports
(function (root) {
  "use strict";

  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  // 線分 ab と cd が互いを横切るか。端点が相手の線分に触れるだけ、重なって平行なときは交わらないとする
  function segCross(a, b, c, d) {
    const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
    return d1 * d2 < 0 && d3 * d4 < 0;
  }

  // 点が輪（多角形）の中か（偶奇の規則）
  function inRing(p, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }

  const rings = (map) => [map.floor, ...map.walls];
  const onFloor = (p, map) => inRing(p, map.floor) && !map.walls.some((w) => inRing(p, w));

  // a から b への線が、床の外周か壁の辺を横切るか
  // 辺の端点（頂点）を線がちょうど通るときは、その頂点の前後の点が壁の中か場外なら切れとする
  function blocked(a, b, map) {
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    for (const r of rings(map))
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        if (segCross(a, b, r[j], r[i])) return true;
        const v = r[i];
        if (L === 0 || Math.abs(cross(a, b, v)) / L > 1e-9) continue;
        const t = ((v[0] - a[0]) * dx + (v[1] - a[1]) * dz) / (L * L);
        if (t <= 0 || t >= 1) continue;
        const e = 1e-4 / L;
        for (const s of [t - e, t + e]) {
          const q = [a[0] + s * dx, a[1] + s * dz];
          if (edgeDist(q, map) > 1e-6 && !onFloor(q, map)) return true;   // 辺の上の点（辺に沿う線）は決め手にしない
        }
      }
    return false;
  }

  function nearestOnSeg(p, a, b) {
    const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
    const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2));
    return [a[0] + t * dx, a[1] + t * dz];
  }

  // 点から最も近い辺までの距離
  function edgeDist(p, map) {
    let best = Infinity;
    for (const r of rings(map))
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const q = nearestOnSeg(p, r[j], r[i]);
        best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
      }
    return best;
  }

  // 床でなければ、辺の最寄りの点から margin だけ外（辺の両側の法線方向と、p から辺へ向かう向き）へ出た点のうち、
  // 床の上で最も近いものへ戻す。見つからなければ p のまま
  function pushOut(p, map, margin = 0.3) {
    if (onFloor(p, map)) return p;
    let best = null, bd = Infinity;
    for (const r of rings(map))
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = r[j], b = r[i], q = nearestOnSeg(p, a, b);
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
        const toward = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const dirs = [n, [-n[0], -n[1]]];
        if (toward > 1e-9) dirs.push([(q[0] - p[0]) / toward, (q[1] - p[1]) / toward]);
        for (const d of dirs) {
          const c = [q[0] + d[0] * margin, q[1] + d[1] * margin];
          const dist = Math.hypot(c[0] - p[0], c[1] - p[1]);
          if (dist < bd && onFloor(c, map)) { best = c; bd = dist; }
        }
      }
    return best || p;
  }

  // 進行度 p（−100〜100）のクリスタルの位置と進む向き（単位）。範囲の外は端に止める
  function laneAt(lane, p) {
    const lo = lane[0][2], hi = lane[lane.length - 1][2];
    const q = Math.max(lo, Math.min(hi, p));
    let j = 0;
    while (j < lane.length - 2 && lane[j + 1][2] < q) j++;
    const [x0, z0, p0] = lane[j], [x1, z1, p1] = lane[j + 1];
    const t = p1 === p0 ? 0 : (q - p0) / (p1 - p0);
    const L = Math.hypot(x1 - x0, z1 - z0) || 1;
    return { x: x0 + t * (x1 - x0), z: z0 + t * (z1 - z0), tx: (x1 - x0) / L, tz: (z1 - z0) / L };
  }

  const r1 = (v) => Math.round(v * 10) / 10;

  // URL の問い合わせ部分。b は 10 個の位置（小数 1 桁）、s は選んだ丸（無ければ省く）
  function encodeState({ m, p, pts, s }) {
    const q = [`m=${encodeURIComponent(m)}`, `p=${Math.round(p * 100) / 100}`];
    if (pts) q.push(`b=${pts.map(([x, z]) => `${r1(x)},${r1(z)}`).join(";")}`);
    if (s >= 0) q.push(`s=${s}`);
    return q.join("&");
  }

  // 壊れた値は既定へ。pts が読めなければ null（画面が「配置」で並べる）
  function parseState(query, defaults) {
    const u = new URLSearchParams(query);
    const m = defaults.maps.includes(u.get("m")) ? u.get("m") : defaults.m;
    const pv = Number(u.get("p"));
    const p = u.has("p") && Number.isFinite(pv) && pv >= -100 && pv <= 100 ? pv : defaults.p;
    let pts = null;
    const b = (u.get("b") || "").split(";").map((s) => s.split(",").map(Number));
    if (b.length === 10 && b.every((v) => v.length === 2 && v.every(Number.isFinite))) pts = b.map(([x, z]) => [r1(x), r1(z)]);
    const sv = Number(u.get("s"));
    const s = u.has("s") && Number.isInteger(sv) && sv >= 0 && sv < 10 ? sv : -1;
    return { m, p, pts, s };
  }

  // 「配置」：青と緑（0〜4）をクリスタルの進む向きの逆側、赤（5〜9）を進む向きの側に、クリスタルから 4〜8 m の
  // 床の上で一列に並べる。壁から 1.5 m 以上離れた 0.5 m 格子の候補を、進む向きに直交する位置で並べて等間隔に選ぶ。
  // 候補が 5 個に満たなければ壁からの距離を 1.0、0.5、0 m へ緩める
  function placeTeams(map, c) {
    const nx = -c.tz, nz = c.tx;
    const team = (side) => {
      for (const clear of [1.5, 1.0, 0.5, 0]) {
        const cand = [];
        for (let dx = -8; dx <= 8; dx += 0.5)
          for (let dz = -8; dz <= 8; dz += 0.5) {
            const d = Math.hypot(dx, dz), along = (dx * c.tx + dz * c.tz) * side;
            if (d < 4 || d > 8 || along < 1) continue;
            const p = [c.x + dx, c.z + dz];
            if (onFloor(p, map) && edgeDist(p, map) >= clear) cand.push({ p, u: dx * nx + dz * nz, d });
          }
        if (cand.length < 5) continue;
        // 一列：クリスタルから 6 m 前後の帯を優先し、直交方向の位置で並べて等間隔に取る
        const band = cand.filter((e) => Math.abs(e.d - 6) <= 1);
        const pool = (band.length >= 5 ? band : cand).sort((a, b) => a.u - b.u);
        return [0, 1, 2, 3, 4].map((k) => pool[Math.round((k * (pool.length - 1)) / 4)].p);
      }
      return null;
    };
    const ally = team(-1), enemy = team(1);
    // 端（±100 の行き止まり）で片側に床が無いときは、反対側の帯から取り、重ならない点を探す
    const fallback = (n, used) => {
      const out = [];
      for (let r = 4; out.length < n && r <= 16; r += 1)
        for (let a = 0; out.length < n && a < 360; a += 15) {
          const p = [c.x + r * Math.cos((a * Math.PI) / 180), c.z + r * Math.sin((a * Math.PI) / 180)];
          if (onFloor(p, map) && [...used, ...out].every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) >= 1)) out.push(p);
        }
      return out;
    };
    const a = ally || fallback(5, enemy || []);
    const e = enemy || fallback(5, a);
    return [...a, ...e];
  }

  // 一直線に並ぶ頂点を落とす
  function dropCollinear(ring) {
    const n = ring.length, keep = [];
    for (let j = 0; j < n; j++) {
      const a = ring[(j - 1 + n) % n], b = ring[j], c = ring[(j + 1) % n];
      if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) keep.push(b);
    }
    return keep;
  }

  // 変換の道具（tools/board_export.py の straighten）と同じ直線化。水平か垂直から tolDeg 以内の辺を軸に揃え
  // （座標は辺の長さで重み付けた平均を grid に丸める）、同じ向きの辺をつないで角を直角にする。軸から外れた辺の区間は、
  // 合計 short 未満なら軸に読み替え、以上なら弧として頂点を残す。同じ向きに進む step 未満の段は落とし、柱の出っ張りは残す
  function straighten(ring, { tolDeg = 10, short = 2.5, step = 1.0, grid = 0.25 } = {}) {
    const n = ring.length;
    if (n < 4) return ring.map((p) => [...p]);
    const len = (e) => Math.hypot(e[1][0] - e[0][0], e[1][1] - e[0][1]);
    const sum = (es, f) => es.reduce((s, e) => s + f(e), 0);
    const t = Math.tan((tolDeg * Math.PI) / 180);
    const axis = (e, force = false) => {
      const dx = Math.abs(e[1][0] - e[0][0]), dz = Math.abs(e[1][1] - e[0][1]);
      if (dz <= t * dx || (force && dx >= dz)) return "H";
      if (dx <= t * dz || force) return "V";
      return "C";
    };
    let edges = ring.map((p, i) => [p, ring[(i + 1) % n]]);
    let kind = edges.map((e) => axis(e));
    kind = kind.map((k, i) => (k !== "C" && len(edges[i]) < 1.0 && kind[(i - 1 + n) % n] === "C" && kind[(i + 1) % n] === "C" ? "C" : k));
    if (kind.every((k) => k === "C")) return ring.map((p) => [...p]);
    let s = 0;
    if (new Set(kind).size > 1) s = kind.findIndex((k, i) => k !== kind[(i - 1 + n) % n]);
    edges = [...edges.slice(s), ...edges.slice(0, s)];
    kind = [...kind.slice(s), ...kind.slice(0, s)];
    const group = (pairs) => {
      const out = [];
      for (const [k, e] of pairs) {
        if (out.length && out[out.length - 1].k === k) out[out.length - 1].es.push(e);
        else out.push({ k, es: [e] });
      }
      return out;
    };
    let runs = group(edges.map((e, i) => [kind[i], e]));
    for (const r of runs) if (r.k === "C" && sum(r.es, len) < short) r.k = "X";
    runs = group(runs.flatMap((r) => r.es.map((e) => [r.k === "X" ? axis(e, true) : r.k, e])));
    if (runs.length > 1 && runs[0].k === runs[runs.length - 1].k) {
      runs[0].es = [...runs[runs.length - 1].es, ...runs[0].es];
      runs.pop();
    }
    const coord = (r) => sum(r.es, (e) => (r.k === "H" ? (e[0][1] + e[1][1]) / 2 : (e[0][0] + e[1][0]) / 2) * len(e)) / Math.max(1e-9, sum(r.es, len));
    const sense = (r) => (r.k === "H" ? sum(r.es, (e) => e[1][0] - e[0][0]) : sum(r.es, (e) => e[1][1] - e[0][1])) > 0;
    let changed = true;
    while (changed && runs.length > 4) {
      changed = false;
      const m = runs.length, at = (i) => runs[((i % m) + m) % m];
      for (let i = 0; i < m; i++) {
        const a = at(i - 1), b = at(i), c = at(i + 1), z = at(i - 2), d = at(i + 2);
        const back = (r, top) => r.k === b.k && sense(r) !== sense(b) && sum(top.es, len) < step;
        if (back(d, c) || back(z, a)) continue;
        if (b.k !== "C" && a.k === c.k && a.k !== "C" && a.k !== b.k && sense(a) === sense(c)
            && sum(b.es, len) < step && Math.abs(coord(a) - coord(c)) < step && a !== c) {
          a.es = [...a.es, ...b.es, ...c.es];
          runs = runs.filter((r) => r !== b && r !== c);
          changed = true;
          break;
        }
      }
    }
    for (const r of runs) if (r.k !== "C") r.c = Math.round(coord(r) / grid) * grid;
    const on = (r, p) => (r.k === "H" ? [p[0], r.c] : [r.c, p[1]]);
    const out = [];
    runs.forEach((r, i) => {
      const nxt = runs[(i + 1) % runs.length];
      if (r.k === "C") r.es.slice(0, -1).forEach((e) => out.push(e[1]));
      const end = r.es[r.es.length - 1][1];
      if (r.k !== "C" && nxt.k !== "C") {
        if (r.k !== nxt.k) { const [h, v] = r.k === "H" ? [r, nxt] : [nxt, r]; out.push([v.c, h.c]); }
      } else if (r.k !== "C") out.push(on(r, end));
      else out.push(on(nxt, end));
    });
    return dropCollinear(out.map(([x, z]) => [Math.round(x * 1000) / 1000, Math.round(z * 1000) / 1000]));
  }

  // 編集モードの吸着：前後の頂点と x か z が near 以内ならその値に揃え（直角の角）、揃わない軸は grid に寄せる
  function snapVertex(p, prev, next, { near = 0.3, grid = 0.5 } = {}) {
    const pick = (i) => {
      const cands = [prev, next].filter(Boolean).map((q) => q[i]).filter((v) => Math.abs(v - p[i]) <= near);
      if (cands.length) return cands.reduce((a, b) => (Math.abs(a - p[i]) <= Math.abs(b - p[i]) ? a : b));
      return Math.round(p[i] / grid) * grid;
    };
    return [pick(0), pick(1)];
  }

  // 選んだ丸 o から見える範囲（半径 radius の円の中だけ正しい）の多角形。外周と壁の辺のうち円にかかるものについて、
  // 各頂点の方向とそのわずか左右、ほかに 3 度おきへ線を引き、最初に当たる辺までの点を角度の順につなぐ。
  // 当たらない線は円の少し外で止める（円での切り抜きは描く側で行う）。射線の判定（blocked）と同じ辺を使う
  function visibility(o, map, radius = 25) {
    const R = radius * 1.05, segs = [], angles = [];
    for (const r of rings(map))
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = r[j], b = r[i], q = nearestOnSeg(o, a, b);
        if (Math.hypot(q[0] - o[0], q[1] - o[1]) > R) continue;
        segs.push([a, b]);
        for (const v of [a, b]) {
          const t = Math.atan2(v[1] - o[1], v[0] - o[0]);
          angles.push(t - 1e-4, t, t + 1e-4);
        }
      }
    for (let d = 0; d < 360; d += 3) angles.push((d * Math.PI) / 180 - Math.PI);
    angles.sort((x, y) => x - y);
    return angles.map((t) => {
      const dx = Math.cos(t), dz = Math.sin(t);
      let best = R;
      for (const [a, b] of segs) {
        // o + s(dx, dz) と a + u(b − a) の交点
        const ex = b[0] - a[0], ez = b[1] - a[1], den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-12) continue;
        const wx = a[0] - o[0], wz = a[1] - o[1];
        const s = (wx * ez - wz * ex) / den, u = (wx * dz - wz * dx) / den;
        if (s > 1e-9 && u >= 0 && u <= 1 && s < best) best = s;
      }
      return [o[0] + dx * best, o[1] + dz * best];
    });
  }

  // 前後の頂点を結ぶ線分から tol 以内にある頂点（直線の途中）と、次の頂点と tol 以内に重なる頂点を落とす。
  // 落とすと前後が変わるので、落とすものが無くなるまで繰り返す。輪は 3 点より減らさない
  function prune(ring, tol = 0.05) {
    let r = ring.map((p) => [...p]), changed = true;
    while (changed && r.length > 3) {
      changed = false;
      for (let i = 0; i < r.length && r.length > 3; i++) {
        const a = r[(i - 1 + r.length) % r.length], b = r[i], c = r[(i + 1) % r.length];
        const q = nearestOnSeg(b, a, c);
        if (Math.hypot(b[0] - c[0], b[1] - c[1]) <= tol || Math.hypot(b[0] - q[0], b[1] - q[1]) <= tol) {
          r.splice(i, 1);
          changed = true;
          i--;
        }
      }
    }
    return r;
  }

  const Geom = { prune, visibility, straighten, snapVertex, segCross, inRing, onFloor, blocked, edgeDist, pushOut, laneAt, encodeState, parseState, placeTeams };
  if (typeof module !== "undefined" && module.exports) module.exports = Geom;
  else root.Geom = Geom;
})(this);
