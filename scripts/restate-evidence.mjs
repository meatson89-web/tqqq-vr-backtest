// 전략 설명에 적을 수치를 새 기준(1년 슬라이드 23창 / 독립 5창)으로 다시 뽑는다
//   node scripts/restate-evidence.mjs
// 화면의 롤링 윈도우가 분기 46개 → 1년 23개로 바뀌었는데 설명문의 수치는 옛 기준이라
// 서로 어긋난다. getRollingWindows와 똑같은 창 목록을 써서 다시 측정한다.

import { runFinalBacktest, getRollingWindows, DEFAULT_SETTINGS, TQQQ_DATA, SIM_DATA, dataForSource } from '../src/lib/backtest.js';

const wins = getRollingWindows(DEFAULT_SETTINGS);
const pct = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const fmtB = v => `${(v / 1e8).toFixed(2)}억`;
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

function boot(xs, blockLen, B = 4000) {
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

// base/변형 두 설정의 세후 총자산 차이(%)를 창별로
function measure(label, baseOv, varOv) {
  const per = wins.map(w => {
    const data = dataForSource(w.source);
    const b = runFinalBacktest(w.startDate, w.endDate, { ...DEFAULT_SETTINGS, ...baseOv }, data).stats;
    const v = runFinalBacktest(w.startDate, w.endDate, { ...DEFAULT_SETTINGS, ...varOv }, data).stats;
    return { w, d: (v.finalAfterTax / b.finalAfterTax - 1) * 100 };
  });
  const all = per.map(p => p.d);
  const ind = per.filter(p => p.w.independent);
  const real = per.filter(p => p.w.source === 'real').map(p => p.d);
  const sim = per.filter(p => p.w.source === 'sim').map(p => p.d);
  const [lo, hi] = boot(all, 5);   // 5년 창 / 1년 슬라이드 = 5개가 한 블록

  const fb = runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], { ...DEFAULT_SETTINGS, ...baseOv }).stats;
  const fv = runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], { ...DEFAULT_SETTINGS, ...varOv }).stats;

  console.log(`\n■ ${label}`);
  console.log(`  전체 23창   평균 ${pct(mean(all))}  중앙 ${pct(median(all))}  개선 ${all.filter(x => x > 0).length}/23  블록95%CI [${lo.toFixed(1)}, ${hi.toFixed(1)}]`);
  console.log(`  실제 12창   평균 ${pct(mean(real))}  개선 ${real.filter(x => x > 0).length}/12`);
  console.log(`  합성 11창   평균 ${pct(mean(sim))}  개선 ${sim.filter(x => x > 0).length}/11`);
  console.log(`  독립 5창    평균 ${pct(mean(ind.map(p => p.d)))}  개선 ${ind.filter(p => p.d > 0).length}/5`);
  for (const p of ind) console.log(`      ${p.w.startDate.slice(0, 7)}~${p.w.endDate.slice(0, 7)} ${p.w.source === 'sim' ? '합성' : '실제'}  ${pct(p.d).padStart(7)}`);
  console.log(`  전체구간(실제 2010~2026)  ${fmtB(fb.finalAfterTax)} → ${fmtB(fv.finalAfterTax)}  ${pct((fv.finalAfterTax / fb.finalAfterTax - 1) * 100)}   MDD ${fb.mdd.toFixed(1)}% → ${fv.mdd.toFixed(1)}%`);
}

console.log(`창 ${wins.length}개 (실제 ${wins.filter(w => w.source === 'real').length} / 합성 ${wins.filter(w => w.source === 'sim').length}), 독립 ${wins.filter(w => w.independent).length}개`);

measure('과열 스로틀 (끄기 → 켜기, RSI70↑ POOL 0%)', { throttleEnabled: false }, {});
measure('완화매도 (끄기 → 켜기)', { relaxEnabled: false }, {});
measure('POOL 부스터 (끄기 → 켜기)', { enabled: false }, {});
measure('대조군: RSI 무관 상시 2.5%', { throttleEnabled: false }, { throttleEnabled: true, throttleTiers: [[0, 2.5]] });

// 현재 기본 설정의 절대 성적 (설명문에 쓸 기준선)
console.log('\n■ 현재 기본 설정 절대 성적');
for (const w of wins.filter(x => x.independent)) {
  const s = w.stats;
  console.log(`  ${w.startDate.slice(0, 7)}~${w.endDate.slice(0, 7)} ${w.source === 'sim' ? '합성' : '실제'}  납입 ${fmtB(s.totalIn)} → ${fmtB(s.finalAfterTax)} (원금의 ${(s.finalAfterTax / s.totalIn * 100).toFixed(0)}%)  MDD ${s.mdd.toFixed(0)}%  매도 ${s.sellCount}회`);
}
const full = runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], DEFAULT_SETTINGS).stats;
console.log(`  전체 2010~2026  납입 ${fmtB(full.totalIn)} → ${fmtB(full.finalAfterTax)}  IRR ${full.irr.toFixed(1)}%  MDD ${full.mdd.toFixed(1)}%  납세 ${fmtB(full.taxPaid)}  매도 ${full.sellCount}회`);

// 매도 없는 단순 적립식 비교 (설명문의 "757억" 갱신용)
const noSell = runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0],
  { ...DEFAULT_SETTINGS, relaxEnabled: false, enabled: false, throttleEnabled: false, poolCapKRW: 0 }).stats;
console.log(`  (참고) 현재 설정 세전 ${fmtB(full.finalTotal)} / 세후 ${fmtB(full.finalAfterTax)}`);
console.log(`  (참고) 매도규칙 그대로·부스터/완화/스로틀 전부 OFF: ${fmtB(noSell.finalAfterTax)}`);
