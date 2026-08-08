// 합성 TQQQ(1999~)로 5년 롤링 윈도우 검증
//   node scripts/opt-rsi-throttle6.mjs
//
// 실제 TQQQ는 2010-02부터라 5년 창이 46개(독립 3개)뿐이고 닷컴·금융위기가 없다.
// QQQ로 역산한 합성 TQQQ는 1999-03부터라 창이 90개, 겹치지 않는 5년이 5개 나온다.
// 다만 합성은 2010년 이후도 실제 데이터를 붙인 게 아니라 QQQ×3−차입비용으로 만든
// "누적수익률만 맞춘" 시계열이다. 그래서 결론을 쓰기 전에 겹치는 구간에서 실제
// TQQQ와 같은 답을 내는지부터 확인한다(0단계). 여기서 갈리면 나머지는 못 믿는다.

import fs from 'node:fs';
import { runFinalBacktest, DEFAULT_SETTINGS, TQQQ_DATA } from '../src/lib/backtest.js';

const SIM = JSON.parse(fs.readFileSync(new URL('../src/data/tqqq_sim.json', import.meta.url), 'utf8'));
const OFF = { ...DEFAULT_SETTINGS, throttleEnabled: false };
const YR = 252, W = YR * 5;

const CAND = [
  ['70↑0% (배포값)', [[70, 0]]],
  ['68↑2.5% 73↑0%', [[68, 2.5], [73, 0]]],
  ['70↑2.5%', [[70, 2.5]]],
  ['상시 2.5% (RSI무관·대조군)', [[0, 2.5]]],
];

const cache = new Map();
function st(data, si, ei, tiers) {
  const k = `${data.length}|${si}|${ei}|${tiers ? JSON.stringify(tiers) : 'off'}`;
  if (!cache.has(k)) cache.set(k, runFinalBacktest(data[si][0], data[ei][0],
    tiers ? { ...OFF, throttleEnabled: true, throttleTiers: tiers } : OFF, data).stats);
  return cache.get(k);
}
const delta = (data, si, ei, tiers) =>
  (st(data, si, ei, tiers).finalAfterTax / st(data, si, ei, null).finalAfterTax - 1) * 100;
const pct = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const fmtB = v => `${(v / 1e8).toFixed(2)}억`;
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const ym = (d, i) => d[i][0].slice(0, 7);
function bootCI(xs, blockLen = 20, B = 4000) {
  const n = xs.length; let seed = 20260808;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const ms = [];
  for (let b = 0; b < B; b++) {
    let s = 0, c = 0;
    while (c < n) { const p = Math.floor(rnd() * n); for (let k = 0; k < blockLen && c < n; k++, c++) s += xs[(p + k) % n]; }
    ms.push(s / n);
  }
  ms.sort((a, b) => a - b);
  return [ms[Math.floor(B * 0.025)], ms[Math.floor(B * 0.975)]];
}

console.log(`합성 ${SIM[0][0]} ~ ${SIM.at(-1)[0]} (${SIM.length}일 = ${(SIM.length / YR).toFixed(1)}년)`);
console.log(`실제 ${TQQQ_DATA[0][0]} ~ ${TQQQ_DATA.at(-1)[0]} (${TQQQ_DATA.length}일 = ${(TQQQ_DATA.length / YR).toFixed(1)}년)\n`);

// ── 0. 겹치는 구간에서 합성이 실제와 같은 답을 내는가 ────────────────────
console.log('=== 0. 신뢰성 확인 — 같은 기간을 실제/합성으로 각각 돌린 결과 ===');
console.log('기간'.padEnd(20) + '  실제세후   합성세후  차이 |  실제Δ(70↑0%)  합성Δ  Δ의차이');
const CHK = [['2010-02~2015-02', '2010-02-11', '2015-02-12'], ['2011-07~2016-07', '2011-07-26', '2016-07-27'],
             ['2016-07~2021-07', '2016-07-28', '2021-07-29'], ['2021-07~2026-08', '2021-07-30', '2026-08-05'],
             ['2010-02~2026-08', '2010-02-11', '2026-08-05']];
for (const [lbl, s, e] of CHK) {
  const rb = runFinalBacktest(s, e, OFF, TQQQ_DATA).stats;
  const rv = runFinalBacktest(s, e, { ...OFF, throttleEnabled: true, throttleTiers: [[70, 0]] }, TQQQ_DATA).stats;
  const sb = runFinalBacktest(s, e, OFF, SIM).stats;
  const sv = runFinalBacktest(s, e, { ...OFF, throttleEnabled: true, throttleTiers: [[70, 0]] }, SIM).stats;
  const rd = (rv.finalAfterTax / rb.finalAfterTax - 1) * 100, sd = (sv.finalAfterTax / sb.finalAfterTax - 1) * 100;
  console.log(lbl.padEnd(20) + fmtB(rb.finalAfterTax).padStart(10) + fmtB(sb.finalAfterTax).padStart(11) +
    `${((sb.finalAfterTax / rb.finalAfterTax - 1) * 100).toFixed(0)}%`.padStart(6) + ' |' +
    pct(rd).padStart(13) + pct(sd).padStart(8) + `${(sd - rd).toFixed(1)}p`.padStart(9));
}

// ── 1. 합성 90개 롤링 5년 윈도우 ─────────────────────────────────────────
const starts = [];
for (let s = 0; s + W <= SIM.length; s += 63) starts.push(s);
console.log(`\n=== 1. 합성 롤링 5년 ${starts.length}개 (분기 슬라이드) ===`);
console.log('안'.padEnd(26) + '평균   중앙값   승률      95%CI      최악    최고');
const cols = {};
for (const [label, tiers] of CAND) {
  const ds = starts.map(s => delta(SIM, s, s + W - 1, tiers));
  cols[label] = ds;
  const [lo, hi] = bootCI(ds);
  console.log(label.padEnd(26) + pct(mean(ds)).padStart(7) + pct(median(ds)).padStart(8) +
    `${(ds.filter(x => x > 0).length / ds.length * 100).toFixed(0)}%`.padStart(7) +
    `[${lo.toFixed(1)},${hi.toFixed(1)}]`.padStart(15) + pct(Math.min(...ds)).padStart(8) + pct(Math.max(...ds)).padStart(8));
}

// ── 2. 시대별로 쪼개기 ───────────────────────────────────────────────────
// 합성의 진짜 가치는 실제 TQQQ에 없는 1999~2010이다. 이 구간만 따로 본다.
const eras = [
  ['닷컴+회복 1999~2005 시작창', s => SIM[s][0] < '2005-01-01'],
  ['금융위기 2005~2010 시작창', s => SIM[s][0] >= '2005-01-01' && SIM[s][0] < '2010-01-01'],
  ['실제데이터 기간 2010~ 시작창', s => SIM[s][0] >= '2010-01-01'],
];
console.log('\n=== 2. 시대별 (합성, 70↑0%) ===');
console.log('시대'.padEnd(30) + '창수   평균   중앙값   승률   기준선세후중앙  매도중앙  POOL최대비중중앙');
for (const [lbl, f] of eras) {
  const ss = starts.filter(f);
  if (!ss.length) continue;
  const ds = ss.map(s => delta(SIM, s, s + W - 1, [[70, 0]]));
  const bs = ss.map(s => st(SIM, s, s + W - 1, null));
  const poolMax = ss.map(s => {
    const { daily } = runFinalBacktest(SIM[s][0], SIM[s + W - 1][0], OFF, SIM);
    return Math.max(...daily.map(d => d.total > 0 ? d.pool / d.total * 100 : 0));
  });
  console.log(lbl.padEnd(30) + String(ss.length).padStart(4) + pct(mean(ds)).padStart(8) + pct(median(ds)).padStart(8) +
    `${(ds.filter(x => x > 0).length / ds.length * 100).toFixed(0)}%`.padStart(7) +
    fmtB(median(bs.map(b => b.finalAfterTax))).padStart(15) +
    `${median(bs.map(b => b.sellCount)).toFixed(0)}회`.padStart(9) +
    `${median(poolMax).toFixed(0)}%`.padStart(17));
}

// ── 3. 겹치지 않는 5년 5구간 (합성이 주는 진짜 이득) ─────────────────────
const nInd = Math.floor(SIM.length / W);
console.log(`\n=== 3. 합성, 겹치지 않는 5년 ${nInd}구간 (독립 표본) ===`);
console.log('구간'.padEnd(20) + '기준선세후'.padStart(11) + '  MDD  매도 POOL최대' + CAND.map(([l]) => l.slice(0, 13).padStart(15)).join(''));
const indCols = CAND.map(() => []);
for (let i = 0; i < nInd; i++) {
  const s = i * W, e = s + W - 1;
  const b = st(SIM, s, e, null);
  const { daily } = runFinalBacktest(SIM[s][0], SIM[e][0], OFF, SIM);
  const pm = Math.max(...daily.map(d => d.total > 0 ? d.pool / d.total * 100 : 0));
  const ds = CAND.map(([, t], j) => { const d = delta(SIM, s, e, t); indCols[j].push(d); return d; });
  console.log(`${ym(SIM, s)}~${ym(SIM, e)}`.padEnd(20) + fmtB(b.finalAfterTax).padStart(11) +
    `${b.mdd.toFixed(0)}%`.padStart(6) + `${b.sellCount}회`.padStart(5) + `${pm.toFixed(0)}%`.padStart(8) +
    ds.map(d => pct(d).padStart(15)).join(''));
}
console.log('평균'.padEnd(20) + ''.padStart(30) + indCols.map(c => pct(mean(c)).padStart(15)).join(''));
console.log('개선 구간'.padEnd(20) + ''.padStart(28) + indCols.map(c => `${c.filter(x => x > 0).length}/${nInd}`.padStart(15)).join(''));

// ── 4. 경계 위치 스캔 (합성, 5년 5분할) ──────────────────────────────────
const need = W * 5, maxOff = SIM.length - need, STEP = 10;
console.log(`\n=== 4. 합성, 겹치지 않는 5년 5분할 경계 스캔 (오프셋 0~${maxOff}, ${Math.floor(maxOff / STEP) + 1}가지) ===`);
console.log('안'.padEnd(26) + '5구간평균  전부+  4개이상+  3개이상+  최악구간최소');
for (const [label, tiers] of CAND) {
  const ms = []; let all = 0, ge4 = 0, ge3 = 0, tot = 0, worst = Infinity;
  for (let off = 0; off <= maxOff; off += STEP) {
    const ds = [0, 1, 2, 3, 4].map(k => delta(SIM, off + k * W, off + (k + 1) * W - 1, tiers));
    ms.push(mean(ds));
    const pos = ds.filter(x => x > 0).length;
    if (pos === 5) all++; if (pos >= 4) ge4++; if (pos >= 3) ge3++;
    worst = Math.min(worst, ...ds); tot++;
  }
  console.log(label.padEnd(26) + pct(mean(ms)).padStart(9) +
    `${(all / tot * 100).toFixed(0)}%`.padStart(7) + `${(ge4 / tot * 100).toFixed(0)}%`.padStart(10) +
    `${(ge3 / tot * 100).toFixed(0)}%`.padStart(10) + pct(worst).padStart(14));
}
