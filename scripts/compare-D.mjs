// 추천안 D vs 현재 기본값 — 23창 전부의 총자산 MDD 변화
//   node scripts/compare-D.mjs
//
// D는 design-defensive3.mjs가 찾은 방어형 설정이다.
//   부스터   lookback 60→120, drawdownPct 30→50 (ratioPct 60 유지)
//   매도문턱 sellRsi 73→70
//   완화매도 relaxMonths 7→5, relaxDispDrop 12→20, relaxSellFrac 0.05→0.40
// 탐색 때는 닷컴 4창을 뺀 19창으로 골랐다. 여기서는 닷컴을 포함한 23창 전부를 낸다.

import { runFinalBacktest, getRollingWindows, DEFAULT_SETTINGS, TQQQ_DATA, dataForSource } from '../src/lib/backtest.js';

const B = DEFAULT_SETTINGS;
const D = {
  ...B,
  enabled: true, ratioPct: 60, drawdownPct: 50, lookback: 120,
  sellRsi: 70,
  relaxEnabled: true, relaxMonths: 5, relaxRsiDrop: 0, relaxDispDrop: 20, relaxSellFrac: 0.40,
};
const EOK = 1e8;
const wins = getRollingWindows(B);
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

function mddFrom(daily, from) {
  let peak = -Infinity, worst = 0;
  for (let i = from; i < daily.length; i++) {
    if (daily[i].total > peak) peak = daily[i].total;
    const dd = daily[i].total / peak - 1;
    if (dd < worst) worst = dd;
  }
  return worst * 100;
}
function measure(w, s) {
  const r = runFinalBacktest(w.startDate, w.endDate, s, dataForSource(w.source));
  const i5 = r.daily.findIndex(d => d.total >= 5 * EOK);
  let pk = 0, pkStock = 1;
  for (const d of r.daily) if (d.total > pk) { pk = d.total; pkStock = d.stockValue / d.total; }
  return { final: r.stats.finalAfterTax, mdd: r.stats.mdd, mdd5: i5 >= 0 ? mddFrom(r.daily, i5) : NaN,
           sells: r.stats.sellCount, tax: r.stats.taxPaid, peakStock: pkStock * 100, peak: pk };
}

const rows = wins.map(w => ({ w, b: measure(w, B), d: measure(w, D) }));

const H = '기간'.padEnd(17) + '구분'.padEnd(9) +
  '│  기본값: MDD  5억후MDD   총자산 │   D: MDD  5억후MDD   총자산 │  MDD개선  5억후개선  총자산비';
console.log('추천 D vs 기본값 — 5년 롤링 23창, 총자산 MDD 변화 (전부 세후)');
console.log('='.repeat(H.length));
console.log(H);
console.log('─'.repeat(H.length));
const f5 = v => isNaN(v) ? '—' : `${v.toFixed(0)}%`;
for (const { w, b, d } of rows) {
  const tag = (w.source === 'sim' ? '합성' : '실제') + (w.independent ? '·독립' : '    ');
  const dMdd = d.mdd - b.mdd;
  const d5 = (isNaN(d.mdd5) || isNaN(b.mdd5)) ? NaN : d.mdd5 - b.mdd5;
  console.log(
    `${w.startDate.slice(0, 7)}~${w.endDate.slice(0, 7)}`.padEnd(17) + tag.padEnd(9) + '│' +
    `${b.mdd.toFixed(0)}%`.padStart(11) + f5(b.mdd5).padStart(10) + `${(b.final / EOK).toFixed(1)}억`.padStart(9) + ' │' +
    `${d.mdd.toFixed(0)}%`.padStart(9) + f5(d.mdd5).padStart(10) + `${(d.final / EOK).toFixed(1)}억`.padStart(9) + ' │' +
    `${dMdd >= 0 ? '+' : ''}${dMdd.toFixed(0)}%p`.padStart(9) +
    `${isNaN(d5) ? '—' : (d5 >= 0 ? '+' : '') + d5.toFixed(0) + '%p'}`.padStart(11) +
    `${(d.final / b.final).toFixed(2)}배`.padStart(10));
}

// ── 요약 ─────────────────────────────────────────────────────────────────
const summarize = (label, rs) => {
  if (!rs.length) return;
  const bm = rs.map(r => r.b.mdd), dm = rs.map(r => r.d.mdd);
  const b5 = rs.map(r => r.b.mdd5).filter(x => !isNaN(x));
  const d5 = rs.map(r => r.d.mdd5).filter(x => !isNaN(x));
  const rt = rs.map(r => r.d.final / r.b.final);
  console.log(`  ${label.padEnd(14)} MDD 평균 ${mean(bm).toFixed(1)}% → ${mean(dm).toFixed(1)}%` +
    `  최악 ${Math.min(...bm).toFixed(1)}% → ${Math.min(...dm).toFixed(1)}%` +
    `  │ 5억후 평균 ${mean(b5).toFixed(1)}% → ${mean(d5).toFixed(1)}%` +
    `  최악 ${Math.min(...b5).toFixed(1)}% → ${Math.min(...d5).toFixed(1)}%` +
    `  │ 총자산 중앙 ${median(rt).toFixed(2)}배`);
};
console.log('\n요약');
summarize('전체 23창', rows);
summarize('닷컴 4창', rows.filter(r => r.w.startDate < '2003-01-01'));
summarize('탐색 19창', rows.filter(r => r.w.startDate >= '2003-01-01'));
summarize('실제 12창', rows.filter(r => r.w.source === 'real'));
summarize('독립 5창', rows.filter(r => r.w.independent));

// ── MDD 개선 분포 ────────────────────────────────────────────────────────
const imp = rows.map(r => r.d.mdd - r.b.mdd);
console.log(`\nMDD 개선 분포 (23창)  개선 ${imp.filter(x => x > 0.5).length}창 / 동일 ${imp.filter(x => Math.abs(x) <= 0.5).length}창 / 악화 ${imp.filter(x => x < -0.5).length}창`);
console.log(`  최대 개선 ${Math.max(...imp).toFixed(1)}%p   최대 악화 ${Math.min(...imp).toFixed(1)}%p   평균 ${mean(imp).toFixed(1)}%p`);
const imp5 = rows.map(r => (isNaN(r.d.mdd5) || isNaN(r.b.mdd5)) ? NaN : r.d.mdd5 - r.b.mdd5).filter(x => !isNaN(x));
console.log(`5억 이후 MDD 개선 (${imp5.length}창)  개선 ${imp5.filter(x => x > 0.5).length} / 동일 ${imp5.filter(x => Math.abs(x) <= 0.5).length} / 악화 ${imp5.filter(x => x < -0.5).length}` +
  `   최대 개선 ${Math.max(...imp5).toFixed(1)}%p   평균 ${mean(imp5).toFixed(1)}%p`);

// ── 반토막 기준 ──────────────────────────────────────────────────────────
console.log('\n"반토막(-50%) 넘는 창"이 몇 개나 줄었나');
for (const [lab, key] of [['창 전체 MDD', 'mdd'], ['5억 이후 MDD', 'mdd5']]) {
  const bs = rows.map(r => r.b[key]).filter(x => !isNaN(x));
  const ds = rows.map(r => r.d[key]).filter(x => !isNaN(x));
  console.log(`  ${lab.padEnd(14)} 기본값 ${bs.filter(x => x <= -50).length}/${bs.length}창  →  D ${ds.filter(x => x <= -50).length}/${ds.length}창`);
}

// ── 전체구간 ─────────────────────────────────────────────────────────────
console.log('\n전체구간 2010-02~2026-08 (실제 TQQQ)');
for (const [lab, s] of [['기본값', B], ['추천 D', D]]) {
  const r = runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], s, TQQQ_DATA);
  const at = t => { const i = r.daily.findIndex(x => x.total >= t * EOK); return i >= 0 ? mddFrom(r.daily, i).toFixed(1) + '%' : '—'; };
  console.log(`  ${lab.padEnd(8)} 세후 ${(r.stats.finalAfterTax / EOK).toFixed(0)}억`.padEnd(24) +
    `MDD ${r.stats.mdd.toFixed(1)}%   5억이후 ${at(5)}   10억이후 ${at(10)}   매도 ${r.stats.sellCount}회   납세 ${(r.stats.taxPaid / EOK).toFixed(0)}억`);
}
