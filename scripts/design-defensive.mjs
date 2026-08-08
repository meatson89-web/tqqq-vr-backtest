// 방어형 설정 탐색 — 부스터 + 완화매도 파라미터만으로 MDD를 어디까지 낮출 수 있나
//   node scripts/design-defensive.mjs
//
// 배경: 총자산이 5억~10억이 된 뒤의 반토막을 견딜 수 있느냐가 기준이다.
// 그래서 창 전체 MDD와 별도로 "총자산이 5억을 넘은 뒤의 MDD"를 따로 잰다.
// 실제로 겪는 고통은 자산이 커진 뒤의 낙폭이지 1억 시절의 낙폭이 아니다.
//
// 닷컴(2000~2002)은 제외한다 — 시작일이 2003-01 이전인 합성 창 4개를 뺀 19창.
// 남는 하락장: 2008 금융위기, 2015~16, 2018Q4, 2020 코로나, 2022 긴축.
//
// 구조적 한계를 먼저 밝힌다. 매도 조건에 `수익률 >= 25%`가 걸려 있어(backtest.js)
// 하락이 진행되면 매도가 발동하지 못한다. 따라서 이 두 파라미터로 가능한 것은
// "하락 도중 현금화"가 아니라 "고점에서 더 팔아두고(완화매도) 하락 도중 덜 쓰기(부스터)"다.

import { runFinalBacktest, getRollingWindows, DEFAULT_SETTINGS, TQQQ_DATA, dataForSource } from '../src/lib/backtest.js';

const B = DEFAULT_SETTINGS;
const BUY_ONLY = { ...B, sellRsi: 100, relaxEnabled: false, enabled: false, throttleEnabled: false };
const EOK = 1e8;

// ── 창 구성 ──────────────────────────────────────────────────────────────
const wins = getRollingWindows(B).filter(w => w.startDate >= '2003-01-01');
console.log(`닷컴 제외 5년 창 ${wins.length}개: ${wins.map(w => w.startDate.slice(0, 7)).join(' ')}\n`);

// ── 측정 ─────────────────────────────────────────────────────────────────
// mddAfter: 총자산이 threshold를 처음 넘은 뒤 구간만으로 계산한 최대낙폭.
function mddFrom(daily, from = 0) {
  let peak = -Infinity, worst = 0;
  for (let i = from; i < daily.length; i++) {
    if (daily[i].total > peak) peak = daily[i].total;
    const dd = daily[i].total / peak - 1;
    if (dd < worst) worst = dd;
  }
  return worst * 100;
}
function firstIdxAbove(daily, thr) {
  const i = daily.findIndex(d => d.total >= thr);
  return i;
}
function measure(sd, ed, settings, data) {
  const r = runFinalBacktest(sd, ed, settings, data);
  const i5 = firstIdxAbove(r.daily, 5 * EOK);
  return {
    final: r.stats.finalAfterTax, mdd: r.stats.mdd, sells: r.stats.sellCount,
    totalIn: r.stats.totalIn, tax: r.stats.taxPaid,
    mdd5: i5 >= 0 ? mddFrom(r.daily, i5) : NaN,      // 5억 돌파 후 MDD
    peakTotal: Math.max(...r.daily.map(d => d.total)),
    daily: r.daily,
  };
}
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// 기준선
const buyRows = wins.map(w => measure(w.startDate, w.endDate, BUY_ONLY, dataForSource(w.source)));
const baseRows = wins.map(w => measure(w.startDate, w.endDate, B, dataForSource(w.source)));

function evaluate(settings) {
  const mdds = [], mdd5s = [], ratios = [], vsBase = [];
  for (let i = 0; i < wins.length; i++) {
    const w = wins[i];
    const m = measure(w.startDate, w.endDate, settings, dataForSource(w.source));
    mdds.push(m.mdd);
    if (!isNaN(m.mdd5)) mdd5s.push(m.mdd5);
    ratios.push(m.final / buyRows[i].final);
    vsBase.push(m.final / baseRows[i].final);
  }
  return {
    mddAvg: mean(mdds), mddWorst: Math.min(...mdds),
    mdd5Avg: mdd5s.length ? mean(mdd5s) : NaN, mdd5Worst: mdd5s.length ? Math.min(...mdd5s) : NaN,
    n5: mdd5s.length,
    vsBuyMed: median(ratios), vsBuyWin: ratios.filter(x => x > 1).length,
    vsBaseMed: median(vsBase),
  };
}

// ── 탐색 그리드 ──────────────────────────────────────────────────────────
const boosters = [{ enabled: false, tag: 'OFF' }];
for (const ratioPct of [10, 20, 30, 45, 60])
  for (const drawdownPct of [30, 40, 50])
    for (const lookback of [60, 120])
      boosters.push({ enabled: true, ratioPct, drawdownPct, lookback, tag: `r${ratioPct}/d${drawdownPct}/L${lookback}` });

const relaxes = [{ relaxEnabled: false, tag: 'OFF' }];
for (const relaxMonths of [3, 5, 7, 9])
  for (const relaxRsiDrop of [0, 5, 10])
    for (const relaxDispDrop of [12, 20, 28])
      for (const relaxSellFrac of [0.05, 0.20, 0.40, 0.70])
        relaxes.push({
          relaxEnabled: true, relaxMonths, relaxRsiDrop, relaxDispDrop, relaxSellFrac,
          tag: `m${relaxMonths}/rsi-${relaxRsiDrop}/disp-${relaxDispDrop}/f${relaxSellFrac * 100}`,
        });

console.log(`탐색: 부스터 ${boosters.length} × 완화매도 ${relaxes.length} = ${boosters.length * relaxes.length}설정`);
const t0 = Date.now();
const results = [];
for (const bo of boosters) {
  for (const rx of relaxes) {
    const { tag: bt, ...bp } = bo, { tag: rt, ...rp } = rx;
    const s = { ...B, ...bp, ...rp };
    results.push({ boost: bt, relax: rt, settings: s, ...evaluate(s) });
  }
}
console.log(`완료 ${((Date.now() - t0) / 1000).toFixed(0)}초\n`);

// ── 기준선 출력 ──────────────────────────────────────────────────────────
const baseEval = evaluate(B);
const show = (label, e) => console.log(
  `  ${label.padEnd(14)} MDD 평균 ${e.mddAvg.toFixed(1)}%  최악 ${e.mddWorst.toFixed(1)}%  │  ` +
  `5억 이후 MDD 평균 ${isNaN(e.mdd5Avg) ? '  —  ' : e.mdd5Avg.toFixed(1) + '%'} 최악 ${isNaN(e.mdd5Worst) ? '  —  ' : e.mdd5Worst.toFixed(1) + '%'} (${e.n5}창)  │  ` +
  `매수만 대비 중앙 ${e.vsBuyMed.toFixed(2)}배 우세 ${e.vsBuyWin}/${wins.length}  기본대비 ${e.vsBaseMed.toFixed(2)}배`);
console.log('기준선');
show('현재 기본값', baseEval);

// ── 파레토 경계 ──────────────────────────────────────────────────────────
// MDD를 1%p 구간으로 잘라, 각 구간에서 총자산(기본대비 중앙)이 가장 높은 설정.
console.log('\n=== MDD-수익 파레토 경계 (MDD 평균 구간별 최고 성과) ===');
console.log('MDD평균구간   부스터              완화매도                     MDD최악   5억후MDD평균/최악  매수만대비  기본대비');
const byBucket = new Map();
for (const r of results) {
  const k = Math.floor(-r.mddAvg);
  const cur = byBucket.get(k);
  if (!cur || r.vsBaseMed > cur.vsBaseMed) byBucket.set(k, r);
}
for (const k of [...byBucket.keys()].sort((a, b) => a - b)) {
  const r = byBucket.get(k);
  console.log(`-${k}~-${k + 1}%`.padEnd(14) + r.boost.padEnd(20) + r.relax.padEnd(29) +
    `${r.mddWorst.toFixed(0)}%`.padStart(7) +
    `${isNaN(r.mdd5Avg) ? '—' : r.mdd5Avg.toFixed(0) + '%'}/${isNaN(r.mdd5Worst) ? '—' : r.mdd5Worst.toFixed(0) + '%'}`.padStart(18) +
    `${r.vsBuyMed.toFixed(2)}배(${r.vsBuyWin})`.padStart(13) + `${r.vsBaseMed.toFixed(2)}배`.padStart(9));
}

// ── 조건별 최적 ──────────────────────────────────────────────────────────
const pick = (label, filter, score) => {
  const c = results.filter(filter);
  if (!c.length) { console.log(`\n${label}: 조건을 만족하는 설정 없음`); return null; }
  const best = c.reduce((a, b) => (score(b) > score(a) ? b : a));
  console.log(`\n${label}  (후보 ${c.length}개)`);
  console.log(`  부스터 ${best.boost}   완화매도 ${best.relax}`);
  show('', best);
  return best;
};

console.log('\n' + '='.repeat(118));
console.log('조건별 최적 설정');
console.log('='.repeat(118));
const cands = {};
cands.balanced = pick('[균형] 매수만 대비 이기면서(중앙>1.0) MDD 평균 최소',
  r => r.vsBuyMed > 1.0, r => r.mddAvg);
cands.mdd55 = pick('[안정] 5억 이후 MDD 평균 -55% 이내에서 총자산 최대',
  r => r.mdd5Avg >= -55, r => r.vsBaseMed);
cands.mdd50 = pick('[강한안정] 5억 이후 MDD 평균 -50% 이내에서 총자산 최대',
  r => r.mdd5Avg >= -50, r => r.vsBaseMed);
cands.keep90 = pick('[수익유지] 기본값 대비 총자산 90% 이상 유지하며 MDD 최소',
  r => r.vsBaseMed >= 0.90, r => r.mddAvg);

// ── 후보 상세: 전체구간 경로 ─────────────────────────────────────────────
console.log('\n' + '='.repeat(118));
console.log('후보별 전체구간 2010-02~2026-08 (실제 TQQQ) — 자산이 커진 뒤의 낙폭');
console.log('='.repeat(118));
const named = [['현재 기본값', B], ...Object.entries(cands).filter(([, v]) => v).map(([k, v]) => [k, v.settings])];
console.log('설정'.padEnd(14) + '세후 총자산'.padStart(12) + '  전체MDD' + '  5억이후MDD' + '  10억이후MDD' + '  매도'.padStart(6) + '  납세'.padStart(10));
for (const [label, s] of named) {
  const r = runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], s, TQQQ_DATA);
  const i5 = firstIdxAbove(r.daily, 5 * EOK), i10 = firstIdxAbove(r.daily, 10 * EOK);
  console.log(label.padEnd(14) + `${(r.stats.finalAfterTax / EOK).toFixed(0)}억`.padStart(12) +
    `${r.stats.mdd.toFixed(1)}%`.padStart(9) +
    `${i5 >= 0 ? mddFrom(r.daily, i5).toFixed(1) + '%' : '—'}`.padStart(12) +
    `${i10 >= 0 ? mddFrom(r.daily, i10).toFixed(1) + '%' : '—'}`.padStart(13) +
    `${r.stats.sellCount}회`.padStart(6) + `${(r.stats.taxPaid / EOK).toFixed(0)}억`.padStart(10));
}
