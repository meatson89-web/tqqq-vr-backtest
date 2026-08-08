// 마켓오프(평단가 근접 시 분할매도) 검증
//   node scripts/sweep-marketoff.mjs
//
// 문제: 이익실현 매도는 "이격도 40% 초과"를 요구하는데 하락장에서는 주가가 180일선
// 위로 그만큼 올라갈 일이 없어 발동을 못 한다. 그래서 2000년·2008년·2022년 고점을
// 그대로 통과한 뒤 전부 맞는다.
// 제안: 총자산이 일정 규모 이상일 때, 가격이 평단가에 가까워지면(수익률 +10%, +5%)
// 단계별로 팔아 현금을 확보한다.
//
// 이 규칙은 수익을 늘리는 게 목적이 아니라 낙폭을 줄이는 게 목적이므로,
// 판정에서 MDD를 수익률과 같은 비중으로 본다.

import fs from 'node:fs';
import { runFinalBacktest, getRollingWindows, DEFAULT_SETTINGS, TQQQ_DATA, dataForSource } from '../src/lib/backtest.js';

const QLD_DATA = JSON.parse(fs.readFileSync(new URL('../src/data/qld.json', import.meta.url), 'utf8'));
const B = DEFAULT_SETTINGS;
const wins = getRollingWindows(B);
const ON = ov => ({ ...B, marketOffEnabled: true, ...ov });

const pct = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const fmtB = v => `${(v / 1e8).toFixed(2)}억`;
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
function boot(xs, blockLen = 5, N = 4000) {
  const n = xs.length; let seed = 20260808;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const ms = [];
  for (let b = 0; b < N; b++) {
    let s = 0, c = 0;
    while (c < n) { const p = Math.floor(rnd() * n); for (let k = 0; k < blockLen && c < n; k++, c++) s += xs[(p + k) % n]; }
    ms.push(s / n);
  }
  ms.sort((a, b) => a - b);
  return [ms[Math.floor(N * 0.025)], ms[Math.floor(N * 0.975)]];
}

const cache = new Map();
function st(w, ov) {
  const k = `${w.id}|${JSON.stringify(ov)}`;
  if (!cache.has(k)) cache.set(k, runFinalBacktest(w.startDate, w.endDate, ov ? ON(ov) : B, dataForSource(w.source)).stats);
  return cache.get(k);
}
const full = ov => runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], ov ? ON(ov) : B).stats;

function evaluate(ov) {
  const ds = wins.map(w => (st(w, ov).finalAfterTax / st(w, null).finalAfterTax - 1) * 100);
  // MDD는 음수값이므로 델타가 양수면 낙폭이 얕아진 것 = 개선이다. 부호를 헷갈리기 쉽다.
  const mdds = wins.map(w => st(w, ov).mdd - st(w, null).mdd);
  const ind = wins.map((w, i) => [w, ds[i], mdds[i]]).filter(([w]) => w.independent);
  const f = full(ov), fb = full(null);
  return {
    ds, m: mean(ds), md: median(ds), win: ds.filter(x => x > 0).length,
    mddAvg: mean(mdds), mddWorse: mdds.filter(x => x > 0.5).length,
    ind: mean(ind.map(r => r[1])), indMdd: mean(ind.map(r => r[2])), indWin: ind.filter(r => r[1] > 0).length,
    fullDelta: (f.finalAfterTax / fb.finalAfterTax - 1) * 100,
    fullAfterTax: f.finalAfterTax, mdd: f.mdd, mddDelta: f.mdd - fb.mdd,
    count: f.marketOffCount,
  };
}
const HDR = '안'.padEnd(30) + '23창평균 중앙값 개선  ΔMDD평균  독립5창(개선) 독립ΔMDD  전체구간세후  전체ΔMDD  발동';
function row(label, ov) {
  const r = evaluate(ov);
  console.log(label.padEnd(30) + pct(r.m).padStart(8) + pct(r.md).padStart(7) + `${r.win}/23`.padStart(6) +
    `${r.mddAvg >= 0 ? '+' : ''}${r.mddAvg.toFixed(1)}`.padStart(10) +
    `${pct(r.ind)}(${r.indWin}/5)`.padStart(15) + `${r.indMdd >= 0 ? '+' : ''}${r.indMdd.toFixed(1)}`.padStart(10) +
    fmtB(r.fullAfterTax).padStart(14) + `${r.mddDelta >= 0 ? '+' : ''}${r.mddDelta.toFixed(1)}`.padStart(10) +
    String(r.count).padStart(6));
  return r;
}

const fb = full(null);
console.log(`기준선(마켓오프 없음) 전체구간 ${fmtB(fb.finalAfterTax)}  MDD ${fb.mdd.toFixed(1)}%  창 ${wins.length}개(독립 5)\n`);

// ── 1. 사용자 제안안 + 매도비율 스윕 (총자산 3억 게이트) ─────────────────
console.log('=== 1. 제안안: 총자산 3억↑ AND 수익률 +10%/+5% 도달 시 분할매도 ===');
console.log(HDR);
for (const f of [0.2, 0.3, 0.4, 0.5, 0.7]) {
  row(`+10%/${(f * 100).toFixed(0)}% · +5%/${(f * 100).toFixed(0)}%`, { marketOffTiers: [[10, f], [5, f]] });
}

// ── 2. 단수/깊이 변형 ────────────────────────────────────────────────────
console.log('\n=== 2. 단 구성 변형 (총자산 3억 게이트 유지) ===');
console.log(HDR);
const VARIANTS = [
  ['+10%만 50%', [[10, 0.5]]],
  ['+5%만 50%', [[5, 0.5]]],
  ['+15/10/5 각 30%', [[15, 0.3], [10, 0.3], [5, 0.3]]],
  ['+10/5/0 각 30%', [[10, 0.3], [5, 0.3], [0, 0.3]]],
  ['+10/5/0/-10 각 30%', [[10, 0.3], [5, 0.3], [0, 0.3], [-10, 0.3]]],
  ['+10/5/0 각 50%', [[10, 0.5], [5, 0.5], [0, 0.5]]],
  ['+20/10/0 각 30%', [[20, 0.3], [10, 0.3], [0, 0.3]]],
];
for (const [label, tiers] of VARIANTS) row(label, { marketOffTiers: tiers });

// ── 3. 총자산 게이트 민감도 ──────────────────────────────────────────────
console.log('\n=== 3. 총자산 게이트 (+10%/+5% 각 30% 고정) ===');
console.log(HDR);
for (const a of [0, 1, 2, 3, 5, 10]) {
  row(a === 0 ? '게이트 없음' : `총자산 ${a}억 이상`, { marketOffMinAssets: a * 1e8 });
}

// ── 4. 재무장 기준 ───────────────────────────────────────────────────────
console.log('\n=== 4. 재무장 수익률 (+10%/+5% 각 30%, 3억 게이트) ===');
console.log(HDR);
for (const g of [15, 20, 25, 40, 60, 1000]) {
  row(g === 1000 ? '재무장 없음(1회성)' : `수익률 +${g}% 회복 시 재무장`, { marketOffResetGain: g });
}

// ── 5. 문제 구간 3개 상세 ────────────────────────────────────────────────
console.log('\n=== 5. 문제 구간 상세 ===');
const CASES = [
  ['2004-03~2009-03 금융위기', '2004-03-16', '2009-03-17', 'sim'],
  ['2018-02~2023-02 2022하락', '2018-02-14', '2023-02-15', 'real'],
  ['1999-03~2004-03 닷컴', '1999-03-11', '2004-03-15', 'sim'],
  ['2020-02~2025-02 독립창', '2020-02-18', '2025-02-20', 'real'],
];
const PICK = [
  ['기준선', null],
  ['+10/5 각 30%', { marketOffTiers: [[10, 0.3], [5, 0.3]] }],
  ['+10/5 각 50%', { marketOffTiers: [[10, 0.5], [5, 0.5]] }],
  ['+10/5/0 각 30%', { marketOffTiers: [[10, 0.3], [5, 0.3], [0, 0.3]] }],
];
for (const [label, s, e, src] of CASES) {
  console.log(`  ${label}`);
  for (const [n, ov] of PICK) {
    const r = runFinalBacktest(s, e, ov ? ON(ov) : B, dataForSource(src));
    const st2 = r.stats;
    console.log(`    ${n.padEnd(16)} ${fmtB(st2.finalAfterTax).padStart(9)} (납입 ${fmtB(st2.totalIn)})  MDD ${st2.mdd.toFixed(1).padStart(6)}%  마켓오프 ${String(st2.marketOffCount).padStart(2)}회 ${fmtB(st2.marketOffSoldKRW).padStart(9)} 매도` +
      (r.marketOffTrades.length ? `  [${r.marketOffTrades.map(t => `${t.date} +${t.tier}%`).join(', ')}]` : ''));
  }
}

// ── 6. QLD 교차검증 ──────────────────────────────────────────────────────
console.log('\n=== 6. QLD 교차검증 ===');
const qWins = [];
for (let s = 0; s + 252 * 5 <= QLD_DATA.length; s += 252) qWins.push([QLD_DATA[s][0], QLD_DATA[s + 252 * 5 - 1][0]]);
for (const [label, ov] of PICK.slice(1)) {
  const ds = [], mdds = [];
  for (const [a, b] of qWins) {
    const bs = runFinalBacktest(a, b, B, QLD_DATA).stats;
    const v = runFinalBacktest(a, b, ON(ov), QLD_DATA).stats;
    ds.push((v.finalAfterTax / bs.finalAfterTax - 1) * 100);
    mdds.push(v.mdd - bs.mdd);
  }
  console.log(`  ${label.padEnd(16)} 평균 ${pct(mean(ds)).padStart(7)}  개선 ${ds.filter(x => x > 0).length}/${qWins.length}  ΔMDD 평균 ${mean(mdds).toFixed(1)}`);
}

// ── 7. 신뢰구간 (최종 후보) ──────────────────────────────────────────────
console.log('\n=== 7. 블록 95% 신뢰구간 ===');
for (const [label, ov] of PICK.slice(1)) {
  const r = evaluate(ov);
  const [lo, hi] = boot(r.ds);
  console.log(`  ${label.padEnd(16)} 총자산 [${lo.toFixed(1)}, ${hi.toFixed(1)}]  (평균 ${pct(r.m)})`);
}
