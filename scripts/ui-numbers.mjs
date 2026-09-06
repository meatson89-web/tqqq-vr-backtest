// 사이트 문구 갱신용 수치 — 기본값이 lookback 252 가 된 뒤의 "부스터 끄기 대비"
import { runFinalBacktest, getRollingWindows, DEFAULT_SETTINGS, TQQQ_DATA } from '../src/lib/backtest.js';
const E = 1e8;
const eok = v => (v / E).toFixed(1);
const pct = (v, d = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const med = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
function bootCI(xs, blockLen = 5, B = 4000, seed0 = 20260807) {
  const n = xs.length; let seed = seed0;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const ms = [];
  for (let b = 0; b < B; b++) { let s = 0, c = 0; while (c < n) { const st = Math.floor(rnd() * n); for (let k = 0; k < blockLen && c < n; k++, c++) s += xs[(st + k) % n]; } ms.push(s / n); }
  ms.sort((a, b) => a - b); return [ms[Math.floor(B * .025)], ms[Math.floor(B * .975)]];
}

for (const lb of [60, 252]) {
  const on = { ...DEFAULT_SETTINGS, lookback: lb };
  const off = { ...DEFAULT_SETTINGS, lookback: lb, enabled: false };
  const fOn = runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], on).stats;
  const fOff = runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], off).stats;
  const wOn = getRollingWindows(on), wOff = getRollingWindows(off);
  const d = wOn.map((w, i) => (w.stats.finalAfterTax / wOff[i].stats.finalAfterTax - 1) * 100);
  const [lo, hi] = bootCI(d);
  const up = d.filter(x => x > 0.01).length, zz = d.filter(x => Math.abs(x) <= 0.01).length, dn = d.filter(x => x < -0.01).length;
  const real = wOn.map((w, i) => ({ s: w.source, d: d[i], ind: w.independent }));
  const rD = real.filter(r => r.s === 'real'), sD = real.filter(r => r.s === 'sim'), iD = real.filter(r => r.ind);
  console.log(`\n===== lookback ${lb} : 부스터 ON vs OFF =====`);
  console.log(`전체구간  끄기 ${eok(fOff.finalAfterTax)}억 → 켜기 ${eok(fOn.finalAfterTax)}억 (${pct((fOn.finalAfterTax / fOff.finalAfterTax - 1) * 100)}%)`);
  console.log(`MDD       끄기 ${fOff.mdd.toFixed(1)}% → 켜기 ${fOn.mdd.toFixed(1)}%`);
  console.log(`23창      평균 ${pct(mean(d))}%  중앙 ${pct(med(d))}%  95%CI [${lo.toFixed(1)}, ${hi.toFixed(1)}]  개선 ${up} / 무 ${zz} / 악화 ${dn}`);
  console.log(`실제 ${rD.length}창 개선 ${rD.filter(r => r.d > .01).length} (평균 ${pct(mean(rD.map(r => r.d)))}%) | 합성 ${sD.length}창 개선 ${sD.filter(r => r.d > .01).length} (평균 ${pct(mean(sD.map(r => r.d)))}%) | 독립 ${iD.length}창 개선 ${iD.filter(r => r.d > .01).length}`);
  console.log(`독립창 상세: ${iD.map((r, k) => `${wOn.filter(w => w.independent)[k].startDate.slice(0, 7)} ${pct(r.d)}%`).join(' | ')}`);
}
