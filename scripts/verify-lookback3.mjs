// 메커니즘 검증 — 사건 3건보다 큰 표본으로
//   node scripts/verify-lookback3.mjs
import { runFinalBacktest, DEFAULT_SETTINGS, TQQQ_DATA, SIM_DATA } from '../src/lib/backtest.js';

const E = 1e8;
const eok = v => (v / E).toFixed(2);
const pct = (v, d = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`;

function rollMax(closes, n) {
  const out = new Array(closes.length);
  for (let i = 0; i < closes.length; i++) {
    let m = -Infinity;
    for (let j = Math.max(0, i - n + 1); j <= i; j++) if (closes[j] > m) m = closes[j];
    out[i] = m;
  }
  return out;
}

// ── H. 무장일 통계 — "60일 고점 리셋" 메커니즘이 실제로 얼마나 흔한가 ──
console.log('=== [H] 합성 27년 전 거래일 기준 무장(-30%↓) 상태 통계 ===');
{
  const closes = SIM_DATA.map(r => r[1]);
  const dates = SIM_DATA.map(r => r[0]);
  const m60 = rollMax(closes, 60), m252 = rollMax(closes, 252);
  let a60 = 0, a252 = 0, only252 = 0, only60 = 0;
  const only252Days = [];
  for (let i = 252; i < closes.length; i++) {
    const on60 = closes[i] <= m60[i] * 0.7;
    const on252 = closes[i] <= m252[i] * 0.7;
    if (on60) a60++;
    if (on252) a252++;
    if (on252 && !on60) { only252++; only252Days.push(i); }
    if (on60 && !on252) only60++;
  }
  const n = closes.length - 252;
  console.log(`전체 ${n}거래일 중  60일무장 ${a60}일(${(a60 / n * 100).toFixed(1)}%)  252일무장 ${a252}일(${(a252 / n * 100).toFixed(1)}%)`);
  console.log(`252일에서만 무장 ${only252}일(${(only252 / n * 100).toFixed(1)}%)   60일에서만 무장 ${only60}일`);

  // 252-only 무장일의 전방 126일 수익률 분포 — 이 규칙이 사는 구간이 좋은 구간인가
  const fwd = (idxs, h) => idxs.filter(i => i + h < closes.length).map(i => (closes[i + h] - closes[i]) / closes[i] * 100);
  for (const h of [63, 126, 252]) {
    const f252 = fwd(only252Days, h);
    const all = []; for (let i = 252; i + h < closes.length; i++) all.push((closes[i + h] - closes[i]) / closes[i] * 100);
    const med = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const avg = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
    if (!f252.length) continue;
    console.log(`  전방 ${h}일 수익률 — 252일전용 무장일(n=${f252.length}): 평균 ${pct(avg(f252))} 중앙 ${pct(med(f252))} | 전체평균 ${pct(avg(all))} 중앙 ${pct(med(all))}`);
  }
  // 252-only 무장 구간 덩어리
  const blocks = [];
  let s = null;
  for (let k = 0; k < only252Days.length; k++) {
    if (s === null) s = only252Days[k];
    if (k === only252Days.length - 1 || only252Days[k + 1] !== only252Days[k] + 1) { blocks.push([s, only252Days[k]]); s = null; }
  }
  console.log(`  252일전용 무장 구간 ${blocks.length}개:`);
  for (const [a, b] of blocks) console.log(`    ${dates[a]} ~ ${dates[b]}  (${b - a + 1}일)`);
}

// ── I. 120 vs 252 를 가르는 유일한 창의 정체 ───────────────────────────
console.log('\n=== [I] 2009-03~2014-03 창: 120 vs 252 집행 차이 ===');
{
  const idx = SIM_DATA.findIndex(([d]) => d >= '2009-03-01');
  const s = SIM_DATA[idx][0], e = SIM_DATA[idx + 252 * 5 - 1][0];
  console.log(`창 ${s} ~ ${e}`);
  for (const lb of [60, 120, 252, 300]) {
    const { boostTrades, stats } = runFinalBacktest(s, e, { ...DEFAULT_SETTINGS, lookback: lb }, SIM_DATA);
    console.log(`  lb${String(lb).padStart(3)}: 세후 ${eok(stats.finalAfterTax).padStart(7)}억  집행 ${boostTrades.map(t => `${t.date}(${eok(t.buyAmt)}억)`).join(' ') || '없음'}`);
  }
}

// ── J. 실제 TQQQ 데이터만으로 120 vs 252 가 갈리는 구간이 있나 ─────────
console.log('\n=== [J] 실제 TQQQ 데이터에서 120 vs 252 차이 ===');
{
  const WIN = 252 * 5, SLIDE = 63;
  let diff = 0, tot = 0;
  for (let s = 0; s + WIN <= TQQQ_DATA.length; s += SLIDE) {
    const sd = TQQQ_DATA[s][0], ed = TQQQ_DATA[s + WIN - 1][0];
    const a = runFinalBacktest(sd, ed, { ...DEFAULT_SETTINGS, lookback: 120 }).stats.finalAfterTax;
    const b = runFinalBacktest(sd, ed, { ...DEFAULT_SETTINGS, lookback: 252 }).stats.finalAfterTax;
    tot++;
    if (Math.abs(b / a - 1) > 0.0001) { diff++; console.log(`  ${sd}~${ed}  120일 ${eok(a)}억 → 252일 ${eok(b)}억  ${pct((b / a - 1) * 100, 2)}`); }
  }
  console.log(`  실제 TQQQ ${tot}창 중 120↔252 가 다른 창: ${diff}개`);
}

// ── K. 다음 침체 실패모드 스트레스 — 2000·2008 경로에서 252 채택 비용 ──
console.log('\n=== [K] 침체 경로 스트레스 (합성, 창 시작을 1개월씩 이동) ===');
{
  const starts = [];
  for (let i = 0; i < SIM_DATA.length; i += 21) {
    const d = SIM_DATA[i][0];
    if (d >= '1999-03-11' && i + 252 * 5 < SIM_DATA.length) starts.push(i);
  }
  let W = 0, L = 0, Z = 0; const ds = [];
  let worst = 0, worstW = '';
  for (const i of starts) {
    const sd = SIM_DATA[i][0], ed = SIM_DATA[i + 252 * 5 - 1][0];
    const a = runFinalBacktest(sd, ed, { ...DEFAULT_SETTINGS, lookback: 60 }, SIM_DATA).stats.finalAfterTax;
    const b = runFinalBacktest(sd, ed, { ...DEFAULT_SETTINGS, lookback: 252 }, SIM_DATA).stats.finalAfterTax;
    const d = (b / a - 1) * 100;
    ds.push(d);
    if (d > 0.01) W++; else if (d < -0.01) L++; else Z++;
    if (d < worst) { worst = d; worstW = `${sd}~${ed}`; }
  }
  const avg = ds.reduce((x, y) => x + y, 0) / ds.length;
  const sorted = [...ds].sort((a, b) => a - b);
  console.log(`  월별 시작 ${ds.length}창: ${W}승/${L}패/${Z}무  평균 ${pct(avg, 2)}  중앙 ${pct(sorted[Math.floor(ds.length / 2)], 2)}`);
  console.log(`  최악 ${pct(worst, 2)} (${worstW})   5%분위 ${pct(sorted[Math.floor(ds.length * 0.05)], 2)}  95%분위 ${pct(sorted[Math.floor(ds.length * 0.95)], 2)}`);
}
