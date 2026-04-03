'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

interface EstimateData {
  id: string;
  customer_name: string;
  phone?: string | null;
  car_model?: string | null;
  services: string[];
  amount?: number | null;
  scheduled_date?: string | null;
  memo?: string | null;
  created_at: string;
}

const SHOP = {
  name: '3M 프로이즘 강남서초점',
  address: '서울특별시 서초구 서초중앙로8길 82 1동 1층 1호',
  phone: '010-7287-7140',
};

export default function EstimatePage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<EstimateData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/estimate/${id}`)
      .then(async (res) => {
        if (!res.ok) { setError(true); return; }
        setData(await res.json());
      })
      .catch(() => setError(true));
  }, [id]);

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f9fa', fontFamily: "'Pretendard', -apple-system, sans-serif" }}>
        <div style={{ textAlign: 'center', color: '#666' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📄</div>
          <h1 style={{ fontSize: '20px', fontWeight: 600, color: '#333', marginBottom: '8px' }}>견적서를 찾을 수 없습니다</h1>
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
  const amountText = data.amount ? `${data.amount.toLocaleString()}원` : '별도 협의';
  const scheduleText = data.scheduled_date || '협의 후 결정';

  return (
    <div style={{ minHeight: '100vh', background: '#f8f9fa', padding: '20px 16px', fontFamily: "'Pretendard', -apple-system, sans-serif" }}>
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        {/* 헤더 */}
        <div style={{ background: '#1a1a1a', borderRadius: '16px 16px 0 0', padding: '32px 28px', color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{ width: '40px', height: '40px', background: '#E4002B', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: 800 }}>◆</div>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 700 }}>{SHOP.name}</div>
              <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>3M Authorized Dealer</div>
            </div>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-0.5px' }}>견적서</div>
          <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>Estimate No. {data.id.toUpperCase()} · {createdDate}</div>
        </div>

        {/* 본문 */}
        <div style={{ background: '#fff', padding: '0' }}>
          {/* 고객 정보 */}
          <div style={{ padding: '24px 28px', borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>고객 정보</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <InfoRow label="고객명" value={data.customer_name} />
              <InfoRow label="연락처" value={data.phone || '-'} />
              <InfoRow label="차종" value={data.car_model || '-'} />
              <InfoRow label="작업 예정일" value={scheduleText} />
            </div>
          </div>

          {/* 서비스 내역 */}
          <div style={{ padding: '24px 28px', borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '16px' }}>서비스 내역</div>
            {data.services.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
                {data.services.map((svc) => (
                  <span key={svc} style={{ background: '#f0f0f0', color: '#333', fontSize: '13px', fontWeight: 500, padding: '6px 14px', borderRadius: '20px' }}>{svc}</span>
                ))}
              </div>
            ) : (
              <div style={{ color: '#999', fontSize: '13px', marginBottom: '16px' }}>서비스 항목 미지정</div>
            )}
            {data.memo && (
              <div style={{ background: '#fafafa', borderRadius: '8px', padding: '12px 16px', fontSize: '13px', color: '#555', lineHeight: 1.6 }}>
                {data.memo}
              </div>
            )}
          </div>

          {/* 금액 */}
          <div style={{ padding: '24px 28px', borderBottom: '1px solid #f0f0f0', background: '#fafafa' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '14px', fontWeight: 500, color: '#666' }}>예상 금액</div>
              <div style={{ fontSize: '28px', fontWeight: 800, color: '#E4002B' }}>{amountText}</div>
            </div>
            <div style={{ fontSize: '11px', color: '#aaa', marginTop: '4px', textAlign: 'right' }}>VAT 포함</div>
          </div>

          {/* 매장 정보 */}
          <div style={{ padding: '24px 28px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>매장 안내</div>
            <div style={{ fontSize: '13px', color: '#555', lineHeight: 1.8 }}>
              <div style={{ fontWeight: 600, color: '#333' }}>{SHOP.name}</div>
              <div>{SHOP.address}</div>
              <div>
                <a href={`tel:${SHOP.phone}`} style={{ color: '#E4002B', textDecoration: 'none', fontWeight: 500 }}>{SHOP.phone}</a>
              </div>
            </div>
          </div>
        </div>

        {/* 푸터 */}
        <div style={{ background: '#f0f0f0', borderRadius: '0 0 16px 16px', padding: '16px 28px' }}>
          <div style={{ fontSize: '11px', color: '#aaa', textAlign: 'center', lineHeight: 1.6 }}>
            본 견적서는 차량 실물 확인 후 변경될 수 있습니다.<br />
            유효기간: 발행일로부터 7일 · 문의: {SHOP.phone}
          </div>
        </div>

        {/* 전화 버튼 */}
        <div style={{ marginTop: '16px' }}>
          <a
            href={`tel:${SHOP.phone}`}
            style={{
              display: 'block', textAlign: 'center', background: '#E4002B', color: '#fff',
              fontSize: '15px', fontWeight: 600, padding: '14px', borderRadius: '12px',
              textDecoration: 'none',
            }}
          >
            전화 문의하기
          </a>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '11px', color: '#999', marginBottom: '2px' }}>{label}</div>
      <div style={{ fontSize: '14px', fontWeight: 500, color: '#333' }}>{value}</div>
    </div>
  );
}
