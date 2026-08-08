// 내 전략(기본값) 단독 — 롤링 창별 총자산이 어떻게 나오는가
//   node scripts/windows-mine.mjs
//
// 비교 대상 없이 내 전략만 본다. 창 구성은 getRollingWindows와 동일한 규칙
// (1년 슬라이드 / 합성은 실제 데이터 없는 기간만 / 겹치지 않는 사슬을 독립 표시)에
// 창 길이만 5년·7.5년·10년으로 바꿨다.
//
// 창마다 납입금이 다르므로(창이 길수록 더 오래 적립) 금액만 보면 비교가 안 된다.
// 그래서 세후 총자산과 함께 "납입 대비 배수"를 같이 낸다.

import { runFinalBacktest, DEFAULT_SETTINGS, TQQQ_DATA, SIM_DATA, DATA_START } from '../src/lib/backtest.js';

const B = DEFAULT_SETTINGS;
const YR = 252;

const fmtB = v => `${(v / 1e8).toFixed(2)}억`;
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };

function buildWindows(windowDays) {
  const result = [];
  const push = (data, source, filter) => {
    for (let start = 0; start + windowDays <= data.length; start += YR) {
      const startDate = data[start][0];
      const endDate = data[start + windowDays - 1][0];
      if (filter && !filter(startDate)) continue;
      result.push({ startDate, endDate, source, data });
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
    const r = runFinalBacktest(w.startDate, w.endDate, B, w.data);
    const peak = Math.max(...r.daily.map(d => d.total));
    const s = r.stats;
    return {
      w, s, peak,
      mult: s.finalAfterTax / s.totalIn,      // 납입 대비 세후 배수
      keep: s.finalAfterTax / peak * 100,     // 고점 대비 잔존
    };
  });

  console.log(`\n${'='.repeat(112)}`);
  console.log(`내 전략 · ${label} 롤링 창 ${rows.length}개 (1년 슬라이드) — 전부 세후`);
  console.log('='.repeat(112));
  const H = '기간'.padEnd(17) + '구분'.padEnd(9) + '납입'.padStart(8) + '  세후 총자산'.padStart(13) +
    '  납입대비'.padStart(9) + '   IRR' + '     MDD' + '   고점잔존' + '  매도' + '     납세';
  console.log(H);
  console.log('─'.repeat(100));
  for (const { w, s, mult, keep } of rows) {
    const tag = (w.source === 'sim' ? '합성' : '실제') + (w.independent ? '·독립' : '    ');
    console.log(
      `${w.startDate.slice(0, 7)}~${w.endDate.slice(0, 7)}`.padEnd(17) + tag.padEnd(9) +
      fmtB(s.totalIn).padStart(8) + fmtB(s.finalAfterTax).padStart(13) +
      `${mult.toFixed(2)}배`.padStart(9) +
      `${s.irr.toFixed(0)}%`.padStart(6) + `${s.mdd.toFixed(0)}%`.padStart(8) +
      `${keep.toFixed(0)}%`.padStart(9) + `${s.sellCount}회`.padStart(6) + fmtB(s.taxPaid).padStart(9));
  }

  const summarize = (name, rs) => {
    if (!rs.length) return;
    const m = rs.map(r => r.mult), ir = rs.map(r => r.s.irr), md = rs.map(r => r.s.mdd);
    console.log(`  ${name.padEnd(16)} 원금회복 ${String(rs.filter(r => r.mult >= 1).length).padStart(2)}/${rs.length}` +
      `  납입대비 중앙 ${median(m).toFixed(2)}배  평균 ${mean(m).toFixed(2)}배  최저 ${Math.min(...m).toFixed(2)}배  최고 ${Math.max(...m).toFixed(2)}배` +
      `  IRR 중앙 ${median(ir).toFixed(0)}%  MDD 평균 ${mean(md).toFixed(0)}%  최악 ${Math.min(...md).toFixed(0)}%`);
  };
  console.log('\n요약');
  summarize(`전체 ${rows.length}창`, rows);
  summarize(`실제 ${rows.filter(r => r.w.source === 'real').length}창`, rows.filter(r => r.w.source === 'real'));
  summarize(`합성 ${rows.filter(r => r.w.source === 'sim').length}창`, rows.filter(r => r.w.source === 'sim'));
  summarize(`독립 ${rows.filter(r => r.w.independent).length}창`, rows.filter(r => r.w.independent));

  // 분포 — 창을 무작위로 하나 뽑았을 때 어디쯤에 떨어지는가
  const m = rows.map(r => r.mult).sort((a, b) => a - b);
  console.log(`  분포(납입대비 배수)  최저 ${m[0].toFixed(2)}  하위25% ${quantile(m, 0.25).toFixed(2)}  중앙 ${median(m).toFixed(2)}` +
    `  상위25% ${quantile(m, 0.75).toFixed(2)}  최고 ${m[m.length - 1].toFixed(2)}` +
    `   원금손실 창 ${rows.filter(r => r.mult < 1).length}개`);
  return { label, rows };
}

const all = [report('5년', 5), report('7.5년', 7.5), report('10년', 10)];

console.log(`\n${'='.repeat(112)}`);
console.log('창 길이별 한눈 비교 (내 전략, 세후)');
console.log('='.repeat(112));
console.log('창길이'.padEnd(8) + '창수'.padStart(5) + '  납입'.padStart(9) + '  총자산중앙'.padStart(12) + '  총자산평균'.padStart(12) +
  '  납입대비중앙'.padStart(13) + '  최저'.padStart(8) + '  최고'.padStart(8) + '  IRR중앙'.padStart(9) + '  MDD평균'.padStart(9) + '  원금손실');
for (const { label, rows } of all) {
  const fa = rows.map(r => r.s.finalAfterTax), m = rows.map(r => r.mult);
  console.log(label.padEnd(8) + String(rows.length).padStart(5) +
    fmtB(mean(rows.map(r => r.s.totalIn))).padStart(9) +
    fmtB(median(fa)).padStart(12) + fmtB(mean(fa)).padStart(12) +
    `${median(m).toFixed(2)}배`.padStart(13) + `${Math.min(...m).toFixed(2)}배`.padStart(8) + `${Math.max(...m).toFixed(2)}배`.padStart(8) +
    `${median(rows.map(r => r.s.irr)).toFixed(0)}%`.padStart(9) +
    `${mean(rows.map(r => r.s.mdd)).toFixed(0)}%`.padStart(9) +
    `${rows.filter(r => r.mult < 1).length}/${rows.length}`.padStart(10));
}
