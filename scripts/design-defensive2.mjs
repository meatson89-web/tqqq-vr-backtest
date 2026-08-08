// 방어형 설정 2차 — 최악 낙폭 기준으로 다시 걸고, 왜 바닥이 있는지 원인까지 본다.
//   node scripts/design-defensive2.mjs
//
// 1차(design-defensive.mjs)에서 "5억 이후 MDD 평균 -55% 이내" 조건이 전 설정을
// 통과해 제약이 안 됐다. 멘탈이 무너지는 건 평균이 아니라 최악의 한 번이므로
// 최악값으로 다시 건다. 동시에 "고점에서 주식 비중이 얼마였나"를 같이 재서
// MDD에 왜 바닥이 있는지 원인을 드러낸다.
//   총자산 MDD ≈ 고점 주식비중 × TQQQ 낙폭   →  주식비중을 못 낮추면 MDD도 못 낮춘다.

import { runFinalBacktest, getRollingWindows, DEFAULT_SETTINGS, TQQQ_DATA, dataForSource } from '../src/lib/backtest.js';

const B = DEFAULT_SETTINGS;
const BUY_ONLY = { ...B, sellRsi: 100, relaxEnabled: false, enabled: false, throttleEnabled: false };
const EOK = 1e8;
const wins = getRollingWindows(B).filter(w => w.startDate >= '2003-01-01');
const realWins = wins.filter(w => w.source === 'real');

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
function measure(w, settings) {
  const r = runFinalBacktest(w.startDate, w.endDate, settings, dataForSource(w.source));
  const i5 = r.daily.findIndex(d => d.total >= 5 * EOK);
  // 총자산 고점일의 주식비중 — 낙폭의 원인
  let pk = 0, pkStock = 1;
  for (const d of r.daily) if (d.total > pk) { pk = d.total; pkStock = d.stockValue / d.total; }
  return {
    final: r.stats.finalAfterTax, mdd: r.stats.mdd, sells: r.stats.sellCount,
    mdd5: i5 >= 0 ? mddFrom(r.daily, i5) : NaN, peakStockPct: pkStock * 100,
  };
}

const buy = wins.map(w => measure(w, BUY_ONLY));
const base = wins.map(w => measure(w, B));

function evaluate(settings) {
  const all = wins.map(w => measure(w, settings));
  const m5 = all.map(x => x.mdd5).filter(x => !isNaN(x));
  const rr = all.map((x, i) => x.final / buy[i].final);
  const rb = all.map((x, i) => x.final / base[i].final);
  const realIdx = wins.map((w, i) => w.source === 'real' ? i : -1).filter(i => i >= 0);
  const m5real = realIdx.map(i => all[i].mdd5).filter(x => !isNaN(x));
  return {
    all,
    mddAvg: mean(all.map(x => x.mdd)), mddWorst: Math.min(...all.map(x => x.mdd)),
    mdd5Avg: mean(m5), mdd5Worst: Math.min(...m5),
    mdd5RealAvg: mean(m5real), mdd5RealWorst: Math.min(...m5real),
    vsBuyMed: median(rr), vsBuyWin: rr.filter(x => x > 1).length,
    vsBaseMed: median(rb),
    peakStock: mean(all.map(x => x.peakStockPct)),
  };
}

// ── 그리드 (1차와 동일) ──────────────────────────────────────────────────
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

const results = [];
for (const bo of boosters) for (const rx of relaxes) {
  const { tag: bt, ...bp } = bo, { tag: rt, ...rp } = rx;
  const s = { ...B, ...bp, ...rp };
  results.push({ boost: bt, relax: rt, settings: s, ...evaluate(s) });
}

const baseEval = evaluate(B);
const line = (label, e) => console.log(label.padEnd(30) +
  `${e.mddAvg.toFixed(1)}%`.padStart(8) + `${e.mddWorst.toFixed(1)}%`.padStart(8) + ' │' +
  `${e.mdd5Avg.toFixed(1)}%`.padStart(8) + `${e.mdd5Worst.toFixed(1)}%`.padStart(8) + ' │' +
  `${e.mdd5RealAvg.toFixed(1)}%`.padStart(8) + `${e.mdd5RealWorst.toFixed(1)}%`.padStart(8) + ' │' +
  `${e.peakStock.toFixed(0)}%`.padStart(7) + ' │' +
  `${e.vsBuyMed.toFixed(2)}(${e.vsBuyWin})`.padStart(11) + `${e.vsBaseMed.toFixed(2)}`.padStart(8));
const HDR = '설정'.padEnd(30) + '전창MDD 평균    최악 │  5억이후 평균    최악 │ 실제12창 평균   최악 │ 고점주식 │  매수만대비   기본대비';

// ── 최악값이 어디까지 내려가나 ───────────────────────────────────────────
console.log('='.repeat(125));
console.log('한계 확인 — 4,495개 설정 중 각 지표의 최선값');
console.log('='.repeat(125));
console.log(`  전창 MDD 평균 최선      ${Math.max(...results.map(r => r.mddAvg)).toFixed(1)}%   (기본값 ${baseEval.mddAvg.toFixed(1)}%)`);
console.log(`  전창 MDD 최악의 최선    ${Math.max(...results.map(r => r.mddWorst)).toFixed(1)}%   (기본값 ${baseEval.mddWorst.toFixed(1)}%)`);
console.log(`  5억이후 MDD 평균 최선   ${Math.max(...results.map(r => r.mdd5Avg)).toFixed(1)}%   (기본값 ${baseEval.mdd5Avg.toFixed(1)}%)`);
console.log(`  5억이후 MDD 최악의 최선 ${Math.max(...results.map(r => r.mdd5Worst)).toFixed(1)}%   (기본값 ${baseEval.mdd5Worst.toFixed(1)}%)`);
console.log(`  실제12창 5억이후 최악   ${Math.max(...results.map(r => r.mdd5RealWorst)).toFixed(1)}%   (기본값 ${baseEval.mdd5RealWorst.toFixed(1)}%)`);
console.log(`  고점 주식비중 최저      ${Math.min(...results.map(r => r.peakStock)).toFixed(0)}%   (기본값 ${baseEval.peakStock.toFixed(0)}%)  ← MDD 바닥의 원인`);

// ── 후보 ─────────────────────────────────────────────────────────────────
const pick = (filter, score) => {
  const c = results.filter(filter);
  return c.length ? c.reduce((a, b) => (score(b) > score(a) ? b : a)) : null;
};
const C = {
  '현재 기본값': { ...baseEval, boost: 'r60/d30/L60', relax: 'm7/rsi-0/disp-12/f5' },
  'A 균형(수익 95%유지)': pick(r => r.vsBaseMed >= 0.95, r => r.mdd5Avg),
  'B 방어(매수만 승리 유지)': pick(r => r.vsBuyMed > 1.0, r => r.mdd5Avg),
  'C 최대방어': pick(() => true, r => r.mdd5Avg),
};
console.log('\n' + '='.repeat(125));
console.log('후보');
console.log('='.repeat(125));
console.log(HDR);
console.log('─'.repeat(125));
for (const [k, v] of Object.entries(C)) if (v) line(k, v);
console.log('\n파라미터');
for (const [k, v] of Object.entries(C)) if (v) console.log(`  ${k.padEnd(24)} 부스터 ${v.boost.padEnd(16)} 완화매도 ${v.relax}`);

// ── 후보 A 창별 상세 ─────────────────────────────────────────────────────
const A = C['A 균형(수익 95%유지)'];
console.log('\n' + '='.repeat(125));
console.log('후보 A 창별 상세 (5억 이후 MDD 기준) — 기본값과 나란히');
console.log('='.repeat(125));
console.log('기간'.padEnd(18) + '구분'.padEnd(7) + '│ 기본값: 총자산  MDD  5억후MDD │ 후보A: 총자산  MDD  5억후MDD │ 총자산비  5억후MDD 개선');
for (let i = 0; i < wins.length; i++) {
  const w = wins[i], b = base[i], a = A.all[i];
  const imp = (isNaN(a.mdd5) || isNaN(b.mdd5)) ? NaN : a.mdd5 - b.mdd5;
  console.log(`${w.startDate.slice(0, 7)}~${w.endDate.slice(0, 7)}`.padEnd(18) +
    (w.source === 'sim' ? '합성' : '실제').padEnd(7) + '│' +
    `${(b.final / EOK).toFixed(1)}억`.padStart(11) + `${b.mdd.toFixed(0)}%`.padStart(6) + `${isNaN(b.mdd5) ? '—' : b.mdd5.toFixed(0) + '%'}`.padStart(10) + ' │' +
    `${(a.final / EOK).toFixed(1)}억`.padStart(10) + `${a.mdd.toFixed(0)}%`.padStart(6) + `${isNaN(a.mdd5) ? '—' : a.mdd5.toFixed(0) + '%'}`.padStart(10) + ' │' +
    `${(a.final / b.final).toFixed(2)}배`.padStart(9) + `${isNaN(imp) ? '—' : (imp >= 0 ? '+' : '') + imp.toFixed(0) + '%p'}`.padStart(14));
}

// ── 전체구간 ─────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(125));
console.log('전체구간 2010-02~2026-08 (실제 TQQQ) — 실제로 겪게 될 경로');
console.log('='.repeat(125));
console.log('설정'.padEnd(24) + '세후 총자산'.padStart(11) + '  전체MDD  5억이후  10억이후  20억이후' + '  매도'.padStart(6) + '  납세'.padStart(9));
for (const [k, v] of Object.entries(C)) {
  if (!v) continue;
  const s = k === '현재 기본값' ? B : v.settings;
  const r = runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], s, TQQQ_DATA);
  const at = thr => { const i = r.daily.findIndex(d => d.total >= thr * EOK); return i >= 0 ? mddFrom(r.daily, i).toFixed(1) + '%' : '—'; };
  console.log(k.padEnd(24) + `${(r.stats.finalAfterTax / EOK).toFixed(0)}억`.padStart(11) +
    `${r.stats.mdd.toFixed(1)}%`.padStart(9) + at(5).padStart(9) + at(10).padStart(9) + at(20).padStart(10) +
    `${r.stats.sellCount}회`.padStart(6) + `${(r.stats.taxPaid / EOK).toFixed(0)}억`.padStart(9));
}
