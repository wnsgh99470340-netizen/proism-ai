/**
 * 작업 리스트 시트 (2026-11-27 WorkOrderModal 에서 분리) — CRM 작업 내역서 창의 "PDF 저장"과 직원용 예약 페이지(/s)가 같은 그림을 쓴다
 * - 순수 표시 컴포넌트. 인쇄용 문서라 인라인 스타일(흰 바탕) 그대로
 * - hidePhone: 직원 페이지는 연락처 칸을 '—' 로 비운다
 */
import { forwardRef } from 'react';
import { ppfOptionLabel } from '@/lib/work-order';

export interface WorkSheetHead { date: string; car?: string | null; plate?: string | null; name?: string | null; source?: string | null; phone?: string | null }

function PrintCheck({ checked }: { checked: boolean }) {
  return checked
    ? <span style={{ background: '#E4002B', color: '#fff', padding: '2px 4px', borderRadius: '3px', fontSize: '14px', fontWeight: 'bold', marginRight: '6px', lineHeight: 1 }}>✓</span>
    : <span style={{ border: '2px solid #ccc', display: 'inline-block', width: '16px', height: '16px', borderRadius: '3px', marginRight: '6px', verticalAlign: 'middle' }} />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WorkSheet = forwardRef<HTMLDivElement, { workOrder: any; head: WorkSheetHead; hidePhone?: boolean }>(function WorkSheet({ workOrder, head, hidePhone }, ref) {
  return (
    <div ref={ref} style={{ width: '800px', padding: '40px', backgroundColor: '#fff', fontFamily: '"Pretendard Variable", -apple-system, sans-serif', color: '#000', fontSize: '12px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '16px' }}>
        <div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#E4002B', letterSpacing: '2px' }}>3M PROIZM</div>
          <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>3M 공식 프리퍼드 인스톨러 인증점</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '22px', fontWeight: 700 }}>작업 리스트</div>
          <div style={{ fontSize: '11px', color: '#888' }}>일반 / 고정</div>
        </div>
      </div>
      {/* 체크 */}
      <div style={{ display: 'flex', gap: '24px', marginBottom: '12px', fontSize: '13px', alignItems: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center' }}><PrintCheck checked={workOrder.warranty_issued} /> 보증서 발행 유무</span>
        <span style={{ display: 'inline-flex', alignItems: 'center' }}><PrintCheck checked={workOrder.crm_recorded} /> CRM 기재 유무</span>
      </div>
      {/* 고객 정보 테이블 */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px' }}>
        <tbody>
          <tr>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600, width: '80px' }}>일자</td>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>{head.date}</td>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600, width: '80px' }}>브랜드/차종</td>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>{head.car || '-'}</td>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600, width: '80px' }}>차량번호</td>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>{head.plate || '-'}</td>
          </tr>
          <tr>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>성명</td>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>{head.name || '-'}</td>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>유입경로</td>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>{head.source || '-'}</td>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>연락처</td>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>{hidePhone ? '—' : (head.phone || '-')}</td>
          </tr>
        </tbody>
      </table>
      {/* 썬팅 */}
      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px', borderBottom: '2px solid #E4002B', paddingBottom: '4px' }}>썬팅</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px' }}>
        <tbody>
          {([
            { label: '버텍스', brand: 'vertex' as const, items: ['1100(비반사)', '900(비반사)', '700(비반사)', '500(비반사)', '기타'] },
            { label: '레인보우', brand: 'rainbow' as const, items: ['IS200(비반사)', 'IS100(비반사)', 'I55(비반사)', 'VS200(반사)', 'V90(반사)', '기타'] },
            { label: '글라스틴트', brand: 'glasstint' as const, items: ['산타나(비반사)', '로데(비반사)', '선셋(반사)', '펜더S(비반사)', '기타'] },
            { label: '티나인', brand: 'tinain' as const, items: ['V100(반사)', 'R100(비반사)', '기타'] },
          ] as const).map((row) => (
            <tr key={row.brand}>
              <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600, width: '70px', verticalAlign: 'top' }}>{row.label}</td>
              <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
                {row.items.map((item) => (
                  <span key={item} style={{ marginRight: '16px', fontSize: '13px', display: 'inline-flex', alignItems: 'center' }}>
                    <PrintCheck checked={workOrder.tinting?.[row.brand]?.selected?.includes(item)} /> {item}
                  </span>
                ))}
                {workOrder.tinting?.[row.brand]?.density && (
                  <span style={{ marginLeft: '8px', color: '#E4002B' }}>농도: [{workOrder.tinting?.[row.brand].density}]</span>
                )}
              </td>
            </tr>
          ))}
          {(workOrder.tint_other?.name || '').trim() && (
            <tr>
              <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600, width: '70px', verticalAlign: 'top' }}>기타 필름</td>
              <td style={{ border: '1px solid #ccc', padding: '6px 8px', fontSize: '13px' }}>{workOrder.tint_other?.name}{workOrder.tint_other?.density ? <span style={{ marginLeft: '8px', color: '#E4002B' }}>농도: [{workOrder.tint_other.density}]</span> : null}</td>
            </tr>
          )}
        </tbody>
      </table>
      {/* PPF & 랩핑 / 코팅 / 기타 */}
      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px', borderBottom: '2px solid #E4002B', paddingBottom: '4px' }}>PPF & 랩핑 / 코팅 / 기타</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px' }}>
        <tbody>
          <tr>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600, width: '70px' }}>PPF</td>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
              {['전체PPF', '프론트패키지', '생활보호패키지'].map((p) => <span key={p} style={{ marginRight: '16px', fontSize: '13px', display: 'inline-flex', alignItems: 'center' }}><PrintCheck checked={workOrder.ppf?.includes(p)} /> {p}</span>)}
              {workOrder.ppf_product && <span style={{ marginRight: '12px', fontWeight: 600 }}>제품: {ppfOptionLabel(workOrder.ppf_product)}</span>}
              {workOrder.ppf_etc && <span>기타: {workOrder.ppf_etc}</span>}
            </td>
          </tr>
          <tr>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>랩핑</td>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
              {['전체랩핑', '부분'].map((p) => <span key={p} style={{ marginRight: '16px', fontSize: '13px', display: 'inline-flex', alignItems: 'center' }}><PrintCheck checked={workOrder.wrapping?.includes(p)} /> {p}</span>)}
              {workOrder.wrapping_etc && <span>기타: {workOrder.wrapping_etc}</span>}
            </td>
          </tr>
          <tr>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>컬러PPF</td>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
              {['전체', '부분', '투톤'].map((p) => <span key={p} style={{ marginRight: '16px', fontSize: '13px', display: 'inline-flex', alignItems: 'center' }}><PrintCheck checked={(workOrder.color_ppf || []).includes(p)} /> {p}</span>)}
              {workOrder.color_ppf_etc && <span>제품: {workOrder.color_ppf_etc}</span>}
            </td>
          </tr>
          {(workOrder.other_work || '').trim() && (
            <tr>
              <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>기타 시공</td>
              <td style={{ border: '1px solid #ccc', padding: '6px 8px', fontSize: '13px' }}>{workOrder.other_work}</td>
            </tr>
          )}
          <tr>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>코팅시공</td>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
              {['기본유리막', '9H', '10H', '그래핀PRO', '가죽코팅(시트)', '가죽코팅(전체)', '발수코팅', '필름코팅'].map((p) => <span key={p} style={{ marginRight: '16px', fontSize: '13px', display: 'inline-flex', alignItems: 'center' }}><PrintCheck checked={workOrder.coating?.includes(p)} /> {p}</span>)}
            </td>
          </tr>
          <tr>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>전장시공</td>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
              {['블랙박스', '하이패스'].map((p) => <span key={p} style={{ marginRight: '16px', fontSize: '13px', display: 'inline-flex', alignItems: 'center' }}><PrintCheck checked={workOrder.electrical?.includes(p)} /> {p}</span>)}
              {workOrder.electrical_etc && <span>기타: {workOrder.electrical_etc}</span>}
            </td>
          </tr>
          <tr>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>프리미엄광택</td>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
              {['전체광택', '부분광택'].map((p) => <span key={p} style={{ marginRight: '16px', fontSize: '13px', display: 'inline-flex', alignItems: 'center' }}><PrintCheck checked={workOrder.polish?.includes(p)} /> {p}</span>)}
              {workOrder.polish_etc && <span>기타: {workOrder.polish_etc}</span>}
            </td>
          </tr>
          <tr>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px', backgroundColor: '#f5f5f5', fontWeight: 600 }}>신차패키지</td>
            <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
              {['신차검수', '내외부디테일링세차', '타이어왁스', '피톤치드연막'].map((p) => <span key={p} style={{ marginRight: '16px', fontSize: '13px', display: 'inline-flex', alignItems: 'center' }}><PrintCheck checked={workOrder.package_options?.includes(p)} /> {p}</span>)}
            </td>
          </tr>
        </tbody>
      </table>
      {/* 특이사항 */}
      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px', borderBottom: '2px solid #E4002B', paddingBottom: '4px' }}>특이사항 및 비고</div>
      <div style={{ border: '1px solid #ccc', padding: '12px', minHeight: '60px', whiteSpace: 'pre-wrap', fontSize: '12px' }}>{workOrder.notes || ''}</div>
      {/* 하단 */}
      <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '10px', color: '#888' }}>
        3M 프로이즘 | 서울시 서초구 서초중앙로8길 82, 1동 1층 1호 | 010-7287-7140
      </div>
    </div>
  );
});

export default WorkSheet;
