// 방어형 3차 — 매도 문턱(sellRsi)까지 포함해 현금 확보 한계를 다시 본다.
//   node scripts/design-defensive3.mjs
//
// 2차에서 부스터+완화매도만으로는 고점 주식비중을 69%→44%까지밖에 못 낮췄다.
// sellRsi는 "정상 매도"의 문턱이고 한 번 걸리면 보유의 70%를 판다. 현금을 만드는
// 가장 굵은 손잡이인데 2차 그리드에 없었다. 낮추면 더 자주·더 일찍 팔아 현금이
// 쌓인다. 대가는 세금과 상승장 이탈이다.

import { runFinalBacktest, getRollingWindows, DEFAULT_SETTINGS, TQQQ_DATA, dataForSource } from '../src/lib/backtest.js';

const B = DEFAULT_SETTINGS;
const BUY_ONLY = { ...B, sellRsi: 100, relaxEnabled: false, enabled: false, throttleEnabled: false };
const EOK = 1e8;
const wins = getRollingWindows(B).filter(w => w.startDate >= '2003-01-01');
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
  return { final: r.stats.finalAfterTax, mdd: r.stats.mdd, sells: r.stats.sellCount, tax: r.stats.taxPaid,
           mdd5: i5 >= 0 ? mddFrom(r.daily, i5) : NaN, peakStockPct: pkStock * 100 };
}
const buy = wins.map(w => measure(w, BUY_ONLY));
const base = wins.map(w => measure(w, B));

function evaluate(s) {
  const all = wins.map(w => measure(w, s));
  const m5 = all.map(x => x.mdd5).filter(x => !isNaN(x));
  const realI = wins.map((w, i) => w.source === 'real' ? i : -1).filter(i => i >= 0);
  const m5r = realI.map(i => all[i].mdd5).filter(x => !isNaN(x));
  const rr = all.map((x, i) => x.final / buy[i].final);
  const rb = all.map((x, i) => x.final / base[i].final);
  return { all,
    mddAvg: mean(all.map(x => x.mdd)),
    mdd5Avg: mean(m5), mdd5Worst: Math.min(...m5),
    mdd5RealAvg: mean(m5r), mdd5RealWorst: Math.min(...m5r),
    vsBuyMed: median(rr), vsBuyWin: rr.filter(x => x > 1).length, vsBaseMed: median(rb),
    peakStock: mean(all.map(x => x.peakStockPct)), sells: mean(all.map(x => x.sells)) };
}

// ── 그리드 ───────────────────────────────────────────────────────────────
const boosters = [
  { enabled: false, tag: 'OFF' },
  { enabled: true, ratioPct: 20, drawdownPct: 50, lookback: 120, tag: 'r20/d50/L120' },
  { enabled: true, ratioPct: 45, drawdownPct: 50, lookback: 120, tag: 'r45/d50/L120' },
  { enabled: true, ratioPct: 60, drawdownPct: 50, lookback: 120, tag: 'r60/d50/L120' },
  { enabled: true, ratioPct: 45, drawdownPct: 40, lookback: 120, tag: 'r45/d40/L120' },
  { enabled: true, ratioPct: 45, drawdownPct: 30, lookback: 60, tag: 'r45/d30/L60' },
  { enabled: true, ratioPct: 60, drawdownPct: 30, lookback: 60, tag: 'r60/d30/L60(기본)' },
];
const relaxes = [{ relaxEnabled: false, tag: 'OFF' }];
for (const relaxMonths of [3, 5, 7])
  for (const relaxRsiDrop of [0, 5, 10])
    for (const relaxDispDrop of [12, 20, 28])
      for (const relaxSellFrac of [0.05, 0.20, 0.40, 0.70])
        relaxes.push({ relaxEnabled: true, relaxMonths, relaxRsiDrop, relaxDispDrop, relaxSellFrac,
          tag: `m${relaxMonths}/rsi-${relaxRsiDrop}/disp-${relaxDispDrop}/f${relaxSellFrac * 100}` });
const sellRsis = [58, 62, 66, 70, 73];

console.log(`탐색: 부스터 ${boosters.length} × 완화매도 ${relaxes.length} × sellRsi ${sellRsis.length} = ${boosters.length * relaxes.length * sellRsis.length}설정`);
const t0 = Date.now();
const results = [];
for (const bo of boosters) for (const rx of relaxes) for (const sellRsi of sellRsis) {
  const { tag: bt, ...bp } = bo, { tag: rt, ...rp } = rx;
  const s = { ...B, ...bp, ...rp, sellRsi };
  results.push({ boost: bt, relax: rt, sellRsi, settings: s, ...evaluate(s) });
}
console.log(`완료 ${((Date.now() - t0) / 1000).toFixed(0)}초\n`);

const baseEval = evaluate(B);
console.log('='.repeat(122));
console.log('한계 — sellRsi를 넣으면 어디까지 가나');
console.log('='.repeat(122));
console.log(`  5억이후 MDD 평균 최선   ${Math.max(...results.map(r => r.mdd5Avg)).toFixed(1)}%   (2차 -29.7%, 기본값 ${baseEval.mdd5Avg.toFixed(1)}%)`);
console.log(`  5억이후 MDD 최악의 최선 ${Math.max(...results.map(r => r.mdd5Worst)).toFixed(1)}%   (2차 -65.7%, 기본값 ${baseEval.mdd5Worst.toFixed(1)}%)`);
console.log(`  고점 주식비중 최저      ${Math.min(...results.map(r => r.peakStock)).toFixed(0)}%   (2차 44%, 기본값 ${baseEval.peakStock.toFixed(0)}%)`);

// sellRsi별 최선
console.log('\n=== sellRsi별: 매수만 대비 이기는(중앙>1.0) 설정 중 5억이후 MDD 최선 ===');
console.log('sellRsi  부스터              완화매도                    5억후MDD 평균/최악  실제12창 평균/최악  고점주식  매도  매수만대비  기본대비');
for (const sr of sellRsis) {
  const c = results.filter(r => r.sellRsi === sr && r.vsBuyMed > 1.0);
  if (!c.length) { console.log(`${sr}`.padEnd(9) + '(매수만을 이기는 설정 없음)'); continue; }
  const b = c.reduce((a, x) => (x.mdd5Avg > a.mdd5Avg ? x : a));
  console.log(String(sr).padEnd(9) + b.boost.padEnd(20) + b.relax.padEnd(28) +
    `${b.mdd5Avg.toFixed(0)}%/${b.mdd5Worst.toFixed(0)}%`.padStart(16) +
    `${b.mdd5RealAvg.toFixed(0)}%/${b.mdd5RealWorst.toFixed(0)}%`.padStart(18) +
    `${b.peakStock.toFixed(0)}%`.padStart(9) + `${b.sells.toFixed(0)}회`.padStart(6) +
    `${b.vsBuyMed.toFixed(2)}(${b.vsBuyWin})`.padStart(11) + `${b.vsBaseMed.toFixed(2)}`.padStart(9));
}

// ── 최종 후보 ────────────────────────────────────────────────────────────
const pick = (f, sc) => { const c = results.filter(f); return c.length ? c.reduce((a, b) => (sc(b) > sc(a) ? b : a)) : null; };
const C = {
  '현재 기본값': { ...baseEval, boost: 'r60/d30/L60', relax: 'm7/rsi-0/disp-12/f5', sellRsi: 73, settings: B },
  'D 방어형 추천': pick(r => r.vsBuyMed >= 1.0 && r.vsBaseMed >= 0.80, r => r.mdd5Avg),
  'E 최대방어(수익 무시)': pick(() => true, r => r.mdd5Avg),
};
console.log('\n' + '='.repeat(122));
console.log('최종 후보');
console.log('='.repeat(122));
console.log('설정'.padEnd(22) + '부스터'.padEnd(18) + '완화매도'.padEnd(27) + 'sellRsi' + ' │ 5억후 평균/최악 │ 실제12창 평균/최악 │ 고점주식 │ 매수만  기본');
for (const [k, v] of Object.entries(C)) {
  if (!v) continue;
  console.log(k.padEnd(22) + v.boost.padEnd(18) + v.relax.padEnd(27) + String(v.sellRsi).padStart(5) + '  │' +
    `${v.mdd5Avg.toFixed(0)}%/${v.mdd5Worst.toFixed(0)}%`.padStart(14) + ' │' +
    `${v.mdd5RealAvg.toFixed(0)}%/${v.mdd5RealWorst.toFixed(0)}%`.padStart(17) + ' │' +
    `${v.peakStock.toFixed(0)}%`.padStart(8) + ' │' +
    `${v.vsBuyMed.toFixed(2)}(${v.vsBuyWin})`.padStart(9) + `${v.vsBaseMed.toFixed(2)}`.padStart(6));
}

const D = C['D 방어형 추천'];
if (D) {
  console.log('\n' + '='.repeat(122));
  console.log('추천안 D 창별 상세');
  console.log('='.repeat(122));
  console.log('기간'.padEnd(18) + '구분'.padEnd(7) + '│ 기본값 총자산  MDD 5억후 │ 추천D 총자산  MDD 5억후 │  총자산비  5억후 개선  매도');
  for (let i = 0; i < wins.length; i++) {
    const w = wins[i], b = base[i], a = D.all[i];
    const imp = (isNaN(a.mdd5) || isNaN(b.mdd5)) ? NaN : a.mdd5 - b.mdd5;
    console.log(`${w.startDate.slice(0, 7)}~${w.endDate.slice(0, 7)}`.padEnd(18) + (w.source === 'sim' ? '합성' : '실제').padEnd(7) + '│' +
      `${(b.final / EOK).toFixed(1)}억`.padStart(11) + `${b.mdd.toFixed(0)}%`.padStart(6) + `${isNaN(b.mdd5) ? '—' : b.mdd5.toFixed(0) + '%'}`.padStart(7) + ' │' +
      `${(a.final / EOK).toFixed(1)}억`.padStart(10) + `${a.mdd.toFixed(0)}%`.padStart(6) + `${isNaN(a.mdd5) ? '—' : a.mdd5.toFixed(0) + '%'}`.padStart(7) + ' │' +
      `${(a.final / b.final).toFixed(2)}배`.padStart(10) + `${isNaN(imp) ? '—' : (imp >= 0 ? '+' : '') + imp.toFixed(0) + '%p'}`.padStart(11) + `${a.sells}회`.padStart(6));
  }
}

console.log('\n' + '='.repeat(122));
console.log('전체구간 2010-02~2026-08 (실제 TQQQ) — 16.5년 복리 경로에서 실제로 겪는 낙폭');
console.log('='.repeat(122));
console.log('설정'.padEnd(22) + '세후 총자산'.padStart(11) + '  전체MDD  5억이후  10억이후  50억이후' + '  매도'.padStart(6) + '  납세'.padStart(9));
for (const [k, v] of Object.entries(C)) {
  if (!v) continue;
  const r = runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], v.settings, TQQQ_DATA);
  const at = t => { const i = r.daily.findIndex(d => d.total >= t * EOK); return i >= 0 ? mddFrom(r.daily, i).toFixed(1) + '%' : '—'; };
  console.log(k.padEnd(22) + `${(r.stats.finalAfterTax / EOK).toFixed(0)}억`.padStart(11) +
    `${r.stats.mdd.toFixed(1)}%`.padStart(9) + at(5).padStart(9) + at(10).padStart(9) + at(50).padStart(10) +
    `${r.stats.sellCount}회`.padStart(6) + `${(r.stats.taxPaid / EOK).toFixed(0)}억`.padStart(9));
}
