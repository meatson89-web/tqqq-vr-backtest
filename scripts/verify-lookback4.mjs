// 최종 확인 — 최악 창의 정체 + 촘촘한 격자에서의 신뢰구간
import { runFinalBacktest, DEFAULT_SETTINGS, TQQQ_DATA, SIM_DATA } from '../src/lib/backtest.js';
const E = 1e8;
const eok = v => (v / E).toFixed(2);
const pct = (v, d = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`;

// ── L. 월별 격자 최악 창의 정체 ────────────────────────────────────────
console.log('=== [L] 촘촘한 격자에서 드러난 최악 창들 (23창 격자엔 없는 것) ===');
const starts = [];
for (let i = 0; i < SIM_DATA.length; i += 21) if (i + 252 * 5 < SIM_DATA.length) starts.push(i);
const rows = [];
for (const i of starts) {
  const sd = SIM_DATA[i][0], ed = SIM_DATA[i + 252 * 5 - 1][0];
  const A = runFinalBacktest(sd, ed, { ...DEFAULT_SETTINGS, lookback: 60 }, SIM_DATA);
  const B = runFinalBacktest(sd, ed, { ...DEFAULT_SETTINGS, lookback: 252 }, SIM_DATA);
  rows.push({ sd, ed, a: A.stats.finalAfterTax, b: B.stats.finalAfterTax,
    d: (B.stats.finalAfterTax / A.stats.finalAfterTax - 1) * 100,
    ta: A.boostTrades, tb: B.boostTrades });
}
rows.sort((x, y) => x.d - y.d);
for (const r of rows.slice(0, 6)) {
  const extra = r.tb.filter(t => !r.ta.some(u => u.date === t.date));
  console.log(`${r.sd}~${r.ed}  ${pct(r.d).padStart(8)}  (${eok(r.a)}억 → ${eok(r.b)}억)  252 추가집행: ${extra.map(t => `${t.date}(${eok(t.buyAmt)}억)`).join(' ') || '없음'}`);
}
console.log('--- 최고 6창 ---');
for (const r of rows.slice(-6).reverse()) {
  const extra = r.tb.filter(t => !r.ta.some(u => u.date === t.date));
  console.log(`${r.sd}~${r.ed}  ${pct(r.d).padStart(8)}  (${eok(r.a)}억 → ${eok(r.b)}억)  252 추가집행: ${extra.map(t => `${t.date}(${eok(t.buyAmt)}억)`).join(' ') || '없음'}`);
}

// ── M. 269창 블록 부트스트랩 (블록 = 5년/1개월 = 60) ───────────────────
const ds = rows.map(r => r.d);
function bootCI(xs, blockLen, B = 8000, seed0 = 20260906) {
  const n = xs.length; let seed = seed0;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const ms = [];
  for (let b = 0; b < B; b++) {
    let sum = 0, cnt = 0;
    while (cnt < n) { const s = Math.floor(rnd() * n); for (let k = 0; k < blockLen && cnt < n; k++, cnt++) sum += xs[(s + k) % n]; }
    ms.push(sum / n);
  }
  ms.sort((a, b) => a - b);
  return [ms[Math.floor(B * 0.025)], ms[Math.floor(B * 0.975)]];
}
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log(`\n=== [M] 269창 평균 ${pct(mean(ds))} ===`);
for (const bl of [20, 60, 120]) {
  const [lo, hi] = bootCI(ds, bl);
  console.log(`  블록 ${String(bl).padStart(3)}개월분: 95%CI [${lo.toFixed(2)}, ${hi.toFixed(2)}]  → ${lo > 0 || hi < 0 ? '0 제외(유의)' : '0 포함(유의성 없음)'}`);
}
const pos = ds.filter(d => d > 0.01), neg = ds.filter(d => d < -0.01);
console.log(`  이긴 창 ${pos.length}개 평균 ${pct(mean(pos))} / 진 창 ${neg.length}개 평균 ${pct(mean(neg))}  → 손익비 ${(mean(pos) / -mean(neg)).toFixed(1)}배`);

// ── N. 무장 단조성 증명 확인 (60 무장 ⊂ 252 무장) ─────────────────────
console.log('\n=== [N] 단조성: 60일 무장은 항상 252일 무장의 부분집합인가 ===');
for (const [name, D] of [['합성', SIM_DATA], ['실제TQQQ', TQQQ_DATA]]) {
  const c = D.map(r => r[1]);
  let viol = 0;
  const rm = n => { const o = []; for (let i = 0; i < c.length; i++) { let m = -Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) if (c[j] > m) m = c[j]; o[i] = m; } return o; };
  const a = rm(60), b = rm(252);
  for (let i = 252; i < c.length; i++) if (c[i] <= a[i] * 0.7 && !(c[i] <= b[i] * 0.7)) viol++;
  console.log(`  ${name}: 위반 ${viol}건 → ${viol === 0 ? '부분집합 성립 (252는 트리거를 추가만 하고 제거하지 않음)' : '위반 있음'}`);
}
