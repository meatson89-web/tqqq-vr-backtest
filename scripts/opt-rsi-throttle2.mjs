// 과열 스로틀 2차: 대조군 실험 + 넓은 그리드
//   node scripts/opt-rsi-throttle2.mjs
//
// 1차에서 "조일수록 좋다"(RSI70→0%가 최고)가 나왔다. 이건 두 가지로 해석된다.
//   (A) RSI가 실제로 고점을 짚어내서 비싸게 사는 걸 피했다  ← 원하는 결론
//   (B) 그냥 POOL 재투자를 덜 해서 현금을 오래 들고 있었을 뿐이고, 그 현금이
//       나중에 부스터로 바닥에서 쓰였다                     ← RSI는 장식
// (B)를 배제하려면 "RSI 조건 없이 평상시 비율만 똑같이 낮춘" 대조군과 비교해야 한다.
// tiers=[[0,X]]는 RSI>=0이 항상 참이므로 정확히 그 대조군이 된다.
// 추가로 부스터를 끈 상태에서도 효과가 남는지 본다(남으면 (A) 쪽 근거).

import fs from 'node:fs';
import { runFinalBacktest, DEFAULT_SETTINGS, TQQQ_DATA } from '../src/lib/backtest.js';

const QLD_DATA = JSON.parse(fs.readFileSync(new URL('../src/data/qld.json', import.meta.url), 'utf8'));
const SIM_DATA = JSON.parse(fs.readFileSync(new URL('../src/data/tqqq_sim.json', import.meta.url), 'utf8'));

const BASE = { ...DEFAULT_SETTINGS };
const FULL = [TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0]];
const INDEP = [
  ['W1', '2011-07-26', '2016-07-27'],
  ['W2', '2016-07-28', '2021-07-29'],
  ['W3', '2021-07-30', '2026-08-06'],
];
const WINDOW = 252 * 5, SLIDE = 63;
const windowsOf = data => {
  const out = [];
  for (let s = 0; s + WINDOW <= data.length; s += SLIDE) out.push([data[s][0], data[s + WINDOW - 1][0]]);
  return out;
};

const cache = new Map();
const stat = (sd, ed, settings, data) => {
  const k = `${sd}|${ed}|${data.length}|${JSON.stringify(settings)}`;
  if (!cache.has(k)) cache.set(k, runFinalBacktest(sd, ed, settings, data).stats);
  return cache.get(k);
};
const S = (tiers, extra = {}) => tiers
  ? { ...BASE, ...extra, throttleEnabled: true, throttleTiers: tiers }
  : { ...BASE, ...extra };

const deltas = (tiers, data, extra = {}) => windowsOf(data).map(([sd, ed]) =>
  (stat(sd, ed, S(tiers, extra), data).finalAfterTax / stat(sd, ed, S(null, extra), data).finalAfterTax - 1) * 100);

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
const tierStr = t => t ? t.map(([r, p]) => `${r}→${p}%`).join(' ') : '기준선';

function row(label, tiers, extra = {}) {
  const dT = deltas(tiers, TQQQ_DATA, extra);
  const [lo, hi] = bootstrapCI(dT);
  const w = INDEP.map(([, s, e]) =>
    (stat(s, e, S(tiers, extra), TQQQ_DATA).finalAfterTax / stat(s, e, S(null, extra), TQQQ_DATA).finalAfterTax - 1) * 100);
  const fv = stat(...FULL, S(tiers, extra), TQQQ_DATA);
  const fb = stat(...FULL, S(null, extra), TQQQ_DATA);
  const f = (fv.finalAfterTax / fb.finalAfterTax - 1) * 100;
  const mddD = fv.mdd - fb.mdd;
  const dQ = mean(deltas(tiers, QLD_DATA, extra));
  const dS = mean(deltas(tiers, SIM_DATA, extra));
  console.log(label.padEnd(24) + pct(mean(dT)).padStart(8) + pct(median(dT)).padStart(8) +
    `[${lo.toFixed(1)},${hi.toFixed(1)}]`.padStart(14) +
    w.map(x => pct(x).padStart(7)).join('') + pct(f).padStart(8) +
    pct(dQ).padStart(7) + pct(dS).padStart(7) + `${mddD >= 0 ? '+' : ''}${mddD.toFixed(1)}`.padStart(7));
  return { label, tiers, dT, lo, hi, w, f, dQ, dS, mddD, m: mean(dT) };
}
const HDR = '안'.padEnd(24) + '롤링평균  중앙값     95%CI     W1     W2     W3    FULL    QLD   합성  ΔMDD';

// ── A. 대조군: RSI 조건 없이 평상시 비율만 낮추기 ────────────────────────
console.log('=== A. 대조군 — RSI 무관하게 평상시 재투자율만 5%→X ===');
console.log(HDR);
const ctrl = {};
for (const x of [4, 3, 2.5, 2, 1, 0.5, 0]) ctrl[x] = row(`상시 ${x}% (RSI무관)`, [[0, x]]);

// ── B. RSI 스로틀 (같은 "덜 사기" 강도끼리 비교) ─────────────────────────
console.log('\n=== B. RSI 조건부 스로틀 ===');
console.log(HDR);
const rsiOnly = {};
for (const t of [60, 65, 68, 70, 72, 75])
  for (const x of [3, 2.5, 2, 1, 0])
    rsiOnly[`${t}/${x}`] = row(`RSI${t} 초과 → ${x}%`, [[t, x]]);

// ── C. "실제로 얼마나 덜 샀나"로 정규화 ──────────────────────────────────
// 대조군과 RSI안의 성과를 그냥 비교하면 안 된다. 같은 금액을 아꼈을 때
// RSI안이 더 나은지를 봐야 한다. 총 POOL 재투자액 감소율을 x축으로 삼는다.
console.log('\n=== C. "아낀 금액" 대비 효율 (FULL 구간) ===');
function spend(tiers) {
  const { daily } = runFinalBacktest(...FULL, S(tiers), TQQQ_DATA);
  // 수요일 실제 재투자액을 직접 못 뽑으므로 최종 세후자산과 매수 회피량의 프록시로
  // "최종 POOL 잔액 대비"가 아니라, 같은 엔진을 다시 돌려 주간 재투자액을 합산한다.
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
console.log('안'.padEnd(24) + '재투자액'.padStart(10) + '감소율'.padStart(9) + 'FULL세후Δ'.padStart(11) + '  효율(Δ/감소율)');
const effRows = [
  ['기준선', null],
  ...Object.entries(ctrl).map(([x, r]) => [`상시 ${x}%`, r.tiers]),
  ...[[70, 3], [70, 2.5], [70, 2], [70, 1], [70, 0], [65, 1], [65, 0], [68, 0], [72, 0], [75, 0]].map(([t, x]) => [`RSI${t}→${x}%`, [[t, x]]]),
];
for (const [lbl, tiers] of effRows) {
  const sp = spend(tiers);
  const cut = (1 - sp / baseSpend) * 100;
  const f = (stat(...FULL, S(tiers), TQQQ_DATA).finalAfterTax / stat(...FULL, S(null), TQQQ_DATA).finalAfterTax - 1) * 100;
  console.log(lbl.padEnd(24) + `${(sp / 1e8).toFixed(0)}억`.padStart(10) + `${cut.toFixed(1)}%`.padStart(9) +
    pct(f).padStart(11) + (cut > 0.5 ? `  ${(f / cut).toFixed(2)}` : ''));
}

// ── D. 부스터 OFF 상태에서도 효과가 남는가 ───────────────────────────────
console.log('\n=== D. 부스터 OFF 상태 (아낀 현금을 폭락 때 몰아 쓰는 경로 차단) ===');
console.log(HDR);
for (const [t, x] of [[70, 2.5], [70, 0], [65, 0]]) row(`RSI${t}→${x}% (부스터OFF)`, [[t, x]], { enabled: false });
row('상시 2.5% (부스터OFF)', [[0, 2.5]], { enabled: false });
