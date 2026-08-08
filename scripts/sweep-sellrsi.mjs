// 매도 RSI 임계(sellRsi)를 새 창 기준(23창 / 독립 5창)으로 다시 스윕
//   node scripts/sweep-sellrsi.mjs
//
// 73은 실제 TQQQ만 쓰던 시절, 분기 슬라이드 46창과 겹치지 않는 3구간으로 고른 값이다.
// 그 뒤 (1) 창을 1년 슬라이드 23개(합성 11 + 실제 12)로 바꿨고 (2) 과열 스로틀이
// 들어왔다. 스로틀은 매도 직후 되사는 걸 막는 규칙이라 매도 임계와 상호작용할 여지가
// 크다 — 임계를 낮춰 자주 팔아도 예전만큼 손해가 아닐 수 있다. 그래서 다시 잰다.

import fs from 'node:fs';
import { runFinalBacktest, getRollingWindows, DEFAULT_SETTINGS, TQQQ_DATA, dataForSource } from '../src/lib/backtest.js';

const QLD_DATA = JSON.parse(fs.readFileSync(new URL('../src/data/qld.json', import.meta.url), 'utf8'));
const wins = getRollingWindows(DEFAULT_SETTINGS);
const BASE_RSI = DEFAULT_SETTINGS.sellRsi;
const CANDS = [68, 69, 70, 71, 72, 73, 74, 75, 76, 78];
// 임계를 계속 올리면 결국 "안 파는 전략"이 된다. 그게 최적이라면 매도 규칙 자체가
// 손해라는 뜻이므로, 상한까지 밀어보고 내부 최적점이 정말 있는지 확인해야 한다.
const HIGH = [78, 80, 82, 85, 90, 100];

const pct = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const fmtB = v => `${(v / 1e8).toFixed(2)}억`;
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
function boot(xs, blockLen = 5, B = 4000) {
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

const cache = new Map();
function stat(w, rsi, extra = {}) {
  const k = `${w.id}|${rsi}|${JSON.stringify(extra)}`;
  if (!cache.has(k)) cache.set(k, runFinalBacktest(w.startDate, w.endDate,
    { ...DEFAULT_SETTINGS, ...extra, sellRsi: rsi }, dataForSource(w.source)).stats);
  return cache.get(k);
}
const fullStat = (rsi, extra = {}) => runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0],
  { ...DEFAULT_SETTINGS, ...extra, sellRsi: rsi }).stats;

function sweep(label, extra) {
  console.log(`\n=== ${label} ===`);
  console.log('sellRsi'.padEnd(9) + '23창평균 중앙값 개선     95%CI      실제12  합성11  독립5창(개선)   전체구간세후  매도수');
  const rows = [];
  for (const rsi of CANDS) {
    const ds = wins.map(w => (stat(w, rsi, extra).finalAfterTax / stat(w, BASE_RSI, extra).finalAfterTax - 1) * 100);
    const real = wins.map((w, i) => [w, ds[i]]).filter(([w]) => w.source === 'real').map(([, d]) => d);
    const sim = wins.map((w, i) => [w, ds[i]]).filter(([w]) => w.source === 'sim').map(([, d]) => d);
    const ind = wins.map((w, i) => [w, ds[i]]).filter(([w]) => w.independent).map(([, d]) => d);
    const [lo, hi] = boot(ds);
    const f = fullStat(rsi, extra);
    rows.push({ rsi, ds, m: mean(ds), lo, hi, ind, f });
    console.log(
      `${rsi}${rsi === BASE_RSI ? '*' : ' '}`.padEnd(9) +
      pct(mean(ds)).padStart(8) + pct(median(ds)).padStart(7) + `${ds.filter(x => x > 0).length}/23`.padStart(6) +
      `[${lo.toFixed(1)},${hi.toFixed(1)}]`.padStart(14) +
      pct(mean(real)).padStart(8) + pct(mean(sim)).padStart(8) +
      `${pct(mean(ind))}(${ind.filter(x => x > 0).length}/5)`.padStart(15) +
      fmtB(f.finalAfterTax).padStart(14) + `${f.sellCount}회`.padStart(7));
  }
  const best = [...rows].sort((a, b) => b.m - a.m)[0];
  console.log(`  → 23창 평균 최고: RSI ${best.rsi} (${pct(best.m)})   현재값 ${BASE_RSI} 대비 ${pct(best.m - rows.find(r => r.rsi === BASE_RSI).m)}p`);
  return rows;
}

console.log(`창 ${wins.length}개 (실제 ${wins.filter(w => w.source === 'real').length} / 합성 ${wins.filter(w => w.source === 'sim').length}), 독립 ${wins.filter(w => w.independent).length}개`);
console.log(`기준값 sellRsi=${BASE_RSI} (표의 모든 수치는 이 값 대비 세후 총자산 차이)`);

const withThrottle = sweep('현재 설정 (과열 스로틀 ON)', {});
sweep('과열 스로틀 OFF — 스로틀이 최적 임계를 옮겼는지 확인', { throttleEnabled: false });

// 독립 5창 상세 (현재 설정)
console.log('\n=== 독립 5창 상세 (과열 스로틀 ON, 73 대비) ===');
const indWins = wins.filter(w => w.independent);
console.log('sellRsi'.padEnd(9) + indWins.map(w => `${w.startDate.slice(2, 7)}~${w.endDate.slice(2, 7)}`.padStart(15)).join(''));
for (const rsi of CANDS) {
  console.log(`${rsi}${rsi === BASE_RSI ? '*' : ' '}`.padEnd(9) +
    indWins.map(w => pct((stat(w, rsi).finalAfterTax / stat(w, BASE_RSI).finalAfterTax - 1) * 100).padStart(15)).join(''));
}

// 절대값도 한 번
console.log('\n=== 전체구간 2010~2026 절대값 (과열 스로틀 ON) ===');
for (const rsi of CANDS) {
  const f = fullStat(rsi);
  console.log(`  RSI ${rsi}${rsi === BASE_RSI ? '*' : ' '}  세후 ${fmtB(f.finalAfterTax).padStart(10)}  IRR ${f.irr.toFixed(1)}%  MDD ${f.mdd.toFixed(1)}%  매도 ${String(f.sellCount).padStart(2)}회  납세 ${fmtB(f.taxPaid)}`);
}

// ── 대조군: 상한까지 밀면 "안 파는 전략"이 된다. 내부 최적점이 있는가 ──────
console.log('\n=== 상한 스윕 — "임계 올리기"가 결국 "매도 포기"인지 확인 ===');
console.log('RSI'.padEnd(6) + '23창평균'.padStart(9) + '개선'.padStart(7) + '독립5창'.padStart(9) + '전체구간세후'.padStart(14) + '매도수'.padStart(7) + '   MDD');
for (const rsi of HIGH) {
  const ds = wins.map(w => (stat(w, rsi).finalAfterTax / stat(w, BASE_RSI).finalAfterTax - 1) * 100);
  const ind = wins.map((w, i) => [w, ds[i]]).filter(([w]) => w.independent).map(([, d]) => d);
  const f = fullStat(rsi);
  console.log(String(rsi).padEnd(6) + pct(mean(ds)).padStart(9) + `${ds.filter(x => x > 0).length}/23`.padStart(7) +
    pct(mean(ind)).padStart(9) + fmtB(f.finalAfterTax).padStart(14) + `${f.sellCount}회`.padStart(7) + `   ${f.mdd.toFixed(1)}%`);
}
console.log('  RSI 90 이상은 매도 0회 = 순수 적립식과 같다.');

// ── 교차검증: QLD ─────────────────────────────────────────────────────────
console.log('\n=== QLD 교차검증 (1년 슬라이드 5년창, 73 대비) ===');
const qWins = [];
for (let s = 0; s + 252 * 5 <= QLD_DATA.length; s += 252) qWins.push([QLD_DATA[s][0], QLD_DATA[s + 252 * 5 - 1][0]]);
for (const rsi of [70, 72, 74, 75, 76, 78]) {
  const ds = qWins.map(([a, b]) => {
    const bs = runFinalBacktest(a, b, { ...DEFAULT_SETTINGS, sellRsi: BASE_RSI }, QLD_DATA).stats;
    const v = runFinalBacktest(a, b, { ...DEFAULT_SETTINGS, sellRsi: rsi }, QLD_DATA).stats;
    return (v.finalAfterTax / bs.finalAfterTax - 1) * 100;
  });
  console.log(`  RSI ${rsi}  평균 ${pct(mean(ds)).padStart(7)}  개선 ${ds.filter(x => x > 0).length}/${qWins.length}`);
}
