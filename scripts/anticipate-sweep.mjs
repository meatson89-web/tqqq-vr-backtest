// 조정예상매도 — 3단계: 발동조건 2·3 파라미터 스윕
//
// 기본값으로는 명확히 나빴다(23창 평균 -5.9%). 강세장에서도 발동하는 게 원인으로
// 보이므로 국면 문턱·마진·매도비율·현금비중을 훑어 "MDD는 줄이되 총자산은 안 깎는"
// 조합이 존재하는지 본다. 없으면 없다고 결론 내는 것도 결과다.
//
// 실행: node scripts/anticipate-sweep.mjs [stage]
//   stage 1 = 국면문턱 × 마진 (가장 중요한 두 축)
//   stage 2 = 매도비율 × 쿨다운
//   stage 3 = 현금비중(발동조건 2) × 수익률조건

import { DEFAULT_SETTINGS } from '../src/lib/backtest.js';
import { buildWindows, run } from './anticipate-compare.mjs';

const YR = 252;
const A = { ...DEFAULT_SETTINGS };
const base = { ...DEFAULT_SETTINGS, relaxEnabled: false, anticipateEnabled: true };

const wins5 = buildWindows(YR * 5);
const wins10 = buildWindows(YR * 10);
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const f = (v, d = 1) => (v > 0 ? '+' : '') + v.toFixed(d);

// A(기존)는 조합마다 같으므로 한 번만 계산
const baseA = new Map();
for (const w of [...wins5, ...wins10]) baseA.set(w, run(w, A));

function evalCfg(cfg, wins) {
  const d = [], m = [], n = [];
  for (const w of wins) {
    const a = baseA.get(w), c = run(w, { ...base, ...cfg });
    d.push((c.mult / a.mult - 1) * 100);
    m.push(c.mdd - a.mdd);
    n.push(c.ant);
  }
  return {
    dAvg: mean(d), dMed: med(d), up: d.filter(x => x > 0.5).length, dn: d.filter(x => x < -0.5).length,
    mAvg: mean(m), mUp: m.filter(x => x > 0.5).length, mDn: m.filter(x => x < -0.5).length,
    fires: mean(n), worst: Math.min(...d),
  };
}

const HEAD = '설정'.padEnd(46) + '총자산Δ평균'.padStart(11) + ' 중앙'.padStart(8) + '  개선/악화'.padStart(11) +
  '  최악창'.padStart(9) + '   MDDΔ'.padStart(9) + ' 개선/악화'.padStart(10) + '  발동'.padStart(7);

function sweep(label, cfgs, wins, tag) {
  console.log(`\n${'='.repeat(118)}`);
  console.log(`${label} — ${tag} 창 ${wins.length}개 (기존 전략 A 대비, 세후 납입대비 배수)`);
  console.log('='.repeat(118));
  console.log(HEAD);
  console.log('─'.repeat(118));
  const rows = cfgs.map(({ name, cfg }) => ({ name, cfg, r: evalCfg(cfg, wins) }));
  rows.sort((x, y) => y.r.dAvg - x.r.dAvg);
  for (const { name, r } of rows) {
    console.log(name.padEnd(46) +
      f(r.dAvg).padStart(10) + '%' + f(r.dMed).padStart(7) + '%' +
      `${r.up}/${r.dn}`.padStart(11) + f(r.worst).padStart(8) + '%' +
      f(r.mAvg).padStart(8) + 'p' + `${r.mUp}/${r.mDn}`.padStart(10) +
      r.fires.toFixed(1).padStart(7));
  }
  return rows;
}

const stage = +(process.argv[2] ?? 1);

if (stage === 1) {
  const cfgs = [];
  for (const reg of [0, 10, 20, 40, 9999]) {
    for (const mg of [0, 3, 6, 10]) {
      cfgs.push({ name: `국면≤${reg === 9999 ? '무제한' : reg + '%'} · 마진 +${mg}`, cfg: { anticipateRegimeMax: reg, anticipateMargin: mg } });
    }
  }
  sweep('1단계 — 국면 문턱 × 국면선 마진', cfgs, wins5, '5년');
}

if (stage === 2) {
  const cfgs = [];
  for (const frac of [0.10, 0.20, 0.30, 0.50, 0.70]) {
    for (const cd of [21, 63, 126]) {
      cfgs.push({ name: `매도 ${(frac * 100).toFixed(0)}% · 쿨다운 ${cd}일`, cfg: { anticipateSellFrac: frac, anticipateCooldown: cd } });
    }
  }
  sweep('2단계 — 매도비율 × 쿨다운 (국면·마진은 기본값)', cfgs, wins5, '5년');
}

if (stage === 3) {
  const cfgs = [];
  for (const cash of [5, 10, 20, 30, 100]) {
    for (const gain of [0, 0.10, 0.25]) {
      cfgs.push({ name: `현금≤${cash}% · 수익률≥${(gain * 100).toFixed(0)}%`, cfg: { anticipateCashMax: cash, anticipateMinGain: gain } });
    }
  }
  sweep('3단계 — 발동조건2(현금비중) × 수익률 조건', cfgs, wins5, '5년');
}

if (stage === 4) {
  // 앞 단계에서 살아남은 축만 조합. 현금조건은 100%(=사실상 해제)가 20%보다 나았다.
  const cfgs = [
    { name: '요청안 그대로 (국면40·현금20·매도30·쿨21)', cfg: {} },
    { name: '국면20 · 현금100 · 매도10 · 수익25', cfg: { anticipateRegimeMax: 20, anticipateCashMax: 100, anticipateSellFrac: 0.10, anticipateMinGain: 0.25 } },
    { name: '국면20 · 현금100 · 매도20 · 수익25', cfg: { anticipateRegimeMax: 20, anticipateCashMax: 100, anticipateSellFrac: 0.20, anticipateMinGain: 0.25 } },
    { name: '국면20 · 현금100 · 매도30 · 수익25', cfg: { anticipateRegimeMax: 20, anticipateCashMax: 100, anticipateSellFrac: 0.30, anticipateMinGain: 0.25 } },
    { name: '국면20 · 현금100 · 매도50 · 수익25', cfg: { anticipateRegimeMax: 20, anticipateCashMax: 100, anticipateSellFrac: 0.50, anticipateMinGain: 0.25 } },
    { name: '국면무제한 · 현금100 · 매도30 · 수익25', cfg: { anticipateRegimeMax: 9999, anticipateCashMax: 100, anticipateSellFrac: 0.30, anticipateMinGain: 0.25 } },
    { name: '국면무제한 · 현금100 · 매도70 · 수익25', cfg: { anticipateRegimeMax: 9999, anticipateCashMax: 100, anticipateSellFrac: 0.70, anticipateMinGain: 0.25 } },
    { name: '국면20 · 현금100 · 매도10 · 수익25 · 마진+3', cfg: { anticipateRegimeMax: 20, anticipateCashMax: 100, anticipateSellFrac: 0.10, anticipateMinGain: 0.25, anticipateMargin: 3 } },
  ];
  sweep('4단계 — 조합 (5년)', cfgs, wins5, '5년');
  sweep('4단계 — 조합 (10년, 견고성 확인)', cfgs, wins10, '10년');
}

if (stage === 5) {
  const FIX = { anticipateRegimeMax: 20, anticipateCashMax: 100, anticipateSellFrac: 0.30, anticipateMinGain: 0.25 };
  const cfgs = [];
  for (const df of [0, 10, 20, 30]) {
    for (const rf of [0, 68, 70]) {
      cfgs.push({ name: `이격도하한 ${df}% · RSI하한 ${rf || '없음'}`, cfg: { ...FIX, anticipateDispFloor: df, anticipateRsiFloor: rf } });
    }
  }
  sweep('5단계 — 예상선 하한 (보정안 기준)', cfgs, wins5, '5년');
  sweep('5단계 — 예상선 하한 (10년)', cfgs, wins10, '10년');
}
