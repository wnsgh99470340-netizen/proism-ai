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
    <div style={{ minHeight: '100vh', background: '#f8f9fa', padding: '20px 16px', fontFamily: "'Pretendard', -apple-system, sans-serif" }}>
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        {/* 헤더 */}
        <div style={{ background: '#1a1a1a', borderRadius: '16px 16px 0 0', padding: '32px 28px', color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{ width: '40px', height: '40px', background: '#22C55E', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: 800 }}>✓</div>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 700 }}>{SHOP.name}</div>
              <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>3M Authorized Dealer</div>
            </div>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-0.5px' }}>시공 보증서</div>
          <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>Warranty No. {data.id.toUpperCase()} · {createdDate}</div>
        </div>

        {/* 본문 */}
        <div style={{ background: '#fff', padding: '0' }}>
          <div style={{ padding: '24px 28px', borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>고객 정보</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <R label="고객명" value={data.customer_name} />
              <R label="연락처" value={data.phone || '-'} />
              <R label="차종" value={data.car_type || '-'} />
              <R label="차량번호" value={data.car_number || '-'} />
            </div>
          </div>

          <div style={{ padding: '24px 28px', borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>시공 내역</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <R label="시공 내용" value={data.work_details || '-'} />
              <R label="시공일" value={data.service_date || '-'} />
              <R label="시공 금액" value={data.price ? `${Number(data.price).toLocaleString()}원` : '-'} />
              <R label="보증 기간" value={data.warranty_period || '-'} />
            </div>
          </div>

          <div style={{ padding: '24px 28px', background: '#f0fdf4', borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ fontSize: '13px', color: '#166534', lineHeight: 1.8 }}>
              <strong>보증 안내</strong><br />
              본 보증서는 위 시공에 대해 보증 기간 내 시공 하자 발생 시 무상 재시공을 보장합니다.
              외부 충격, 사고, 고객 부주의로 인한 손상은 보증 대상에서 제외됩니다.
            </div>
          </div>

          <div style={{ padding: '24px 28px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>매장 안내</div>
            <div style={{ fontSize: '13px', color: '#555', lineHeight: 1.8 }}>
              <div style={{ fontWeight: 600, color: '#333' }}>{SHOP.name}</div>
              <div>{SHOP.address}</div>
              <div><a href={`tel:${SHOP.phone}`} style={{ color: '#22C55E', textDecoration: 'none', fontWeight: 500 }}>{SHOP.phone}</a></div>
            </div>
          </div>
        </div>

        <div style={{ background: '#f0f0f0', borderRadius: '0 0 16px 16px', padding: '16px 28px' }}>
          <div style={{ fontSize: '11px', color: '#aaa', textAlign: 'center', lineHeight: 1.6 }}>
            본 보증서는 전자 문서로 발급되었으며, 별도의 서명 없이 유효합니다.<br />
            문의: {SHOP.phone}
          </div>
        </div>

        <div style={{ marginTop: '16px' }}>
          <a href={`tel:${SHOP.phone}`} style={{ display: 'block', textAlign: 'center', background: '#22C55E', color: '#fff', fontSize: '15px', fontWeight: 600, padding: '14px', borderRadius: '12px', textDecoration: 'none' }}>
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
      <div style={{ fontSize: '11px', color: '#999', marginBottom: '2px' }}>{label}</div>
      <div style={{ fontSize: '14px', fontWeight: 500, color: '#333' }}>{value}</div>
    </div>
  );
}
