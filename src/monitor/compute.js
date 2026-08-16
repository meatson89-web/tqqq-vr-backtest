// TQQQ 모니터링 — 원 종가에서 모든 지표를 계산한다.
// 데이터는 tqqq.json / qqq.json (자동 갱신)만 쓰고, 파생값은 전부 여기서 만든다.
// 그래서 데이터가 갱신되면 낙폭·사이클·회귀식까지 자동으로 따라 움직인다.

export const MDD_TH = -30;   // 사이클로 셀 최소 낙폭(%)
export const DEEP_TH = -40;  // 이보다 깊으면 '깊은 낙폭'
// 과열 이격도 기준선. 200일선 시절의 115를 180일선으로 옮긴 값 —
// scripts/calibrate-overheat.mjs 로 재보정했고 근거 세 가지가 모두 114로 모인다.
//   1) QQQ180≥114 는 옛 QQQ200≥115 와 성능이 같다 (고점 7/13·체류 3.5%·효율 15.4)
//   2) 전략 매도선(TQQQ 180일 이격도 +40%)에 걸린 날의 QQQ180 이격도 중앙값 114.1
//   3) 사이클 고점 13개의 QQQ180 이격도 중앙값 114.7
// 115를 그대로 두면 같은 조합의 고점 포착이 7/13 → 5/13으로 떨어진다.
export const UP_DISP = 114;
export const UP_RSI = 70;    // 과열 RSI
export const DN_DISP = 90;   // 깊은 저점 이격도
export const DN_RSI = 33;    // 과매도 RSI

export const toT = (ymd) => {
  const y = +ymd.slice(0, 4), m = +ymd.slice(5, 7), d = +ymd.slice(8, 10);
  return y + ((m - 1) * 30.44 + d) / 365.25;
};

export function sma(arr, n) {
  const out = new Array(arr.length).fill(null);
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    s += arr[i];
    if (i >= n) s -= arr[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

// Wilder RSI. 값이 null인 구간(상장 전)은 건너뛴다.
export function wilderRsi(px, n = 14) {
  const out = new Array(px.length).fill(null);
  let up = 0, dn = 0, prev = null, cnt = 0;
  for (let i = 0; i < px.length; i++) {
    const p = px[i];
    if (p == null) continue;
    if (prev === null) { prev = p; continue; }
    const ch = p - prev; prev = p;
    const u = Math.max(ch, 0), d = Math.max(-ch, 0);
    cnt++;
    if (cnt <= n) { up += u / n; dn += d / n; }
    else { up = (up * (n - 1) + u) / n; dn = (dn * (n - 1) + d) / n; }
    if (cnt >= n) out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
  }
  return out;
}

/** tqqq/qqq 원본을 날짜 기준으로 합쳐 기본 시계열을 만든다 */
export function buildSeries(tqqqRows, qqqRows) {
  const qMap = new Map(qqqRows);
  const rows = [];
  // QQQ 기준으로 훑되 TQQQ 상장 이후만 지표 대상
  for (const [ymd, qv] of qqqRows) {
    rows.push({ ymd, t: toT(ymd), q: qv, px: null });
  }
  const idx = new Map(rows.map((r, i) => [r.ymd, i]));
  for (const [ymd, tv] of tqqqRows) {
    const i = idx.get(ymd);
    if (i != null) rows[i].px = tv;
    else if (qMap.has(ymd)) { /* 이론상 없음 */ }
  }
  return rows;
}

/** 낙폭·성장지수 (TQQQ 구간만) */
export function addDrawdown(rows) {
  let peak = -Infinity, base = null;
  for (const r of rows) {
    if (r.px == null) { r.dd = null; r.growth = null; continue; }
    if (base === null) base = r.px;
    peak = Math.max(peak, r.px);
    r.dd = +((r.px / peak - 1) * 100).toFixed(2);
    r.growth = +(r.px / base * 100).toFixed(1);
  }
  return rows;
}

/** 이격도·RSI (MA 기간 가변) */
export function addIndicators(rows, ma = 180, rsiN = 14) {
  const m = sma(rows.map(r => r.q), ma);
  const rs = wilderRsi(rows.map(r => r.px), rsiN);
  rows.forEach((r, i) => {
    r.disp = m[i] ? +(r.q / m[i] * 100).toFixed(2) : null;
    r.rsi = rs[i] == null ? null : +rs[i].toFixed(1);
  });
  return rows;
}

/** -MDD_TH 이상 하락 사이클 검출 (고점/저점 일자 + 그 시점 지표) */
export function findCycles(rows, th = MDD_TH) {
  const v = rows.filter(r => r.px != null);
  const out = [];
  let inx = false, pkIdx = 0, trIdx = 0, trVal = 0;
  let runPeak = -Infinity, runPeakIdx = 0;
  for (let i = 0; i < v.length; i++) {
    const r = v[i];
    if (r.px > runPeak) { runPeak = r.px; runPeakIdx = i; }
    if (!inx && r.dd < -0.001) { inx = true; pkIdx = runPeakIdx; trVal = r.dd; trIdx = i; }
    else if (inx) {
      if (r.dd < trVal) { trVal = r.dd; trIdx = i; }
      if (r.dd > -0.001) {
        if (trVal <= th) out.push({ pk: v[pkIdx], tr: v[trIdx], mdd: +trVal.toFixed(1), end: r, recDays: dayDiff(v[trIdx].ymd, r.ymd) });
        inx = false;
      }
    }
  }
  if (inx && trVal <= th) out.push({ pk: v[pkIdx], tr: v[trIdx], mdd: +trVal.toFixed(1), end: null, recDays: null });
  return out.map((c, i) => ({ ...c, no: i + 1, deep: c.mdd <= DEEP_TH }));
}

const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

/** 고점 지표 ~ 직전 6개월 QQQ 상승률 단순회귀 */
export function regimeFit(rows, cycles) {
  const idx = new Map(rows.map((r, i) => [r.ymd, i]));
  const pts = [];
  for (const c of cycles) {
    const i = idx.get(c.pk.ymd);
    if (i == null || i < 126) continue;
    const x = (rows[i].q / rows[i - 126].q - 1) * 100;
    if (c.pk.disp == null || c.pk.rsi == null) continue;
    pts.push({ date: c.pk.ymd, x: +x.toFixed(1), d: c.pk.disp, r: c.pk.rsi, mdd: c.mdd, deep: c.deep });
  }
  const fit = (key) => {
    const n = pts.length;
    const mx = pts.reduce((s, p) => s + p.x, 0) / n;
    const my = pts.reduce((s, p) => s + p[key], 0) / n;
    const b = pts.reduce((s, p) => s + (p.x - mx) * (p[key] - my), 0)
            / pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
    const a = my - b * mx;
    const ss = pts.reduce((s, p) => s + (p[key] - (a + b * p.x)) ** 2, 0);
    const st = pts.reduce((s, p) => s + (p[key] - my) ** 2, 0);
    return { a: +a.toFixed(2), b: +b.toFixed(4), r2: +(1 - ss / st).toFixed(3) };
  };
  const last = rows[rows.length - 1];
  const nowR = +((last.q / rows[rows.length - 1 - 126].q - 1) * 100).toFixed(1);
  const d = fit('d'), r = fit('r');
  return {
    pts, d, r, now_r126: nowR,
    now_disp: last.disp, now_rsi: last.rsi,
    now_pred_d: +(d.a + d.b * nowR).toFixed(1),
    now_pred_r: +(r.a + r.b * nowR).toFixed(1),
  };
}

/**
 * 사이클 고점/저점 마커를 짧은 배열로 뽑는다.
 * 예전에는 본 데이터 행마다 마커 필드를 붙이고 Scatter로 그렸는데,
 * Scatter는 값이 null인 행까지 전부 레이어를 만들기 때문에 점 26개를 찍자고
 * 행 수(4천여)×계열 수만큼 빈 노드가 생겨 차트가 심하게 버벅였다.
 * 마커는 ReferenceDot으로 따로 그린다 — 툴팁 활성 인덱스에도 끼어들지 않는다.
 * disp·rsi는 addIndicators 뒤에 호출해야 현재 MA 기준 값이 들어간다.
 */
export function cycleMarks(cycles) {
  const out = [];
  for (const c of cycles) {
    for (const [kind, r] of [['peak', c.pk], ['trough', c.tr]]) {
      out.push({
        kind, deep: c.deep, t: r.t, ymd: r.ymd,
        px: r.px, growth: r.growth, disp: r.disp, rsi: r.rsi,
      });
    }
  }
  return out;
}

/** 국면 예상 고점선을 각 행에 붙인다 */
export function addPeakLines(rows, fit) {
  rows.forEach((r, i) => {
    if (i < 126) { r.peakline = r.peakline_r = null; return; }
    const g = (r.q / rows[i - 126].q - 1) * 100;
    r.peakline = +(fit.d.a + fit.d.b * g).toFixed(2);
    r.peakline_r = +(fit.r.a + fit.r.b * g).toFixed(2);
  });
  return rows;
}

/** 고점/저점 지표 요약 + 밴드 포착률 */
export function bandStats(cycles) {
  const pk = cycles.map(c => c.pk), tr = cycles.map(c => c.tr);
  const st = (arr, k) => {
    const v = arr.map(x => x[k]).filter(x => x != null).sort((a, b) => a - b);
    return { min: +v[0].toFixed(1), max: +v[v.length - 1].toFixed(1), med: +median(v).toFixed(1) };
  };
  const deep = cycles.filter(c => c.deep).map(c => c.tr);
  const shallow = cycles.filter(c => !c.deep).map(c => c.tr);
  const rate = (arr, k, cmp) => Math.round(arr.filter(x => cmp(x[k])).length / arr.length * 100);
  return {
    n: cycles.length, n_deep: deep.length, mdd_th: MDD_TH, deep_th: DEEP_TH,
    up_disp: UP_DISP, up_rsi: UP_RSI, dn_disp: DN_DISP, dn_rsi: DN_RSI,
    peak_disp: st(pk, 'disp'), peak_rsi: st(pk, 'rsi'),
    trough_disp: st(tr, 'disp'), trough_rsi: st(tr, 'rsi'),
    deep_disp: st(deep, 'disp'), shallow_disp: st(shallow, 'disp'),
    hit_up_disp: rate(pk, 'disp', v => v >= UP_DISP),
    hit_up_rsi: rate(pk, 'rsi', v => v >= UP_RSI),
    hit_dn_disp: rate(tr, 'disp', v => v <= DN_DISP),
    hit_dn_rsi: rate(tr, 'rsi', v => v <= DN_RSI),
  };
}

const median = (v) => v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;

/** 연도별 요약 */
export function annualStats(rows) {
  const byYear = new Map();
  let prevClose = null;
  for (const r of rows) {
    if (r.px == null) continue;
    const y = +r.ymd.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, { y, first: prevClose ?? r.px, last: r.px, ddMin: 0, dispMin: Infinity, dispMax: -Infinity, rsiMin: 100, rsiMax: 0 });
    const o = byYear.get(y);
    o.last = r.px;
    if (r.dd != null) o.ddMin = Math.min(o.ddMin, r.dd);
    if (r.disp != null) { o.dispMin = Math.min(o.dispMin, r.disp); o.dispMax = Math.max(o.dispMax, r.disp); }
    if (r.rsi != null) { o.rsiMin = Math.min(o.rsiMin, r.rsi); o.rsiMax = Math.max(o.rsiMax, r.rsi); }
    prevClose = r.px;
  }
  return [...byYear.values()].map(o => ({ ...o, ret: +((o.last / o.first - 1) * 100).toFixed(1) }));
}

/** 현재 상태 요약 */
export function nowStats(rows) {
  const v = rows.filter(r => r.px != null);
  const last = v[v.length - 1], first = v[0];
  const years = (new Date(last.ymd) - new Date(first.ymd)) / 86400000 / 365.25;
  const allDd = Math.min(...v.map(r => r.dd));
  const dispSorted = v.map(r => r.disp).filter(x => x != null).sort((a, b) => a - b);
  const pctRank = (arr, x) => Math.round(arr.filter(v2 => v2 < x).length / arr.length * 100);
  return {
    date: last.ymd, price: last.px, growth: Math.round(last.growth),
    dd: +last.dd.toFixed(1), disp: +last.disp.toFixed(1), rsi: last.rsi,
    mdd_all: +allDd.toFixed(1), years: +years.toFixed(1),
    cagr: +(((last.px / first.px) ** (1 / years) - 1) * 100).toFixed(1),
    disp_pct: pctRank(dispSorted, last.disp),
    combo: last.disp >= UP_DISP && last.rsi >= UP_RSI,
  };
}

/** 3배 시뮬 (QQQ 일간수익률×3 − 드래그). 드래그는 실측 TQQQ로 역산 */
export function simulate3x(rows) {
  const withBoth = rows.filter(r => r.px != null);
  let simR = 1, actR = 1, n = 0;
  for (let i = 1; i < withBoth.length; i++) {
    const gq = withBoth[i].q / withBoth[i - 1].q - 1;
    const gt = withBoth[i].px / withBoth[i - 1].px - 1;
    simR *= 1 + 3 * gq; actR *= 1 + gt; n++;
  }
  const drag = Math.pow(simR / actR, 1 / n) - 1;
  const out = [];
  let sim = 1, q1 = 1;
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) {
      const g = rows[i].q / rows[i - 1].q - 1;
      sim *= 1 + 3 * g - drag;
      q1 *= 1 + g;
    }
    out.push({ t: rows[i].t, ymd: rows[i].ymd, sim: +(sim * 100).toPrecision(5), q1: +(q1 * 100).toFixed(1) });
  }
  return { series: out, dragAnnual: +((Math.pow(1 + drag, 252) - 1) * 100).toFixed(2) };
}

/** 롤링 보유수익률 분포 */
export function rollingStats(vals, years) {
  const d = Math.round(years * 252);
  const r = [];
  for (let i = 0; i + d < vals.length; i++) r.push(vals[i + d] / vals[i] - 1);
  if (!r.length) return null;
  r.sort((a, b) => a - b);
  const q = (p) => r[Math.floor(r.length * p)];
  const pc = (x) => +(x * 100).toFixed(0);
  return {
    n: years, cnt: r.length, worst: pc(r[0]), p25: pc(q(0.25)), med: pc(q(0.5)),
    p75: pc(q(0.75)), best: pc(r[r.length - 1]),
    loss: Math.round(r.filter(x => x < 0).length / r.length * 100),
    annmed: +((Math.pow(1 + q(0.5), 1 / years) - 1) * 100).toFixed(1),
    annp25: +((Math.pow(1 + q(0.25), 1 / years) - 1) * 100).toFixed(1),
  };
}
