// 추세국면(QQQ 200일선 dwell) 규칙 스윕
//   node scripts/sweep-regime.mjs
//
// 판정은 validate.mjs와 같은 규격이다: 전부 세후, 롤링 창, 블록 부트스트랩,
// QLD·합성TQQQ 교차검증.
//
// 이 규칙은 2021~2023 구간을 보고 만들었으므로 그 구간 성적으로 파라미터를 고르면
// 순환논법이 된다. 그래서 D는 "닷컴·금융위기를 포함한 합성 데이터에서 고원인가"로
// 고르고, 2019~2024 창은 맨 마지막에 결과 확인용으로만 본다.

import fs from 'node:fs';
import { runFinalBacktest, DEFAULT_SETTINGS, TQQQ_DATA } from '../src/lib/backtest.js';

const QLD_DATA = JSON.parse(fs.readFileSync(new URL('../src/data/qld.json', import.meta.url), 'utf8'));
const SIM_DATA = JSON.parse(fs.readFileSync(new URL('../src/data/tqqq_sim.json', import.meta.url), 'utf8'));

// 기본 설정은 이제 추세국면이 켜져 있다. 개선폭을 재려면 기준선을 명시적으로
// 꺼야 한다 — 안 그러면 후보와 기준선이 같아져 전부 0.0%로 나온다.
const BASE = { ...DEFAULT_SETTINGS, regimeEnabled: false };
const WINDOW = 252 * 5, SLIDE = 63;
const windowsOf = data => {
  const out = [];
  for (let s = 0; s + WINDOW <= data.length; s += SLIDE) out.push([data[s][0], data[s + WINDOW - 1][0]]);
  return out;
};
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const pct = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

// 기준선은 창마다 한 번만 돌린다.
const baseCache = new Map();
function baseOf(data, sd, ed) {
  const k = `${sd}|${ed}`;
  if (!baseCache.has(k)) baseCache.set(k, runFinalBacktest(sd, ed, BASE, data).stats);
  return baseCache.get(k);
}
// 창별 [세후자산 개선%, MDD 개선%p]
function compare(settings, data) {
  return windowsOf(data).map(([sd, ed]) => {
    const b = baseOf(data, sd, ed);
    const v = runFinalBacktest(sd, ed, { ...BASE, ...settings }, data).stats;
    return [(v.finalAfterTax / b.finalAfterTax - 1) * 100, v.mdd - b.mdd];
  });
}
function bootstrapCI(xs, blockLen = Math.round(WINDOW / SLIDE), B = 4000) {
  const n = xs.length;
  let seed = 20260807;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const means = [];
  for (let b = 0; b < B; b++) {
    let sum = 0, cnt = 0;
    while (cnt < n) {
      const start = Math.floor(rnd() * n);
      for (let k = 0; k < blockLen && cnt < n; k++, cnt++) sum += xs[(start + k) % n];
    }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(B * 0.025)], means[Math.floor(B * 0.975)]];
}

function row(label, settings) {
  const cT = compare(settings, TQQQ_DATA);
  const cS = compare(settings, SIM_DATA);
  const cQ = compare(settings, QLD_DATA);
  const dT = cT.map(x => x[0]), dS = cS.map(x => x[0]), dQ = cQ.map(x => x[0]);
  const [lo, hi] = bootstrapCI(dS);
  const mddS = mean(cS.map(x => x[1])), mddT = mean(cT.map(x => x[1]));
  return {
    label, dT, dS, dQ, lo, hi, mddS, mddT,
    line: label.padEnd(24) +
      pct(mean(dS)).padStart(9) + pct(median(dS)).padStart(9) +
      `[${lo.toFixed(1)}, ${hi.toFixed(1)}]`.padStart(17) +
      `${mddS >= 0 ? '+' : ''}${mddS.toFixed(1)}p`.padStart(9) +
      pct(mean(dT)).padStart(9) + `${mddT >= 0 ? '+' : ''}${mddT.toFixed(1)}p`.padStart(9) +
      pct(mean(dQ)).padStart(9),
  };
}

const HEAD = '설정'.padEnd(23) + '합성평균  중앙값     95%신뢰구간   합성MDDΔ  TQQQ평균 TQQQMDDΔ   QLD평균';
const ON = { regimeEnabled: true };

console.log('※ 개선폭은 모두 현재 기본설정(추세국면 OFF) 대비, 세후 기준.');
console.log(`※ 창: 합성 ${windowsOf(SIM_DATA).length}개 / TQQQ ${windowsOf(TQQQ_DATA).length}개 / QLD ${windowsOf(QLD_DATA).length}개. 신뢰구간은 합성 기준.\n`);

console.log('① dwell 문턱 D (가속 0주, 부스터 0%) — 여기가 고원이 아니면 기각한다');
console.log(HEAD);
for (const D of [1, 2, 3, 5, 8, 12, 20, 40]) {
  console.log(row(`D=${D}일`, { ...ON, regimeDwellDays: D, regimeAccelWeeks: 0 }).line);
}

console.log('\n② 잠긴 동안 부스터 비율 (D=1, 가속 0주)');
console.log(HEAD);
for (const bp of [0, 6, 12, 20, 30, 45]) {
  console.log(row(`부스터 ${bp}%`, { ...ON, regimeDwellDays: 1, regimeAccelWeeks: 0, regimeBoostPct: bp }).line);
}

console.log('\n③ 해제 후 가속 주수 (D=1, 부스터 0%)');
console.log(HEAD);
for (const w of [0, 2, 4, 8]) {
  console.log(row(`가속 ${w}주`, { ...ON, regimeDwellDays: 1, regimeAccelWeeks: w }).line);
}

console.log('\n③-2 해제 확인일수 exitDays — 잠금 진입은 즉시 고정');
console.log(HEAD);
for (const e of [1, 2, 3, 5, 8, 10, 15, 20]) {
  console.log(row(`해제 ${e}일`, { ...ON, regimeExitDays: e }).line);
}

// 조각 수는 "장기 하락이 몇 번 끊기나"를 직접 센다. 개선폭보다 이쪽이 규칙의
// 의도(하락 도중 틈에서 부스터가 살아나지 않게)를 더 정확히 보여준다.
console.log('\n③-3 주요 약세장이 몇 조각으로 갈리나 (조각 1 = 한 덩어리로 잠김)');
const BEARS = [
  // [이름, 조각을 셀 구간, 백테스트를 돌릴 창, 데이터]
  ['닷컴 2000-09~2001-12', '2000-09-01', '2001-12-31', '1999-03-11', '2004-03-15', SIM_DATA],
  ['금융위기 2008-09~2009-05', '2008-09-01', '2009-05-31', '2004-03-16', '2009-12-31', SIM_DATA],
  ['횡보 2015-08~2016-07', '2015-08-01', '2016-07-31', '2013-01-02', '2018-01-02', TQQQ_DATA],
  ['긴축 2022-01~2023-02', '2022-01-01', '2023-02-28', '2019-02-15', '2024-02-16', TQQQ_DATA],
];
console.log('해제일수  ' + BEARS.map(x => x[0].split(' ')[0].padStart(10)).join(' '));
for (const e of [1, 2, 3, 5, 8, 10]) {
  const cells = BEARS.map(([, sd, ed, ws, we, data]) => {
    const r = runFinalBacktest(ws, we, { ...BASE, ...ON, regimeExitDays: e }, data);
    let n = 0, prev = false;
    for (const d of r.daily) {
      if (d.date < sd || d.date > ed) continue;
      if (d.regimeLocked && !prev) n++;
      prev = d.regimeLocked;
    }
    return String(n).padStart(10);
  });
  console.log(String(e).padStart(8) + '  ' + cells.join(' '));
}
console.log('  ※ 2015-08 횡보장은 어떤 값으로도 한 덩어리가 안 된다 — 시장이 실제로');
console.log('    선 위아래를 오간 구간이라 쪼개지는 게 맞다. 조각 수 자체가 목표가 아니다.');

console.log('\n④ 평상시 5% 정지 여부');
console.log(HEAD);
const P0 = { ...ON, regimeDwellDays: 1, regimeAccelWeeks: 0 };
console.log(row('5% 정지', { ...P0, regimePoolStop: true }).line);
console.log(row('5% 유지', { ...P0, regimePoolStop: false }).line);

// ── 목표 창 (마지막에만 본다) ────────────────────────────────────────────
console.log('\n⑤ 목표 창 2019-02-15 ~ 2024-02-16  ※ 설계 동기가 된 구간이라 선택 근거로 쓰지 않는다');
const b = runFinalBacktest('2019-02-15', '2024-02-16', BASE).stats;
console.log(`  기준선          세후 ${(b.finalAfterTax / 1e8).toFixed(2)}억  MDD ${b.mdd.toFixed(1)}%  IRR ${b.irr.toFixed(1)}%  납세 ${(b.taxPaid / 1e8).toFixed(2)}억`);
for (const D of [1, 3, 5, 10]) {
  const r = runFinalBacktest('2019-02-15', '2024-02-16', { ...BASE, ...ON, regimeDwellDays: D, regimeAccelWeeks: 0 });
  const v = r.stats;
  console.log(`  D=${D} 부스터12% 가속0  세후 ${(v.finalAfterTax / 1e8).toFixed(2)}억  MDD ${v.mdd.toFixed(1)}%  IRR ${v.irr.toFixed(1)}%  납세 ${(v.taxPaid / 1e8).toFixed(2)}억  잠금 ${v.lockedWeeks}주/가속 ${v.accelWeeks}주`);
}

console.log('\n⑥ 하락장 5년 창 (합성, 세후) — 규칙의 목적 자체');
for (const [lbl, s, e] of [['닷컴 1999-03~2004-03', '1999-03-11', '2004-03-15'], ['금융위기 2004-03~2009-03', '2004-03-16', '2009-03-17']]) {
  const bb = runFinalBacktest(s, e, BASE, SIM_DATA).stats;
  const vv = runFinalBacktest(s, e, { ...BASE, ...ON, regimeDwellDays: 1, regimeAccelWeeks: 0 }, SIM_DATA).stats;
  console.log(`  ${lbl}`);
  console.log(`    기준선  납입 ${(bb.totalIn / 1e8).toFixed(2)}억 → ${(bb.finalAfterTax / 1e8).toFixed(2)}억  MDD ${bb.mdd.toFixed(0)}%`);
  console.log(`    D=3     납입 ${(vv.totalIn / 1e8).toFixed(2)}억 → ${(vv.finalAfterTax / 1e8).toFixed(2)}억  MDD ${vv.mdd.toFixed(0)}%  잠금 ${vv.lockedWeeks}주`);
}
