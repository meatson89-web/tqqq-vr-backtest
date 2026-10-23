import '../monitor/monitor.css'
import '../drawdown/drawdown.css'
import './soxl.css'

// 출처: SOXL 추천C 매수규칙 점검 (2026-09-21, claude.ai 아티팩트) 요약.
// 시간봉 = Polygon 2021-08-25~2026-08-24, 일봉 근사 = 야후 2010-03-11~2026-09-21. 초기 $10,000, 편도 0.05%, 세금 없음.
const GRID = [
  ['RSI 9', ['$124k', 4], ['$67k', 9], ['$13k', 14], ['$44k', 14]],
  ['RSI 12', ['$20k', 1], ['$324k', 2, true], ['$133k', 7], ['$38k', 13]],
  ['RSI 14', ['$30k', 0], ['$74k', 1], ['$185k', 6], ['$25k', 12]],
  ['RSI 16', ['$16k', 0], ['$24k', 1], ['$641k', 2], ['$38k', 9]],
]
const WIN = [
  ['2010-03', 1.53, 3.57, -68, 6], ['2011-03', 0.71, 1.75, -69, 6], ['2012-03', 2.35, 8.05, -65, 5],
  ['2013-03', 11.35, 21.09, -65, 3], ['2014-03', 2.59, 6.0, -65, 5], ['2015-03', 3.16, 5.27, -63, 6],
  ['2016-03', 20.84, 19.66, -62, 4], ['2017-03', 6.04, 6.6, -62, 6], ['2018-03', 2.73, 1.07, -61, 6],
  ['2019-03', 13.47, 5.97, -51, 5], ['2020-03', 16.3, 1.89, -51, 5], ['2021-03', 11.5, 1.63, -51, 5],
]
const YEARS = [
  [2010, -2.0, 26.2, 2], [2011, -11.9, -48.1, 1], [2012, -48.5, 3.6, 2], [2013, 98.3, 156.7, 0],
  [2014, 60.5, 95.3, 1], [2015, -19.5, -20.6, 1], [2016, 75.4, 123.5, 1], [2017, 101.7, 141.7, 0],
  [2018, -25.8, -39.1, 2], [2019, 34.9, 231.8, 1], [2020, 196.0, 70.0, 1], [2021, 65.2, 118.8, 1],
  [2022, -31.4, -85.7, 1], [2023, 122.5, 227.0, 1], [2024, 126.9, -12.3, 1], [2025, 99.6, 54.9, 1], [2026, 334.9, 219.5, 1],
]
const CAND = [
  ['트레일 3% → 2%', '$403k (+24%)', '비교 불가', '기각', '1.0%에서 무너지는 좁은 봉우리. 3배 ETF 슬리피지 영역'],
  ['필터 확인 10일 연속', '$364k, 손절 1', '$3.15M (−47%)', '기각', '2025-02-24 한 건을 피하고 2010년대 진입을 대거 놓침'],
  ['200일선 거리 > +3%만 진입', '$402k, 손절 1', '$1.97M (−65%)', '기각', '거리 0.0%였던 한 건에 맞춘 것'],
  ['SOX 60일 고점 대비 > −10%만', '$106k', '$0.75M', '기각', '손절 2건 그대로, 승리 거래만 버림'],
  ['SOXL 60일 고점 대비 > −30/−40%', '$85k', '$0.55M / $1.26M', '기각', '깊은 낙폭 진입이 승리 거래에 더 많음'],
  ['하드스탑 30% → 25%', '$185k', '$8.60M (+45%)', '기각', '기간마다 방향이 반대'],
  ['하드스탑 → 20%', '$214k', '$1.94M', '기각', '−10% 넘게 견디고 이긴 거래 9건이 손실로 바뀜'],
  ['발동 10% / 트레일 5%', '$277k', '$4.21M', '기각', '반납이 늘고 손절은 줄지 않음'],
  ['발동 15~20%', '$51k / $30k', '—', '기각', '발동 전 손절이 7~8건으로 늘어남'],
  ['보유 중 200일선 이탈 시 청산', '$175k', '$0.53M', '기각', '이탈 직후 반등을 매번 놓침'],
  ['청산 후 5~20일 재진입 금지', '$110k ~ $20k', '—', '기각', '연속 진입이 이익의 원천'],
  ['포지션 70% (현금 30%)', '$127k · MDD −29.5%', '$1.61M · MDD −52.9%', '선택지', 'MDD를 11~15%p 줄이는 유일한 레버. 총자산은 감소'],
  ['SOX 200일선 필터 (현재 규칙)', '+20% vs 필터 없음', '+58% / +81%', '유지', '양쪽 기간에서 유일하게 플러스'],
]
const sg = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%'

export default function SoxlSummary() {
  return (
    <div className="monitor dd sx">
      <div className="mn-head">
        <h2>SOXL 단기 — 추천C 매수규칙 점검 요약</h2>
        <span className="mn-sub">2026-09-21 점검 · 시간봉 2021-08~2026-08 (Polygon) · 일봉 근사 2010-03~2026-09 (야후)</span>
      </div>
      <p className="dd-lead">
        결론: <b>결과는 −30% 손절 횟수가 정하고, 그 횟수를 미리 줄이는 진입 규칙은 없었다.</b> 최근 5년 32.4배는 재현되지만 파라미터를
        한 칸만 옮겨도 총자산이 5~16배 흔들린다. 15개 개선안 중 두 기간 모두에서 총자산을 올린 것은 없다 → <b>파라미터 유지</b>, 기대치는 상장 이후 기준으로.
      </p>

      <div className="dd-h">규칙 (종가 판정, 1시간봉 정규장)</div>
      <div className="sx-rules">
        <div><span>진입</span><b>RSI(12) ≤ 25</b><em>그리고 전일 SOX 종가 &gt; SOX 200일선</em></div>
        <div><span>트레일 발동</span><b>+10%</b><em>보유 중 종가가 진입가 +10% 도달</em></div>
        <div><span>익절</span><b>고점 −3%</b><em>발동 후 보유 중 최고 종가 대비</em></div>
        <div><span>손절</span><b>진입가 −30%</b><em>발동 전에만 적용 (하드스탑)</em></div>
      </div>
      <p className="mn-note">증권사 스탑주문을 걸지 않는다. 같은 −3%를 장중 스탑으로 걸면 꼬리에 잘려 성과가 무너진다. 1시간봉 종가를 보고 직접 판단.
        (09-06 v3 파인 스크립트는 문턱 25.5, 이 점검은 25 기준이다.)</p>

      <div className="mn-rail">
        <div className="mn-tile"><div className="k">최근 5년 재현 (시간봉)</div><div className="v">32.4<small>배</small></div><div className="n">$324,080 · MDD −40.8% · 39매매 37승 · 하드스탑 2건</div></div>
        <div className="mn-tile"><div className="k">이웃 파라미터 16칸</div><div className="v" style={{ color: '#e8a33d' }}>1.3~64<small>배</small></div><div className="n">RSI 기간·문턱 한 칸 차이. 하드스탑 0~14건이 갈랐다</div></div>
        <div className="mn-tile"><div className="k">상장 이후 16.5년 (일봉 근사)</div><div className="v" style={{ color: '#e66767' }}>6<small>개 손실 연도</small></div><div className="n">17년 중. 하드스탑 18건, MDD −68%. 5년 창 12개 중 7개에서 바이앤홀드에 짐</div></div>
        <div className="mn-tile"><div className="k">채택한 개선안</div><div className="v">0<small>건</small></div><div className="n">15개 후보 전부 한쪽 기간에서 총자산 감소</div></div>
      </div>

      <div className="dd-h">다섯 줄 요약</div>
      <ol className="dd-list">
        <li><b>재현된다.</b> $10,000 → $324,080, CAGR 100.6%. 필터 없는 B는 $269,973 / MDD −66.3%, 바이앤홀드 $25,315.</li>
        <li><b>손익 구조가 문제.</b> 평균 이익 +12.6%, 평균 손실 −31.0% → 손절 1번이 이익 2.5번을 지운다. 손익분기 승률 76%.</li>
        <li><b>두 손절(2024-07-17, 2025-02-24)은 사전에 걸러지지 않는다.</b> 200일선 거리·60일 낙폭·직전 5일 수익률 어느 것으로도 승리 거래와 갈리지 않았다.</li>
        <li><b>최근 5년이 상장 이후 최고의 창이다.</b> 2010년부터는 매년 약 1건 손절, 손실 연도 6번. 크게 이기는 건 2018년 이후 시작한 창뿐.</li>
        <li><b>권고:</b> 파라미터 유지 · 봇(strategy.py)에 SOX 200일선 필터 이식 · 계획은 상장 이후 기준으로.</li>
      </ol>

      <div className="dd-h">문제점</div>
      <ol className="dd-list">
        <li><b>P1 진입 파라미터 표면이 봉우리다.</b> 16칸 중 $300k 넘는 칸은 둘뿐이고 둘 다 이웃이 10배 아래. 39건 표본에서 손절이 우연히 2건이었던 칸이다.</li>
        <li><b>P2 손절은 진입 시점에 구분되지 않는다.</b> 손절 2건은 SOX가 고점 근처에서 막 꺾이던 순간. 승리 거래엔 SOXL 60일 낙폭 −59% 진입도 있다.</li>
        <li><b>P3 손익비 0.40, 손익분기 승률 76%.</b> 최근 5년 승률 95%, 상장 이후 82% → 여유 6%p뿐.</li>
        <li><b>P4 손절을 조이면 더 나빠진다.</b> 20%는 $214k / MDD −48.1%. 잘리고 되사서 또 잘리는 톱질이 생긴다.</li>
      </ol>

      <div className="dd-h">진입 RSI 기간 × 문턱 (시간봉 5년 총자산 · 손절 횟수)</div>
      <div className="mn-tw"><table className="sx-grid">
        <thead><tr><th></th><th className="c">≤20</th><th className="c">≤25</th><th className="c">≤30</th><th className="c">≤35</th></tr></thead>
        <tbody>{GRID.map(([k, ...cells]) => (
          <tr key={k}><td className="dim">{k}</td>{cells.map(([v, h, pick], i) => (
            <td key={i} className={`c${pick ? ' pick' : ''}`}>{v}<div className="dim">손절 {h}{pick ? ' · 현재' : ''}</div></td>))}</tr>
        ))}</tbody>
      </table></div>

      <div className="dd-h">상장 이후 5년 창 (일봉 근사, 3월 시작)</div>
      <div className="mn-tw"><table>
        <thead><tr><th style={{ textAlign: 'left' }}>시작</th><th>전략</th><th>바이앤홀드</th><th>전략 MDD</th><th>손절</th></tr></thead>
        <tbody>{WIN.map(([d, s, b, m, h]) => (
          <tr key={d} className={s < b ? 'sx-lose' : ''}><td style={{ textAlign: 'left' }}>{d}</td><td className={s < 1 ? 'neg' : ''}>{s.toFixed(2)}배</td><td>{b.toFixed(2)}배</td><td>{m}%</td><td>{h}</td></tr>
        ))}</tbody>
      </table></div>
      <p className="mn-note">붉은 행 = 바이앤홀드에 진 창 (12개 중 7개). 16.5년 누적은 전략 $5.9M vs 바이앤홀드 $2.2M이지만 차이의 거의 전부가 2018년 이후에 생겼다.</p>

      <div className="dd-h">연도별 수익률 (일봉 근사 vs SOXL 바이앤홀드)</div>
      <div className="mn-tw"><table>
        <thead><tr><th style={{ textAlign: 'left' }}>연도</th>{YEARS.map(y => <th key={y[0]}>{String(y[0]).slice(2)}</th>)}</tr></thead>
        <tbody>
          <tr><td style={{ textAlign: 'left' }} className="dim">전략</td>{YEARS.map(y => <td key={y[0]} className={y[1] >= 0 ? 'pos' : 'neg'}>{sg(y[1])}</td>)}</tr>
          <tr><td style={{ textAlign: 'left' }} className="dim">바이앤홀드</td>{YEARS.map(y => <td key={y[0]} className={y[2] >= 0 ? 'pos' : 'neg'}>{sg(y[2])}</td>)}</tr>
          <tr><td style={{ textAlign: 'left' }} className="dim">손절</td>{YEARS.map(y => <td key={y[0]} className="dim">{y[3] || '·'}</td>)}</tr>
        </tbody>
      </table></div>
      <p className="mn-note">2010년은 3월 상장부터, 2026년은 9월 21일까지. 전략이 이긴 해는 17년 중 5번(2020·2022·2024·2025·2026).</p>

      <div className="dd-h">개선 후보 검토 — 두 기간 모두 플러스여야 채택</div>
      <div className="mn-tw"><table>
        <thead><tr><th style={{ textAlign: 'left' }}>후보</th><th>시간봉 5년</th><th>일봉 16.5년</th><th className="c">판정</th><th style={{ textAlign: 'left' }}>사유</th></tr></thead>
        <tbody>{CAND.map(([n, a, b, v, why]) => (
          <tr key={n}><td style={{ textAlign: 'left' }}>{n}</td><td>{a}</td><td>{b}</td>
            <td className="c"><span className={`sx-chip ${v === '유지' ? 'keep' : v === '선택지' ? 'opt' : ''}`}>{v}</span></td>
            <td className="dd-wrap dim" style={{ textAlign: 'left' }}>{why}</td></tr>
        ))}</tbody>
      </table></div>

      <div className="dd-h">권고</div>
      <ol className="dd-list">
        <li><b>파라미터 유지</b> — RSI(12) ≤ 25, 발동 +10%, 트레일 −3%, 손절 −30%, SOX 200일선 필터. 더 높은 이웃 칸(트레일 2%, RSI16≤30)은 고립된 봉우리라 옮기지 않는다.</li>
        <li><b>봇에 필터 이식</b> — soxl-signal-bot의 strategy.py는 필터 없는 B를 돌린다. 전일 SOX 종가 &gt; 200일 SMA를 진입에 AND로 넣는 것이 유일한 실행 항목.</li>
        <li><b>감시 기준 두 가지</b> — 누적 승률이 <b>76% 아래</b>면 복리가 음수. <b>12개월 안에 손절 3건</b>이면 규칙이 아니라 국면을 의심한다.</li>
        <li><b>선택지: 포지션 70%</b> — MDD를 −40.8% → −29.5%로 줄이지만 총자산이 −61%. 손절 −30%를 견딜 수 없다면 파라미터가 아니라 비율을 건드린다.</li>
        <li><b>하지 말 것</b> — 손절 조이기(20~25%), 60일 낙폭·200일선 거리로 진입 추가 필터, 일봉 근사 절대치($5.9M)를 성과로 읽기.</li>
      </ol>
      <p className="mn-note">한계: 종가 판정, 편도 0.05%, 세금·슬리피지 없음. 일봉 근사는 시간봉보다 거칠어 손절·MDD가 과대평가될 수 있다(방향만 읽을 것).</p>
    </div>
  )
}
