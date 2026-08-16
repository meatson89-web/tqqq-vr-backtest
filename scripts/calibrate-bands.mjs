// 모니터 과열선(UP_DISP) 보정.
//
// 배경 — 모니터의 이격도와 매도 전략의 이격도는 서로 다른 값이다.
//   전략(backtest.js): TQQQ 종가 vs TQQQ 180일선, 편차 % 표기.  매도 = +40% 초과
//   모니터(compute.js): QQQ 종가 vs QQQ  180일선, 비율 % 표기.  과열 = 115 이상
// 둘을 같은 잣대에 올려놓고, 매도 트리거와 맞는 과열선을 찾는다.
//
// 성능 지표는 화면 SIGPERF 표와 같은 정의를 쓴다.
//   고점 포착률 = 사이클 고점 13개 중, 고점 직전 W일 안에 신호가 한 번이라도 켜진 비율
//   밴드 체류율 = 전체 거래일 중 신호가 켜져 있던 비율
//   효율        = 포착률 ÷ 체류율
//
// 실행: node scripts/calibrate-overheat.mjs

import tqqqRaw from '../src/data/tqqq.json' with { type: 'json' };
import qqqRaw from '../src/data/qqq.json' with { type: 'json' };
import * as M from '../src/monitor/compute.js';

const pct = (x) => +(x * 100).toFixed(1);

// ── 시계열 ────────────────────────────────────────────────────────────
const rows = M.buildSeries(tqqqRaw, qqqRaw);
M.addDrawdown(rows);

const qCloses = rows.map(r => r.q);
const tCloses = rows.map(r => r.px);

/** 비율 표기 이격도 (100 = 이동평균선 위) */
const dispRatio = (closes, n) => {
  const ma = M.sma(closes.map(c => (c == null ? 0 : c)), n);
  return closes.map((c, i) => (c == null || !ma[i] ? null : (c / ma[i]) * 100));
};

// TQQQ는 상장 전 구간이 null이라 SMA를 따로 돌린다(널을 0으로 채우면 안 됨).
const smaSkipNull = (arr, n) => {
  const out = new Array(arr.length).fill(null);
  const buf = [];
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] == null) continue;
    buf.push(arr[i]); s += arr[i];
    if (buf.length > n) s -= buf.shift();
    if (buf.length === n) out[i] = s / n;
  }
  return out;
};

const maT180 = smaSkipNull(tCloses, 180);
const dispT180 = tCloses.map((c, i) => (c == null || !maT180[i] ? null : (c / maT180[i]) * 100));
const dispQ180 = dispRatio(qCloses, 180);
const dispQ200 = dispRatio(qCloses, 200);
const rsi = M.wilderRsi(tCloses, 14).map(v => (v == null ? null : +v.toFixed(1)));

// 지표를 rows에 얹어 사이클을 찾는다 (findCycles는 dd만 본다)
M.addIndicators(rows, 180, 14);
const cycles = M.findCycles(rows);
const pos = new Map(rows.map((r, i) => [r.ymd, i]));
const peakIdx = cycles.map(c => pos.get(c.pk.ymd));

// 평가 대상 = TQQQ 상장 이후. TQQQ 자체 180일선은 상장 +180거래일(2010-10말)
// 부터 생기므로 그 전 구간은 "신호 꺼짐"으로 본다(전략도 그때는 못 판다).
const evalIdx = rows.map((r, i) => i).filter(i =>
  tCloses[i] != null && dispQ180[i] != null && rsi[i] != null);

// 직전 사이클 저점(첫 사이클은 평가 시작점)부터 고점까지가 '상승 구간'
const troughIdx = cycles.map(c => pos.get(c.tr.ymd));
const rallyStart = peakIdx.map((p, k) => (k === 0 ? evalIdx[0] : troughIdx[k - 1]));

// ── 성능 계산 ─────────────────────────────────────────────────────────
// mode 'W'     : 고점 직전 W거래일 안에 신호가 켜졌으면 포착
// mode 'rally' : 직전 저점~고점 상승 구간 안에 켜졌으면 포착
const perf = (onFn, W, mode = 'W') => {
  const on = evalIdx.filter(onFn);
  const onSet = new Set(on);
  let cap = 0;
  for (let k = 0; k < peakIdx.length; k++) {
    const p = peakIdx[k];
    const from = mode === 'rally' ? rallyStart[k] : Math.max(0, p - W);
    for (let i = from; i <= p; i++) if (onSet.has(i)) { cap++; break; }
  }
  const capPct = pct(cap / peakIdx.length), dwell = pct(on.length / evalIdx.length);
  return { cap, capPct, dwell, eff: +(capPct / dwell).toFixed(1) };
};

// ── 1. 기존 표(SIGPERF)를 재현하는 포착 창 W 찾기 ──────────────────────
// 공표치: 이격도(QQQ,MA200)≥115 AND RSI≥70 → 7/13, RSI 단독 → 10/13,
//         이격도 단독 → 8/13, OR → 11/13
console.log('== 1. 공표 SIGPERF(7/10/8/11)를 재현하는 포착 정의 찾기 (MA200·115 기준) ==');
const probes = [[30, 'W'], [45, 'W'], [60, 'W'], [90, 'W'], [126, 'W'], [180, 'W'], [252, 'W'], [0, 'rally']];
for (const [w, mode] of probes) {
  const a = perf(i => dispQ200[i] >= 115 && rsi[i] >= 70, w, mode);
  const b = perf(i => rsi[i] >= 70, w, mode);
  const c = perf(i => dispQ200[i] >= 115, w, mode);
  const d = perf(i => dispQ200[i] >= 115 || rsi[i] >= 70, w, mode);
  const tag = (a.cap === 7 && b.cap === 10 && c.cap === 8 && d.cap === 11) ? '  <= 공표치 일치' : '';
  const lbl = mode === 'rally' ? '직전저점~고점' : `고점직전 ${w}일`;
  console.log(`${lbl.padEnd(14)}  AND ${a.cap}/13  RSI ${b.cap}/13  이격도 ${c.cap}/13  OR ${d.cap}/13${tag}`);
}
console.log('공표치            AND  7/13  RSI 10/13  이격도  8/13  OR 11/13');
console.log(`체류율(내 계산): AND ${perf(i => dispQ200[i] >= 115 && rsi[i] >= 70, 126).dwell}% (공표 3.4)` +
            ` · RSI ${perf(i => rsi[i] >= 70, 126).dwell}% (공표 12.5)` +
            ` · 이격도 ${perf(i => dispQ200[i] >= 115, 126).dwell}% (공표 10.7)` +
            ` · OR ${perf(i => dispQ200[i] >= 115 || rsi[i] >= 70, 126).dwell}% (공표 19.9)`);

// 포착 창은 7~40거래일 어디로 잡아도 결과가 같다(신호는 사실상 고점 부근에서
// 켜진다). 21일(약 1개월)로 고정한다.
// 공표치와 RSI·OR가 한 칸씩 다른 이유: 2015-07-20 고점의 RSI가 정확히 70.0이라
// 기존 표는 `>70`(초과), 화면 코드(UP_RSI 비교)는 `>=70`(이상)을 쓴다. 여기서는
// 화면 코드와 같은 `>=`로 맞춘다.
const W = 21;

// ── 2. 두 이격도의 관계 ───────────────────────────────────────────────
console.log('\n== 2. 사이클 고점 13개에서 두 이격도 ==');
const f1 = (v) => (v == null ? '   —  ' : v.toFixed(1).padStart(6));
console.log('고점일        QQQ180  QQQ200  TQQQ180  전략매도선(140) 도달?  RSI');
for (const c of cycles) {
  const i = pos.get(c.pk.ymd);
  console.log(`${c.pk.ymd}  ${f1(dispQ180[i])}  ${f1(dispQ200[i])}  ${f1(dispT180[i])}` +
              `   ${dispT180[i] == null ? '- (180일선 미형성)' : dispT180[i] >= 140 ? 'O' : 'X'}`.padEnd(26) +
              `  ${rsi[i]}`);
}

// TQQQ180 = 140 인 날들의 QQQ180 분포 → 환산선
const near = evalIdx.filter(i => dispT180[i] != null && dispT180[i] >= 139 && dispT180[i] <= 141)
  .map(i => dispQ180[i]);
near.sort((a, b) => a - b);
const med = near.length ? near[Math.floor(near.length / 2)] : NaN;
console.log(`\nTQQQ180 이격도가 딱 140(=+40%)인 날 ${near.length}일의 QQQ180 이격도:`);
console.log(`  중앙 ${med.toFixed(1)} · 하위25% ${near[Math.floor(near.length * .25)]?.toFixed(1)}` +
            ` · 상위25% ${near[Math.floor(near.length * .75)]?.toFixed(1)}` +
            ` · 범위 ${near[0]?.toFixed(1)}~${near[near.length - 1]?.toFixed(1)}`);

// 회귀: QQQ180 ≈ a + b*TQQQ180
const both = evalIdx.filter(i => dispT180[i] != null);
const xs = both.map(i => dispT180[i]), ys = both.map(i => dispQ180[i]);
const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
const b1 = xs.reduce((s, v, k) => s + (v - mx) * (ys[k] - my), 0) / xs.reduce((s, v) => s + (v - mx) ** 2, 0);
const a1 = my - b1 * mx;
const ss = ys.reduce((s, v, k) => s + (v - (a1 + b1 * xs[k])) ** 2, 0);
const st = ys.reduce((s, v) => s + (v - my) ** 2, 0);
console.log(`회귀 QQQ180 = ${a1.toFixed(2)} + ${b1.toFixed(4)}·TQQQ180  (R²=${(1 - ss / st).toFixed(3)})` +
            `  → TQQQ180 140 일 때 QQQ180 ${(a1 + b1 * 140).toFixed(1)}`);

// ── 3. 임계선 스윕 ────────────────────────────────────────────────────
const sweep = (label, arr, lo, hi, step) => {
  console.log(`\n== 3. ${label} 단독 임계선 스윕 (포착창 ${W}일) ==`);
  console.log('임계   포착      체류    효율');
  for (let t = lo; t <= hi + 1e-9; t += step) {
    const p = perf(i => arr[i] != null && arr[i] >= t, W);
    console.log(`${t.toFixed(0).padStart(4)}  ${String(p.cap).padStart(2)}/13 ${String(p.capPct).padStart(5)}%  ${String(p.dwell).padStart(5)}%  ${String(p.eff).padStart(5)}`);
  }
};
sweep('QQQ 180일 이격도', dispQ180, 108, 124, 2);
sweep('TQQQ 180일 이격도', dispT180, 120, 160, 5);

// ── 4. 후보 과열선 비교 (RSI 70 AND 조합) ─────────────────────────────
console.log(`\n== 4. 후보 비교 — 이격도 AND RSI≥70 (포착창 ${W}일) ==`);
const cands = [
  ['QQQ200 ≥ 115 (기존 — 200일선 기준)', i => dispQ200[i] >= 115],
  ['QQQ180 ≥ 115 (상수 그대로 두면)', i => dispQ180[i] >= 115],
  ['QQQ180 ≥ 114 (전략 +40% 환산)', i => dispQ180[i] >= 114],
  ['QQQ180 ≥ 113', i => dispQ180[i] >= 113],
  ['TQQQ180 ≥ 140 (전략 매도선 그 자체)', i => dispT180[i] != null && dispT180[i] >= 140],
];
console.log('신호                                  포착      체류    효율');
for (const [n, f] of cands) {
  const p = perf(i => f(i) && rsi[i] >= 70, W);
  console.log(`${n.padEnd(36)} ${String(p.cap).padStart(2)}/13 ${String(p.capPct).padStart(5)}%  ${String(p.dwell).padStart(5)}%  ${String(p.eff).padStart(5)}`);
}
console.log('\n(참고) 이격도 단독');
for (const [n, f] of cands) {
  const p = perf(f, W);
  console.log(`${n.padEnd(36)} ${String(p.cap).padStart(2)}/13 ${String(p.capPct).padStart(5)}%  ${String(p.dwell).padStart(5)}%  ${String(p.eff).padStart(5)}`);
}

// ── 5. 고점/저점 실측 분포 (MA180 기준) ───────────────────────────────
console.log('\n== 5. MA180 기준 실측 분포 ==');
const stat = (idxs, arr) => {
  const v = idxs.map(i => arr[i]).filter(x => x != null).sort((a, b) => a - b);
  return `중앙 ${v[Math.floor(v.length / 2)].toFixed(1)} · 최저 ${v[0].toFixed(1)} · 최고 ${v[v.length - 1].toFixed(1)}`;
};
console.log(`고점 QQQ180 이격도  ${stat(peakIdx, dispQ180)}`);
console.log(`저점 QQQ180 이격도  ${stat(troughIdx, dispQ180)}   (현행 과매도선 DN_DISP=90)`);
console.log(`고점 QQQ200 이격도  ${stat(peakIdx, dispQ200)}`);

// ── 6. 화면 SIGPERF 표 교체본 (QQQ180 기준, 포착창 126일) ──────────────
console.log(`\n== 6. SIGPERF 표 교체본 — QQQ 180일 이격도 기준, 포착창 ${W}일 ==`);
const UP = 114;
const adaptive = (i) => { // 국면선: 직전 6개월 QQQ 상승률로 예상 고점 이격도
  if (i < 126 || rows[i].peakline == null) return Infinity;
  return rows[i].peakline;
};
M.addPeakLines(rows, M.regimeFit(rows, cycles));
const table = [
  [`고정: 이격도≥${UP} AND RSI≥70`, i => dispQ180[i] >= UP && rsi[i] >= 70],
  ['혼합: 이격도 국면선 AND RSI≥70', i => dispQ180[i] >= adaptive(i) && rsi[i] >= 70],
  ['적응형 AND (margin 0)', i => dispQ180[i] >= adaptive(i)],
  ['RSI ≥70 단독', i => rsi[i] >= 70],
  [`이격도 ≥${UP}% 단독`, i => dispQ180[i] >= UP],
  [`고정: 이격도≥${UP} OR RSI≥70`, i => dispQ180[i] >= UP || rsi[i] >= 70],
];
const scored = table.map(([n, f]) => ({ n, ...perf(f, W) })).sort((a, b) => b.eff - a.eff);
console.log('신호                                포착    체류    효율');
for (const r of scored) {
  console.log(`${r.n.padEnd(34)} ${String(r.capPct).padStart(5)}%  ${String(r.dwell).padStart(5)}%  ${String(r.eff).padStart(5)}`);
}
console.log('\nSIGPERF 배열 붙여넣기용:');
for (const r of scored) console.log(`  ['${r.n}', ${r.capPct}, ${r.dwell}, ${r.eff}, ${r === scored[0]}],`);

// ── 7. 현재 값 ────────────────────────────────────────────────────────
const last = evalIdx[evalIdx.length - 1];
console.log(`\n== 7. 현재 (${rows[last].ymd}) ==`);
console.log(`QQQ180 이격도 ${dispQ180[last].toFixed(1)} · TQQQ180 이격도 ${dispT180[last].toFixed(1)}` +
            ` (전략 표기 +${(dispT180[last] - 100).toFixed(1)}%, 매도선 +40%) · TQQQ RSI ${rsi[last]}`);
