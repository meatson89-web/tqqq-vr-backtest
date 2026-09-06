// 60일 vs 252일 — 5년 롤링 창별 세후 총자산 승패표
//   node scripts/verify-table.mjs
import { runFinalBacktest, getRollingWindows, DEFAULT_SETTINGS, TQQQ_DATA, SIM_DATA } from '../src/lib/backtest.js';

const B60 = { ...DEFAULT_SETTINGS, lookback: 60 };
const B252 = { ...DEFAULT_SETTINGS, lookback: 252 };
const E = 1e8;
const eok = v => (v / E).toFixed(2);
const pct = (v, d = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;

// ── 사용자 기준 격자: 5년 창 · 1년 슬라이드 (23창) ─────────────────────
const w60 = getRollingWindows(B60);
const w252 = getRollingWindows(B252);

console.log('| # | 구간 | 표본 | 60일 세후총자산 | 252일 세후총자산 | 차이(억) | 차이(%) | 판정 |');
console.log('|---|---|---|---|---|---|---|---|');
let W = 0, L = 0, Z = 0, iW = 0, iL = 0, iZ = 0;
w60.forEach((a, i) => {
  const b = w252[i];
  const da = (b.stats.finalAfterTax - a.stats.finalAfterTax) / E;
  const dp = (b.stats.finalAfterTax / a.stats.finalAfterTax - 1) * 100;
  let v;
  if (dp > 0.01) { v = '승'; W++; if (a.independent) iW++; }
  else if (dp < -0.01) { v = '패'; L++; if (a.independent) iL++; }
  else { v = '무'; Z++; if (a.independent) iZ++; }
  console.log(`| ${i + 1} | ${a.startDate}~${a.endDate} | ${a.source === 'sim' ? '합성' : '실제'}${a.independent ? ' ◆' : ''} | ` +
    `${eok(a.stats.finalAfterTax)}억 | ${eok(b.stats.finalAfterTax)}억 | ${pct(da)} | ${pct(dp)}% | ${v} |`);
});
console.log(`\n합계 ${W}승 / ${L}패 / ${Z}무   (독립창 ${iW}승 / ${iL}패 / ${iZ}무)`);

// 총자산 합계 관점
const s60 = w60.reduce((s, w) => s + w.stats.finalAfterTax, 0);
const s252 = w252.reduce((s, w) => s + w.stats.finalAfterTax, 0);
console.log(`23창 세후총자산 합계: 60일 ${eok(s60)}억 → 252일 ${eok(s252)}억  (${pct((s252 / s60 - 1) * 100)}%)`);
const ds = w60.map((a, i) => (w252[i].stats.finalAfterTax / a.stats.finalAfterTax - 1) * 100);
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const med = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log(`창별 변화율: 평균 ${pct(mean(ds))}%  중앙 ${pct(med(ds))}%  최고 ${pct(Math.max(...ds))}%  최악 ${pct(Math.min(...ds))}%`);

// ── 격자를 촘촘하게 했을 때 ────────────────────────────────────────────
console.log('\n\n=== 격자별 승패 요약 (전부 5년 창, 세후 총자산 기준) ===');
console.log('| 격자 | 창 수 | 승 | 패 | 무 | 평균Δ | 중앙Δ | 최고 | 최악 | 이긴창 평균 | 진창 평균 |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
const WIN = 252 * 5;
for (const [label, slide, data] of [
  ['1년 슬라이드 (보고서 기준)', 252, null],
  ['분기 슬라이드', 63, SIM_DATA],
  ['월 슬라이드', 21, SIM_DATA],
  ['2주 슬라이드', 10, SIM_DATA],
]) {
  let d;
  if (slide === 252) d = ds;
  else {
    d = [];
    for (let s = 0; s + WIN <= data.length; s += slide) {
      const sd = data[s][0], ed = data[s + WIN - 1][0];
      const a = runFinalBacktest(sd, ed, B60, data).stats.finalAfterTax;
      const b = runFinalBacktest(sd, ed, B252, data).stats.finalAfterTax;
      d.push((b / a - 1) * 100);
    }
  }
  const w = d.filter(x => x > 0.01), l = d.filter(x => x < -0.01), z = d.filter(x => Math.abs(x) <= 0.01);
  console.log(`| ${label} | ${d.length} | ${w.length} | ${l.length} | ${z.length} | ${pct(mean(d))}% | ${pct(med(d))}% | ` +
    `${pct(Math.max(...d))}% | ${pct(Math.min(...d))}% | ${w.length ? pct(mean(w)) : '-'}% | ${l.length ? pct(mean(l)) : '-'}% |`);
}
