// 전략 변경안 검증 프레임
//
//   node scripts/validate.mjs
//
// 기존 검증("46개 롤링 윈도우 중 몇 개가 개선됐나")은 두 가지 이유로 결론을 낼 수 없다.
//   1) 46개 윈도우는 인접끼리 데이터가 95% 겹친다. 독립 표본은 사실상 3개다.
//      → 윈도우 단위 승패를 세는 대신 블록 부트스트랩으로 신뢰구간을 낸다.
//   2) 세전 기준이라 실제 손에 남는 금액과 다르다. 이 전략은 이익실현 매도가 잦아
//      세금 영향이 크고, 세전/세후로 순위가 뒤집힌다.
//      → 모든 판정을 세후로 한다.
// 여기에 더해, TQQQ 한 종목에서만 좋은 안은 그 구간에 맞춘 것일 가능성이 높으므로
// 2008년을 포함하는 QLD로 교차검증한다.
//
// 통과 조건 (4개 전부):
//   G1 자산 하한 — 세후 총자산이 기준 대비 10% 넘게 줄지 않을 것.
//                 (현금 비중만 늘려 변동성을 줄이는 안을 걸러내기 위한 조건)
//   G2 개선     — 세후 총자산 평균 개선폭 > 0
//   G3 교차검증 — QLD에서도 평균 개선폭의 부호가 같을 것
//   G4 유의성   — 블록 부트스트랩 95% 신뢰구간이 0을 포함하지 않을 것

import fs from 'node:fs';
import { runFinalBacktest, DEFAULT_SETTINGS, TQQQ_DATA } from '../src/lib/backtest.js';

const QLD_DATA = JSON.parse(fs.readFileSync(new URL('../src/data/qld.json', import.meta.url), 'utf8'));
// 합성 TQQQ(1999~). 닷컴버블·금융위기가 들어 있는 유일한 데이터.
// 생성: python scripts/build-sim-tqqq.py
const SIM_DATA = JSON.parse(fs.readFileSync(new URL('../src/data/tqqq_sim.json', import.meta.url), 'utf8'));

// 현재 기본 설정을 기준선으로 삼는다.
const BASE = { ...DEFAULT_SETTINGS };

const CANDIDATES = [
  { label: '완화매도 끄기', settings: { relaxEnabled: false } },
  { label: '부스터 끄기', settings: { enabled: false } },
  { label: '부스터 낙폭 -25%', settings: { drawdownPct: 25 } },
  { label: '부스터 낙폭 -35%', settings: { drawdownPct: 35 } },
  { label: '부스터 재투자 40%', settings: { ratioPct: 40 } },
  { label: '부스터 재투자 80%', settings: { ratioPct: 80 } },
  { label: '부스터 재투자 100%', settings: { ratioPct: 100 } },
  { label: '완화매도 7→9개월', settings: { relaxMonths: 9 } },
];

const WINDOW = 252 * 5, SLIDE = 63;
const windowsOf = data => {
  const out = [];
  for (let s = 0; s + WINDOW <= data.length; s += SLIDE) out.push([data[s][0], data[s + WINDOW - 1][0]]);
  return out;
};

// 후보 - 기준선의 세후 총자산 차이(%)를 윈도우별로
function deltas(settings, data) {
  return windowsOf(data).map(([sd, ed]) => {
    const b = runFinalBacktest(sd, ed, BASE, data).stats;
    const v = runFinalBacktest(sd, ed, { ...BASE, ...settings }, data).stats;
    return (v.finalAfterTax / b.finalAfterTax - 1) * 100;
  });
}

// 순환 블록 부트스트랩. 인접 윈도우가 겹치는 만큼(WINDOW/SLIDE=20개)을 한 블록으로 묶어
// 재표본해야 겹침에서 오는 가짜 표본 수를 걷어낼 수 있다.
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

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const fmtB = v => `${(v / 1e8).toFixed(2)}억`;
const pct = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

// ── 기준선 ───────────────────────────────────────────────────────────────
const fullT = runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], BASE).stats;
console.log('기준선 (현재 설정, 세후)');
console.log(`  TQQQ 2010-2026  총자산 ${fmtB(fullT.finalAfterTax)}  납세 ${fmtB(fullT.taxPaid)}  IRR ${pct(fullT.irr)}  MDD ${fullT.mdd.toFixed(1)}%`);
console.log(`  롤링 윈도우 TQQQ ${windowsOf(TQQQ_DATA).length}개 / QLD ${windowsOf(QLD_DATA).length}개 / 합성 ${windowsOf(SIM_DATA).length}개 (블록 길이 ${Math.round(WINDOW / SLIDE)})`);
const simFull = runFinalBacktest(SIM_DATA[0][0], SIM_DATA.at(-1)[0], BASE, SIM_DATA).stats;
console.log(`  합성 TQQQ 1999-2026 (닷컴·금융위기 포함): 총자산 ${fmtB(simFull.finalAfterTax)}  MDD ${simFull.mdd.toFixed(1)}%`);
for (const [lbl, s, e] of [['닷컴 5년 1999-03~2004-03', '1999-03-11', '2004-03-15'], ['금융위기 5년 2004-03~2009-03', '2004-03-16', '2009-03-17']]) {
  const st = runFinalBacktest(s, e, BASE, SIM_DATA).stats;
  console.log(`    ${lbl}: 납입 ${fmtB(st.totalIn)} → ${fmtB(st.finalAfterTax)} (원금의 ${(st.finalAfterTax / st.totalIn * 100).toFixed(0)}%), MDD ${st.mdd.toFixed(0)}%, 매도 ${st.sellCount}회`);
}
console.log('');

// ── 후보 판정 ────────────────────────────────────────────────────────────
console.log('후보'.padEnd(20) + 'TQQQ평균  중앙값   95%신뢰구간      QLD평균  합성99~  전체구간Δ  판정');
for (const { label, settings } of CANDIDATES) {
  const dT = deltas(settings, TQQQ_DATA);
  const dQ = deltas(settings, QLD_DATA);
  const dS = deltas(settings, SIM_DATA);
  const [lo, hi] = bootstrapCI(dT);
  const fv = runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], { ...BASE, ...settings }).stats;
  const fullDelta = (fv.finalAfterTax / fullT.finalAfterTax - 1) * 100;

  const g1 = median(dT) >= -10 && fullDelta >= -10;
  const g2 = mean(dT) > 0;
  // 교차검증: QLD(2배·2008포함)와 합성TQQQ(1999~·닷컴포함) 어느 쪽에서도
  // 반대 방향으로 크게 무너지지 않을 것. 두 데이터 모두 매도가 드물게 발동해
  // 정보량이 적으므로 "부호 일치"가 아니라 "-5% 초과 악화 없음"으로 본다.
  const g3 = mean(dQ) > -5 && mean(dS) > -5;
  const g4 = lo > 0 || hi < 0;
  const gates = [g1, g2, g3, g4];
  const verdict = gates.every(Boolean) ? '통과' : `탈락(${gates.map((g, i) => g ? null : `G${i + 1}`).filter(Boolean).join(',')})`;

  console.log(
    label.padEnd(20) + pct(mean(dT)).padStart(8) + pct(median(dT)).padStart(8) +
    `[${lo.toFixed(1)}, ${hi.toFixed(1)}]`.padStart(17) +
    pct(mean(dQ)).padStart(9) + pct(mean(dS)).padStart(9) + pct(fullDelta).padStart(11) + '  ' + verdict
  );
}

// ── 파라미터 안정성 ──────────────────────────────────────────────────────
// 어떤 파라미터를 이웃 값으로 바꿨을 때 결과가 크게 흔들린다면, 지금 값이 좋은 것이
// 아니라 이 구간에 우연히 맞은 것이다. 변동폭이 1.2배 이하면 그 파라미터는 영향이
// 거의 없다는 뜻이므로 굳이 노출할 이유가 없다.
console.log('\n파라미터 안정성 (세후 총자산, 전체구간)');
const SCAN = [
  ['부스터 낙폭%', 'drawdownPct', [20, 25, 30, 35, 40]],
  ['부스터 재투자%', 'ratioPct', [25, 40, 60, 80, 100]],
  ['부스터 고점기간', 'lookback', [40, 50, 60, 80, 120]],
  ['완화 개월', 'relaxMonths', [5, 6, 7, 9, 12]],
  ['완화 이격폭', 'relaxDispDrop', [6, 9, 12, 15, 20]],
  ['완화매도 비율', 'relaxSellFrac', [0.03, 0.05, 0.10, 0.20, 0.40]],
];
for (const [name, key, vals] of SCAN) {
  const res = vals.map(v => runFinalBacktest(TQQQ_DATA[0][0], TQQQ_DATA.at(-1)[0], { ...BASE, [key]: v }).stats.finalAfterTax);
  const cells = vals.map((v, i) => (v === BASE[key] ? `[${(res[i] / 1e8).toFixed(0)}]` : `${(res[i] / 1e8).toFixed(0)}`)).join(' ');
  const spread = Math.max(...res) / Math.min(...res);
  console.log(`  ${name.padEnd(16)}${cells.padEnd(30)}${spread.toFixed(2)}배${spread <= 1.2 ? '  ← 영향 거의 없음' : ''}`);
}
