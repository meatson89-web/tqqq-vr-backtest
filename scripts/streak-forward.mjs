// TQQQ 연속 상승 이후 성과 분석
//
//   node scripts/streak-forward.mjs            # 실제 TQQQ(2010~)
//   node scripts/streak-forward.mjs --sim      # 합성 TQQQ(1999~, 닷컴/금융위기 포함)
//   node scripts/streak-forward.mjs --md       # 마크다운 표로 출력
//
// 질문: "3일·4일·5일 연속 상승한 뒤, 누적 상승률에 따라 5/10/20일 뒤 가격은?"
//
// 정의
//   상승일   : 종가 > 전일 종가
//   연속 N일 : 앞뒤가 끊긴 '정확히 N일' 연속 상승 구간(최대 연속 구간 기준).
//              5일 연속은 3일 연속에도 포함되는 식의 중복 집계를 피한다.
//   진입     : 연속 상승 마지막 날 종가(= 연속 상승을 확인한 시점에 사는 경우)
//   누적상승률: 연속 시작 직전 종가 → 마지막 날 종가
//   5/10/20일: 이후 거래일 기준 수익률(종가/진입가 - 1)
//   MDD      : 진입 후 해당 구간 안에서 종가가 진입가 대비 가장 많이 빠진 폭

import fs from 'node:fs';

const args = process.argv.slice(2);
const USE_SIM = args.includes('--sim');
const AS_MD = args.includes('--md');

const file = USE_SIM ? '../src/data/tqqq_sim.json' : '../src/data/tqqq.json';
const DATA = JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const dates = DATA.map((d) => d[0]);
const close = DATA.map((d) => d[1]);

const HORIZONS = [5, 10, 20];
// 누적 상승률 구간. TQQQ 3일 연속의 중앙값이 약 6.6%, 5일 연속이 약 11.5%다.
const BUCKETS = [
  { label: '~5%', lo: -Infinity, hi: 0.05 },
  { label: '5~10%', lo: 0.05, hi: 0.1 },
  { label: '10~15%', lo: 0.1, hi: 0.15 },
  { label: '15%~', lo: 0.15, hi: Infinity },
];

// 최대 연속 상승 구간을 모두 찾는다.
function findStreaks() {
  const out = [];
  let len = 0;
  for (let i = 1; i < close.length; i++) {
    if (close[i] > close[i - 1]) {
      len++;
    } else {
      if (len > 0) out.push(makeStreak(i - 1, len));
      len = 0;
    }
  }
  if (len > 0) out.push(makeStreak(close.length - 1, len));
  return out;
}

function makeStreak(endIdx, len) {
  const startIdx = endIdx - len; // 연속 시작 '직전' 종가의 인덱스
  const s = {
    len,
    endIdx,
    startDate: dates[startIdx + 1],
    endDate: dates[endIdx],
    entry: close[endIdx],
    gain: close[endIdx] / close[startIdx] - 1,
    fwd: {},
    mdd: {},
  };
  for (const h of HORIZONS) {
    if (endIdx + h < close.length) {
      s.fwd[h] = close[endIdx + h] / s.entry - 1;
      let lo = 0;
      for (let k = 1; k <= h; k++) lo = Math.min(lo, close[endIdx + k] / s.entry - 1);
      s.mdd[h] = lo;
    }
  }
  return s;
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (v, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '-');
const pctPlain = (v, d = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : '-');

// 한 표본 집합의 5/10/20일 통계
function stats(group) {
  const row = { n: group.length };
  for (const h of HORIZONS) {
    const fwd = group.filter((s) => Number.isFinite(s.fwd[h])).map((s) => s.fwd[h]);
    const mdd = group.filter((s) => Number.isFinite(s.mdd[h])).map((s) => s.mdd[h]);
    row[h] = {
      n: fwd.length,
      avg: mean(fwd),
      med: median(fwd),
      win: fwd.length ? fwd.filter((v) => v > 0).length / fwd.length : NaN,
      worst: fwd.length ? Math.min(...fwd) : NaN,
      best: fwd.length ? Math.max(...fwd) : NaN,
      mddAvg: mean(mdd),
      mddWorst: mdd.length ? Math.min(...mdd) : NaN,
    };
  }
  return row;
}

// 비교 기준선: 전 거래일에서 무작정 샀을 때
function baseline() {
  const all = [];
  for (let i = 0; i < close.length; i++) {
    const s = { fwd: {}, mdd: {} };
    for (const h of HORIZONS) {
      if (i + h < close.length) {
        s.fwd[h] = close[i + h] / close[i] - 1;
        let lo = 0;
        for (let k = 1; k <= h; k++) lo = Math.min(lo, close[i + k] / close[i] - 1);
        s.mdd[h] = lo;
      }
    }
    all.push(s);
  }
  return stats(all);
}

const streaks = findStreaks();
const rows = [];

function pushRow(label, group) {
  if (!group.length) return;
  rows.push({ label, gainAvg: mean(group.map((s) => s.gain)), ...stats(group) });
}

// 기준선을 맨 위에 놓고, 그 아래에 연속 상승 케이스를 쌓는다.
rows.push({ label: '기준선(아무 날이나 매수)', gainAvg: NaN, ...baseline() });

for (const n of [3, 4, 5]) {
  const g = streaks.filter((s) => s.len === n);
  pushRow(`${n}일 연속 전체`, g);
  for (const b of BUCKETS) {
    pushRow(`  ${n}일 · ${b.label}`, g.filter((s) => s.gain >= b.lo && s.gain < b.hi));
  }
}
pushRow('6일 이상 연속', streaks.filter((s) => s.len >= 6));

// ── 출력 ────────────────────────────────────────────────────────────────
const title = USE_SIM ? '합성 TQQQ(1999~)' : '실제 TQQQ(2010~)';
console.log(`\n# TQQQ 연속 상승 이후 성과 — ${title}`);
console.log(`기간: ${dates[0]} ~ ${dates[dates.length - 1]} (${close.length}거래일)\n`);

if (AS_MD) {
  console.log('### 이후 수익률 (평균 / 중앙값 / 승률)\n');
  console.log('| 구분 | 표본 | 누적상승 | 5일 | 10일 | 20일 |');
  console.log('|---|---:|---:|---:|---:|---:|');
  for (const r of rows) {
    const cell = (h) => `${pct(r[h].avg)} / ${pct(r[h].med)} / ${pctPlain(r[h].win, 0)}`;
    console.log(`| ${r.label} | ${r.n} | ${pct(r.gainAvg)} | ${cell(5)} | ${cell(10)} | ${cell(20)} |`);
  }
  console.log('\n### 이후 하락폭 (진입가 대비 평균 MDD / 최악 MDD)\n');
  console.log('| 구분 | 표본 | 5일 | 10일 | 20일 | 20일 최저 수익률 |');
  console.log('|---|---:|---:|---:|---:|---:|');
  for (const r of rows) {
    console.log(
      `| ${r.label} | ${r.n} | ${pct(r[5].mddAvg)} / ${pct(r[5].mddWorst)} | ` +
        `${pct(r[10].mddAvg)} / ${pct(r[10].mddWorst)} | ` +
        `${pct(r[20].mddAvg)} / ${pct(r[20].mddWorst)} | ${pct(r[20].worst)} |`,
    );
  }
} else {
  const pad = (s, w) => String(s).padEnd(w, ' ');
  const padL = (s, w) => String(s).padStart(w, ' ');
  console.log(
    pad('구분', 22) +
      padL('표본', 5) +
      padL('누적', 8) +
      padL('5일', 8) +
      padL('10일', 8) +
      padL('20일', 8) +
      padL('승률20', 8) +
      padL('MDD평균', 9) +
      padL('MDD최악', 9),
  );
  for (const r of rows) {
    console.log(
      pad(r.label, 22) +
        padL(r.n, 5) +
        padL(pct(r.gainAvg), 8) +
        padL(pct(r[5].avg), 8) +
        padL(pct(r[10].avg), 8) +
        padL(pct(r[20].avg), 8) +
        padL(pctPlain(r[20].win, 0), 8) +
        padL(pct(r[20].mddAvg), 9) +
        padL(pct(r[20].mddWorst), 9),
    );
  }
}

// 개별 기록 출력
function printRecords(list) {
  if (AS_MD) {
    console.log('| 기간 | 일수 | 누적상승 | 진입가 | 5일 | 10일 | 20일 | 20일 MDD |');
    console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
    for (const s of list) {
      console.log(
        `| ${s.startDate}~${s.endDate} | ${s.len} | ${pct(s.gain)} | ${s.entry.toFixed(2)} | ` +
          `${pct(s.fwd[5])} | ${pct(s.fwd[10])} | ${pct(s.fwd[20])} | ${pct(s.mdd[20])} |`,
      );
    }
  } else {
    for (const s of list) {
      console.log(
        `${s.startDate}~${s.endDate}  ${s.len}일  누적 ${pct(s.gain)}  진입 ${s.entry.toFixed(2)}  ` +
          `5일 ${pct(s.fwd[5])}  10일 ${pct(s.fwd[10])}  20일 ${pct(s.fwd[20])}  MDD20 ${pct(s.mdd[20])}`,
      );
    }
  }
}

console.log('\n## 누적 상승률 상위 20건 (3일 이상 연속)\n');
printRecords(
  streaks
    .filter((s) => s.len >= 3)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 20),
);

console.log('\n## 최근 15건 (3일 이상 연속)\n');
printRecords(streaks.filter((s) => s.len >= 3).slice(-15));

// 전체 기록 CSV
const csvPath = new URL(`../docs/${USE_SIM ? 'streaks_sim.csv' : 'streaks.csv'}`, import.meta.url);
const csv = [
  'start,end,len,cum_gain,entry,fwd5,fwd10,fwd20,mdd5,mdd10,mdd20',
  ...streaks
    .filter((s) => s.len >= 3)
    .map((s) =>
      [
        s.startDate,
        s.endDate,
        s.len,
        s.gain.toFixed(4),
        s.entry,
        s.fwd[5]?.toFixed(4) ?? '',
        s.fwd[10]?.toFixed(4) ?? '',
        s.fwd[20]?.toFixed(4) ?? '',
        s.mdd[5]?.toFixed(4) ?? '',
        s.mdd[10]?.toFixed(4) ?? '',
        s.mdd[20]?.toFixed(4) ?? '',
      ].join(','),
    ),
].join('\n');
if (args.includes('--csv')) {
  fs.mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
  fs.writeFileSync(csvPath, csv + '\n');
  console.log(`\n전체 기록 CSV: ${csvPath.pathname}`);
}
