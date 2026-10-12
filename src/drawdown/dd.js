// 하락장 기록·모니터 공용 계산.
// tqqq.json / qqq.json (매일 자동 갱신, 수정종가)만 쓰고 파생값은 전부 여기서 만든다.
// 그래서 데이터가 갱신되면 이벤트·회복일·유사 사례까지 자동으로 따라 움직인다.
//
// 이벤트 = QQQ가 TQQQ 상장일 이후 최고가에서 10% 이상 내려간 뒤 그 최고가를 되찾을 때까지.
// TQQQ 고점 = 직전 이벤트의 QQQ 회복일 ~ 이번 QQQ 바닥 사이에서 TQQQ가 가장 높았던 날.

export const EVENT_TH = -0.10

export const NAMES = {
  '2010-04': '2010년 유럽 재정위기', '2011-07': '2011년 미국 신용등급 강등',
  '2012-04': '2012년 4~6월 유럽 위기', '2012-09': '2012년 9~11월 재정절벽',
  '2015-07': '2015년 8월 위안화 절하', '2015-12': '2016년 1~2월 유가 급락',
  '2018-01': '2018년 2월 급락', '2018-03': '2018년 3월', '2018-08': '2018년 4분기',
  '2019-05': '2019년 5월 무역분쟁', '2020-02': '코로나', '2020-09': '2020년 9월',
  '2021-02': '2021년 2월 금리', '2021-12': '2022년 약세장', '2024-07': '2024년 7~8월',
  '2025-02': '2025년 관세', '2025-10': '2025-10 ~ 2026-03', '2026-06': '2026년 6~7월',
}

const day = s => Date.parse(s) / 864e5
export const calDays = (a, b) => Math.round(day(b) - day(a))
export const monthsBetween = (a, b) => (day(b) - day(a)) / 30.44

// TQQQ 상장일부터 두 계열이 모두 있는 날만 쓴다.
export function buildData(tqqqRaw, qqqRaw) {
  const qm = new Map(qqqRaw)
  const D = [], Q = [], T = []
  for (const [d, t] of tqqqRaw) {
    const q = qm.get(d)
    if (q == null || t == null) continue
    D.push(d); Q.push(q); T.push(t)
  }
  return { D, Q, T }
}

export function findEvents(D, Q, T) {
  const E = []
  let pk = 0, pi = 0, cur = null
  for (let i = 0; i < Q.length; i++) {
    if (Q[i] >= pk) { if (cur) { cur.rec = i; E.push(cur); cur = null } pk = Q[i]; pi = i; continue }
    if (!cur && Q[i] / pk - 1 <= EVENT_TH) cur = { pk: pi, cross: i, tr: i, rec: null }
    if (cur && Q[i] < Q[cur.tr]) cur.tr = i
  }
  if (cur) E.push(cur)
  let prevRec = 0
  for (const e of E) {
    let tp = prevRec
    for (let i = prevRec; i <= e.tr; i++) if (T[i] > T[tp]) tp = i
    const tEnd = e.rec ?? T.length - 1
    let tt = tp
    for (let i = tp; i <= tEnd; i++) if (T[i] < T[tt]) tt = i
    let trec = null
    for (let i = tt; i < T.length; i++) if (T[i] >= T[tp]) { trec = i; break }
    Object.assign(e, { tp, tt, trec, qmax: Q[e.tr] / Q[e.pk] - 1, tmax: T[tt] / T[tp] - 1 })
    e.name = NAMES[D[e.pk].slice(0, 7)] || `${D[e.pk].slice(0, 7)} 하락`
    prevRec = e.rec ?? Q.length - 1
  }
  return E
}

const firstFrom = (from, n, f) => { for (let i = from; i < n; i++) if (f(i)) return i; return null }
// QQQ 일간 수익률 × 3을 매일 복리로 쌓은 값 (비용 없음)
function syn3x(Q, a, b) { let v = 1; for (let i = a + 1; i <= b; i++) v *= 1 + 3 * (Q[i] / Q[i - 1] - 1); return v - 1 }

// 기록 페이지용 이벤트별 수치
export function recordRows(D, Q, T, E) {
  const N = Q.length
  const side = (S, pk, tr, rec) => {
    const p10 = firstFrom(tr, N, i => S[i] >= 1.1 * S[pk]), p20 = firstFrom(tr, N, i => S[i] >= 1.2 * S[pk])
    return {
      pk: D[pk], tr: D[tr], dd: S[tr] / S[pk] - 1, fall: monthsBetween(D[pk], D[tr]),
      rec: rec != null ? D[rec] : null, recM: rec != null ? monthsBetween(D[pk], D[rec]) : null,
      p10M: p10 != null ? monthsBetween(D[pk], D[p10]) : null, p20M: p20 != null ? monthsBetween(D[pk], D[p20]) : null,
    }
  }
  const ph = (a, b) => b == null ? null : { q: Q[b] / Q[a] - 1, t: T[b] / T[a] - 1, s: syn3x(Q, a, b) }
  return E.map(e => ({
    name: e.name, open: e.rec == null, tOpen: e.trec == null,
    q: side(Q, e.pk, e.tr, e.rec), t: side(T, e.tp, e.tt, e.trec),
    down: ph(e.pk, e.tr), up: ph(e.tr, e.rec), cycle: ph(e.pk, e.rec),
    tAtQrec: e.rec != null ? T[e.rec] / T[e.pk] - 1 : null,
    qAtTrec: e.trec != null ? Q[e.trec] / Q[e.tp] - 1 : null,
  }))
}

// 차트용 고점 대비 하락폭. 주마다 가장 깊었던 날 하나만 남긴다.
export function drawdownSeries(D, Q, T) {
  let qp = 0, tp = 0
  const out = []
  let wk = null, best = null
  for (let i = 0; i < D.length; i++) {
    qp = Math.max(qp, Q[i]); tp = Math.max(tp, T[i])
    const r = { d: D[i], q: (Q[i] / qp - 1) * 100, t: (T[i] / tp - 1) * 100 }
    const w = Math.floor((day(D[i]) + 3) / 7)
    if (w !== wk) { if (best) out.push(best); wk = w; best = r }
    else if (r.t < best.t) best = r
  }
  if (best) out.push(best)
  // 마지막 날은 그대로 보여준다
  const last = { d: D.at(-1), q: (Q.at(-1) / qp - 1) * 100, t: (T.at(-1) / tp - 1) * 100 }
  if (out.at(-1).d !== last.d) out.push(last); else out[out.length - 1] = last
  return out
}

// ---------- 모니터: 현재 상태 판정과 유사 사례 ----------
export function featB(D, Q, e, i) {
  let mn = Infinity
  for (let k = e.pk; k <= i; k++) mn = Math.min(mn, Q[k])
  return { qdd: Q[i] / Q[e.pk] - 1, qmin: mn / Q[e.pk] - 1, days: calDays(D[e.pk], D[i]) }
}
export function featC(D, T, e, i) {
  return { tdd: T[i] / T[e.tp] - 1, depth: e.qmax, since: calDays(D[e.rec], D[i]) }
}
// 단위: 아래 차이 하나씩이 "같은 정도로 다르다"
const distB = (a, b) => ((a.qdd - b.qdd) / 0.03) ** 2 + ((a.qmin - b.qmin) / 0.04) ** 2 + (Math.log((a.days + 10) / (b.days + 10)) / 0.5) ** 2
const distC = (a, b) => ((a.tdd - b.tdd) / 0.04) ** 2 + ((a.depth - b.depth) / 0.06) ** 2 + (Math.log((a.since + 10) / (b.since + 10)) / 0.6) ** 2

function outcome(D, Q, T, e, i) {
  const o = {}
  if (e.rec != null && i < e.rec) {
    let mn = Infinity
    for (let k = i; k <= e.rec; k++) mn = Math.min(mn, Q[k])
    o.qFurther = mn / Q[i] - 1; o.qRec = calDays(D[i], D[e.rec])
  } else { o.qFurther = 0; o.qRec = 0 }
  const tEnd = e.trec ?? T.length - 1
  let mn = Infinity
  for (let k = i; k <= tEnd; k++) mn = Math.min(mn, T[k])
  o.tFurther = mn / T[i] - 1
  o.tRec = e.trec != null ? calDays(D[i], D[e.trec]) : null
  for (const [k, n] of [['r3', 63], ['r6', 126], ['r12', 252]]) o[k] = i + n < T.length ? T[i + n] / T[i] - 1 : null
  return o
}

// 과거 이벤트마다 가장 닮은 하루를 고르고, 닮은 순으로 k개.
export function matchAnalogs(D, Q, T, E, phase, f, exclude, k = 8) {
  const res = []
  for (const e of E) {
    if (e === exclude) continue
    let best = null
    if (phase === 'B') {
      const end = e.rec ?? Q.length
      for (let i = e.cross; i < end; i++) { const g = featB(D, Q, e, i), d = distB(f, g); if (!best || d < best.d) best = { e, i, d } }
    } else {
      if (e.rec == null || e.trec == null || e.trec <= e.rec) continue
      for (let i = e.rec; i < e.trec; i++) { const g = featC(D, T, e, i), d = distC(f, g); if (!best || d < best.d) best = { e, i, d } }
    }
    if (best) res.push({ ...best, o: outcome(D, Q, T, e, best.i) })
  }
  return res.sort((a, b) => a.d - b.d).slice(0, k)
}

// 판정: A 정상 / B QQQ 하락 중 / C QQQ 회복·TQQQ 회복 전
export function currentState(D, Q, T, E) {
  const n = Q.length - 1, last = E.at(-1)
  let qpk = 0
  for (let i = 0; i <= n; i++) qpk = Math.max(qpk, Q[i])
  const st = { n, last, qddATH: Q[n] / qpk - 1, phase: 'A' }
  if (last && last.rec == null) { st.phase = 'B'; st.f = featB(D, Q, last, n) }
  else if (last && last.trec == null) { st.phase = 'C'; st.f = featC(D, T, last, n) }
  return st
}

// 직접 넣은 가격을 끝에 붙인 사본. 같은 날짜면 덮어쓰고, 이전 날짜면 그 뒤를 자른다.
export function withExtra(data, extra) {
  if (!extra) return data
  const D = [...data.D], Q = [...data.Q], T = [...data.T]
  let k = D.length - 1
  while (k >= 0 && D[k] >= extra.date) k--
  D.length = Q.length = T.length = k + 1
  D.push(extra.date); Q.push(extra.q); T.push(extra.t)
  return { D, Q, T }
}
