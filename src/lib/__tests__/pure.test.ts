// 순수 로직 시험 (2026-11-23): DB 없이 돌아가는 해석기·문구·판정 함수들. `npm test`
import { describe, it, expect } from 'vitest';
import { appendCareLog, parseCareLog, stripCareLog } from '@/lib/care-log';
import { isSkipped, skipReason, quoteCloseReason, maintenanceYears } from '@/lib/followups';
import { formatPhoneInput } from '@/lib/phone';
import { normalizePhone, statusColor, formatDate } from '@/lib/crm-shared';
import { followUpMessage, followUpSmsKey, followUpLabel, arrivalSms, MAINT_SMS, QC_SMS } from '@/config/sms-templates';
import { matchFaqs, INQUIRY_FAQS } from '@/config/inquiry-faq';
import { careGuidesFor, CARE_GUIDES } from '@/config/care-guide';
import { blacklistInfo, stripBlacklist, isBlacklisted } from '@/lib/blacklist';
import { ppfProduct, workItems, workDetailsText } from '@/lib/work-order';
import { referrerToken, hideRefToken } from '@/components/crm/ReferrerPicker';
import { overdueAppointments } from '@/lib/appointments-flow';
import { vehicleLabel } from '@/lib/vehicles';
import { normalizeService } from '@/lib/appointment-import';

describe('점검 기록 memo (care-log)', () => {
  it('붙이고 읽고 떼기가 원래 메모를 보존한다', () => {
    const base = '랩핑 시공 완료 후 6개월 메인터넌스';
    const m = appendCareLog(base, { date: '2026-11-22', note: '코팅 도포 · 끝단 이상 없음', photos: ['https://x/a.jpg', 'https://x/b.jpg'] });
    expect(parseCareLog(m)).toEqual({ date: '2026-11-22', note: '코팅 도포 · 끝단 이상 없음', photos: ['https://x/a.jpg', 'https://x/b.jpg'] });
    expect(stripCareLog(m)).toBe(base);
  });
  it('메모 없이 사진만 올려도 사진 줄을 메모로 읽지 않는다', () => {
    const m = appendCareLog(null, { date: '2026-11-22', note: '', photos: ['https://x/c.jpg'] });
    expect(parseCareLog(m)).toEqual({ date: '2026-11-22', note: '', photos: ['https://x/c.jpg'] });
  });
  it('기록이 없으면 null', () => { expect(parseCareLog('그냥 메모')).toBeNull(); });
});

describe('사후관리 상태 해석 (followups)', () => {
  it('미방문 표시와 사유', () => {
    expect(isSkipped('미방문 2026-11-22: 전화 안 받음\nPPF 메인터넌스')).toBe(true);
    expect(skipReason('미방문 2026-11-22: 전화 안 받음')).toBe('전화 안 받음');
    expect(isSkipped('PPF 메인터넌스')).toBe(false);
  });
  it('견적 종결 사유', () => {
    expect(quoteCloseReason('견적 종결 2026-11-22: 다른 곳에서 함\n홍길동 010-0000-0000')).toBe('다른 곳에서 함');
    expect(quoteCloseReason('예약 잡혀 자동 정리 2026-11-22')).toBe('');
  });
  it('메인터넌스 기간: 선택값 우선, 보증서 N년(2 이상), 옛 1년 기본값은 한계 없음', () => {
    expect(maintenanceYears(JSON.stringify({ maintenance_years: '5', warranty: { warranty_period: '시공일로부터 5년' } }))).toBe(5);
    expect(maintenanceYears(JSON.stringify({ warranty: { warranty_period: '시공일로부터 3년' } }))).toBe(3);
    expect(maintenanceYears(JSON.stringify({ warranty: { warranty_period: '시공일로부터 1년' } }))).toBeNull();
    expect(maintenanceYears('글 메모')).toBeNull();
    expect(maintenanceYears(null)).toBeNull();
  });
});

describe('전화번호', () => {
  it('입력 중 하이픈 자동', () => {
    expect(formatPhoneInput('0107')).toBe('010-7');
    expect(formatPhoneInput('01072877')).toBe('010-728-77');
    expect(formatPhoneInput('01072877140')).toBe('010-7287-7140');
    expect(formatPhoneInput('010-7287-71401')).toBe('010-7287-7140');
    expect(formatPhoneInput('0212345678')).toBe('02-1234-5678');
  });
  it('저장 형식 통일', () => {
    expect(normalizePhone('01093207942')).toBe('010-9320-7942');
    expect(normalizePhone(' 010 1234 5678 ')).toBe('010-1234-5678');
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('1588-1234')).toBe('1588-1234');
  });
});

describe('문자 문구 (sms-templates)', () => {
  it('메인터넌스 2회차부터 개월만 바뀌고 회차는 손님에게 안 보인다', () => {
    const second = followUpMessage('메인터넌스', 'PPF 2회차 메인터넌스 (6개월마다 자동)');
    expect(second).toContain('시공 후 12개월이 되어 메인터넌스 안내드립니다.');
    expect(second).not.toMatch(/번째|회차/);
    expect(followUpMessage('메인터넌스', 'PPF 시공 완료 후 6개월 메인터넌스')).toBe(MAINT_SMS);
    expect(followUpMessage('QC점검', null)).toBe(QC_SMS);
  });
  it('입고 안내 문구에 날짜·요일·시공·주소가 들어간다', () => {
    const t = arrivalSms('홍길동', '2026-11-28', 'PPF');
    expect(t).toContain('홍길동 고객님, 내일 11월 28일 토요일 PPF 입고 예정입니다.');
    expect(t).toContain('서초중앙로8길 82');
  });
  it('입고 안내 키·라벨', () => {
    expect(followUpSmsKey('입고안내')).toBe('arrival');
    expect(followUpLabel('입고안내')).toBe('입고 안내');
    expect(followUpLabel('QC점검')).toBe('QC 점검');
  });
});

describe('문의 답변 반복 질문 (inquiry-faq)', () => {
  it('질문이 있을 때만 걸린다', () => {
    expect(matchFaqs('모델Y 전체 PPF 얼마예요? 세차는 언제부터 되나요? 보증은요?').map((f) => f.key)).toEqual(['wash', 'warranty']);
    expect(matchFaqs('기존 썬팅 떼고 다시 하려는데 기포가 좀 있어요').map((f) => f.key).sort()).toEqual(['bubble', 'removal']);
    expect(matchFaqs('카니발 크롬죽이기 가격이요')).toEqual([]);
  });
  it('답에 보증 연수·탁송이 없다 (사장님 결정)', () => {
    for (const f of INQUIRY_FAQS) { expect(f.answer).not.toMatch(/\d+년 보증|보증 \d+년|탁송/); }
  });
});

describe('내 차 관리법 고르기 (care-guide)', () => {
  it('시공 종류와 작업 내역서 묶음으로 해당 안내만', () => {
    expect(careGuidesFor(['신차패키지'], ['썬팅', 'PPF']).map((g) => g.key)).toEqual(['PPF', '썬팅', '유리막코팅']);
    expect(careGuidesFor(['랩핑', '크롬죽이기']).map((g) => g.key)).toEqual(['랩핑', '크롬죽이기']);
    expect(careGuidesFor(['컬러PPF']).map((g) => g.key)).toEqual(['컬러PPF']);
    expect(careGuidesFor([])).toEqual([]);
  });
  it('안내 문구에 보증 연수가 없다', () => {
    for (const g of CARE_GUIDES) for (const line of [...g.after, ...g.daily, ...g.contact]) expect(line).not.toMatch(/보증 \d+년|\d+년 보증/);
  });
});

describe('블랙리스트·소개 토큰', () => {
  it('블랙리스트 토큰 읽기·떼기', () => {
    const memo = '차량번호: 12가3456\n[블랙리스트 2026-11-22: 결제 미이행]';
    expect(blacklistInfo(memo)).toEqual({ date: '2026-11-22', reason: '결제 미이행' });
    expect(isBlacklisted(memo)).toBe(true);
    expect(stripBlacklist(memo)).toBe('차량번호: 12가3456');
    expect(isBlacklisted('보통 메모')).toBe(false);
  });
  it('소개 토큰은 화면에서 숨겨진다', () => {
    const t = referrerToken({ id: '11111111-1111-1111-1111-111111111111', name: '홍길동' });
    expect(hideRefToken(`전화문의 010-0000-0000 · X5 · ${t}`)).toBe('전화문의 010-0000-0000 · X5 · 소개: 홍길동');
  });
});

describe('작업 내역서 → 제품·항목 (work-order)', () => {
  it('PPF 등급은 정해진 스펙으로만, 시리즈50·100은 발수코팅 없음', () => {
    expect(ppfProduct('50시리즈')).toBe('3M PPF 시리즈50 · 185μm · 셀프힐링 · 고광택');
    expect(ppfProduct('시리즈100')).not.toContain('발수');
    expect(ppfProduct('150')).toContain('발수코팅');
    expect(ppfProduct('PRO200 무광')).toContain('무광');
    expect(ppfProduct('')).toBeNull();
  });
  it('항목 묶음과 증명서 줄', () => {
    const items = workItems({ ppf: ['프론트패키지'], ppf_etc: '50시리즈', tinting: { glasstint: { selected: ['로데(비반사)'], density: '전면30 측후면 15' } }, coating: ['그래핀PRO'] });
    expect(items.map((i) => i.group)).toEqual(['PPF', '썬팅', '코팅']);
    expect(items[0].product).toContain('시리즈50');
    expect(workDetailsText({ ppf: ['전체PPF'], ppf_etc: '150' }, '시공')).toBe('PPF 전체 PPF (3M PPF 시리즈150)');
  });
});

describe('예약 흐름 판정 (appointments-flow)', () => {
  it('끝난 날이 지났는데 완료 안 된 것만', () => {
    const list = [
      { id: 'a', appointment_date: '2026-11-10', end_date: '2026-11-13', status: '예약확정' },
      { id: 'b', appointment_date: '2026-11-20', end_date: null, status: '시공중' },
      { id: 'c', appointment_date: '2026-11-10', end_date: '2026-11-13', status: '완료' },
      { id: 'd', appointment_date: '2026-11-30', end_date: null, status: '예약확정' },
    ];
    expect(overdueAppointments(list, '2026-11-23').map((a) => a.id)).toEqual(['a', 'b']);
  });
  it('상태 색·날짜 표기', () => {
    expect(statusColor('취소')).toContain('line-through');
    expect(formatDate(null)).toBe('-');
  });
  it('차량 라벨', () => {
    expect(vehicleLabel({ brand: '포르쉐', model: '타이칸', plate: '12가 3456' }, true)).toBe('포르쉐 타이칸 (12가 3456)');
    expect(vehicleLabel(null)).toBe('');
  });
});

describe('스크린샷 일정 → 시공 종류 (normalizeService)', () => {
  it('필름 이름·루프스킨만 적혀도 종류를 잡는다', () => {
    expect(normalizeService('5시리즈 전면 크리스탈라인')).toBe('썬팅');
    expect(normalizeService('GLS 썬팅 IS200')).toBe('썬팅');
    expect(normalizeService('e300 버텍스 900')).toBe('썬팅');
    expect(normalizeService('5시리즈 루프스킨 제거 및 재시공')).toBe('랩핑');
    expect(normalizeService('BMW X6 PWF 매트블랙')).toBe('컬러PPF');
    expect(normalizeService('랜드로버 보험수리')).toBeNull();
  });
});
