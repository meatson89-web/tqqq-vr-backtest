// 부스터 재투자 비율(ratioPct)이 "고점에서 반의 반토막" 을 막아주는가
//   node scripts/sweep-boostratio.mjs
//
// 목표가 바뀌면 재는 지표도 바뀌어야 한다. 여기서 막고 싶은 건 "사이클 중간에
// 잘 올라간 자산을 하락장에 그대로 반납하는 것"이므로, MDD보다
//   잔존율 = 창 종료 시점 총자산 / 창 안에서 찍은 최고 총자산
// 이 더 직접적인 지표다. MDD는 회복된 일시적 낙폭도 세지만 잔존율은 실제로
// 손에 남은 것만 센다. 2004~2009은 최고 5.38억 → 최종 0.66억으로 잔존율 12%다.

import { runFinalBacktest, getRollingWindows, DEFAULT_SETTINGS, TQQQ_DATA, dataForSource } from '../src/lib/backtest.js';

const B = DEFAULT_SETTINGS;
const wins = getRollingWindows(B);
const pct = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const fmtB = v => `${(v / 1e8).toFixed(2)}억`;
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

const cache = new Map();
function run(w, ov) {
  const k = `${w.id}|${JSON.stringify(ov)}`;
  if (!cache.has(k)) {
    const r = runFinalBacktest(w.startDate, w.endDate, { ...B, ...ov }, dataForSource(w.source));
    const peak = Math.max(...r.daily.map(d => d.total));
    cache.set(k, { st: r.stats, peak, keep: r.stats.finalAfterTax / peak * 100 });
  }
  return cache.get(k);
}
function fullRun(ov) {
  const r = runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], { ...B, ...ov });
  const peak = Math.max(...r.daily.map(d => d.total));
  return { st: r.stats, peak, keep: r.stats.finalAfterTax / peak * 100 };
}

// ── 1. 재투자 비율 스윕 ──────────────────────────────────────────────────
console.log('=== 1. 부스터 재투자 비율 스윕 (23창) ===');
console.log('비율'.padEnd(8) + '23창 총자산Δ  잔존율 중앙  잔존율 평균  최악 잔존율  MDD평균   전체구간세후  전체MDD  전체잔존율');
const RATIOS = [5, 10, 15, 20, 25, 30, 40, 60, 80, 100];
const base = wins.map(w => run(w, {}));
for (const rp of RATIOS) {
  const rs = wins.map(w => run(w, { ratioPct: rp }));
  const ds = rs.map((r, i) => (r.st.finalAfterTax / base[i].st.finalAfterTax - 1) * 100);
  const keeps = rs.map(r => r.keep);
  const f = fullRun({ ratioPct: rp });
  console.log(`${rp}%${rp === 60 ? '*' : ' '}`.padEnd(8) +
    pct(mean(ds)).padStart(12) + `${median(keeps).toFixed(0)}%`.padStart(12) +
    `${mean(keeps).toFixed(0)}%`.padStart(12) + `${Math.min(...keeps).toFixed(0)}%`.padStart(12) +
    `${mean(rs.map(r => r.st.mdd)).toFixed(1)}%`.padStart(9) +
    fmtB(f.st.finalAfterTax).padStart(14) + `${f.st.mdd.toFixed(1)}%`.padStart(9) + `${f.keep.toFixed(0)}%`.padStart(11));
}
console.log('  * 현재값. 잔존율 = 창 종료 총자산 / 창 내 최고 총자산');

// ── 2. 문제 구간에서 실제로 뭘 바꾸나 ────────────────────────────────────
console.log('\n=== 2. "반의 반토막" 구간 상세 — 최고 총자산 → 최종 ===');
const CASES = [
  ['2004-03~2009-03 금융위기', '2004-03-16', '2009-03-17', 'sim'],
  ['2018-02~2023-02 2022하락', '2018-02-14', '2023-02-15', 'real'],
  ['1999-03~2004-03 닷컴', '1999-03-11', '2004-03-15', 'sim'],
  ['2016-02~2021-02 강세장', '2016-02-16', '2021-02-16', 'real'],
  ['2020-02~2025-02 독립창', '2020-02-18', '2025-02-20', 'real'],
];
for (const [label, s, e, src] of CASES) {
  console.log(`  ${label}`);
  for (const rp of [60, 40, 25, 15, 5]) {
    const r = runFinalBacktest(s, e, { ...B, ratioPct: rp }, dataForSource(src));
    const peak = Math.max(...r.daily.map(d => d.total));
    console.log(`    재투자 ${String(rp).padStart(3)}%${rp === 60 ? '*' : ' '}  최고 ${fmtB(peak).padStart(9)} → 최종 ${fmtB(r.stats.finalAfterTax).padStart(9)}` +
      `  잔존율 ${(r.stats.finalAfterTax / peak * 100).toFixed(0).padStart(3)}%  MDD ${r.stats.mdd.toFixed(1).padStart(6)}%  부스터 ${String(r.stats.boostedWeeks).padStart(2)}주`);
  }
}

// ── 3. 잔존율을 실제로 올리는 게 뭔가 — 후보 비교 ────────────────────────
console.log('\n=== 3. 잔존율 개선 후보 비교 (23창) ===');
console.log('안'.padEnd(28) + '23창 총자산Δ  잔존율중앙  최악잔존  MDD평균  전체구간세후  전체잔존율');
const OPTS = [
  ['기준선', {}],
  ['부스터 재투자 25%', { ratioPct: 25 }],
  ['부스터 끄기', { enabled: false }],
  ['매도비율 70% (현재)', {}],
  ['매도 RSI 76 (덜 팔기)', { sellRsi: 76 }],
  ['마켓오프+부스터잠금', { marketOffEnabled: true, marketOffTiers: [[10, 0.3], [5, 0.3]], marketOffLockBooster: true }],
  ['POOL 비중캡 기준 100억', { poolCapKRW: 1e10 }],
];
for (const [label, ov] of OPTS) {
  const rs = wins.map(w => run(w, ov));
  const ds = rs.map((r, i) => (r.st.finalAfterTax / base[i].st.finalAfterTax - 1) * 100);
  const keeps = rs.map(r => r.keep);
  const f = fullRun(ov);
  console.log(label.padEnd(28) + pct(mean(ds)).padStart(12) + `${median(keeps).toFixed(0)}%`.padStart(11) +
    `${Math.min(...keeps).toFixed(0)}%`.padStart(10) + `${mean(rs.map(r => r.st.mdd)).toFixed(1)}%`.padStart(9) +
    fmtB(f.st.finalAfterTax).padStart(14) + `${f.keep.toFixed(0)}%`.padStart(11));
}

// ── 4. 잔존율이 낮은 창은 애초에 어떤 창인가 ─────────────────────────────
console.log('\n=== 4. 기준선 잔존율이 낮은 창 (반의 반토막이 실제로 일어난 곳) ===');
const sorted = wins.map((w, i) => ({ w, ...base[i] })).sort((a, b) => a.keep - b.keep);
for (const r of sorted.slice(0, 8)) {
  console.log(`  ${r.w.startDate.slice(0, 7)}~${r.w.endDate.slice(0, 7)} ${r.w.source === 'sim' ? '합성' : '실제'}` +
    `  최고 ${fmtB(r.peak).padStart(9)} → 최종 ${fmtB(r.st.finalAfterTax).padStart(9)}  잔존율 ${r.keep.toFixed(0).padStart(3)}%  매도 ${r.st.sellCount}회`);
}
