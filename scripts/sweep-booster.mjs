// 부스터 트리거 재검토: lookback × drawdown 2차원 + RSI AND 조건
//   node scripts/sweep-booster.mjs
//
// 현재 트리거는 "최근 60거래일 고점 대비 -30% 이하". 두 값은 독립이 아니다 —
// lookback을 늘리면 기준 고점이 높아져 같은 -30%도 훨씬 쉽게 걸린다. 그래서
// 한 축씩 훑지 말고 2차원으로 봐야 한다.
// RSI AND 조건은 "낙폭은 컸지만 이미 반등이 시작된 주"를 걸러내자는 아이디어다.
// 다만 조건을 하나 더 걸면 발동이 줄어들 뿐인데 그게 좋아 보일 수 있으므로,
// "같은 발동 빈도를 낙폭 기준만 조여서 만든 대조군"과 반드시 비교한다.

import fs from 'node:fs';
import { runFinalBacktest, getRollingWindows, DEFAULT_SETTINGS, TQQQ_DATA, dataForSource } from '../src/lib/backtest.js';

const QLD_DATA = JSON.parse(fs.readFileSync(new URL('../src/data/qld.json', import.meta.url), 'utf8'));
const B = DEFAULT_SETTINGS;
const wins = getRollingWindows(B);
const indWins = wins.filter(w => w.independent);

const pct = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const fmtB = v => `${(v / 1e8).toFixed(2)}억`;
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
function boot(xs, blockLen = 5, B2 = 4000) {
  const n = xs.length; let seed = 20260808;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const ms = [];
  for (let b = 0; b < B2; b++) {
    let s = 0, c = 0;
    while (c < n) { const p = Math.floor(rnd() * n); for (let k = 0; k < blockLen && c < n; k++, c++) s += xs[(p + k) % n]; }
    ms.push(s / n);
  }
  ms.sort((a, b) => a - b);
  return [ms[Math.floor(B2 * 0.025)], ms[Math.floor(B2 * 0.975)]];
}

const cache = new Map();
function st(w, ov) {
  const k = `${w.id}|${JSON.stringify(ov)}`;
  if (!cache.has(k)) cache.set(k, runFinalBacktest(w.startDate, w.endDate, { ...B, ...ov }, dataForSource(w.source)).stats);
  return cache.get(k);
}
const full = ov => runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], { ...B, ...ov }).stats;
const baseOf = w => st(w, {});

function evaluate(ov) {
  const ds = wins.map(w => (st(w, ov).finalAfterTax / baseOf(w).finalAfterTax - 1) * 100);
  const ind = wins.map((w, i) => [w, ds[i]]).filter(([w]) => w.independent).map(([, d]) => d);
  const f = full(ov), fb = full({});
  return {
    m: mean(ds), md: median(ds), win: ds.filter(x => x > 0).length, ds,
    ind: mean(ind), indWin: ind.filter(x => x > 0).length,
    fullDelta: (f.finalAfterTax / fb.finalAfterTax - 1) * 100,
    fullAfterTax: f.finalAfterTax, mdd: f.mdd, mddDelta: f.mdd - fb.mdd,
    weeks: f.boostedWeeks, totalWeeks: f.totalWeeks,
  };
}

console.log(`창 ${wins.length}개 (독립 ${indWins.length}개). 기준선 = 현재 설정 (lookback 60 / -30% / 재투자 60%)`);
const fb = full({});
console.log(`기준선 전체구간: ${fmtB(fb.finalAfterTax)}  MDD ${fb.mdd.toFixed(1)}%  부스터 ${fb.boostedWeeks}/${fb.totalWeeks}주\n`);

// ── 1. lookback × drawdown 2차원 (23창 평균) ─────────────────────────────
const LB = [40, 60, 90, 120, 180, 250];
const DD = [15, 20, 25, 30, 35, 40, 45, 50];
console.log('=== 1. lookback × 낙폭 — 23창 평균 (기준선 대비 세후) ===');
console.log('lookback'.padEnd(10) + DD.map(d => `-${d}%`.padStart(9)).join(''));
const grid = {};
for (const lb of LB) {
  const row = DD.map(dd => {
    const r = evaluate({ lookback: lb, drawdownPct: dd });
    grid[`${lb}|${dd}`] = r;
    return r;
  });
  console.log(String(lb).padEnd(10) + row.map((r, i) => {
    const cur = lb === 60 && DD[i] === 30;
    return (cur ? `[${pct(r.m)}]` : pct(r.m)).padStart(9);
  }).join(''));
}
console.log('\n=== 1b. 같은 격자 — 부스터 발동 주수 (전체구간 850주 중) ===');
console.log('lookback'.padEnd(10) + DD.map(d => `-${d}%`.padStart(9)).join(''));
for (const lb of LB) {
  console.log(String(lb).padEnd(10) + DD.map(dd => String(grid[`${lb}|${dd}`].weeks).padStart(9)).join(''));
}
console.log('\n=== 1c. 같은 격자 — 전체구간 MDD ===');
console.log('lookback'.padEnd(10) + DD.map(d => `-${d}%`.padStart(9)).join(''));
for (const lb of LB) {
  console.log(String(lb).padEnd(10) + DD.map(dd => `${grid[`${lb}|${dd}`].mdd.toFixed(1)}%`.padStart(9)).join(''));
}

const ranked = Object.entries(grid).map(([k, r]) => ({ k, ...r })).sort((a, b) => b.m - a.m);
console.log('\n상위 8개 (23창 평균 기준):');
console.log('설정'.padEnd(16) + '23창평균 중앙값 개선  독립5창(개선) 전체구간세후   ΔMDD  발동주');
for (const r of ranked.slice(0, 8)) {
  const [lb, dd] = r.k.split('|');
  console.log(`${lb}일 / -${dd}%`.padEnd(16) + pct(r.m).padStart(8) + pct(r.md).padStart(7) +
    `${r.win}/23`.padStart(6) + `${pct(r.ind)}(${r.indWin}/5)`.padStart(14) +
    fmtB(r.fullAfterTax).padStart(12) + `${r.mddDelta >= 0 ? '+' : ''}${r.mddDelta.toFixed(1)}`.padStart(7) + String(r.weeks).padStart(7));
}
const cur = grid['60|30'];
console.log(`현재값 60일/-30%: 평균 ${pct(cur.m)} (정의상 0), 전체 ${fmtB(cur.fullAfterTax)}, 발동 ${cur.weeks}주`);

// ── 2. RSI AND 조건 ──────────────────────────────────────────────────────
console.log('\n=== 2. RSI AND 조건 (lookback 60 / -30% 고정) ===');
console.log('조건'.padEnd(20) + '23창평균 중앙값 개선     95%CI      독립5창(개선) 전체구간세후   ΔMDD  발동주');
const rsiRows = [];
for (const rmax of [null, 55, 50, 45, 40, 35, 30, 25]) {
  const r = evaluate({ boostRsiMax: rmax });
  const [lo, hi] = boot(r.ds);
  rsiRows.push({ rmax, ...r, lo, hi });
  console.log((rmax == null ? 'RSI 조건 없음(현재)' : `RSI ≤ ${rmax}`).padEnd(20) +
    pct(r.m).padStart(8) + pct(r.md).padStart(7) + `${r.win}/23`.padStart(6) +
    `[${lo.toFixed(1)},${hi.toFixed(1)}]`.padStart(14) +
    `${pct(r.ind)}(${r.indWin}/5)`.padStart(14) + fmtB(r.fullAfterTax).padStart(12) +
    `${r.mddDelta >= 0 ? '+' : ''}${r.mddDelta.toFixed(1)}`.padStart(7) + String(r.weeks).padStart(7));
}

// ── 3. 대조군: 같은 발동 빈도를 낙폭만 조여서 만들면? ────────────────────
// RSI 조건이 진짜 정보를 더하는지, 그냥 발동을 줄인 것뿐인지 가른다.
console.log('\n=== 3. 대조군 — 같은 발동 주수를 "낙폭만 조여서" 만들면 ===');
console.log('발동 주수가 비슷한 쌍끼리 비교해야 RSI 조건의 순효과가 보인다.');
console.log('안'.padEnd(26) + '발동주  23창평균  독립5창  전체구간세후');
const ddOnly = [30, 32, 35, 38, 40, 45, 50].map(dd => ({ label: `-${dd}% (RSI조건 없음)`, ov: { drawdownPct: dd } }));
const rows3 = [
  ...ddOnly,
  ...[50, 45, 40, 35, 30].map(rm => ({ label: `-30% AND RSI ≤ ${rm}`, ov: { boostRsiMax: rm } })),
];
for (const { label, ov } of rows3) {
  const r = evaluate(ov);
  console.log(label.padEnd(26) + String(r.weeks).padStart(6) + pct(r.m).padStart(10) +
    pct(r.ind).padStart(9) + fmtB(r.fullAfterTax).padStart(14));
}

// ── 4. 유망 조합 QLD 교차검증 ────────────────────────────────────────────
console.log('\n=== 4. QLD 교차검증 (1년 슬라이드 5년창) ===');
const qWins = [];
for (let s = 0; s + 252 * 5 <= QLD_DATA.length; s += 252) qWins.push([QLD_DATA[s][0], QLD_DATA[s + 252 * 5 - 1][0]]);
const finalists = [
  ['120일 / -30%', { lookback: 120, drawdownPct: 30 }],
  ['180일 / -30%', { lookback: 180, drawdownPct: 30 }],
  ['120일 / -40%', { lookback: 120, drawdownPct: 40 }],
  ['180일 / -45%', { lookback: 180, drawdownPct: 45 }],
  ['60일 / -30% AND RSI≤40', { boostRsiMax: 40 }],
  ['60일 / -30% AND RSI≤30', { boostRsiMax: 30 }],
];
for (const [label, ov] of finalists) {
  const ds = qWins.map(([a, b]) => {
    const bs = runFinalBacktest(a, b, B, QLD_DATA).stats;
    const v = runFinalBacktest(a, b, { ...B, ...ov }, QLD_DATA).stats;
    return (v.finalAfterTax / bs.finalAfterTax - 1) * 100;
  });
  console.log(`  ${label.padEnd(24)} 평균 ${pct(mean(ds)).padStart(7)}  개선 ${ds.filter(x => x > 0).length}/${qWins.length}`);
}
