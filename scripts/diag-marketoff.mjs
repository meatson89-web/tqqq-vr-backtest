// 진단: 2004-03~2009-03, 2018-02~2023-02 구간에서 고점 이후 무슨 일이 있었나
//   node scripts/diag-marketoff.mjs
// 마켓오프(평단가 근접 시 분할매도) 규칙을 만들기 전에 확인할 것:
//   1) 총자산이 3억을 넘긴 적이 있는가 (넘지 않으면 규칙이 아예 발동 못 한다)
//   2) 고점에서 평단가 대비 수익률이 얼마였고, 어떤 속도로 무너졌나
//   3) +10% / +5% 선을 통과한 시점의 가격이 바닥 대비 얼마나 높았나

import { runFinalBacktest, DEFAULT_SETTINGS, dataForSource } from '../src/lib/backtest.js';

const CASES = [
  ['2004-03~2009-03 (금융위기)', '2004-03-16', '2009-03-17', 'sim'],
  ['2018-02~2023-02 (2022 하락)', '2018-02-14', '2023-02-15', 'real'],
  ['1999-03~2004-03 (닷컴)', '1999-03-11', '2004-03-15', 'sim'],
];
const fmtB = v => `${(v / 1e8).toFixed(2)}억`;

for (const [label, s, e, src] of CASES) {
  const { daily, stats } = runFinalBacktest(s, e, DEFAULT_SETTINGS, dataForSource(src));
  const peak = daily.reduce((a, b) => (b.total > a.total ? b : a));
  const trough = daily.slice(daily.indexOf(peak)).reduce((a, b) => (b.total < a.total ? b : a));
  const maxTotal = peak.total;
  const over3 = daily.filter(d => d.total >= 300_000_000);

  console.log(`\n■ ${label}`);
  console.log(`  최종 ${fmtB(stats.finalAfterTax)} (납입 ${fmtB(stats.totalIn)}), MDD ${stats.mdd.toFixed(1)}%, 매도 ${stats.sellCount}회`);
  console.log(`  총자산 최대 ${fmtB(maxTotal)} (${peak.date})  →  이후 최저 ${fmtB(trough.total)} (${trough.date})`);
  console.log(`  총자산 3억 이상이었던 날: ${over3.length}일 / ${daily.length}일` +
    (over3.length ? ` (${over3[0].date} ~ ${over3[over3.length - 1].date})` : '  ← 규칙이 발동할 수 없음'));

  // 고점 이후 수익률이 +10%, +5%, 0%를 처음 밑돈 날
  const after = daily.slice(daily.indexOf(peak));
  console.log(`  고점일 평단가 대비 수익률 ${peak.gainPct.toFixed(1)}% (가격 $${peak.priceUSD.toFixed(2)}, 평단 $${(peak.avgCost / 1350).toFixed(2)})`);
  for (const thr of [25, 20, 15, 10, 5, 0, -20, -50]) {
    const hit = after.find(d => d.gainPct <= thr);
    if (!hit) { console.log(`    +${thr}% 밑돈 날: 없음`); continue; }
    const low = Math.min(...after.map(d => d.priceUSD));
    console.log(`    ${thr >= 0 ? '+' : ''}${thr}% 밑돈 날 ${hit.date}  가격 $${hit.priceUSD.toFixed(2)}` +
      `  (고점가 대비 ${((hit.priceUSD / peak.priceUSD - 1) * 100).toFixed(0)}%, 이후 최저가 $${low.toFixed(2)} 대비 +${((hit.priceUSD / low - 1) * 100).toFixed(0)}%)` +
      `  총자산 ${fmtB(hit.total)}`);
  }
}
