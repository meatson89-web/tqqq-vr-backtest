// 구간 분할을 바꿔가며 과열 스로틀 결론이 유지되는지 본다
//   node scripts/opt-rsi-throttle5.mjs
//
// 지금까지는 "겹치지 않는 독립 5년 3구간"으로만 검증했다. 3개는 표본이 적고,
// 게다가 어디서 자르느냐(경계 위치)에 따라 결과가 달라질 수 있다.
// W1(2011-07~2016-07)이 매번 소폭 마이너스로 나왔는데, 그게 진짜 그 국면의
// 성질인지 자른 위치가 우연히 그랬던 건지 구분되지 않는다.
//
// A. 5년 6구간 (요청) — 전 구간에 균등 배치. 이웃끼리 약 54% 겹친다.
//    겹치는 구간은 독립 표본이 아니다. 6개 중 5개가 좋아도 그건 "5번 확인"이
//    아니라 "같은 데이터를 5번 본 것"에 가깝다. 국면별 그림을 보는 용도다.
// B. 겹치지 않는 6구간 — 창을 2.7년으로 줄이면 진짜 독립 표본 6개가 나온다.
//    대신 짧아서 노이즈가 크고 매도 트리거가 몇 번 안 걸린다.
// C. 경계 위치 스캔 — 5년 3분할을 시작 오프셋을 옮겨가며 전부 돌린다.
//    "3구간 전부 개선"이 몇 %의 분할에서 성립하는지가 핵심 지표다.

import { runFinalBacktest, DEFAULT_SETTINGS, TQQQ_DATA } from '../src/lib/backtest.js';

const BASE_OFF = { ...DEFAULT_SETTINGS, throttleEnabled: false };
const N = TQQQ_DATA.length;
const YR = 252;

const CAND = [
  ['70↑0% (현재 배포값)', [[70, 0]]],
  ['68↑2.5% 73↑0%', [[68, 2.5], [73, 0]]],
  ['65↑2.5% 70↑0%', [[65, 2.5], [70, 0]]],
  ['70↑2.5%', [[70, 2.5]]],
];

const cache = new Map();
function st(si, ei, tiers) {
  const k = `${si}|${ei}|${tiers ? JSON.stringify(tiers) : 'off'}`;
  if (!cache.has(k)) {
    cache.set(k, runFinalBacktest(TQQQ_DATA[si][0], TQQQ_DATA[ei][0],
      tiers ? { ...BASE_OFF, throttleEnabled: true, throttleTiers: tiers } : BASE_OFF).stats);
  }
  return cache.get(k);
}
const delta = (si, ei, tiers) => (st(si, ei, tiers).finalAfterTax / st(si, ei, null).finalAfterTax - 1) * 100;
const pct = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const fmtB = v => `${(v / 1e8).toFixed(2)}억`;
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const ym = i => TQQQ_DATA[i][0].slice(0, 7);

console.log(`데이터 ${TQQQ_DATA[0][0]} ~ ${TQQQ_DATA[N - 1][0]} (${N}거래일 = ${(N / YR).toFixed(2)}년)\n`);

// ── A. 5년 6구간 (겹침 허용) ──────────────────────────────────────────────
const WA = YR * 5;
const lastStart = N - WA;
const startsA = Array.from({ length: 6 }, (_, i) => Math.round(i * lastStart / 5));
const overlapA = WA - (startsA[1] - startsA[0]);
console.log(`=== A. 5년 6구간 (이웃 겹침 ${overlapA}일 = ${(overlapA / WA * 100).toFixed(0)}%) ===`);
console.log('구간'.padEnd(20) + '기준선세후'.padStart(11) + '  MDD  매도' + CAND.map(([l]) => l.slice(0, 14).padStart(16)).join(''));
const colsA = CAND.map(() => []);
for (const s of startsA) {
  const e = s + WA - 1;
  const b = st(s, e, null);
  const ds = CAND.map(([, t], j) => { const d = delta(s, e, t); colsA[j].push(d); return d; });
  console.log(`${ym(s)}~${ym(e)}`.padEnd(20) + fmtB(b.finalAfterTax).padStart(11) +
    `${b.mdd.toFixed(0)}%`.padStart(6) + `${b.sellCount}회`.padStart(5) +
    ds.map(d => pct(d).padStart(16)).join(''));
}
console.log('평균'.padEnd(20) + ''.padStart(22) + colsA.map(c => pct(mean(c)).padStart(16)).join(''));
console.log('개선 구간 수'.padEnd(20) + ''.padStart(20) + colsA.map(c => `${c.filter(x => x > 0).length}/6`.padStart(16)).join(''));

// ── B. 겹치지 않는 6구간 ─────────────────────────────────────────────────
const WB = Math.floor(N / 6);
console.log(`\n=== B. 겹치지 않는 6구간 (창 ${WB}일 = ${(WB / YR).toFixed(2)}년, 진짜 독립 표본 6개) ===`);
console.log('구간'.padEnd(20) + '기준선세후'.padStart(11) + '  MDD  매도  캡' + CAND.map(([l]) => l.slice(0, 14).padStart(16)).join(''));
const colsB = CAND.map(() => []);
for (let i = 0; i < 6; i++) {
  const s = i * WB, e = s + WB - 1;
  const b = st(s, e, null);
  const ds = CAND.map(([, t], j) => { const d = delta(s, e, t); colsB[j].push(d); return d; });
  console.log(`${ym(s)}~${ym(e)}`.padEnd(20) + fmtB(b.finalAfterTax).padStart(11) +
    `${b.mdd.toFixed(0)}%`.padStart(6) + `${b.sellCount}회`.padStart(5) + `${b.capApplied}`.padStart(4) +
    ds.map(d => pct(d).padStart(16)).join(''));
}
console.log('평균'.padEnd(20) + ''.padStart(26) + colsB.map(c => pct(mean(c)).padStart(16)).join(''));
console.log('개선 구간 수'.padEnd(20) + ''.padStart(24) + colsB.map(c => `${c.filter(x => x > 0).length}/6`.padStart(16)).join(''));

// ── C. 5년 3분할의 경계 위치 스캔 ────────────────────────────────────────
// 3구간이 딱 들어가는 시작 오프셋 전부를 훑는다. "어디서 잘라도 같은 결론인가"
const need = WA * 3;
const maxOff = N - need;
const STEP = 3;
console.log(`\n=== C. 겹치지 않는 5년 3분할, 경계 위치 스캔 (오프셋 0~${maxOff}일, ${STEP}일 간격 ${Math.floor(maxOff / STEP) + 1}가지 분할) ===`);
console.log('안'.padEnd(22) + '3구간평균 최악구간중앙  3구간전부+  2개이상+  최악구간최소');
for (const [label, tiers] of CAND) {
  const means = [], worsts = [];
  let all3 = 0, ge2 = 0, tot = 0;
  for (let off = 0; off <= maxOff; off += STEP) {
    const ds = [0, 1, 2].map(k => delta(off + k * WA, off + (k + 1) * WA - 1, tiers));
    means.push(mean(ds)); worsts.push(Math.min(...ds));
    if (ds.every(x => x > 0)) all3++;
    if (ds.filter(x => x > 0).length >= 2) ge2++;
    tot++;
  }
  const sw = [...worsts].sort((a, b) => a - b);
  console.log(label.padEnd(22) + pct(mean(means)).padStart(9) + pct(sw[Math.floor(sw.length / 2)]).padStart(12) +
    `${(all3 / tot * 100).toFixed(0)}%`.padStart(12) + `${(ge2 / tot * 100).toFixed(0)}%`.padStart(10) + pct(sw[0]).padStart(14));
}

// ── D. 현재 배포값이 지는 구간은 어떤 구간인가 ───────────────────────────
console.log('\n=== D. 70↑0%가 지는 5년 구간 (분기 슬라이드 46개 중) ===');
const losers = [];
for (let s = 0; s + WA <= N; s += 63) {
  const d = delta(s, s + WA - 1, [[70, 0]]);
  if (d <= 0) losers.push([ym(s), ym(s + WA - 1), d, st(s, s + WA - 1, null)]);
}
console.log(`46개 중 ${losers.length}개에서 악화. 목록:`);
for (const [a, b, d, bs] of losers) {
  console.log(`  ${a}~${b}  ${pct(d).padStart(7)}   기준선 ${fmtB(bs.finalAfterTax).padStart(9)}  MDD ${bs.mdd.toFixed(0)}%  매도 ${bs.sellCount}회`);
}
