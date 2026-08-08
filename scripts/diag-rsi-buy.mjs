// 진단: 수요일 POOL 재투자가 과열(RSI 높은) 구간에서 얼마나 일어나는가
//   node scripts/diag-rsi-buy.mjs
import { runFinalBacktest, DEFAULT_SETTINGS, TQQQ_DATA } from '../src/lib/backtest.js';

const WINS = [
  ['W1 2011-07~2016-07', '2011-07-26', '2016-07-27'],
  ['W2 2016-07~2021-07', '2016-07-28', '2021-07-29'],
  ['W3 2021-07~2026-08', '2021-07-30', '2026-08-06'],
  ['FULL 2010~2026', TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0]],
];
const fmtB = v => `${(v / 1e8).toFixed(2)}억`;

for (const [lbl, s, e] of WINS) {
  const { daily, stats: st } = runFinalBacktest(s, e, DEFAULT_SETTINGS);
  let nAll = 0, n70 = 0, n75 = 0, n80 = 0;
  let poolAll = 0, pool70 = 0;   // 그 주 수요일에 재투자된 POOL 금액(5% 기준 추정)
  for (const d of daily) {
    if (new Date(d.date + 'T00:00:00Z').getUTCDay() !== 3) continue;
    nAll++;
    const amt = d.pool * 0.05;
    poolAll += amt;
    if (d.rsi >= 70) { n70++; pool70 += amt; }
    if (d.rsi >= 75) n75++;
    if (d.rsi >= 80) n80++;
  }
  console.log(`${lbl}`);
  console.log(`  세후 ${fmtB(st.finalAfterTax)}  IRR ${st.irr.toFixed(1)}%  MDD ${st.mdd.toFixed(1)}%  매도 ${st.sellCount}회(완화 ${st.relaxedSellCount})  캡발동 ${st.capApplied}  부스터주 ${st.boostedWeeks}/${st.totalWeeks}`);
  console.log(`  수요일 ${nAll}회 중 RSI>=70 ${n70}회(${(n70 / nAll * 100).toFixed(0)}%), >=75 ${n75}회, >=80 ${n80}회`);
  console.log(`  POOL 재투자 총액 ${fmtB(poolAll)} 중 RSI>=70 구간 ${fmtB(pool70)} (${(pool70 / poolAll * 100).toFixed(0)}%)`);
}
