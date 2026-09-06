// 추가 독립 검증 — 보고서가 다루지 않은 취약점 확인
//   node scripts/verify-lookback2.mjs
import { runFinalBacktest, DEFAULT_SETTINGS, TQQQ_DATA, SIM_DATA, getBoosterStatus } from '../src/lib/backtest.js';

const BASE = { ...DEFAULT_SETTINGS, lookback: 60 };
const CAND = { ...DEFAULT_SETTINGS, lookback: 252 };
const E = 1e8;
const eok = v => (v / E).toFixed(2);
const pct = (v, d = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`;

// ── A. 종료일 민감도: +18.4% 는 언제 생겼나 ───────────────────────────
console.log('=== [A] 전체구간 개선폭의 종료일 민감도 (시작 고정 2010-02-11) ===');
console.log('종료일        60일(억)     252일(억)     Δ%');
for (const end of ['2023-02-07', '2023-06-30', '2023-12-29', '2024-06-28', '2024-12-31',
                   '2025-06-30', '2025-12-31', '2026-06-30', '2026-07-28', '2026-09-02']) {
  const b = runFinalBacktest(TQQQ_DATA[0][0], end, BASE).stats;
  const v = runFinalBacktest(TQQQ_DATA[0][0], end, CAND).stats;
  console.log(`${end}  ${eok(b.finalAfterTax).padStart(10)}  ${eok(v.finalAfterTax).padStart(11)}  ${pct((v.finalAfterTax / b.finalAfterTax - 1) * 100, 2).padStart(8)}`);
}

// ── B. 2026-07-29 집행의 전방 데이터가 얼마나 있나 ────────────────────
console.log('\n=== [B] 사건표 "전방 126일 최저" 의 실제 관측 길이 ===');
for (const d of ['2000-01-12', '2018-10-24', '2020-04-15', '2020-09-23', '2023-02-08', '2024-08-07', '2026-07-29']) {
  const idx = SIM_DATA.findIndex(([dd]) => dd >= d);
  const avail = SIM_DATA.length - idx - 1;
  let min = Infinity, minD = '';
  for (let k = idx; k < Math.min(SIM_DATA.length, idx + 126); k++) if (SIM_DATA[k][1] < min) { min = SIM_DATA[k][1]; minD = SIM_DATA[k][0]; }
  const p = SIM_DATA[idx][1];
  console.log(`${d}  전방 관측 ${String(Math.min(avail, 126)).padStart(3)}일 / 126일 요구  최저 ${pct((min - p) / p * 100, 1).padStart(7)} (${minD})${avail < 126 ? '   ← 미완결 평가' : ''}`);
}

// ── C. 2023-02-08 사건 제거 시 남는 것 ────────────────────────────────
// 시작일을 2023-03 이후로 잡아 그 사건을 배제한 구간에서 두 설정 비교
console.log('\n=== [C] 2023-02-08 을 배제한 구간 비교 ===');
for (const [s, e] of [['2023-03-01', '2026-09-02'], ['2010-02-11', '2023-02-07'], ['2010-02-11', '2020-12-31']]) {
  const b = runFinalBacktest(s, e, BASE).stats;
  const v = runFinalBacktest(s, e, CAND).stats;
  console.log(`${s}~${e}  60일 ${eok(b.finalAfterTax).padStart(9)}억  252일 ${eok(v.finalAfterTax).padStart(9)}억  ${pct((v.finalAfterTax / b.finalAfterTax - 1) * 100).padStart(8)}`);
}

// ── D. 08-28 컷 재현 주장 확인 ────────────────────────────────────────
console.log('\n=== [D] 데이터 08-28 컷 재현 (기존 문서 1,576억 / 내 구간 11.47억) ===');
{
  const b = runFinalBacktest(TQQQ_DATA[0][0], '2026-08-28', BASE).stats;
  const v = runFinalBacktest(TQQQ_DATA[0][0], '2026-08-28', CAND).stats;
  console.log(`전체구간 08-28 컷: 60일 ${eok(b.finalAfterTax)}억  252일 ${eok(v.finalAfterTax)}억  ${pct((v.finalAfterTax / b.finalAfterTax - 1) * 100)}`);
  const mb = runFinalBacktest('2021-09-01', '2026-08-28', BASE).stats;
  const mv = runFinalBacktest('2021-09-01', '2026-08-28', CAND).stats;
  console.log(`내 구간  08-28 컷: 60일 ${eok(mb.finalAfterTax)}억  252일 ${eok(mv.finalAfterTax)}억`);
}

// ── E. 현재 무장 상태 — 지금 채택하면 당장 달라지는 게 있나 ───────────
console.log('\n=== [E] 현재(마지막 거래일) 부스터 무장 상태 ===');
for (const lb of [60, 252]) {
  try {
    const st = getBoosterStatus({ ...DEFAULT_SETTINGS, lookback: lb });
    console.log(`lookback ${lb}:`, JSON.stringify(st));
  } catch (err) { console.log(`lookback ${lb}: getBoosterStatus 없음/오류 — ${err.message}`); }
}

// ── F. 최근 5년·3년 구간에서의 차이 (앞으로의 체감) ───────────────────
console.log('\n=== [F] 최근 구간 ===');
for (const [s, e] of [['2021-09-01', '2026-09-01'], ['2022-01-03', '2026-09-02'], ['2019-01-02', '2026-09-02']]) {
  const b = runFinalBacktest(s, e, BASE).stats;
  const v = runFinalBacktest(s, e, CAND).stats;
  console.log(`${s}~${e}  60일 ${eok(b.finalAfterTax).padStart(9)}억  252일 ${eok(v.finalAfterTax).padStart(9)}억  ${pct((v.finalAfterTax / b.finalAfterTax - 1) * 100).padStart(8)}  MDD ${b.mdd.toFixed(1)}% → ${v.mdd.toFixed(1)}%`);
}

// ── G. 손실 3창의 원인 사건 확인 (2008-05-07) ─────────────────────────
console.log('\n=== [G] 손실 3창의 부스터 집행 차이 ===');
for (const [s, e] of [['2004-03-16', '2009-03-17'], ['2005-03-16', '2010-03-17'], ['2006-03-16', '2011-03-17']]) {
  for (const lb of [60, 252]) {
    const { boostTrades, stats } = runFinalBacktest(s, e, { ...DEFAULT_SETTINGS, lookback: lb }, SIM_DATA);
    console.log(`  ${s}~${e} lb${lb}: 세후 ${eok(stats.finalAfterTax)}억  집행 ${boostTrades.map(t => `${t.date}(${eok(t.buyAmt)}억)`).join(' ') || '없음'}`);
  }
}
