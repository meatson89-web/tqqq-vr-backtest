// 내 전략 vs 매수만(매도 없는 순수 적립식) — 롤링 5년 23창 비교
//   node scripts/compare-buyonly.mjs
//
// "매수만"은 sellRsi를 100으로 두어 매도 조건이 절대 걸리지 않게 만든 것이다.
// 매도가 없으면 POOL이 항상 0이라 부스터·과열 스로틀·비중캡도 자동으로 무력화되고,
// 실현손익이 없으니 양도세도 0이다. 즉 초기 일시매수 + 매주 수요일 정액매수만 남는다.
// 납입금은 두 전략이 동일하므로 최종 총자산을 그대로 비교하면 된다.

import { runFinalBacktest, getRollingWindows, DEFAULT_SETTINGS, TQQQ_DATA, dataForSource } from '../src/lib/backtest.js';

const B = DEFAULT_SETTINGS;
const BUY_ONLY = { ...B, sellRsi: 100, relaxEnabled: false, enabled: false, throttleEnabled: false };
const wins = getRollingWindows(B);

const fmtB = v => `${(v / 1e8).toFixed(2)}억`;
const pct = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

function measure(sd, ed, settings, data) {
  const r = runFinalBacktest(sd, ed, settings, data);
  const peak = Math.max(...r.daily.map(d => d.total));
  return { ...r.stats, peak, keep: r.stats.finalAfterTax / peak * 100 };
}

const rows = wins.map(w => {
  const d = dataForSource(w.source);
  const mine = measure(w.startDate, w.endDate, B, d);
  const buy = measure(w.startDate, w.endDate, BUY_ONLY, d);
  return { w, mine, buy, ratio: mine.finalAfterTax / buy.finalAfterTax };
});

console.log('내 전략(기본값) vs 매수만 — 5년 롤링 23창, 전부 세후');
console.log('창당 납입금은 두 전략 동일. 배수 = 내 전략 ÷ 매수만\n');
const H1 = '기간'.padEnd(17) + '구분'.padEnd(9) + '납입'.padStart(8) +
  '   ┃ 내 전략: 총자산   IRR    MDD  잔존 매도 ┃ 매수만: 총자산   IRR    MDD  잔존 ┃  배수';
console.log(H1);
console.log('─'.repeat(H1.length - 4));
for (const { w, mine, buy, ratio } of rows) {
  const tag = (w.source === 'sim' ? '합성' : '실제') + (w.independent ? '·독립' : '    ');
  console.log(
    `${w.startDate.slice(0, 7)}~${w.endDate.slice(0, 7)}`.padEnd(17) + tag.padEnd(9) +
    fmtB(mine.totalIn).padStart(8) + '   ┃' +
    fmtB(mine.finalAfterTax).padStart(11) + `${mine.irr.toFixed(0)}%`.padStart(6) +
    `${mine.mdd.toFixed(0)}%`.padStart(7) + `${mine.keep.toFixed(0)}%`.padStart(6) + `${mine.sellCount}회`.padStart(5) + ' ┃' +
    fmtB(buy.finalAfterTax).padStart(10) + `${buy.irr.toFixed(0)}%`.padStart(6) +
    `${buy.mdd.toFixed(0)}%`.padStart(7) + `${buy.keep.toFixed(0)}%`.padStart(6) + ' ┃' +
    `${ratio.toFixed(2)}배`.padStart(8));
}

// ── 요약 ─────────────────────────────────────────────────────────────────
const ratios = rows.map(r => r.ratio);
const wins23 = rows.filter(r => r.ratio > 1).length;
const indRows = rows.filter(r => r.w.independent);
const realRows = rows.filter(r => r.w.source === 'real');
const simRows = rows.filter(r => r.w.source === 'sim');
const summarize = (label, rs) => {
  const rt = rs.map(r => r.ratio);
  console.log(`  ${label.padEnd(16)} 내 전략 우세 ${String(rs.filter(r => r.ratio > 1).length).padStart(2)}/${rs.length}` +
    `  배수 중앙 ${median(rt).toFixed(2)}  평균 ${mean(rt).toFixed(2)}  최저 ${Math.min(...rt).toFixed(2)}  최고 ${Math.max(...rt).toFixed(2)}` +
    `  MDD평균 내 ${mean(rs.map(r => r.mine.mdd)).toFixed(1)}% vs 매수만 ${mean(rs.map(r => r.buy.mdd)).toFixed(1)}%`);
};
console.log('\n요약');
summarize('전체 23창', rows);
summarize('실제 12창', realRows);
summarize('합성 11창', simRows);
summarize('독립 5창', indRows);

// ── 전체구간 ─────────────────────────────────────────────────────────────
console.log('\n전체구간 2010-02 ~ 2026-08 (실제 TQQQ)');
const fm = measure(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], B, TQQQ_DATA);
const fbuy = measure(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], BUY_ONLY, TQQQ_DATA);
const fNoTax = runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], { ...B, taxEnabled: false }).stats;
console.log(`  납입 ${fmtB(fm.totalIn)}`);
console.log(`  내 전략   세후 ${fmtB(fm.finalAfterTax).padStart(10)}  IRR ${fm.irr.toFixed(1)}%  MDD ${fm.mdd.toFixed(1)}%  잔존 ${fm.keep.toFixed(0)}%  매도 ${fm.sellCount}회  납세 ${fmtB(fm.taxPaid)}`);
console.log(`  매수만    세후 ${fmtB(fbuy.finalAfterTax).padStart(10)}  IRR ${fbuy.irr.toFixed(1)}%  MDD ${fbuy.mdd.toFixed(1)}%  잔존 ${fbuy.keep.toFixed(0)}%  매도 0회  납세 0.00억`);
console.log(`  → ${(fm.finalAfterTax / fbuy.finalAfterTax).toFixed(2)}배 (세금이 없다고 가정하면 ${(fNoTax.finalTotal / fbuy.finalAfterTax).toFixed(2)}배)`);

// ── 매수만이 이긴 창은 어떤 창인가 ───────────────────────────────────────
console.log('\n매수만이 이긴 창');
for (const r of rows.filter(x => x.ratio <= 1).sort((a, b) => a.ratio - b.ratio)) {
  console.log(`  ${r.w.startDate.slice(0, 7)}~${r.w.endDate.slice(0, 7)} ${r.w.source === 'sim' ? '합성' : '실제'}` +
    `  ${r.ratio.toFixed(2)}배  (내 ${fmtB(r.mine.finalAfterTax)} vs 매수만 ${fmtB(r.buy.finalAfterTax)}, 매도 ${r.mine.sellCount}회, 납세 ${fmtB(r.mine.taxPaid)})`);
}
