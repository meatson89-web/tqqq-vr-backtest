// 독립 검증: 부스터 고점기간 60 → 252 변경이 합리적 개선인지
//   node scripts/verify-lookback.mjs
// DEFAULT_SETTINGS 가 이미 252 로 바뀌어 있으므로 기준선을 명시적으로 60 으로 고정한다.
import fs from 'node:fs';
import { runFinalBacktest, getRollingWindows, DEFAULT_SETTINGS, TQQQ_DATA, SIM_DATA } from '../src/lib/backtest.js';

const QLD_DATA = JSON.parse(fs.readFileSync(new URL('../src/data/qld.json', import.meta.url), 'utf8'));

const BASE = { ...DEFAULT_SETTINGS, lookback: 60 };   // ← 기준선 강제
const CAND = { ...DEFAULT_SETTINGS, lookback: 252 };

const E = 1e8;
const eok = v => (v / E).toFixed(2);
const pct = (v, d = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`;
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function bootstrapCI(xs, blockLen, B = 4000, seed0 = 20260807) {
  const n = xs.length;
  let seed = seed0;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const means = [];
  for (let b = 0; b < B; b++) {
    let sum = 0, cnt = 0;
    while (cnt < n) {
      const start = Math.floor(rnd() * n);
      for (let k = 0; k < blockLen && cnt < n; k++, cnt++) sum += xs[(start + k) % n];
    }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(B * 0.025)], means[Math.floor(B * 0.975)]];
}

console.log('데이터 범위: TQQQ', TQQQ_DATA[0][0], '~', TQQQ_DATA.at(-1)[0],
  '| 합성', SIM_DATA[0][0], '~', SIM_DATA.at(-1)[0]);

// ── 1. 전체구간 / 합성 27년 / 내 구간 ────────────────────────────────
console.log('\n=== [1] 단일 구간 세후 총자산 ===');
const runs = [
  ['전체구간 TQQQ 2010~2026', TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], TQQQ_DATA],
  ['합성 27년 1999-03-10~',   '1999-03-10',    '2026-09-02',        SIM_DATA],
  ['내 구간 2021-09~2026-09', '2021-09-01',    '2026-09-01',        TQQQ_DATA],
];
for (const [label, s, e, d] of runs) {
  const b = runFinalBacktest(s, e, BASE, d).stats;
  const v = runFinalBacktest(s, e, CAND, d).stats;
  console.log(`${label.padEnd(26)} 60일 ${eok(b.finalAfterTax).padStart(9)}억  →  252일 ${eok(v.finalAfterTax).padStart(9)}억  ` +
    `${pct((v.finalAfterTax / b.finalAfterTax - 1) * 100).padStart(8)}   MDD ${b.mdd.toFixed(1)}% → ${v.mdd.toFixed(1)}%`);
}

// ── 2. 23창 (사용자 판정 기준) ────────────────────────────────────────
console.log('\n=== [2] 23창 (5년 롤링·1년 슬라이드) 세후 총자산 ===');
const W60 = getRollingWindows(BASE);
function windowCompare(lb) {
  const ws = getRollingWindows({ ...DEFAULT_SETTINGS, lookback: lb });
  const deltas = ws.map((w, i) => (w.stats.finalAfterTax / W60[i].stats.finalAfterTax - 1) * 100);
  let W = 0, L = 0, Z = 0, iW = 0, iL = 0, iZ = 0;
  deltas.forEach((d, i) => {
    if (d > 0.01) W++; else if (d < -0.01) L++; else Z++;
    if (ws[i].independent) { if (d > 0.01) iW++; else if (d < -0.01) iL++; else iZ++; }
  });
  return { ws, deltas, W, L, Z, iW, iL, iZ };
}
console.log(`창 개수 ${W60.length} (독립창 ${W60.filter(w => w.independent).length})`);
for (const lb of [120, 220, 252, 300, 504]) {
  const r = windowCompare(lb);
  const [lo, hi] = bootstrapCI(r.deltas, 5);
  console.log(`\n-- lookback ${lb} --  평균 ${pct(mean(r.deltas))}  중앙 ${pct(median(r.deltas))}  ` +
    `${r.W}승/${r.L}패/${r.Z}무  ◆독립 ${r.iW}승/${r.iL}패/${r.iZ}무  ` +
    `최악 ${pct(Math.min(...r.deltas))}  95%CI [${lo.toFixed(2)}, ${hi.toFixed(2)}]`);
  r.deltas.forEach((d, i) => {
    if (Math.abs(d) < 0.01) return;
    const w = r.ws[i];
    console.log(`   ${w.independent ? '◆' : ' '} ${w.startDate.slice(0, 7)}~${w.endDate.slice(0, 7)}  ${pct(d)}  ` +
      `(${eok(W60[i].stats.finalAfterTax)}억 → ${eok(w.stats.finalAfterTax)}억)`);
  });
}

// ── 3. 46창 검증 프레임 (G1~G4) ───────────────────────────────────────
console.log('\n=== [3] 46창 검증 게이트 (validate.mjs 프레임) ===');
const WIN = 252 * 5, SLIDE = 63;
const windowsOf = data => {
  const out = [];
  for (let s = 0; s + WIN <= data.length; s += SLIDE) out.push([data[s][0], data[s + WIN - 1][0]]);
  return out;
};
const deltasOf = (settings, data) => windowsOf(data).map(([sd, ed]) => {
  const b = runFinalBacktest(sd, ed, BASE, data).stats;
  const v = runFinalBacktest(sd, ed, { ...BASE, ...settings }, data).stats;
  return (v.finalAfterTax / b.finalAfterTax - 1) * 100;
});
const dT = deltasOf({ lookback: 252 }, TQQQ_DATA);
const dQ = deltasOf({ lookback: 252 }, QLD_DATA);
const dS = deltasOf({ lookback: 252 }, SIM_DATA);
const [lo46, hi46] = bootstrapCI(dT, Math.round(WIN / SLIDE));
const fullB = runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], BASE).stats;
const fullV = runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], CAND).stats;
const fullDelta = (fullV.finalAfterTax / fullB.finalAfterTax - 1) * 100;
console.log(`창 수 TQQQ ${dT.length} / QLD ${dQ.length} / 합성 ${dS.length}   블록길이 ${Math.round(WIN / SLIDE)}`);
console.log(`G1 자산하한  중앙 ${pct(median(dT), 1)} & 전체구간 ${pct(fullDelta, 1)}  ≥ -10%  → ${median(dT) >= -10 && fullDelta >= -10 ? '통과' : '미달'}`);
console.log(`G2 개선      평균 ${pct(mean(dT), 1)} > 0                        → ${mean(dT) > 0 ? '통과' : '미달'}`);
console.log(`G3 교차검증  QLD ${pct(mean(dQ), 1)} / 합성 ${pct(mean(dS), 1)}  > -5%      → ${mean(dQ) > -5 && mean(dS) > -5 ? '통과' : '미달'}`);
console.log(`G4 유의성    95%CI [${lo46.toFixed(2)}, ${hi46.toFixed(2)}] 0 제외?         → ${lo46 > 0 || hi46 < 0 ? '통과' : '미달'}`);

// ── 4. lookback 전 구간 스윕 (고원인가 칼끝인가) ──────────────────────
console.log('\n=== [4] lookback 스윕 — 전체구간 / 합성27년 / 23창 ===');
console.log('lb    전체구간(억)  Δ%      합성27년(억)   Δ%      23창평균  최악창   승/패');
for (const lb of [40, 60, 80, 100, 120, 150, 180, 200, 220, 240, 252, 260, 280, 300, 350, 400, 504, 600]) {
  const st = { ...DEFAULT_SETTINGS, lookback: lb };
  const f = runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], st).stats;
  const sm = runFinalBacktest('1999-03-10', '2026-09-02', st, SIM_DATA).stats;
  const smB = runFinalBacktest('1999-03-10', '2026-09-02', BASE, SIM_DATA).stats;
  const r = windowCompare(lb);
  console.log(`${String(lb).padStart(4)}  ${eok(f.finalAfterTax).padStart(11)}  ${pct((f.finalAfterTax / fullB.finalAfterTax - 1) * 100, 1).padStart(7)}` +
    `  ${eok(sm.finalAfterTax).padStart(11)}  ${pct((sm.finalAfterTax / smB.finalAfterTax - 1) * 100, 1).padStart(7)}` +
    `  ${pct(mean(r.deltas)).padStart(8)}  ${pct(Math.min(...r.deltas)).padStart(7)}  ${r.W}/${r.L}`);
}

// ── 5. 부스터 집행 내역 비교 (사건 수준) ──────────────────────────────
console.log('\n=== [5] 합성 27년 부스터 집행 내역 ===');
function trades(lb) {
  const { boostTrades } = runFinalBacktest('1999-03-10', '2026-09-02', { ...DEFAULT_SETTINGS, lookback: lb }, SIM_DATA);
  return boostTrades;
}
const t60 = trades(60), t252 = trades(252);
const set60 = new Set(t60.map(t => t.date)), set252 = new Set(t252.map(t => t.date));
const all = [...new Set([...set60, ...set252])].sort();
console.log('날짜         가격     60일매수    252일매수   전방126일최저  구분');
for (const d of all) {
  const a = t60.find(t => t.date === d), b = t252.find(t => t.date === d);
  const ref = a || b;
  const idx = SIM_DATA.findIndex(([dd]) => dd >= d);
  let min126 = Infinity;
  for (let k = idx; k < Math.min(SIM_DATA.length, idx + 126); k++) min126 = Math.min(min126, SIM_DATA[k][1]);
  const fwd = (min126 - ref.priceUSD) / ref.priceUSD * 100;
  const tag = a && b ? '공통' : (b ? '252만' : '60만');
  console.log(`${d}  $${ref.priceUSD.toFixed(2).padStart(6)}  ${(a ? eok(a.buyAmt) : '-').padStart(9)}억  ` +
    `${(b ? eok(b.buyAmt) : '-').padStart(9)}억  ${pct(fwd, 1).padStart(9)}     ${tag}`);
}
console.log(`집행 횟수: 60일 ${t60.length}회 / 252일 ${t252.length}회`);

// ── 6. 실제 TQQQ 전체구간 부스터 집행 내역 ────────────────────────────
console.log('\n=== [6] 실제 TQQQ 2010~2026 부스터 집행 내역 ===');
function tradesReal(lb) {
  const { boostTrades } = runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], { ...DEFAULT_SETTINGS, lookback: lb });
  return boostTrades;
}
const r60 = tradesReal(60), r252 = tradesReal(252);
const rs60 = new Set(r60.map(t => t.date)), rs252 = new Set(r252.map(t => t.date));
for (const d of [...new Set([...rs60, ...rs252])].sort()) {
  const a = r60.find(t => t.date === d), b = r252.find(t => t.date === d);
  console.log(`${d}  60일 ${(a ? eok(a.buyAmt) : '-').padStart(9)}억   252일 ${(b ? eok(b.buyAmt) : '-').padStart(9)}억   ${a && b ? '공통' : (b ? '252만' : '60만')}`);
}
console.log(`집행 횟수: 60일 ${r60.length}회 / 252일 ${r252.length}회`);
