// 과열 스로틀 3차: 사다리(다단) 안 정면 비교 + 최종 후보 상세
//   node scripts/opt-rsi-throttle3.mjs
import fs from 'node:fs';
import { runFinalBacktest, DEFAULT_SETTINGS, TQQQ_DATA } from '../src/lib/backtest.js';

const QLD_DATA = JSON.parse(fs.readFileSync(new URL('../src/data/qld.json', import.meta.url), 'utf8'));
const SIM_DATA = JSON.parse(fs.readFileSync(new URL('../src/data/tqqq_sim.json', import.meta.url), 'utf8'));
const BASE = { ...DEFAULT_SETTINGS };
const FULL = [TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0]];
const INDEP = [
  ['W1 2011-07~2016-07', '2011-07-26', '2016-07-27'],
  ['W2 2016-07~2021-07', '2016-07-28', '2021-07-29'],
  ['W3 2021-07~2026-08', '2021-07-30', '2026-08-06'],
];
const WINDOW = 252 * 5, SLIDE = 63;
const windowsOf = data => {
  const out = [];
  for (let s = 0; s + WINDOW <= data.length; s += SLIDE) out.push([data[s][0], data[s + WINDOW - 1][0]]);
  return out;
};
const cache = new Map();
const stat = (sd, ed, tiers, data) => {
  const k = `${sd}|${ed}|${data.length}|${JSON.stringify(tiers)}`;
  if (!cache.has(k)) cache.set(k, runFinalBacktest(sd, ed,
    tiers ? { ...BASE, throttleEnabled: true, throttleTiers: tiers } : BASE, data).stats);
  return cache.get(k);
};
const deltas = (tiers, data) => windowsOf(data).map(([sd, ed]) =>
  (stat(sd, ed, tiers, data).finalAfterTax / stat(sd, ed, null, data).finalAfterTax - 1) * 100);
function bootstrapCI(xs, blockLen = Math.round(WINDOW / SLIDE), B = 4000) {
  const n = xs.length; let seed = 20260807;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const means = [];
  for (let b = 0; b < B; b++) {
    let sum = 0, cnt = 0;
    while (cnt < n) { const s = Math.floor(rnd() * n); for (let k = 0; k < blockLen && cnt < n; k++, cnt++) sum += xs[(s + k) % n]; }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(B * 0.025)], means[Math.floor(B * 0.975)]];
}
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const pct = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const fmtB = v => `${(v / 1e8).toFixed(2)}억`;
const tierStr = t => t ? t.map(([r, p]) => `${r}↑${p}%`).join(' ') : '기준선';

const CAND = [
  ['① 기준선 (스로틀 없음)', null],
  ['② 사용자안 70→2.5% 단일', [[70, 2.5]]],
  ['③ 사용자안 사다리 3/2.5/1', [[70, 3], [75, 2.5], [80, 1]]],
  ['④ 사다리 2.5/1/0', [[70, 2.5], [75, 1], [80, 0]]],
  ['⑤ 사다리 2/1/0', [[70, 2], [75, 1], [80, 0]]],
  ['⑥ 사다리 2.5/1/0 (73/78)', [[70, 2.5], [73, 1], [78, 0]]],
  ['⑦ 사다리 1/0.5/0', [[70, 1], [75, 0.5], [80, 0]]],
  ['⑧ 단일 70→1%', [[70, 1]]],
  ['⑨ 단일 70→0%', [[70, 0]]],
  ['⑩ 단일 72→0%', [[72, 0]]],
];

console.log('=== 후보 비교 (전부 세후, 기준선 대비 %) ===');
console.log('안'.padEnd(28) + '롤링평균 중앙값  최악윈도우    95%CI      W1     W2     W3   FULL    QLD   합성  ΔMDD');
const out = [];
for (const [label, tiers] of CAND) {
  if (!tiers) { console.log(label.padEnd(28) + '  (아래 절대금액 표 참조)'); continue; }
  const dT = deltas(tiers, TQQQ_DATA);
  const [lo, hi] = bootstrapCI(dT);
  const w = INDEP.map(([, s, e]) => (stat(s, e, tiers, TQQQ_DATA).finalAfterTax / stat(s, e, null, TQQQ_DATA).finalAfterTax - 1) * 100);
  const fv = stat(...FULL, tiers, TQQQ_DATA), fb = stat(...FULL, null, TQQQ_DATA);
  const f = (fv.finalAfterTax / fb.finalAfterTax - 1) * 100;
  const dQ = mean(deltas(tiers, QLD_DATA)), dS = mean(deltas(tiers, SIM_DATA));
  const rec = { label, tiers, dT, lo, hi, w, f, dQ, dS, mddD: fv.mdd - fb.mdd, worst: Math.min(...dT) };
  out.push(rec);
  console.log(label.padEnd(28) + pct(mean(dT)).padStart(7) + pct(median(dT)).padStart(7) + pct(rec.worst).padStart(9) +
    `[${lo.toFixed(1)},${hi.toFixed(1)}]`.padStart(14) + w.map(x => pct(x).padStart(7)).join('') +
    pct(f).padStart(7) + pct(dQ).padStart(7) + pct(dS).padStart(7) + `${rec.mddD >= 0 ? '+' : ''}${rec.mddD.toFixed(1)}`.padStart(6));
}

console.log('\n=== 판정 (G1~G4 + 독립 3구간 전부 개선) ===');
for (const r of out) {
  const g = {
    G1: median(r.dT) >= -10 && r.f >= -10,
    G2: mean(r.dT) > 0,
    G3: r.dQ > -5 && r.dS > -5,
    G4: r.lo > 0 || r.hi < 0,
    'W3구간전부+': r.w.every(x => x > 0),
  };
  const fails = Object.entries(g).filter(([, v]) => !v).map(([k]) => k);
  console.log(`  ${r.label.padEnd(28)} ${fails.length ? '탈락(' + fails.join(',') + ')' : '통과'}`);
}

console.log('\n=== 절대금액 상세 (세후 총자산) ===');
const PICK = [['기준선', null], ['70→2.5% 단일', [[70, 2.5]]], ['사다리 2.5/1/0', [[70, 2.5], [75, 1], [80, 0]]], ['70→0% 단일', [[70, 0]]]];
for (const [lbl, s, e] of [...INDEP, ['FULL 2010~2026', ...FULL]]) {
  console.log(`  ${lbl}`);
  for (const [n, t] of PICK) {
    const st = stat(s, e, t, TQQQ_DATA);
    console.log(`    ${n.padEnd(16)} ${fmtB(st.finalAfterTax).padStart(10)}  IRR ${st.irr.toFixed(1).padStart(5)}%  MDD ${st.mdd.toFixed(1).padStart(6)}%  납세 ${fmtB(st.taxPaid).padStart(9)}  스로틀주 ${String(st.throttledWeeks).padStart(3)}/${st.totalWeeks}  캡 ${st.capApplied}`);
  }
}
