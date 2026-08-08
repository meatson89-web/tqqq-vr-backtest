// 내 전략 vs 매수만 — 창 길이를 5년 / 7.5년 / 10년으로 바꿔가며 비교
//   node scripts/compare-buyonly-windows.mjs
//
// compare-buyonly.mjs와 같은 비교인데 창 길이만 파라미터로 뺐다.
// 창 구성 규칙은 getRollingWindows와 동일하다:
//   · 슬라이드 1년(252거래일)
//   · 합성 창은 실제 데이터가 없는 기간(시작일 < 2010-02)만
//   · 겹치지 않는 사슬을 탐욕적으로 이어 붙여 "독립" 표시
//
// 창을 길게 잡으면 표본 수는 줄지만 각 창이 상승·하락 국면을 모두 품게 된다.
// 5년 창에서 "국면에 따라 갈린다"고 나온 결론이 창을 늘리면 어떻게 되는지 본다.

import { runFinalBacktest, DEFAULT_SETTINGS, TQQQ_DATA, SIM_DATA, DATA_START } from '../src/lib/backtest.js';

const B = DEFAULT_SETTINGS;
const BUY_ONLY = { ...B, sellRsi: 100, relaxEnabled: false, enabled: false, throttleEnabled: false };
const YR = 252;

const fmtB = v => `${(v / 1e8).toFixed(2)}억`;
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

function measure(sd, ed, settings, data) {
  const r = runFinalBacktest(sd, ed, settings, data);
  const peak = Math.max(...r.daily.map(d => d.total));
  return { ...r.stats, peak, keep: r.stats.finalAfterTax / peak * 100 };
}

function buildWindows(windowDays) {
  const result = [];
  const push = (data, source, filter) => {
    for (let start = 0; start + windowDays <= data.length; start += YR) {
      const startDate = data[start][0];
      const endDate = data[start + windowDays - 1][0];
      if (filter && !filter(startDate)) continue;
      result.push({ startDate, endDate, source });
    }
  };
  push(SIM_DATA, 'sim', d => d < DATA_START);
  push(TQQQ_DATA, 'real');
  let chainEnd = '';
  for (const w of result) {
    if (w.startDate >= chainEnd) { w.independent = true; chainEnd = w.endDate; }
  }
  return result;
}

function report(label, years) {
  const wins = buildWindows(Math.round(YR * years));
  const rows = wins.map(w => {
    const data = w.source === 'sim' ? SIM_DATA : TQQQ_DATA;
    const mine = measure(w.startDate, w.endDate, B, data);
    const buy = measure(w.startDate, w.endDate, BUY_ONLY, data);
    return { w, mine, buy, ratio: mine.finalAfterTax / buy.finalAfterTax };
  });

  console.log(`\n${'='.repeat(118)}`);
  console.log(`${label} 롤링 창 ${rows.length}개 (1년 슬라이드, 전부 세후) — 배수 = 내 전략 ÷ 매수만`);
  console.log('='.repeat(118));
  const H = '기간'.padEnd(17) + '구분'.padEnd(9) + '납입'.padStart(8) +
    '   ┃ 내 전략: 총자산   IRR    MDD  잔존 매도 ┃ 매수만: 총자산   IRR    MDD  잔존 ┃  배수';
  console.log(H);
  console.log('─'.repeat(H.length - 4));
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

  const summarize = (name, rs) => {
    if (!rs.length) return null;
    const rt = rs.map(r => r.ratio);
    console.log(`  ${name.padEnd(18)} 내 전략 우세 ${String(rs.filter(r => r.ratio > 1).length).padStart(2)}/${rs.length}` +
      `  배수 중앙 ${median(rt).toFixed(2)}  평균 ${mean(rt).toFixed(2)}  최저 ${Math.min(...rt).toFixed(2)}  최고 ${Math.max(...rt).toFixed(2)}` +
      `  MDD평균 내 ${mean(rs.map(r => r.mine.mdd)).toFixed(1)}% vs 매수만 ${mean(rs.map(r => r.buy.mdd)).toFixed(1)}%`);
    return null;
  };
  console.log('\n요약');
  summarize(`전체 ${rows.length}창`, rows);
  summarize(`실제 ${rows.filter(r => r.w.source === 'real').length}창`, rows.filter(r => r.w.source === 'real'));
  summarize(`합성 ${rows.filter(r => r.w.source === 'sim').length}창`, rows.filter(r => r.w.source === 'sim'));
  summarize(`독립 ${rows.filter(r => r.w.independent).length}창`, rows.filter(r => r.w.independent));

  const losers = rows.filter(x => x.ratio <= 1).sort((a, b) => a.ratio - b.ratio);
  console.log(`\n매수만이 이긴 창 ${losers.length}개`);
  for (const r of losers) {
    console.log(`  ${r.w.startDate.slice(0, 7)}~${r.w.endDate.slice(0, 7)} ${r.w.source === 'sim' ? '합성' : '실제'}` +
      `  ${r.ratio.toFixed(2)}배  (내 ${fmtB(r.mine.finalAfterTax)} vs 매수만 ${fmtB(r.buy.finalAfterTax)}, 매도 ${r.mine.sellCount}회, 납세 ${fmtB(r.mine.taxPaid)})`);
  }
  return { label, years, rows };
}

const all = [report('5년', 5), report('7.5년', 7.5), report('10년', 10)];

// ── 창 길이별 한눈 비교 ──────────────────────────────────────────────────
console.log(`\n${'='.repeat(118)}`);
console.log('창 길이별 요약 — 창을 늘리면 결론이 어떻게 움직이는가');
console.log('='.repeat(118));
console.log('창길이'.padEnd(8) + '창수'.padStart(6) + '우세'.padStart(9) + '중앙'.padStart(8) + '평균'.padStart(8) +
  '최저'.padStart(8) + '최고'.padStart(8) + '   ┃ 독립창: 창수  우세  중앙  평균 ┃ MDD평균 내 / 매수만');
for (const { label, rows } of all) {
  const rt = rows.map(r => r.ratio);
  const ind = rows.filter(r => r.w.independent);
  const irt = ind.map(r => r.ratio);
  console.log(label.padEnd(8) + String(rows.length).padStart(6) +
    `${rows.filter(r => r.ratio > 1).length}/${rows.length}`.padStart(9) +
    `${median(rt).toFixed(2)}`.padStart(8) + `${mean(rt).toFixed(2)}`.padStart(8) +
    `${Math.min(...rt).toFixed(2)}`.padStart(8) + `${Math.max(...rt).toFixed(2)}`.padStart(8) + '   ┃' +
    String(ind.length).padStart(11) + `${ind.filter(r => r.ratio > 1).length}/${ind.length}`.padStart(6) +
    `${median(irt).toFixed(2)}`.padStart(6) + `${mean(irt).toFixed(2)}`.padStart(6) + ' ┃' +
    `${mean(rows.map(r => r.mine.mdd)).toFixed(1)}% / ${mean(rows.map(r => r.buy.mdd)).toFixed(1)}%`.padStart(20));
}
