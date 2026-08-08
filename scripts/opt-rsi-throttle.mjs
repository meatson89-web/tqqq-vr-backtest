// 과열(RSI) 구간 POOL 재투자 스로틀 최적화 + 검증
//   node scripts/opt-rsi-throttle.mjs
//
// 문제의식: 수익실현 매도는 RSI 73 부근에서 일어나므로 그 직후 몇 주 동안 POOL은
// 크고 RSI는 아직 높다. 이때 평상시 규칙대로 POOL의 5%를 사면 방금 판 가격 근처에서
// 되사서 평단가를 올리고, 곧 오는 조정을 그대로 맞는다.
// 대안: 그날 RSI 구간에 따라 재투자 비율을 5% → 3% → 2.5% → 1% 식으로 줄인다.
//
// 판정은 전부 세후(finalAfterTax) 기준. 선택은 46개 롤링 5년 윈도우 평균으로 하고,
// 검증은 (1) 겹치지 않는 독립 5년 구간 3개, (2) 블록 부트스트랩 95% CI,
// (3) QLD·합성TQQQ 교차검증으로 한다.

import fs from 'node:fs';
import { runFinalBacktest, DEFAULT_SETTINGS, TQQQ_DATA } from '../src/lib/backtest.js';

const QLD_DATA = JSON.parse(fs.readFileSync(new URL('../src/data/qld.json', import.meta.url), 'utf8'));
const SIM_DATA = JSON.parse(fs.readFileSync(new URL('../src/data/tqqq_sim.json', import.meta.url), 'utf8'));

const BASE = { ...DEFAULT_SETTINGS };
const FULL = [TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0]];

// 겹치지 않는 독립 5년(1260거래일) 구간 3개 — 최근 15년을 정확히 3등분
const INDEP = [
  ['W1 11-07~16-07', '2011-07-26', '2016-07-27'],
  ['W2 16-07~21-07', '2016-07-28', '2021-07-29'],
  ['W3 21-07~26-08', '2021-07-30', '2026-08-06'],
];

const WINDOW = 252 * 5, SLIDE = 63;
const windowsOf = data => {
  const out = [];
  for (let s = 0; s + WINDOW <= data.length; s += SLIDE) out.push([data[s][0], data[s + WINDOW - 1][0]]);
  return out;
};

// 기준선 캐시 (같은 윈도우를 후보마다 다시 돌리지 않도록)
const baseCache = new Map();
const baseline = (sd, ed, data) => {
  const k = `${sd}|${ed}|${data.length}`;
  if (!baseCache.has(k)) baseCache.set(k, runFinalBacktest(sd, ed, BASE, data).stats);
  return baseCache.get(k);
};

const run = (tiers, sd, ed, data = TQQQ_DATA) =>
  runFinalBacktest(sd, ed, { ...BASE, throttleEnabled: true, throttleTiers: tiers }, data).stats;

const deltas = (tiers, data) => windowsOf(data).map(([sd, ed]) =>
  (run(tiers, sd, ed, data).finalAfterTax / baseline(sd, ed, data).finalAfterTax - 1) * 100);

function bootstrapCI(xs, blockLen = Math.round(WINDOW / SLIDE), B = 4000) {
  const n = xs.length;
  let seed = 20260807;
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

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const pct = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const fmtB = v => `${(v / 1e8).toFixed(2)}억`;
const tierStr = t => t.map(([r, p]) => `${r}:${p}%`).join(' ');

// ── 0. 기준선 ────────────────────────────────────────────────────────────
console.log('=== 기준선 (스로틀 없음, 평상시 POOL 재투자 5% 고정, 세후) ===');
const bFull = baseline(...FULL, TQQQ_DATA);
console.log(`  FULL 2010~2026  ${fmtB(bFull.finalAfterTax)}  IRR ${bFull.irr.toFixed(1)}%  MDD ${bFull.mdd.toFixed(1)}%`);
for (const [lbl, s, e] of INDEP) {
  const b = baseline(s, e, TQQQ_DATA);
  console.log(`  ${lbl}  ${fmtB(b.finalAfterTax)}  IRR ${b.irr.toFixed(1)}%  MDD ${b.mdd.toFixed(1)}%`);
}

// ── 1. 질문에 대한 직답: RSI 70 초과 시 2.5% ─────────────────────────────
console.log('\n=== Q1. "RSI 70 넘으면 5% → 2.5%" 단일 규칙 ===');
console.log('안'.padEnd(22) + '롤링평균  중앙값     95%CI        W1      W2      W3    FULL');
const Q1 = [
  ['RSI70→2.5%', [[70, 2.5]]],
  ['RSI70→0% (전면중단)', [[70, 0]]],
  ['RSI70→3%', [[70, 3]]],
  ['RSI70→1%', [[70, 1]]],
];
function report(label, tiers) {
  const dT = deltas(tiers, TQQQ_DATA);
  const [lo, hi] = bootstrapCI(dT);
  const w = INDEP.map(([, s, e]) => (run(tiers, s, e).finalAfterTax / baseline(s, e, TQQQ_DATA).finalAfterTax - 1) * 100);
  const f = (run(tiers, ...FULL).finalAfterTax / bFull.finalAfterTax - 1) * 100;
  console.log(label.padEnd(22) + pct(mean(dT)).padStart(8) + pct(median(dT)).padStart(8) +
    `[${lo.toFixed(1)},${hi.toFixed(1)}]`.padStart(15) +
    w.map(x => pct(x).padStart(8)).join('') + pct(f).padStart(8));
  return { dT, lo, hi, w, f, mean: mean(dT) };
}
for (const [l, t] of Q1) report(l, t);

// ── 2. 3단 사다리 그리드 최적화 (선택 기준: 롤링 46구간 평균) ────────────
console.log('\n=== Q2. 3단 사다리 그리드 최적화 ===');
const T1 = [65, 68, 70], T2 = [73, 75], T3 = [78, 80];
const R1 = [4, 3, 2.5, 2], R2 = [3, 2.5, 2, 1], R3 = [2, 1, 0.5, 0];
const results = [];
for (const t1 of T1) for (const t2 of T2) for (const t3 of T3)
  for (const r1 of R1) for (const r2 of R2) for (const r3 of R3) {
    if (!(r1 >= r2 && r2 >= r3)) continue;
    const tiers = [[t1, r1], [t2, r2], [t3, r3]];
    const dT = deltas(tiers, TQQQ_DATA);
    results.push({ tiers, m: mean(dT), md: median(dT), dT });
  }
results.sort((a, b) => b.m - a.m);
console.log(`후보 ${results.length}개 평가. 상위 12개:`);
console.log('사다리'.padEnd(30) + '롤링평균  중앙값');
for (const r of results.slice(0, 12)) {
  console.log(tierStr(r.tiers).padEnd(30) + pct(r.m).padStart(8) + pct(r.md).padStart(8));
}
console.log('하위 3개(참고):');
for (const r of results.slice(-3)) {
  console.log(tierStr(r.tiers).padEnd(30) + pct(r.m).padStart(8) + pct(r.md).padStart(8));
}

// ── 3. 상위 후보 전체 검증 ───────────────────────────────────────────────
console.log('\n=== Q3. 상위 후보 전체 검증 (전부 세후) ===');
console.log('사다리'.padEnd(30) + '롤링평균  중앙값     95%CI        W1      W2      W3    FULL     QLD    합성');
const finalists = [
  ...results.slice(0, 6).map(r => r.tiers),
  [[70, 3], [75, 2.5], [80, 1]],  // 사용자가 제시한 형태
  [[70, 2.5]],
];
const seen = new Set();
const scored = [];
for (const tiers of finalists) {
  const key = tierStr(tiers);
  if (seen.has(key)) continue;
  seen.add(key);
  const dT = deltas(tiers, TQQQ_DATA);
  const [lo, hi] = bootstrapCI(dT);
  const w = INDEP.map(([, s, e]) => (run(tiers, s, e).finalAfterTax / baseline(s, e, TQQQ_DATA).finalAfterTax - 1) * 100);
  const f = (run(tiers, ...FULL).finalAfterTax / bFull.finalAfterTax - 1) * 100;
  const dQ = mean(deltas(tiers, QLD_DATA));
  const dS = mean(deltas(tiers, SIM_DATA));
  scored.push({ tiers, key, dT, lo, hi, w, f, dQ, dS });
  console.log(key.padEnd(30) + pct(mean(dT)).padStart(8) + pct(median(dT)).padStart(8) +
    `[${lo.toFixed(1)},${hi.toFixed(1)}]`.padStart(15) +
    w.map(x => pct(x).padStart(8)).join('') + pct(f).padStart(8) +
    pct(dQ).padStart(8) + pct(dS).padStart(8));
}

// ── 4. 게이트 판정 ───────────────────────────────────────────────────────
console.log('\n=== Q4. 판정 (validate.mjs와 동일 게이트) ===');
console.log('  G1 세후자산 하한(중앙값·전체구간 -10% 초과 악화 없음)');
console.log('  G2 롤링 평균 개선 > 0   G3 QLD·합성 모두 -5% 초과 악화 없음   G4 95%CI가 0 미포함');
for (const s of scored) {
  const g1 = median(s.dT) >= -10 && s.f >= -10;
  const g2 = mean(s.dT) > 0;
  const g3 = s.dQ > -5 && s.dS > -5;
  const g4 = s.lo > 0 || s.hi < 0;
  const g5 = s.w.every(x => x > 0);   // 추가: 독립 3구간 전부 개선
  const gates = { G1: g1, G2: g2, G3: g3, G4: g4, 'W전부+': g5 };
  const fails = Object.entries(gates).filter(([, v]) => !v).map(([k]) => k);
  console.log(`  ${s.key.padEnd(30)} ${fails.length ? '탈락(' + fails.join(',') + ')' : '통과'}`);
}

// ── 5. 파라미터 민감도 (최상위안 주변) ───────────────────────────────────
const best = scored[0];
console.log(`\n=== Q5. 최상위안 ${best.key} 주변 민감도 (롤링 평균) ===`);
if (best.tiers.length === 3) {
  const [[b1, p1], [b2, p2], [b3, p3]] = best.tiers;
  const scan = [];
  for (const d of [-3, -2, 0, 2, 3]) scan.push([`1단 임계 ${b1 + d}`, [[b1 + d, p1], [b2, p2], [b3, p3]]]);
  for (const d of [-1.5, -1, 0, 1, 1.5]) scan.push([`1단 비율 ${(p1 + d).toFixed(1)}%`, [[b1, Math.max(0, p1 + d)], [b2, p2], [b3, p3]]]);
  for (const d of [-1, -0.5, 0, 0.5, 1]) scan.push([`3단 비율 ${(p3 + d).toFixed(1)}%`, [[b1, p1], [b2, p2], [b3, Math.max(0, p3 + d)]]]);
  for (const [lbl, t] of scan) {
    const m = mean(deltas(t, TQQQ_DATA));
    console.log(`  ${lbl.padEnd(18)}${tierStr(t).padEnd(30)}${pct(m).padStart(8)}`);
  }
}
