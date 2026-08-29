// 조정예상매도 — 2단계: 기존 전략 대비 효과 측정
//
//   A 기존       완화매도 ON,  조정예상 OFF   (= 현재 배포된 전략)
//   B 완화만제거  완화매도 OFF, 조정예상 OFF   (완화매도를 뺀 것만의 효과를 분리)
//   C 교체       완화매도 OFF, 조정예상 ON    (사용자 요청안)
//
// 창 구성은 windows-mine.mjs와 같은 규칙(1년 슬라이드, 합성은 실데이터 없는 기간만).
// 창마다 납입금이 달라 금액만으로는 비교가 안 되므로 세후 "납입대비 배수"로 본다.
//
// 실행: node scripts/anticipate-compare.mjs [창길이년수]

import { runFinalBacktest, DEFAULT_SETTINGS, TQQQ_DATA, SIM_DATA, DATA_START } from '../src/lib/backtest.js';

const YR = 252;
const A = { ...DEFAULT_SETTINGS };
const B = { ...DEFAULT_SETTINGS, relaxEnabled: false };
const C = { ...DEFAULT_SETTINGS, relaxEnabled: false, anticipateEnabled: true };

export function buildWindows(windowDays) {
  const out = [];
  const push = (data, source, filter) => {
    for (let s = 0; s + windowDays <= data.length; s += YR) {
      const startDate = data[s][0], endDate = data[s + windowDays - 1][0];
      if (filter && !filter(startDate)) continue;
      out.push({ startDate, endDate, source, data });
    }
  };
  push(SIM_DATA, 'sim', d => d < DATA_START);
  push(TQQQ_DATA, 'real');
  let chainEnd = '';
  for (const w of out) if (w.startDate >= chainEnd) { w.independent = true; chainEnd = w.endDate; }
  return out;
}

export const run = (w, s) => {
  const r = runFinalBacktest(w.startDate, w.endDate, s, w.data);
  return { mult: r.stats.finalAfterTax / r.stats.totalIn, mdd: r.stats.mdd,
           irr: r.stats.irr, sells: r.stats.sellCount, ant: r.stats.antCount,
           antSold: r.stats.antSoldKRW, final: r.stats.finalAfterTax, totalIn: r.stats.totalIn };
};

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pc = (n, d) => ((n / d - 1) * 100);
const f = (v, d = 1) => (v > 0 ? '+' : '') + v.toFixed(d);

function report(years) {
  const wins = buildWindows(Math.round(YR * years));
  const rows = wins.map(w => ({ w, a: run(w, A), b: run(w, B), c: run(w, C) }));

  console.log(`\n${'='.repeat(120)}`);
  console.log(`${years}년 롤링 창 ${rows.length}개 — 세후 기준. A=기존 / B=완화만제거 / C=조정예상 교체`);
  console.log('='.repeat(120));
  console.log('기간'.padEnd(26) + '구분'.padEnd(7) +
    'A 배수'.padStart(8) + 'B 배수'.padStart(8) + 'C 배수'.padStart(8) +
    '  C-A'.padStart(8) + '   A MDD'.padStart(9) + '   C MDD'.padStart(9) + '  MDD차'.padStart(8) + '  조정매도'.padStart(9));
  console.log('─'.repeat(120));
  for (const { w, a, b, c } of rows) {
    console.log(
      `${w.startDate}~${w.endDate} `.padEnd(26) +
      `${w.source === 'sim' ? '합성' : '실제'}${w.independent ? '·독립' : '    '}`.padEnd(7) +
      a.mult.toFixed(2).padStart(8) + b.mult.toFixed(2).padStart(8) + c.mult.toFixed(2).padStart(8) +
      f(pc(c.mult, a.mult)).padStart(7) + '%' +
      a.mdd.toFixed(1).padStart(8) + '%' + c.mdd.toFixed(1).padStart(8) + '%' +
      f(c.mdd - a.mdd).padStart(7) + 'p' +
      String(c.ant).padStart(9));
  }

  const dCA = rows.map(r => pc(r.c.mult, r.a.mult));
  const dBA = rows.map(r => pc(r.b.mult, r.a.mult));
  const mCA = rows.map(r => r.c.mdd - r.a.mdd);
  console.log('─'.repeat(120));
  console.log(`총자산(납입대비 배수) C vs A — 평균 ${f(mean(dCA))}% · 중앙 ${f(med(dCA))}% · ` +
    `개선 ${dCA.filter(x => x > 0.5).length}창 / 악화 ${dCA.filter(x => x < -0.5).length}창 / 무변화 ${dCA.filter(x => Math.abs(x) <= 0.5).length}창`);
  console.log(`              B vs A — 평균 ${f(mean(dBA))}% (완화매도 제거만의 효과)`);
  console.log(`MDD C vs A — 평균 ${f(mean(mCA))}%p · 개선 ${mCA.filter(x => x > 0.5).length}창 / 악화 ${mCA.filter(x => x < -0.5).length}창`);
  console.log(`조정예상매도 발동 — 창당 평균 ${mean(rows.map(r => r.c.ant)).toFixed(1)}회, 0회인 창 ${rows.filter(r => r.c.ant === 0).length}개`);

  const ind = rows.filter(r => r.w.independent);
  if (ind.length) {
    console.log(`\n겹치지 않는 독립 창 ${ind.length}개만: ` +
      ind.map(r => `${r.w.startDate.slice(0, 7)} ${f(pc(r.c.mult, r.a.mult))}%`).join(' · '));
  }
  return rows;
}

// 전체 구간 (합성 27년 / 실제 16년)
function full() {
  console.log(`\n${'='.repeat(120)}`);
  console.log('전체 구간 (창 분할 없이 한 번에)');
  console.log('='.repeat(120));
  for (const [lbl, data] of [['합성 1999~2026', SIM_DATA], ['실제 2010~2026', TQQQ_DATA]]) {
    const w = { startDate: data[0][0], endDate: data[data.length - 1][0], data };
    const a = run(w, A), b = run(w, B), c = run(w, C);
    console.log(`\n${lbl}  (${w.startDate} ~ ${w.endDate})`);
    console.log(`  A 기존       세후 ${(a.final / 1e8).toFixed(2)}억  배수 ${a.mult.toFixed(2)}  MDD ${a.mdd.toFixed(1)}%  IRR ${a.irr.toFixed(1)}%  매도 ${a.sells}회`);
    console.log(`  B 완화만제거  세후 ${(b.final / 1e8).toFixed(2)}억  배수 ${b.mult.toFixed(2)}  MDD ${b.mdd.toFixed(1)}%  IRR ${b.irr.toFixed(1)}%  매도 ${b.sells}회`);
    console.log(`  C 조정예상    세후 ${(c.final / 1e8).toFixed(2)}억  배수 ${c.mult.toFixed(2)}  MDD ${c.mdd.toFixed(1)}%  IRR ${c.irr.toFixed(1)}%  매도 ${c.sells}회 (조정예상 ${c.ant}회, ${(c.antSold / 1e8).toFixed(1)}억)`);
    console.log(`  → C vs A: 총자산 ${f(pc(c.mult, a.mult))}% · MDD ${f(c.mdd - a.mdd)}%p`);
  }
}

// 스윕 스크립트가 buildWindows/run만 import할 때 본문이 재실행되지 않도록 가드.
if (process.argv[1] && process.argv[1].endsWith('anticipate-compare.mjs')) {
  const yearsArg = process.argv[2] ? [+process.argv[2]] : [5, 10];
  full();
  for (const y of yearsArg) report(y);
}
