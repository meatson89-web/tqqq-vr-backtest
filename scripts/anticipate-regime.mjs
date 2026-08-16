// 조정예상매도 — 5단계: 발동조건1(국면 정의) 최적화 + 과최적화 검증
//
// 앞서 약 70개 조합을 훑은 뒤라, 여기서 국면 정의까지 더 훑으면 "우연히 좋은 값"을
// 집을 위험이 커진다. 그래서 고르는 표본과 확인하는 표본을 시대로 갈랐다.
//
//   선택(in-sample)  합성 TQQQ 시대 창 — 1999~2010 시작. 닷컴·금융위기.
//   검증(holdout)    실제 TQQQ 시대 창 — 2010~. 선택 과정에서 한 번도 안 본 구간.
//
// 선택 표본에서 1등이 검증 표본에서도 상위면 진짜 신호에 가깝고,
// 검증 표본에서 무너지면 그건 그냥 합성 구간에 맞춘 것이다.
//
// 실행: node scripts/anticipate-regime.mjs [couple]
//   인자 couple = 회귀 x축(조건3)도 같은 기간으로 맞춘 변형까지 본다

import { runFinalBacktest, DEFAULT_SETTINGS, TQQQ_DATA, SIM_DATA, DATA_START } from '../src/lib/backtest.js';

const YR = 252;
// 조건 1 외의 나머지는 앞 단계에서 확정된 보정값으로 고정한다.
const FIX = {
  anticipateEnabled: true, anticipateCashMax: 100, anticipateSellFrac: 0.30,
  anticipateMinGain: 0.25, anticipateCooldown: 21, anticipateDispFloor: 20,
};
const A = { ...DEFAULT_SETTINGS };

function windows(data, years, filter) {
  const d = Math.round(YR * years), out = [];
  for (let s = 0; s + d <= data.length; s += YR) {
    const startDate = data[s][0];
    if (filter && !filter(startDate)) continue;
    out.push({ startDate, endDate: data[s + d - 1][0], data });
  }
  return out;
}
// 선택용 = 합성 시대(실데이터 시작 전), 검증용 = 실제 TQQQ
const SEL = [...windows(SIM_DATA, 5, d => d < DATA_START), ...windows(SIM_DATA, 10, d => d < DATA_START)];
const HOLD = [...windows(TQQQ_DATA, 5), ...windows(TQQQ_DATA, 10)];

const cache = new Map();
function evalOn(wins, cfg) {
  const d = [], m = [], n = [];
  for (const w of wins) {
    const bk = w.startDate + w.endDate;
    if (!cache.has(bk)) {
      const r = runFinalBacktest(w.startDate, w.endDate, A, w.data).stats;
      cache.set(bk, { mult: r.finalAfterTax / r.totalIn, mdd: r.mdd });
    }
    const base = cache.get(bk);
    const r = runFinalBacktest(w.startDate, w.endDate, { ...DEFAULT_SETTINGS, relaxEnabled: false, ...FIX, ...cfg }, w.data).stats;
    d.push((r.finalAfterTax / r.totalIn / base.mult - 1) * 100);
    m.push(r.mdd - base.mdd);
    n.push(r.antCount);
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  return { d: mean(d), up: d.filter(x => x > 0.5).length, dn: d.filter(x => x < -0.5).length,
           worst: Math.min(...d), m: mean(m), mUp: m.filter(x => x > 0.5).length,
           mDn: m.filter(x => x < -0.5).length, fires: mean(n), N: d.length };
}

// 방식별 문턱 후보 — 단위가 달라 각각 따로 준다
const GRID = {
  ret:      { N: [63, 126, 189, 252], th: [0, 10, 20, 40, 80] },
  maslope:  { N: [21, 63, 126],       th: [0, 3, 6, 12, 25] },
  highdist: { N: [126, 252],          th: [-25, -15, -8, -3, 0] },
};

const cfgs = [];
for (const [mode, g] of Object.entries(GRID)) {
  for (const n of g.N) for (const th of g.th) {
    cfgs.push({ name: `${mode.padEnd(8)} ${String(n).padStart(3)}일 ≤ ${String(th).padStart(4)}`,
                cfg: { anticipateRegimeMode: mode, anticipateRegimeN: n, anticipateRegimeMax: th } });
  }
}

const f = (v, d = 1) => (v > 0 ? '+' : '') + v.toFixed(d);
console.log(`선택 표본 ${SEL.length}창(합성 1999~2010 시작) · 검증 표본 ${HOLD.length}창(실제 2010~)`);
console.log(`조건1 외 파라미터 고정: 현금조건 해제 · 매도 30% · 수익률≥25% · 쿨다운 21일 · 예상선 하한 +20%`);

const rows = cfgs.map(c => ({ ...c, s: evalOn(SEL, c.cfg), h: evalOn(HOLD, c.cfg) }));
rows.sort((a, b) => b.s.d - a.s.d);

console.log(`\n${'='.repeat(112)}`);
console.log('국면 정의 스윕 — 선택 표본 성적순. 오른쪽이 그 설정의 검증 표본 성적이다.');
console.log('='.repeat(112));
console.log('국면 정의'.padEnd(22) + '│' + '  선택: 총자산Δ  개선/악화   MDDΔ  발동'.padEnd(40) + '│' + '  검증: 총자산Δ  개선/악화   MDDΔ  발동');
console.log('─'.repeat(112));
for (const r of rows) {
  console.log(r.name.padEnd(22) + '│' +
    f(r.s.d).padStart(10) + '%' + `${r.s.up}/${r.s.dn}`.padStart(9) + f(r.s.m).padStart(8) + 'p' + r.s.fires.toFixed(1).padStart(6) + '  │' +
    f(r.h.d).padStart(10) + '%' + `${r.h.up}/${r.h.dn}`.padStart(9) + f(r.h.m).padStart(8) + 'p' + r.h.fires.toFixed(1).padStart(6));
}

// 순위 상관 — 선택 표본 순위가 검증 표본에서 얼마나 유지되나
const rank = (arr, key) => {
  const s = [...arr].sort((a, b) => b[key].d - a[key].d);
  return new Map(s.map((r, i) => [r.name, i]));
};
const rs = rank(rows, 's'), rh = rank(rows, 'h');
const n = rows.length;
const dsum = rows.reduce((acc, r) => acc + (rs.get(r.name) - rh.get(r.name)) ** 2, 0);
const rho = 1 - (6 * dsum) / (n * (n * n - 1));
console.log('─'.repeat(112));
console.log(`스피어만 순위상관(선택 vs 검증) ρ = ${rho.toFixed(3)}  — 1이면 완전 일치, 0이면 무관(=과최적화)`);
const top5 = rows.slice(0, 5);
console.log(`선택 상위 5개의 검증 성적: ${top5.map(r => f(r.h.d) + '%').join(' · ')}`);
console.log(`전체 ${n}개의 검증 성적 평균: ${f(rows.reduce((a, r) => a + r.h.d, 0) / n)}%`);
const bestHold = [...rows].sort((a, b) => b.h.d - a.h.d)[0];
console.log(`검증 표본 자체 1등: ${bestHold.name.trim()} (검증 ${f(bestHold.h.d)}%, 선택 ${f(bestHold.s.d)}%)`);

// ── 정밀 스윕 — 선택된 값 주변이 고원인가 봉우리인가 ────────────────────
// 한 점만 좋고 옆이 무너지면 그건 우연이다. 넓게 평평해야 진짜 신호다.
if (process.argv[2] === 'fine') {
  console.log(`\n${'='.repeat(112)}`);
  console.log('정밀 스윕 — ret 방식, 126일/20% 주변. 좌: 선택(합성) / 우: 검증(실제) 총자산Δ%');
  console.log('='.repeat(112));
  const Ns = [100, 113, 126, 140, 160], ths = [12, 16, 20, 24, 28];
  console.log('        ' + ths.map(t => `≤${t}%`.padStart(16)).join(''));
  for (const n of Ns) {
    let line = `${n}일`.padEnd(8);
    for (const th of ths) {
      const cfg = { anticipateRegimeMode: 'ret', anticipateRegimeN: n, anticipateRegimeMax: th };
      const s = evalOn(SEL, cfg), h = evalOn(HOLD, cfg);
      line += `${f(s.d)} / ${f(h.d)}`.padStart(16);
    }
    console.log(line);
  }
  console.log('\n같은 격자의 MDDΔ (선택 / 검증, +면 개선)');
  console.log('        ' + ths.map(t => `≤${t}%`.padStart(16)).join(''));
  for (const n of Ns) {
    let line = `${n}일`.padEnd(8);
    for (const th of ths) {
      const cfg = { anticipateRegimeMode: 'ret', anticipateRegimeN: n, anticipateRegimeMax: th };
      const s = evalOn(SEL, cfg), h = evalOn(HOLD, cfg);
      line += `${f(s.m)}p/${f(h.m)}p`.padStart(16);
    }
    console.log(line);
  }
}
