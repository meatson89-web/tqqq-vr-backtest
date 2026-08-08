// 5년 롤링 윈도우를 몇 년씩 밀며 만들 것인가 — 슬라이드 간격이 결론을 바꾸는가
//   node scripts/window-design.mjs
//
// 지금까지 두 가지를 섞어 썼다.
//   · 분기(63일) 슬라이드 46개 — 이웃끼리 95% 겹침
//   · 겹치지 않는 5년 3개
// 그 사이(1~4년 슬라이드)를 전부 만들어보고 무엇이 달라지는지 본다.
//
// 핵심은 "창을 많이 만들면 검증이 강해지는가"다. 답부터 말하면 아니다.
// 겹치는 창은 같은 데이터를 다시 보는 것이라 정보가 늘지 않는다. 늘어나는 건
// 표본 수가 아니라 "자르는 위치에 대한 민감도가 줄어드는 것"이다.
// 그래서 두 가지 신뢰구간을 나란히 낸다.
//   · 순진한 CI  — 창 n개를 독립 표본으로 취급 (겹침을 무시)
//   · 블록 CI   — 겹치는 만큼(창길이/슬라이드)을 한 덩어리로 재표본
// 둘의 차이가 곧 "몇 개를 만들었느냐에 속고 있는 정도"다.

import fs from 'node:fs';
import { runFinalBacktest, DEFAULT_SETTINGS, TQQQ_DATA } from '../src/lib/backtest.js';

const SIM = JSON.parse(fs.readFileSync(new URL('../src/data/tqqq_sim.json', import.meta.url), 'utf8'));
const OFF = { ...DEFAULT_SETTINGS, throttleEnabled: false };
const ON = { ...DEFAULT_SETTINGS, throttleEnabled: true, throttleTiers: [[70, 0]] };
const YR = 252, W = YR * 5;

const cache = new Map();
function d(data, si, ei) {
  const k = `${data.length}|${si}`;
  if (!cache.has(k)) {
    const b = runFinalBacktest(data[si][0], data[ei][0], OFF, data).stats;
    const v = runFinalBacktest(data[si][0], data[ei][0], ON, data).stats;
    cache.set(k, { delta: (v.finalAfterTax / b.finalAfterTax - 1) * 100, base: b });
  }
  return cache.get(k);
}
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const sd = xs => Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / Math.max(1, xs.length - 1));
const pct = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

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

const SLIDES = [
  ['분기(0.25년)', 63], ['1년', YR], ['2년', YR * 2], ['3년', YR * 3], ['4년', YR * 4], ['5년(안겹침)', YR * 5],
];

for (const [name, data] of [['실제 TQQQ 2010~2026', TQQQ_DATA], ['합성 TQQQ 1999~2026', SIM]]) {
  const span = data.length / YR;
  console.log(`\n${'='.repeat(100)}`);
  console.log(`${name}  (${span.toFixed(1)}년, 5년 창 → 실질 독립 표본은 최대 ${(span / 5).toFixed(1)}개)`);
  console.log('='.repeat(100));
  console.log('슬라이드'.padEnd(14) + '겹침   창수  평균   중앙값  승률  최악  ' +
    '순진한 CI'.padStart(15) + '  ' + '블록 CI'.padStart(15) + '   CI폭배율');
  for (const [slabel, slide] of SLIDES) {
    const xs = [];
    for (let s = 0; s + W <= data.length; s += slide) xs.push(d(data, s, s + W - 1).delta);
    if (xs.length < 2) { console.log(`${slabel.padEnd(14)}창 ${xs.length}개 — 통계 불가`); continue; }
    const blockLen = Math.max(1, Math.round(W / slide));
    const [nlo, nhi] = boot(xs, 1);
    const [blo, bhi] = boot(xs, blockLen);
    const overlapPct = Math.max(0, (W - slide) / W * 100);
    console.log(
      slabel.padEnd(14) + `${overlapPct.toFixed(0)}%`.padStart(5) + String(xs.length).padStart(6) +
      pct(mean(xs)).padStart(7) + pct(median(xs)).padStart(8) +
      `${(xs.filter(x => x > 0).length / xs.length * 100).toFixed(0)}%`.padStart(6) +
      pct(Math.min(...xs)).padStart(7) + '  ' +
      `[${nlo.toFixed(1)},${nhi.toFixed(1)}]`.padStart(15) + '  ' +
      `[${blo.toFixed(1)},${bhi.toFixed(1)}]`.padStart(15) +
      `${((bhi - blo) / (nhi - nlo)).toFixed(1)}배`.padStart(10));
  }
}

// ── 1년 슬라이드 창 상세 (가장 읽기 좋은 절충안) ─────────────────────────
for (const [name, data] of [['실제 TQQQ', TQQQ_DATA], ['합성 TQQQ', SIM]]) {
  const rows = [];
  for (let s = 0; s + W <= data.length; s += YR) {
    const r = d(data, s, s + W - 1);
    rows.push([data[s][0].slice(0, 7), data[s + W - 1][0].slice(0, 7), r.delta, r.base]);
  }
  console.log(`\n=== ${name} · 1년 슬라이드 5년 창 ${rows.length}개 (이웃 4년 겹침) ===`);
  const per = 3;
  for (let i = 0; i < rows.length; i += per) {
    console.log(rows.slice(i, i + per).map(([a, b, dd, bs]) =>
      `${a}~${b} ${pct(dd).padStart(6)} (MDD${bs.mdd.toFixed(0)}% 매도${bs.sellCount})`.padEnd(46)).join(''));
  }
  const xs = rows.map(r => r[2]);
  console.log(`  평균 ${pct(mean(xs))}  중앙 ${pct(median(xs))}  표준편차 ${sd(xs).toFixed(2)}  개선 ${xs.filter(x => x > 0).length}/${xs.length}`);
}

// ── 슬라이드를 바꿔도 평균이 그대로인 이유를 수치로 ──────────────────────
console.log('\n=== 슬라이드별 평균값만 모아보기 (같은 데이터를 몇 번 세느냐의 차이) ===');
console.log('데이터'.padEnd(22) + SLIDES.map(([l]) => l.padStart(13)).join(''));
for (const [name, data] of [['실제 TQQQ', TQQQ_DATA], ['합성 TQQQ', SIM]]) {
  const cells = SLIDES.map(([, slide]) => {
    const xs = [];
    for (let s = 0; s + W <= data.length; s += slide) xs.push(d(data, s, s + W - 1).delta);
    return xs.length >= 2 ? `${pct(mean(xs))}(n=${xs.length})` : `n=${xs.length}`;
  });
  console.log(name.padEnd(22) + cells.map(c => c.padStart(13)).join(''));
}
