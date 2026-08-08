// 지정안 검증: RSI 65↑ 2.5%, 70↑ 0%
//   node scripts/opt-rsi-throttle4.mjs
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
const stat = (sd, ed, tiers, data, extra = {}) => {
  const k = `${sd}|${ed}|${data.length}|${JSON.stringify(tiers)}|${JSON.stringify(extra)}`;
  if (!cache.has(k)) cache.set(k, runFinalBacktest(sd, ed,
    tiers ? { ...BASE, ...extra, throttleEnabled: true, throttleTiers: tiers } : { ...BASE, ...extra }, data).stats);
  return cache.get(k);
};
const deltas = (tiers, data, extra = {}) => windowsOf(data).map(([sd, ed]) =>
  (stat(sd, ed, tiers, data, extra).finalAfterTax / stat(sd, ed, null, data, extra).finalAfterTax - 1) * 100);
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

const TARGET = [[65, 2.5], [70, 0]];
const PEERS = [
  ['★ 65↑2.5% 70↑0%', TARGET],
  ['  70↑0% 단일', [[70, 0]]],
  ['  72↑0% 단일', [[72, 0]]],
  ['  65↑0% 단일', [[65, 0]]],
  ['  65↑2.5% 단일', [[65, 2.5]]],
  ['  65↑2.5% 72↑0%', [[65, 2.5], [72, 0]]],
  ['  60↑2.5% 70↑0%', [[60, 2.5], [70, 0]]],
  ['  68↑2.5% 73↑0%', [[68, 2.5], [73, 0]]],
];

console.log('=== 1. 후보 비교 (전부 세후, 기준선 대비 %) ===');
console.log('안'.padEnd(22) + '롤링평균 중앙값  최악   승률   95%CI       W1     W2     W3   FULL    QLD   합성  ΔMDD');
const rows = [];
for (const [label, tiers] of PEERS) {
  const dT = deltas(tiers, TQQQ_DATA);
  const [lo, hi] = bootstrapCI(dT);
  const w = INDEP.map(([, s, e]) => (stat(s, e, tiers, TQQQ_DATA).finalAfterTax / stat(s, e, null, TQQQ_DATA).finalAfterTax - 1) * 100);
  const fv = stat(...FULL, tiers, TQQQ_DATA), fb = stat(...FULL, null, TQQQ_DATA);
  const f = (fv.finalAfterTax / fb.finalAfterTax - 1) * 100;
  const dQ = mean(deltas(tiers, QLD_DATA)), dS = mean(deltas(tiers, SIM_DATA));
  const win = dT.filter(x => x > 0).length / dT.length * 100;
  const r = { label, tiers, dT, lo, hi, w, f, dQ, dS, mddD: fv.mdd - fb.mdd, worst: Math.min(...dT), win };
  rows.push(r);
  console.log(label.padEnd(22) + pct(mean(dT)).padStart(7) + pct(median(dT)).padStart(7) + pct(r.worst).padStart(7) +
    `${win.toFixed(0)}%`.padStart(6) + `[${lo.toFixed(1)},${hi.toFixed(1)}]`.padStart(13) +
    w.map(x => pct(x).padStart(7)).join('') + pct(f).padStart(7) + pct(dQ).padStart(7) + pct(dS).padStart(7) +
    `${r.mddD >= 0 ? '+' : ''}${r.mddD.toFixed(1)}`.padStart(6));
}

console.log('\n=== 2. 게이트 판정 ===');
console.log('  G1 자산하한  G2 롤링평균>0  G3 QLD·합성 -5%초과 악화없음  G4 95%CI가 0 미포함');
for (const r of rows) {
  const g = { G1: median(r.dT) >= -10 && r.f >= -10, G2: mean(r.dT) > 0, G3: r.dQ > -5 && r.dS > -5, G4: r.lo > 0 || r.hi < 0 };
  const fails = Object.entries(g).filter(([, v]) => !v).map(([k]) => k);
  const w3 = r.w.every(x => x > 0) ? '독립3구간 전부+' : `독립3구간 ${r.w.filter(x => x > 0).length}/3`;
  console.log(`  ${r.label.padEnd(22)} ${(fails.length ? '탈락(' + fails.join(',') + ')' : '통과').padEnd(14)} ${w3}`);
}

console.log('\n=== 3. 지정안 절대금액 상세 ===');
for (const [lbl, s, e] of [...INDEP, ['FULL 2010~2026', ...FULL]]) {
  console.log(`  ${lbl}`);
  for (const [n, t] of [['기준선', null], ['65↑2.5% 70↑0%', TARGET], ['70↑0% 단일', [[70, 0]]]]) {
    const st = stat(s, e, t, TQQQ_DATA);
    console.log(`    ${n.padEnd(16)} ${fmtB(st.finalAfterTax).padStart(10)}  IRR ${st.irr.toFixed(1).padStart(5)}%  MDD ${st.mdd.toFixed(1).padStart(6)}%  납세 ${fmtB(st.taxPaid).padStart(9)}  스로틀주 ${String(st.throttledWeeks).padStart(3)}/${st.totalWeeks}`);
  }
}

console.log('\n=== 4. 대조군 대비 효율 (FULL) — RSI가 일하는가, 그냥 덜 사는 건가 ===');
function spend(tiers) {
  const { daily } = runFinalBacktest(...FULL, tiers ? { ...BASE, throttleEnabled: true, throttleTiers: tiers } : BASE, TQQQ_DATA);
  let sum = 0;
  const tier = tiers ? [...tiers].sort((a, b) => a[0] - b[0]) : null;
  for (const d of daily) {
    if (new Date(d.date + 'T00:00:00Z').getUTCDay() !== 3) continue;
    let r = 0.05;
    if (d.boostCond) r = BASE.ratioPct / 100;
    else if (tier && !isNaN(d.rsi)) { for (const [th, p] of tier) if (d.rsi >= th) r = p / 100; }
    sum += d.pool * r;
  }
  return sum;
}
const baseSpend = spend(null);
console.log('안'.padEnd(22) + '재투자총액'.padStart(11) + '감소율'.padStart(9) + 'FULL세후Δ'.padStart(11));
for (const [lbl, t] of [['기준선', null], ['★ 65↑2.5% 70↑0%', TARGET], ['70↑0% 단일', [[70, 0]]],
  ['상시 3.5% (RSI무관)', [[0, 3.5]]], ['상시 3% (RSI무관)', [[0, 3]]]]) {
  const sp = spend(t);
  const f = (stat(...FULL, t, TQQQ_DATA).finalAfterTax / stat(...FULL, null, TQQQ_DATA).finalAfterTax - 1) * 100;
  console.log(lbl.padEnd(22) + `${(sp / 1e8).toFixed(0)}억`.padStart(11) + `${((1 - sp / baseSpend) * 100).toFixed(1)}%`.padStart(9) + pct(f).padStart(11));
}

console.log('\n=== 5. 부스터 OFF (아낀 현금의 바닥 재투입 경로 차단) ===');
for (const [lbl, t] of [['★ 65↑2.5% 70↑0%', TARGET], ['70↑0% 단일', [[70, 0]]], ['65↑0% 단일', [[65, 0]]]]) {
  const dT = deltas(t, TQQQ_DATA, { enabled: false });
  const f = (stat(...FULL, t, TQQQ_DATA, { enabled: false }).finalAfterTax / stat(...FULL, null, TQQQ_DATA, { enabled: false }).finalAfterTax - 1) * 100;
  const w = INDEP.map(([, s, e]) => (stat(s, e, t, TQQQ_DATA, { enabled: false }).finalAfterTax / stat(s, e, null, TQQQ_DATA, { enabled: false }).finalAfterTax - 1) * 100);
  console.log(`  ${lbl.padEnd(22)} 롤링평균 ${pct(mean(dT)).padStart(7)}  W ${w.map(x => pct(x).padStart(7)).join('')}  FULL ${pct(f).padStart(7)}`);
}

console.log('\n=== 6. 1단 파라미터 민감도 (2단은 70↑0% 고정, 롤링평균) ===');
for (const t1 of [58, 60, 62, 65, 67, 68]) {
  const line = [4, 3.5, 3, 2.5, 2, 1].map(p1 => {
    const m = mean(deltas([[t1, p1], [70, 0]], TQQQ_DATA));
    return `${p1}%:${pct(m)}`.padStart(12);
  }).join('');
  console.log(`  1단 RSI${t1}` + line);
}
console.log('  (참고) 1단 없음, 70↑0%만: ' + pct(mean(deltas([[70, 0]], TQQQ_DATA))));
