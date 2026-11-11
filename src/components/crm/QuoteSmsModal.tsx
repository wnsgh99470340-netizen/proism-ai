'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * 견적 문자 생성 (2026-11-11)
 * 전화 상담 뒤 보내는 문자를 "통화 한 줄 + 추천 하나 + 날짜 두 개 + 링크 하나" 형식으로 만들어 폰 문자 앱을 연다.
 * 보내면 사후관리에 재연락(다음 날)·마무리(3일 뒤)가 자동 등록되고, 상담 기록도 한 줄 남는다.
 */

export interface QuoteSmsInitial {
  customerId?: string | null;
  name?: string;
  phone?: string;
  car?: string;
  service?: string;
}

interface Props {
  initial: QuoteSmsInitial;
  onClose: () => void;
  onDone: () => void;
}

const SERVICES = ['PPF', '컬러PPF', '랩핑', '크롬죽이기', '신차패키지', '썬팅', '유리막코팅', '실내PPF'] as const;
type ServiceKey = typeof SERVICES[number];

/** 서비스(무상) 항목 — 처음엔 아무것도 선택 안 됨. 필요한 것만 체크해서 "포함:" 줄을 만든다 */
const SERVICE_ITEMS = [
  'B/C필러 하이그로시 PPF', '실내 PPF (T존)', '실내 PPF (액정)', '실내 전체코팅', '필름코팅',
  '캐리어 탁송 (왕복)', '신차검수', '기본 유리막코팅', '유리막코팅 2레이어 업그레이드',
  '생활보호 PPF 4종 (컵·엣지·주유구·트렁크리드)', '컵/엣지 PPF', '디스플레이 PPF', '사이드미러 PPF', '헤드라이트 PPF',
] as const;
/** 시공별 기간·보증 한 줄 */
const DEFAULT_TERMS: Record<ServiceKey, string> = {
  PPF: '시공 3박4일 / 2주 뒤 QC / 6개월마다 메인터넌스',
  컬러PPF: '시공 3박4일 / 2주 뒤 QC / 6개월마다 메인터넌스',
  랩핑: '6개월마다 메인터넌스',
  크롬죽이기: '6개월마다 메인터넌스',
  신차패키지: '검수 → 썬팅 → PPF → 코팅 순서 / 6개월마다 메인터넌스',
  썬팅: '시공 후 2~3일 창문 유지 / 6개월마다 메인터넌스',
  유리막코팅: '6개월마다 메인터넌스',
  실내PPF: '6개월마다 메인터넌스',
};
/**
 * 가격표 (2026-11-11 사장님 견적표 소비자 가격 = 정상가, 세단 기준)
 * 시공 → 범위 → 항목·정상가. 사장님이 창에서 고친 금액은 localStorage 에 기억되어 다음부터 우선 적용
 */
type PriceItem = { grade: string; price: number };
const PRICE_BOOK: Record<ServiceKey, Record<string, PriceItem[]>> = {
  PPF: {
    전체: [
      { grade: '시리즈50(185μm)', price: 5500000 },
      { grade: '시리즈100(190μm)', price: 6000000 },
      { grade: '시리즈150(190μm·발수)', price: 6500000 },
      { grade: 'PRO200 유광(200μm·발수)', price: 7000000 },
      { grade: 'PRO200 무광(200μm·발수)', price: 7000000 },
    ],
    프론트: [{ grade: 'FULL 프론트 PPF 패키지(범퍼+본넷+프론트휀더)', price: 2500000 }],
    생활보호: [
      { grade: '생활보호 PPF 3종(도어컵+도어엣지+주유구)', price: 100000 },
      { grade: '생활보호 PPF 4종(3종+트렁크리드)', price: 150000 },
      { grade: '생활보호 PPF 5종(4종+헤드라이트)', price: 350000 },
      { grade: '생활보호 PPF 6종(5종+사이드미러커버)', price: 500000 },
    ],
    부분: [
      { grade: '헤드라이트 PPF', price: 200000 },
      { grade: '사이드미러 PPF', price: 150000 },
      { grade: '트렁크리드 PPF', price: 70000 },
      { grade: '하이그로시 필러 PPF(1짝)', price: 40000 },
    ],
  },
  컬러PPF: {
    전체: [{ grade: '전체 컬러 PPF (3M PWF)', price: 6500000 }],
    투톤: [{ grade: '투톤 컬러 PPF (상단)', price: 3000000 }],
  },
  랩핑: {
    전체: [{ grade: '전체 랩핑 (3M 2080)', price: 3000000 }],
    투톤: [{ grade: '투톤 랩핑 (상단, PET 고광택)', price: 2000000 }],
    루프: [{ grade: '루프스킨 랩핑', price: 250000 }],
  },
  크롬죽이기: {
    윈도우몰딩: [{ grade: '크롬죽이기 (윈도우몰딩, 3M 2080 글로스블랙)', price: 0 }],
    전체: [{ grade: '크롬죽이기 전체 (3M 2080 글로스블랙)', price: 1400000 }],
  },
  신차패키지: {
    '썬팅 등급(정상가)': [
      { grade: '루마 버텍스 1100 (보증 10년)', price: 2700000 },
      { grade: '루마 버텍스 900 (보증 10년)', price: 1800000 },
      { grade: '루마 버텍스 700 (보증 7년)', price: 1450000 },
      { grade: '루마 버텍스 700M 블랙반사 (보증 7년)', price: 1350000 },
      { grade: '루마 버텍스 MK 반사 (보증 7년)', price: 1200000 },
      { grade: '레인보우 IRIS V90 반사 (보증 10년)', price: 1250000 },
      { grade: '레인보우 IRIS IS100 (보증 10년)', price: 1100000 },
      { grade: '레인보우 IRIS IS200 (보증 10년)', price: 1450000 },
      { grade: '레인보우 IRIS VS200 반사 (보증 10년)', price: 1700000 },
      { grade: '티나인 V100 반사 (보증 10년)', price: 1250000 },
      { grade: '티나인 R100 (보증 10년)', price: 1150000 },
      { grade: '글라스틴트 산타나 (보증 10년)', price: 1300000 },
      { grade: '글라스틴트 로데 (보증 10년)', price: 950000 },
      { grade: '글라스틴트 펜더 S (보증 10년)', price: 700000 },
      { grade: '글라스틴트 선셋 반사 (보증 10년)', price: 950000 },
      { grade: '3M 크리스탈라인', price: 0 },
    ],
    '프론트 PPF 추가': [{ grade: 'FULL 프론트 PPF 패키지 추가(범퍼+본넷+프론트휀더)', price: 2500000 }],
    '전체 PPF 추가': [
      { grade: '전체 PPF 시리즈50 추가', price: 5500000 },
      { grade: '전체 PPF 시리즈100 추가', price: 6000000 },
      { grade: '전체 PPF 시리즈150 추가', price: 6500000 },
      { grade: '전체 PPF PRO200 추가', price: 7000000 },
    ],
  },
  썬팅: {
    '전면+측후면(정상가)': [
      { grade: '루마 버텍스 1100 (보증 10년)', price: 2700000 },
      { grade: '루마 버텍스 900 (보증 10년)', price: 1800000 },
      { grade: '루마 버텍스 700 (보증 7년)', price: 1450000 },
      { grade: '루마 버텍스 700M 블랙반사 (보증 7년)', price: 1350000 },
      { grade: '루마 버텍스 MK 반사 (보증 7년)', price: 1200000 },
      { grade: '레인보우 IRIS V90 반사 (보증 10년)', price: 1250000 },
      { grade: '레인보우 IRIS IS100 (보증 10년)', price: 1100000 },
      { grade: '레인보우 IRIS IS200 (보증 10년)', price: 1450000 },
      { grade: '레인보우 IRIS VS200 반사 (보증 10년)', price: 1700000 },
      { grade: '티나인 V100 반사 (보증 10년)', price: 1250000 },
      { grade: '티나인 R100 (보증 10년)', price: 1150000 },
      { grade: '글라스틴트 산타나 (보증 10년)', price: 1300000 },
      { grade: '글라스틴트 로데 (보증 10년)', price: 950000 },
      { grade: '글라스틴트 펜더 S (보증 10년)', price: 700000 },
      { grade: '글라스틴트 선셋 반사 (보증 10년)', price: 950000 },
      { grade: '3M 크리스탈라인', price: 0 },
    ],
  },
  유리막코팅: {
    전체: [{ grade: '고강도 유리막코팅', price: 0 }, { grade: '유리막코팅 2레이어', price: 0 }],
  },
  실내PPF: {
    부분: [
      { grade: '디스플레이(네비게이션) PPF', price: 70000 },
      { grade: '기어판넬(기어봉 주변) PPF', price: 150000 },
      { grade: '실내 사이드스텝 PPF(4짝)', price: 160000 },
      { grade: '가죽코팅(침투형)', price: 500000 },
    ],
  },
};
const rangesOf = (svc: ServiceKey) => Object.keys(PRICE_BOOK[svc]);
const itemsOf = (svc: ServiceKey, range: string): PriceItem[] => PRICE_BOOK[svc][range] || PRICE_BOOK[svc][rangesOf(svc)[0]] || [];
const bookPrice = (svc: ServiceKey, range: string, grade: string) => itemsOf(svc, range).find((i) => i.grade === grade)?.price || 0;
const DEFAULT_LINK = 'https://blog.naver.com/roice_/223938165520';
const STORE_KEY = 'crm_quote_sms_memory_v1';

type Memory = { prices: Record<string, string>; link: string; benefits: Record<string, string> };
function loadMemory(): Memory {
  try { return { prices: {}, link: DEFAULT_LINK, benefits: {}, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; } catch { return { prices: {}, link: DEFAULT_LINK, benefits: {} }; }
}
function saveMemory(m: Memory) { try { localStorage.setItem(STORE_KEY, JSON.stringify(m)); } catch { /* ignore */ } }

const fmtNum = (digits: string) => (digits ? Number(digits).toLocaleString() : '');
const won = (digits: string) => {
  const n = Number(digits.replace(/[^\d]/g, ''));
  if (!n) return '';
  if (n % 10000 === 0) return `${(n / 10000).toLocaleString()}만원`;
  return `${n.toLocaleString()}원`;
};
const dayLabel = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  const w = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${w})`;
};
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0]; };
const normalizeService = (s?: string): ServiceKey => {
  const t = (s || '').replace(/\s/g, '');
  if (/컬러|PWF/i.test(t)) return '컬러PPF';
  if (/실내/.test(t)) return '실내PPF';
  if (/크롬/.test(t)) return '크롬죽이기';
  if (/신차/.test(t)) return '신차패키지';
  if (/썬팅|틴팅/.test(t)) return '썬팅';
  if (/유리막|코팅/.test(t)) return '유리막코팅';
  if (/랩핑/.test(t)) return '랩핑';
  return 'PPF';
};

const inputCls = 'w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm text-[var(--c-text-1)] outline-none focus:border-[#C8A951]/50';
const labelCls = 'text-xs text-[var(--c-text-3)] mb-1 block';

export default function QuoteSmsModal({ initial, onClose, onDone }: Props) {
  const today = new Date().toISOString().split('T')[0];
  const [mem] = useState<Memory>(() => loadMemory());
  const [name, setName] = useState(initial.name || '');
  const [phone, setPhone] = useState(initial.phone || '');
  const [car, setCar] = useState(initial.car || '');
  const [service, setService] = useState<ServiceKey>(normalizeService(initial.service));
  const [range, setRange] = useState<string>(() => rangesOf(normalizeService(initial.service))[0]);
  const [summary, setSummary] = useState('');
  const [recGrade, setRecGrade] = useState('');
  const [recPrice, setRecPrice] = useState('');
  const [recSale, setRecSale] = useState('');
  const [recWhy, setRecWhy] = useState('');
  const [altGrade, setAltGrade] = useState('');
  const [altPrice, setAltPrice] = useState('');
  const [altSale, setAltSale] = useState('');
  const [altWhy, setAltWhy] = useState('');
  const [extraLabel, setExtraLabel] = useState('');
  const [extraPrice, setExtraPrice] = useState('');
  const [priceNote, setPriceNote] = useState('세단 기준이며 SUV·RV는 추가 금액이 있을 수 있습니다. 다른 등급도 안내해 드립니다');
  const [benefitSel, setBenefitSel] = useState<string[]>([]);
  const [benefitExtra, setBenefitExtra] = useState('');
  const [terms, setTerms] = useState('');
  const [date1, setDate1] = useState(addDays(today, 2));
  const [date2, setDate2] = useState(addDays(today, 5));
  const [link, setLink] = useState(mem.link || DEFAULT_LINK);
  const [withFollowUps, setWithFollowUps] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // 시공 바꾸면 범위·혜택 기본값 갱신
  useEffect(() => {
    setRange((r) => (rangesOf(service).includes(r) ? r : rangesOf(service)[0]));
    setTerms(DEFAULT_TERMS[service]);
  }, [service]);
  // 범위 바꾸면 추천=두 번째(없으면 첫째), 상위=세 번째
  useEffect(() => {
    const items = itemsOf(service, range);
    setRecGrade(items[1]?.grade || items[0]?.grade || '');
    setAltGrade(items[2]?.grade || '');
  }, [service, range]);
  // 가격: 사장님이 고친 값(기억) → 가격표 정상가 → 빈칸
  useEffect(() => { const b = bookPrice(service, range, recGrade); setRecPrice(mem.prices[`${service}|${recGrade}`] || (b ? String(b) : '')); setRecSale(mem.prices[`${service}|${recGrade}|sale`] || ''); }, [service, range, recGrade, mem.prices]);
  useEffect(() => { const b = bookPrice(service, range, altGrade); setAltPrice(mem.prices[`${service}|${altGrade}`] || (b ? String(b) : '')); setAltSale(mem.prices[`${service}|${altGrade}|sale`] || ''); }, [service, range, altGrade, mem.prices]);
  const presetGrades = itemsOf(service, range).map((i) => i.grade);

  const text = useMemo(() => {
    const lines: string[] = [];
    lines.push('안녕하세요 3M 프로이즘 진준호입니다.');
    lines.push(`방금 통화한 ${[car, range, service].filter(Boolean).join(' ')} 견적입니다.`);
    lines.push('');
    if (extraLabel && extraPrice) { lines.push(`${extraLabel} ${won(extraPrice)}`); lines.push(''); }
    if (summary) lines.push(summary.trim().replace(/[.。]$/, '') + (recGrade ? ' →' : ''));
    const priceText = (normal: string, sale: string) => {
      if (normal && sale) return `정상가 ${won(normal)} → ${won(sale)}`;
      if (normal) return `정상가 ${won(normal)}`;
      if (sale) return won(sale);
      return '';
    };
    if (recGrade) lines.push(`${recWhy ? recWhy + ' ' : ''}${recGrade} ${priceText(recPrice, recSale)}`.trim());
    if (altGrade && (altPrice || altSale)) lines.push(`${altWhy ? altWhy + ' ' : ''}${altGrade} ${priceText(altPrice, altSale)}`.trim());
    if (priceNote) lines.push(`(${priceNote})`);
    lines.push('');
    const benefitList = [...benefitSel, ...(benefitExtra.trim() ? [benefitExtra.trim()] : [])];
    if (benefitList.length > 0) lines.push(`서비스: ${benefitList.join(' · ')}`);
    if (terms) lines.push(terms);
    lines.push('보증: 3M 제품보증 + 시공보증서 발급');
    lines.push('');
    if (date1 || date2) {
      const ds = [date1, date2].filter(Boolean).map(dayLabel);
      lines.push(`${ds.join(', ')} 입고 가능합니다.`);
      lines.push(ds.length > 1 ? '어느 쪽이 편하세요?' : '괜찮으실까요?');
      lines.push('');
    }
    if (link) { lines.push('시공 사진·과정은 여기 한 편만 보시면 됩니다'); lines.push(link); lines.push(''); }
    lines.push('3M 프로이즘 강남서초점 010-7287-7140');
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }, [car, range, service, extraLabel, extraPrice, summary, recGrade, recPrice, recSale, recWhy, altGrade, altPrice, altSale, altWhy, priceNote, benefitSel, benefitExtra, terms, date1, date2, link]);

  const followUp1 = `안녕하세요 3M 프로이즘입니다.\n어제 보내드린 ${car || ''} ${service} 견적 보셨을까요?\n${date1 ? `${dayLabel(date1)} 자리는 아직 비어 있습니다.` : '입고 일정은 맞춰 드릴 수 있습니다.'}\n궁금한 점 있으시면 편하게 물어봐 주세요.`;
  const followUp2 = `3M 프로이즘입니다. 마지막으로 한 가지만 말씀드리면,\n${service === 'PPF' || service === '컬러PPF' ? '어디서 하시더라도 외부 패널은 열 없이 습식으로, 필름 끝을 패널 안쪽으로 넣어 마감하는지 꼭 확인해 보세요.' : service === '썬팅' ? '어디서 하시더라도 기존 필름 제거는 스팀으로 하는지, 후면 유리는 한 장 시공인지 꼭 확인해 보세요.' : '어디서 하시더라도 필름 끝단 마감과 메인터넌스가 있는지 꼭 확인해 보세요.'}\n도움이 필요하시면 언제든 연락 주세요. 감사합니다.`;

  const remember = () => {
    const m = loadMemory();
    if (recGrade && recPrice) m.prices[`${service}|${recGrade}`] = recPrice;
    if (altGrade && altPrice) m.prices[`${service}|${altGrade}`] = altPrice;
    if (recGrade) m.prices[`${service}|${recGrade}|sale`] = recSale;
    if (altGrade) m.prices[`${service}|${altGrade}|sale`] = altSale;
    m.link = link;
    saveMemory(m);
  };

  const openSms = () => {
    const p = phone.replace(/[^\d]/g, '');
    if (!p) { setNote('전화번호가 필요합니다.'); return; }
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    window.open(isIOS ? `sms:${p}&body=${encodeURIComponent(text)}` : `sms:${p}?body=${encodeURIComponent(text)}`);
  };

  const registerFollowUps = async () => {
    const who = `${name || '고객'} ${phone}`.trim();
    const rows = [
      { customer_id: initial.customerId || null, follow_up_type: '견적재연락', scheduled_date: addDays(today, 1), memo: `${who} · ${car} ${service}\n${followUp1}` },
      { customer_id: initial.customerId || null, follow_up_type: '견적마무리', scheduled_date: addDays(today, 3), memo: `${who} · ${car} ${service}\n${followUp2}` },
    ];
    const { error } = await supabase.from('follow_ups').insert(rows);
    if (error) throw new Error(error.message);
  };
  const logConsultation = async () => {
    if (!initial.customerId) return;
    await supabase.from('consultations').insert({
      customer_id: initial.customerId,
      consultation_date: today,
      content: `[견적 문자] ${summary || ''}`.trim(),
      estimate: recPrice || recSale ? `${recGrade} ${recSale ? won(recSale) : won(recPrice)}` : null,
      interested_services: `${service} ${range}`,
      memo: car || null,
    });
  };

  const send = async (how: 'sms' | 'copy') => {
    setBusy(true); setNote(null);
    try {
      remember();
      if (how === 'copy') { await navigator.clipboard.writeText(text); } else { openSms(); }
      if (withFollowUps) await registerFollowUps();
      await logConsultation().catch(() => {});
      setNote(how === 'copy' ? '복사했습니다. 사후관리에 재연락 2건을 넣었습니다.' : '문자 앱을 열었습니다. 사후관리에 재연락 2건을 넣었습니다.');
      onDone();
    } catch (e) {
      setNote(`⚠️ ${e instanceof Error ? e.message : '실패'}`);
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-[var(--c-border)] flex items-center justify-between">
          <h3 className="text-[var(--c-text-1)] font-semibold text-base">📩 견적 문자</h3>
          <span className="text-[11px] text-[var(--c-text-3)]">통화 한 줄 · 추천 하나 · 날짜 두 개 · 링크 하나</span>
        </div>
        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-0">
          {/* 입력 */}
          <div className="px-6 py-4 space-y-3 md:border-r border-[var(--c-border)]">
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>고객</label><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="이름" /></div>
              <div><label className={labelCls}>전화 *</label><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="010-0000-0000" /></div>
              <div><label className={labelCls}>차종 *</label><input value={car} onChange={(e) => setCar(e.target.value)} className={inputCls} placeholder="예: 포르쉐 카이엔" /></div>
              <div><label className={labelCls}>시공</label>
                <div className="flex gap-2">
                  <select value={service} onChange={(e) => setService(e.target.value as ServiceKey)} className={inputCls}>{SERVICES.map((s) => <option key={s}>{s}</option>)}</select>
                  <select value={range} onChange={(e) => setRange(e.target.value)} className={`${inputCls} w-32`}>{rangesOf(service).map((r) => <option key={r}>{r}</option>)}</select>
                </div>
              </div>
            </div>
            <div>
              <label className={labelCls}>통화에서 들은 것 한 줄 (이 줄이 다른 집 문자와 구분을 만듭니다)</label>
              <input value={summary} onChange={(e) => setSummary(e.target.value)} className={inputCls} placeholder="예: 말씀하신 대로 주말 위주 운행이면" />
            </div>
            <div className="rounded-lg border border-[#C8A951]/30 bg-[#C8A951]/5 p-3 space-y-2">
              <div className="text-xs font-medium text-[#C8A951]">추천 하나</div>
              <select value={recGrade} onChange={(e) => setRecGrade(e.target.value)} className={inputCls}>{presetGrades.map((g) => <option key={g}>{g}</option>)}<option value="">직접 입력</option></select>
              <div className="grid grid-cols-2 gap-2">
                <div><label className={labelCls}>정상가</label><input value={fmtNum(recPrice)} onChange={(e) => setRecPrice(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" className={`${inputCls} text-right`} placeholder="6,000,000" /></div>
                <div><label className={labelCls}>할인가 (비우면 정상가만)</label><input value={fmtNum(recSale)} onChange={(e) => setRecSale(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" className={`${inputCls} text-right`} placeholder="4,500,000" /></div>
              </div>
              {!presetGrades.includes(recGrade) && <input value={recGrade} onChange={(e) => setRecGrade(e.target.value)} className={inputCls} placeholder="추천 항목 이름" />}
              <input value={recWhy} onChange={(e) => setRecWhy(e.target.value)} className={inputCls} placeholder="앞에 붙일 말 (예: 충분합니다 →, 권합니다 →) 비워도 됨" />
              <div className="text-[11px] text-[var(--c-text-3)]">{recPrice || recSale ? `표시: ${recPrice ? `정상가 ${won(recPrice)}` : ''}${recPrice && recSale ? ' → ' : ''}${recSale ? won(recSale) : ''}` : '숫자만 치면 쉼표가 자동으로 붙습니다. 한 번 넣으면 다음에 기억합니다'}</div>
            </div>
            <div className="rounded-lg border border-[var(--c-border)] p-3 space-y-2">
              <div className="text-xs font-medium text-[var(--c-text-2)]">상위 선택지 (선택)</div>
              <select value={altGrade} onChange={(e) => setAltGrade(e.target.value)} className={inputCls}><option value="">없음</option>{presetGrades.map((g) => <option key={g}>{g}</option>)}</select>
              <div className="grid grid-cols-2 gap-2">
                <div><label className={labelCls}>정상가</label><input value={fmtNum(altPrice)} onChange={(e) => setAltPrice(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" className={`${inputCls} text-right`} placeholder="6,500,000" /></div>
                <div><label className={labelCls}>할인가</label><input value={fmtNum(altSale)} onChange={(e) => setAltSale(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" className={`${inputCls} text-right`} placeholder="5,000,000" /></div>
              </div>
              <input value={altWhy} onChange={(e) => setAltWhy(e.target.value)} className={inputCls} placeholder="예: 발수코팅까지 원하시면" />
            </div>
            <div className="grid grid-cols-[1fr_120px] gap-2">
              <div><label className={labelCls}>추가 비용 (선택)</label><input value={extraLabel} onChange={(e) => setExtraLabel(e.target.value)} className={inputCls} placeholder="예: 기존 필름 제거" /></div>
              <div><label className={labelCls}>금액</label><input value={fmtNum(extraPrice)} onChange={(e) => setExtraPrice(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" className={`${inputCls} text-right`} placeholder="600,000" /></div>
            </div>
            <div><label className={labelCls}>가격 조건 한 줄</label><input value={priceNote} onChange={(e) => setPriceNote(e.target.value)} className={inputCls} /></div>
            <div>
              <label className={labelCls}>서비스 항목 (무상) — 필요한 것만 체크. 기본은 비어 있음</label>
              <div className="flex flex-wrap gap-1.5">
                {SERVICE_ITEMS.map((it) => {
                  const on = benefitSel.includes(it);
                  return (
                    <button key={it} type="button" onClick={() => setBenefitSel(on ? benefitSel.filter((x) => x !== it) : [...benefitSel, it])}
                      className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${on ? 'bg-[#C8A951]/20 border-[#C8A951]/60 text-[#C8A951]' : 'bg-[var(--c-input)] border-[var(--c-border)] text-[var(--c-text-2)] hover:border-[#C8A951]/40'}`}>
                      {on ? '✓ ' : ''}{it}
                    </button>
                  );
                })}
              </div>
              <input value={benefitExtra} onChange={(e) => setBenefitExtra(e.target.value)} className={`${inputCls} mt-2`} placeholder="목록에 없는 서비스 직접 입력 (선택)" />
            </div>
            <div><label className={labelCls}>기간·관리</label><input value={terms} onChange={(e) => setTerms(e.target.value)} className={inputCls} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>입고 가능 날짜 1</label><input type="date" value={date1} onChange={(e) => setDate1(e.target.value)} className={inputCls} /></div>
              <div><label className={labelCls}>입고 가능 날짜 2</label><input type="date" value={date2} onChange={(e) => setDate2(e.target.value)} className={inputCls} /></div>
            </div>
            <div><label className={labelCls}>링크 하나</label><input value={link} onChange={(e) => setLink(e.target.value)} className={inputCls} /></div>
            <label className="flex items-center gap-2 text-xs text-[var(--c-text-2)]">
              <input type="checkbox" checked={withFollowUps} onChange={(e) => setWithFollowUps(e.target.checked)} className="accent-[#E4002B]" />
              보내면 사후관리에 재연락(내일)·마무리(3일 뒤) 문자를 자동 등록
            </label>
          </div>
          {/* 미리보기 */}
          <div className="px-6 py-4 space-y-3 bg-[var(--c-bg)]/40">
            <div className="text-xs text-[var(--c-text-3)]">문자 미리보기 ({text.length}자)</div>
            <pre className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--c-text-1)] bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4 font-sans">{text}</pre>
            <details className="text-[11px] text-[var(--c-text-3)]">
              <summary className="cursor-pointer">재연락 문자 2통 미리보기</summary>
              <pre className="whitespace-pre-wrap mt-2 p-3 rounded-lg bg-[var(--c-card)] border border-[var(--c-border)] font-sans text-[var(--c-text-2)]">[내일] {followUp1}</pre>
              <pre className="whitespace-pre-wrap mt-2 p-3 rounded-lg bg-[var(--c-card)] border border-[var(--c-border)] font-sans text-[var(--c-text-2)]">[3일 뒤] {followUp2}</pre>
            </details>
            {note && <div className="text-xs text-[var(--c-text-2)]">{note}</div>}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-[var(--c-border)] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[var(--c-text-3)] hover:text-[var(--c-text-2)]">닫기</button>
          <button onClick={() => send('copy')} disabled={busy || !car} className="bg-[var(--c-subtle)] hover:bg-[var(--c-hover)] text-[var(--c-text-1)] text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-50">📋 복사</button>
          <button onClick={() => send('sms')} disabled={busy || !car || !phone} className="bg-[#E4002B] hover:bg-[#c60026] text-white text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-50">💬 문자 보내기</button>
        </div>
      </div>
    </div>
  );
}
