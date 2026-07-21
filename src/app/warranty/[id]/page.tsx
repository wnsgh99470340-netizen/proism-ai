'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

interface WarrantyData {
  id: string;
  customer_name: string;
  phone?: string | null;
  car_type?: string | null;
  car_number?: string | null;
  work_details?: string | null;
  warranty_period?: string | null;
  service_date?: string | null;
  price?: string | null;
  created_at: string;
}

const SHOP = {
  name: '3M 프로이즘 강남서초점',
  address: '서울특별시 서초구 서초중앙로8길 82 1동 1층 1호',
  phone: '010-7287-7140',
};

// 화면은 그대로 유지하고, 인쇄(Ctrl+P) 시에만 A4 한 장에 꽉 차도록 확대·재배치한다.
const PRINT_CSS = `
@media print {
  /* 여백 최소화 — A4 세로, 상하좌우 8mm */
  @page { size: A4 portrait; margin: 8mm; }

  html, body {
    background: #fff !important;
    margin: 0 !important;
    padding: 0 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  .no-print { display: none !important; }

  .warranty-root {
    min-height: auto !important;
    background: #fff !important;
    padding: 0 !important;
    margin: 0 !important;
  }

  /* 카드가 A4 인쇄영역(가로 194mm × 세로 281mm)에 꽉 차도록 flex 컬럼으로 확장 */
  .warranty-card {
    max-width: 100% !important;
    width: 100% !important;
    margin: 0 !important;
    box-shadow: none !important;
    display: flex !important;
    flex-direction: column !important;
    min-height: 281mm !important;
    border: 1px solid #ccc;
  }

  /* 페이지 중간에서 섹션이 잘리지 않도록 */
  .warranty-header, .warranty-footer, .sec {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  /* 헤더 확대 */
  .warranty-header {
    padding: 40px 44px !important;
    border-radius: 0 !important;
  }
  .warranty-title { font-size: 44px !important; }

  /* 본문이 남는 세로 공간을 모두 채우고, 섹션을 균등 분배 */
  .warranty-body {
    flex: 1 1 auto !important;
    display: flex !important;
    flex-direction: column !important;
    justify-content: space-between !important;
  }
  .sec { padding: 30px 44px !important; }
  .sec-notice { padding: 30px 44px !important; }

  /* 텍스트 전반 확대 — A4에서 읽기 좋은 크기로 */
  .sec-label { font-size: 16px !important; margin-bottom: 16px !important; }
  .r-label { font-size: 15px !important; margin-bottom: 4px !important; }
  .r-value { font-size: 22px !important; }
  .sec > div:nth-child(2) { gap: 18px 24px !important; }
  .notice-text { font-size: 18px !important; line-height: 1.9 !important; }
  .shop-info { font-size: 18px !important; line-height: 1.9 !important; }

  /* 푸터 확대 */
  .warranty-footer {
    padding: 20px 44px !important;
    border-radius: 0 !important;
  }
  .warranty-footer > div { font-size: 14px !important; }
}
`;

export default function WarrantyPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<WarrantyData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/warranty/${id}`)
      .then(async (res) => { if (!res.ok) { setError(true); return; } setData(await res.json()); })
      .catch(() => setError(true));
  }, [id]);

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f9fa', fontFamily: "'Pretendard', -apple-system, sans-serif" }}>
        <div style={{ textAlign: 'center', color: '#666' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📄</div>
          <h1 style={{ fontSize: '20px', fontWeight: 600, color: '#333', marginBottom: '8px' }}>보증서를 찾을 수 없습니다</h1>
          <p style={{ fontSize: '14px' }}>링크가 만료되었거나 잘못된 주소입니다.</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f9fa' }}>
        <div style={{ color: '#999', fontSize: '14px' }}>불러오는 중...</div>
      </div>
    );
  }

  const createdDate = new Date(data.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="warranty-root" style={{ minHeight: '100vh', background: '#f8f9fa', padding: '20px 16px', fontFamily: "'Pretendard', -apple-system, sans-serif" }}>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="warranty-card" style={{ maxWidth: '600px', margin: '0 auto' }}>
        {/* 헤더 */}
        <div className="warranty-header" style={{ background: '#1a1a1a', borderRadius: '16px 16px 0 0', padding: '32px 28px', color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{ width: '40px', height: '40px', background: '#22C55E', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: 800 }}>✓</div>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 700 }}>{SHOP.name}</div>
              <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>3M Authorized Dealer</div>
            </div>
          </div>
          <div className="warranty-title" style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-0.5px' }}>시공 보증서</div>
          <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>Warranty No. {data.id.toUpperCase()} · {createdDate}</div>
        </div>

        {/* 본문 */}
        <div className="warranty-body" style={{ background: '#fff', padding: '0' }}>
          <div className="sec" style={{ padding: '24px 28px', borderBottom: '1px solid #f0f0f0' }}>
            <div className="sec-label" style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>고객 정보</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <R label="고객명" value={data.customer_name} />
              <R label="연락처" value={data.phone || '-'} />
              <R label="차종" value={data.car_type || '-'} />
              <R label="차량번호" value={data.car_number || '-'} />
            </div>
          </div>

          <div className="sec" style={{ padding: '24px 28px', borderBottom: '1px solid #f0f0f0' }}>
            <div className="sec-label" style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>시공 내역</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <R label="시공 내용" value={data.work_details || '-'} />
              <R label="시공일" value={data.service_date || '-'} />
              <R label="시공 금액" value={data.price ? `${Number(data.price).toLocaleString()}원` : '-'} />
              <R label="보증 기간" value={data.warranty_period || '-'} />
            </div>
          </div>

          <div className="sec sec-notice" style={{ padding: '24px 28px', background: '#f0fdf4', borderBottom: '1px solid #f0f0f0' }}>
            <div className="notice-text" style={{ fontSize: '13px', color: '#166534', lineHeight: 1.8 }}>
              <strong>보증 안내</strong><br />
              본 보증서는 위 시공에 대해 보증 기간 내 시공 하자 발생 시 무상 재시공을 보장합니다.
              외부 충격, 사고, 고객 부주의로 인한 손상은 보증 대상에서 제외됩니다.
            </div>
          </div>

          <div className="sec" style={{ padding: '24px 28px' }}>
            <div className="sec-label" style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>매장 안내</div>
            <div className="shop-info" style={{ fontSize: '13px', color: '#555', lineHeight: 1.8 }}>
              <div style={{ fontWeight: 600, color: '#333' }}>{SHOP.name}</div>
              <div>{SHOP.address}</div>
              <div><a href={`tel:${SHOP.phone}`} style={{ color: '#22C55E', textDecoration: 'none', fontWeight: 500 }}>{SHOP.phone}</a></div>
            </div>
          </div>
        </div>

        <div className="warranty-footer" style={{ background: '#f0f0f0', borderRadius: '0 0 16px 16px', padding: '16px 28px' }}>
          <div style={{ fontSize: '11px', color: '#aaa', textAlign: 'center', lineHeight: 1.6 }}>
            본 보증서는 전자 문서로 발급되었으며, 별도의 서명 없이 유효합니다.<br />
            문의: {SHOP.phone}
          </div>
        </div>

        <div className="no-print" style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
          <button type="button" onClick={() => window.print()} style={{ flex: 1, textAlign: 'center', background: '#1a1a1a', color: '#fff', fontSize: '15px', fontWeight: 600, padding: '14px', borderRadius: '12px', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            보증서 인쇄
          </button>
          <a href={`tel:${SHOP.phone}`} style={{ flex: 1, textAlign: 'center', background: '#22C55E', color: '#fff', fontSize: '15px', fontWeight: 600, padding: '14px', borderRadius: '12px', textDecoration: 'none' }}>
            전화 문의하기
          </a>
        </div>
      </div>
    </div>
  );
}

function R({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="r-label" style={{ fontSize: '11px', color: '#999', marginBottom: '2px' }}>{label}</div>
      <div className="r-value" style={{ fontSize: '14px', fontWeight: 500, color: '#333' }}>{value}</div>
    </div>
  );
}
