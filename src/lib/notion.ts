/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const NOTION_API_KEY = process.env.NOTION_API_KEY || '';
const CUSTOMER_DB_ID = process.env.NOTION_CUSTOMER_DB_ID || '';
const NOTION_VERSION = '2022-06-28';

const CONFIG_PATH = join(process.cwd(), '.notion-dbs.json');

// ─── DB ID 설정 관리 ────────────────────────────────────
interface NotionDbConfig {
  appointmentDbId?: string;
  blogDbId?: string;
  serviceDbId?: string;
  consultationDbId?: string;
  estimateDbId?: string;
  portfolioDbId?: string;
  containerPageId?: string;
}

let cachedConfig: NotionDbConfig | null = null;

export async function getDbConfig(): Promise<NotionDbConfig> {
  if (cachedConfig) return cachedConfig;
  // 1. 파일에서 읽기 시도
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    cachedConfig = JSON.parse(raw);
    return cachedConfig!;
  } catch { /* 파일 없음 — 환경변수 폴백 */ }
  // 2. 환경변수에서 읽기 (Vercel 등 서버리스 환경)
  cachedConfig = {
    appointmentDbId: process.env.NOTION_APPOINTMENT_DB_ID || undefined,
    blogDbId: process.env.NOTION_BLOG_DB_ID || undefined,
    serviceDbId: process.env.NOTION_SERVICE_DB_ID || undefined,
    consultationDbId: process.env.NOTION_CONSULTATION_DB_ID || undefined,
    estimateDbId: process.env.NOTION_ESTIMATE_DB_ID || undefined,
    portfolioDbId: process.env.NOTION_PORTFOLIO_DB_ID || undefined,
    containerPageId: process.env.NOTION_CONTAINER_PAGE_ID || undefined,
  };
  return cachedConfig;
}

async function saveDbConfig(config: NotionDbConfig) {
  cachedConfig = config;
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ─── Types ───────────────────────────────────────────────
export interface NotionCustomerInput {
  name: string;
  phone?: string | null;
  car_brand?: string | null;
  car_model?: string | null;
  service_type?: string | null;
  appointment_date?: string | null;
  status?: string | null;
  memo?: string | null;
}

// ─── Notion REST API helper ─────────────────────────────
async function notionFetch(endpoint: string, options: { method?: string; body?: any } = {}) {
  const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion API ${res.status}: ${err}`);
  }
  return res.json();
}

// ─── 서비스 옵션 (공통) ──────────────────────────────────
const SERVICE_OPTIONS = [
  { name: 'PPF', color: 'blue' },
  { name: '틴팅', color: 'green' },
  { name: '세라믹코팅', color: 'yellow' },
  { name: '래핑', color: 'purple' },
  { name: '기타', color: 'gray' },
];

const STATUS_OPTIONS = [
  { name: '상담중', color: 'yellow' },
  { name: '예약확정', color: 'blue' },
  { name: '시공중', color: 'orange' },
  { name: '완료', color: 'green' },
  { name: '취소', color: 'red' },
  { name: '예정', color: 'purple' },
];

// ═══════════════════════════════════════════════════════════
// 고객 DB
// ═══════════════════════════════════════════════════════════

export async function ensureCustomerDbProperties() {
  const db = await notionFetch(`/databases/${CUSTOMER_DB_ID}`);
  const existing = Object.keys(db.properties || {});

  const required: Record<string, any> = {};

  if (!existing.includes('고객명')) {
    const titleProp = Object.entries(db.properties).find(([, v]: [string, any]) => v.type === 'title');
    if (titleProp) required[titleProp[0]] = { name: '고객명', title: {} };
  }
  if (!existing.includes('연락처')) required['연락처'] = { phone_number: {} };
  if (!existing.includes('차종')) required['차종'] = { rich_text: {} };
  if (!existing.includes('서비스')) required['서비스'] = { select: { options: SERVICE_OPTIONS } };
  if (!existing.includes('예약일')) required['예약일'] = { date: {} };
  if (!existing.includes('상태')) required['상태'] = { select: { options: STATUS_OPTIONS } };
  if (!existing.includes('메모')) required['메모'] = { rich_text: {} };

  if (Object.keys(required).length > 0) {
    await notionFetch(`/databases/${CUSTOMER_DB_ID}`, { method: 'PATCH', body: { properties: required } });
  }
}

export async function createCustomerPage(input: NotionCustomerInput) {
  const carInfo = [input.car_brand, input.car_model].filter(Boolean).join(' ');
  const properties: Record<string, any> = {
    '고객명': { title: [{ text: { content: input.name } }] },
  };
  if (input.phone) properties['연락처'] = { phone_number: input.phone };
  if (carInfo) properties['차종'] = { rich_text: [{ text: { content: carInfo } }] };
  if (input.service_type) properties['서비스'] = { select: { name: input.service_type } };
  if (input.appointment_date) properties['예약일'] = { date: { start: input.appointment_date } };
  if (input.status) properties['상태'] = { select: { name: input.status } };
  if (input.memo) properties['메모'] = { rich_text: [{ text: { content: input.memo } }] };

  return notionFetch('/pages', { method: 'POST', body: { parent: { database_id: CUSTOMER_DB_ID }, properties } });
}

export async function queryCustomers(startCursor?: string) {
  const body: any = { sorts: [{ timestamp: 'created_time', direction: 'descending' }], page_size: 100 };
  if (startCursor) body.start_cursor = startCursor;
  const response = await notionFetch(`/databases/${CUSTOMER_DB_ID}/query`, { method: 'POST', body });
  return {
    results: response.results.map(parseCustomerPage),
    hasMore: response.has_more,
    nextCursor: response.next_cursor,
  };
}

function parseCustomerPage(page: any) {
  const props = page.properties || {};
  return {
    id: page.id,
    name: props['고객명']?.title?.[0]?.plain_text || '',
    phone: props['연락처']?.phone_number || '',
    car: props['차종']?.rich_text?.[0]?.plain_text || '',
    service: props['서비스']?.select?.name || '',
    appointment_date: props['예약일']?.date?.start || '',
    status: props['상태']?.select?.name || '',
    memo: props['메모']?.rich_text?.[0]?.plain_text || '',
    created_at: page.created_time,
  };
}

// ═══════════════════════════════════════════════════════════
// 컨테이너 페이지 + DB 초기화
// ═══════════════════════════════════════════════════════════

async function ensureContainerPage(): Promise<string> {
  const config = await getDbConfig();
  if (config.containerPageId) {
    // 유효한지 확인
    try {
      await notionFetch(`/pages/${config.containerPageId}`);
      return config.containerPageId;
    } catch { /* 삭제된 경우 재생성 */ }
  }

  // 고객 DB 안에 컨테이너 페이지 생성
  const page = await notionFetch('/pages', {
    method: 'POST',
    body: {
      parent: { database_id: CUSTOMER_DB_ID },
      properties: {
        '고객명': { title: [{ text: { content: '📊 프로이즘 시스템 DB (삭제금지)' } }] },
      },
    },
  });

  const updated = { ...await getDbConfig(), containerPageId: page.id };
  await saveDbConfig(updated);
  return page.id;
}

// DB 존재 확인 헬퍼
async function dbExists(dbId: string | undefined): Promise<boolean> {
  if (!dbId) return false;
  try {
    await notionFetch(`/databases/${dbId}`);
    return true;
  } catch { return false; }
}

/** 모든 DB를 초기화하고 ID를 반환 */
export async function initAllDatabases() {
  const config = await getDbConfig();
  const parentPageId = await ensureContainerPage();
  let changed = false;

  // 1. 예약 일정 DB
  if (!await dbExists(config.appointmentDbId)) {
    const db = await notionFetch('/databases', {
      method: 'POST',
      body: {
        parent: { type: 'page_id', page_id: parentPageId },
        title: [{ text: { content: '예약 일정' } }],
        is_inline: true,
        properties: {
          '제목': { title: {} },
          '고객명': { rich_text: {} },
          '서비스': { select: { options: SERVICE_OPTIONS } },
          '예약일': { date: {} },
          '종료일': { date: {} },
          '상태': { select: { options: STATUS_OPTIONS } },
          '담당자': { select: { options: [{ name: '대표', color: 'blue' }, { name: '이팀장님', color: 'green' }] } },
          '메모': { rich_text: {} },
        },
      },
    });
    config.appointmentDbId = db.id;
    changed = true;
  }

  // 2. 블로그 발행 이력 DB
  if (!await dbExists(config.blogDbId)) {
    const db = await notionFetch('/databases', {
      method: 'POST',
      body: {
        parent: { type: 'page_id', page_id: parentPageId },
        title: [{ text: { content: '블로그 발행 이력' } }],
        is_inline: true,
        properties: {
          '제목': { title: {} },
          '차종': { rich_text: {} },
          '서비스': { select: { options: SERVICE_OPTIONS } },
          '생성일': { date: {} },
          '발행여부': { checkbox: {} },
          '네이버URL': { url: {} },
          '본문미리보기': { rich_text: {} },
        },
      },
    });
    config.blogDbId = db.id;
    changed = true;
  }

  // 3. 시공 기록 DB
  if (!await dbExists(config.serviceDbId)) {
    const db = await notionFetch('/databases', {
      method: 'POST',
      body: {
        parent: { type: 'page_id', page_id: parentPageId },
        title: [{ text: { content: '시공 기록' } }],
        is_inline: true,
        properties: {
          '제목': { title: {} },
          '고객명': { rich_text: {} },
          '차종': { rich_text: {} },
          '서비스': { select: { options: SERVICE_OPTIONS } },
          '시공일': { date: {} },
          '금액': { number: { format: 'won' } },
          '담당자': { select: { options: [{ name: '대표', color: 'blue' }, { name: '이팀장님', color: 'green' }] } },
          '상태': { select: { options: [{ name: '완료', color: 'green' }, { name: '진행중', color: 'orange' }] } },
        },
      },
    });
    config.serviceDbId = db.id;
    changed = true;
  }

  // 4. 상담 기록 DB
  if (!await dbExists(config.consultationDbId)) {
    const db = await notionFetch('/databases', {
      method: 'POST',
      body: {
        parent: { type: 'page_id', page_id: parentPageId },
        title: [{ text: { content: '상담 기록' } }],
        is_inline: true,
        properties: {
          '제목': { title: {} },
          '고객명': { rich_text: {} },
          '상담일': { date: {} },
          '상담유형': { select: { options: [{ name: '카톡', color: 'green' }, { name: '전화', color: 'blue' }, { name: '방문', color: 'orange' }, { name: '기타', color: 'gray' }] } },
          '내용': { rich_text: {} },
          '담당자': { select: { options: [{ name: '대표', color: 'blue' }, { name: '이팀장님', color: 'green' }] } },
        },
      },
    });
    config.consultationDbId = db.id;
    changed = true;
  }

  // 5. 견적서 DB
  if (!await dbExists(config.estimateDbId)) {
    const db = await notionFetch('/databases', {
      method: 'POST',
      body: {
        parent: { type: 'page_id', page_id: parentPageId },
        title: [{ text: { content: '견적서' } }],
        is_inline: true,
        properties: {
          '제목': { title: {} },
          '고객명': { rich_text: {} },
          '차종': { rich_text: {} },
          '서비스': { multi_select: { options: SERVICE_OPTIONS } },
          '예상금액': { number: { format: 'won' } },
          '작업예정일': { date: {} },
          '상태': { select: { options: [{ name: '발송', color: 'blue' }, { name: '확정', color: 'green' }, { name: '취소', color: 'red' }, { name: '대기', color: 'yellow' }] } },
          '생성일': { date: {} },
        },
      },
    });
    config.estimateDbId = db.id;
    changed = true;
  }

  // 6. 시공 포트폴리오 DB
  if (!await dbExists(config.portfolioDbId)) {
    const db = await notionFetch('/databases', {
      method: 'POST',
      body: {
        parent: { type: 'page_id', page_id: parentPageId },
        title: [{ text: { content: '시공 포트폴리오' } }],
        is_inline: true,
        properties: {
          '제목': { title: {} },
          '차종': { rich_text: {} },
          '서비스': { select: { options: SERVICE_OPTIONS } },
          '시공일': { date: {} },
          '설명': { rich_text: {} },
          '사진URL': { url: {} },
        },
      },
    });
    config.portfolioDbId = db.id;
    changed = true;
  }

  if (changed) await saveDbConfig(config);

  return {
    customerDbId: CUSTOMER_DB_ID,
    appointmentDbId: config.appointmentDbId,
    blogDbId: config.blogDbId,
    serviceDbId: config.serviceDbId,
    consultationDbId: config.consultationDbId,
    estimateDbId: config.estimateDbId,
    portfolioDbId: config.portfolioDbId,
    containerPageId: config.containerPageId,
  };
}

// ═══════════════════════════════════════════════════════════
// 예약 일정 DB
// ═══════════════════════════════════════════════════════════

export async function createAppointmentPage(input: {
  customerName: string;
  serviceType?: string | null;
  appointmentDate: string;
  endDate?: string | null;
  status?: string | null;
  manager?: string | null;
  memo?: string | null;
}) {
  const config = await getDbConfig();
  if (!config.appointmentDbId) throw new Error('예약 일정 DB가 초기화되지 않았습니다. /api/notion/init을 먼저 호출하세요.');

  const properties: Record<string, any> = {
    '제목': { title: [{ text: { content: `${input.customerName} - ${input.serviceType || '예약'}` } }] },
    '고객명': { rich_text: [{ text: { content: input.customerName } }] },
    '예약일': { date: { start: input.appointmentDate } },
  };
  if (input.serviceType) properties['서비스'] = { select: { name: input.serviceType } };
  if (input.endDate) properties['종료일'] = { date: { start: input.endDate } };
  if (input.status) properties['상태'] = { select: { name: input.status } };
  if (input.manager) properties['담당자'] = { select: { name: input.manager } };
  if (input.memo) properties['메모'] = { rich_text: [{ text: { content: input.memo } }] };

  return notionFetch('/pages', { method: 'POST', body: { parent: { database_id: config.appointmentDbId }, properties } });
}

export async function queryAppointments(startCursor?: string) {
  const config = await getDbConfig();
  if (!config.appointmentDbId) return { results: [], hasMore: false, nextCursor: null };

  const body: any = { sorts: [{ property: '예약일', direction: 'descending' }], page_size: 100 };
  if (startCursor) body.start_cursor = startCursor;
  const response = await notionFetch(`/databases/${config.appointmentDbId}/query`, { method: 'POST', body });

  return {
    results: response.results.map((p: any) => {
      const props = p.properties || {};
      return {
        id: p.id,
        title: props['제목']?.title?.[0]?.plain_text || '',
        customerName: props['고객명']?.rich_text?.[0]?.plain_text || '',
        service: props['서비스']?.select?.name || '',
        appointmentDate: props['예약일']?.date?.start || '',
        endDate: props['종료일']?.date?.start || '',
        status: props['상태']?.select?.name || '',
        manager: props['담당자']?.select?.name || '',
        memo: props['메모']?.rich_text?.[0]?.plain_text || '',
      };
    }),
    hasMore: response.has_more,
    nextCursor: response.next_cursor,
  };
}

// ═══════════════════════════════════════════════════════════
// 블로그 발행 이력 DB
// ═══════════════════════════════════════════════════════════

export async function createBlogPage(input: {
  title: string;
  carModel?: string | null;
  service?: string | null;
  published?: boolean;
  naverUrl?: string | null;
  preview?: string | null;
}) {
  const config = await getDbConfig();
  if (!config.blogDbId) throw new Error('블로그 DB가 초기화되지 않았습니다. /api/notion/init을 먼저 호출하세요.');

  const properties: Record<string, any> = {
    '제목': { title: [{ text: { content: input.title } }] },
    '생성일': { date: { start: new Date().toISOString().split('T')[0] } },
    '발행여부': { checkbox: input.published ?? false },
  };
  if (input.carModel) properties['차종'] = { rich_text: [{ text: { content: input.carModel } }] };
  if (input.service) properties['서비스'] = { select: { name: input.service } };
  if (input.naverUrl) properties['네이버URL'] = { url: input.naverUrl };
  if (input.preview) properties['본문미리보기'] = { rich_text: [{ text: { content: input.preview.slice(0, 2000) } }] };

  return notionFetch('/pages', { method: 'POST', body: { parent: { database_id: config.blogDbId }, properties } });
}

export async function queryBlogPosts(startCursor?: string) {
  const config = await getDbConfig();
  if (!config.blogDbId) return { results: [], hasMore: false, nextCursor: null };

  const body: any = { sorts: [{ property: '생성일', direction: 'descending' }], page_size: 100 };
  if (startCursor) body.start_cursor = startCursor;
  const response = await notionFetch(`/databases/${config.blogDbId}/query`, { method: 'POST', body });

  return {
    results: response.results.map((p: any) => {
      const props = p.properties || {};
      return {
        id: p.id,
        title: props['제목']?.title?.[0]?.plain_text || '',
        carModel: props['차종']?.rich_text?.[0]?.plain_text || '',
        service: props['서비스']?.select?.name || '',
        createdDate: props['생성일']?.date?.start || '',
        published: props['발행여부']?.checkbox || false,
        naverUrl: props['네이버URL']?.url || '',
        preview: props['본문미리보기']?.rich_text?.[0]?.plain_text || '',
      };
    }),
    hasMore: response.has_more,
    nextCursor: response.next_cursor,
  };
}

// ═══════════════════════════════════════════════════════════
// 시공 기록 DB
// ═══════════════════════════════════════════════════════════

export async function createServiceRecordPage(input: {
  customerName: string;
  carModel?: string | null;
  service?: string | null;
  serviceDate: string;
  amount?: number | null;
  manager?: string | null;
  status?: string | null;
}) {
  const config = await getDbConfig();
  if (!config.serviceDbId) throw new Error('시공 기록 DB가 초기화되지 않았습니다. /api/notion/init을 먼저 호출하세요.');

  const properties: Record<string, any> = {
    '제목': { title: [{ text: { content: `${input.customerName} - ${input.service || '시공'}` } }] },
    '고객명': { rich_text: [{ text: { content: input.customerName } }] },
    '시공일': { date: { start: input.serviceDate } },
    '상태': { select: { name: input.status || '완료' } },
  };
  if (input.carModel) properties['차종'] = { rich_text: [{ text: { content: input.carModel } }] };
  if (input.service) properties['서비스'] = { select: { name: input.service } };
  if (input.amount) properties['금액'] = { number: input.amount };
  if (input.manager) properties['담당자'] = { select: { name: input.manager } };

  return notionFetch('/pages', { method: 'POST', body: { parent: { database_id: config.serviceDbId }, properties } });
}

export async function queryServiceRecords(filters?: { month?: string; service?: string }, startCursor?: string) {
  const config = await getDbConfig();
  if (!config.serviceDbId) return { results: [], hasMore: false, nextCursor: null };

  const body: any = { sorts: [{ property: '시공일', direction: 'descending' }], page_size: 100 };
  if (startCursor) body.start_cursor = startCursor;

  // 필터 구성
  const filterConditions: any[] = [];
  if (filters?.month) {
    // month format: "2026-04"
    const start = `${filters.month}-01`;
    const nextMonth = new Date(start);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const end = nextMonth.toISOString().split('T')[0];
    filterConditions.push({ property: '시공일', date: { on_or_after: start } });
    filterConditions.push({ property: '시공일', date: { before: end } });
  }
  if (filters?.service) {
    filterConditions.push({ property: '서비스', select: { equals: filters.service } });
  }
  if (filterConditions.length === 1) body.filter = filterConditions[0];
  else if (filterConditions.length > 1) body.filter = { and: filterConditions };

  const response = await notionFetch(`/databases/${config.serviceDbId}/query`, { method: 'POST', body });

  return {
    results: response.results.map((p: any) => {
      const props = p.properties || {};
      return {
        id: p.id,
        title: props['제목']?.title?.[0]?.plain_text || '',
        customerName: props['고객명']?.rich_text?.[0]?.plain_text || '',
        carModel: props['차종']?.rich_text?.[0]?.plain_text || '',
        service: props['서비스']?.select?.name || '',
        serviceDate: props['시공일']?.date?.start || '',
        amount: props['금액']?.number || 0,
        manager: props['담당자']?.select?.name || '',
        status: props['상태']?.select?.name || '',
      };
    }),
    hasMore: response.has_more,
    nextCursor: response.next_cursor,
  };
}

// ═══════════════════════════════════════════════════════════
// 상담 기록 DB
// ═══════════════════════════════════════════════════════════

export async function createConsultationPage(input: {
  customerName: string;
  consultationDate: string;
  consultationType?: string | null;
  content?: string | null;
  manager?: string | null;
}) {
  const config = await getDbConfig();
  if (!config.consultationDbId) throw new Error('상담 기록 DB가 초기화되지 않았습니다. /api/notion/init을 먼저 호출하세요.');

  const properties: Record<string, any> = {
    '제목': { title: [{ text: { content: `${input.customerName} - ${input.consultationType || '상담'}` } }] },
    '고객명': { rich_text: [{ text: { content: input.customerName } }] },
    '상담일': { date: { start: input.consultationDate } },
  };
  if (input.consultationType) properties['상담유형'] = { select: { name: input.consultationType } };
  if (input.content) properties['내용'] = { rich_text: [{ text: { content: input.content.slice(0, 2000) } }] };
  if (input.manager) properties['담당자'] = { select: { name: input.manager } };

  return notionFetch('/pages', { method: 'POST', body: { parent: { database_id: config.consultationDbId }, properties } });
}

export async function queryConsultations(filters?: { customer?: string }, startCursor?: string) {
  const config = await getDbConfig();
  if (!config.consultationDbId) return { results: [], hasMore: false, nextCursor: null };

  const body: any = { sorts: [{ property: '상담일', direction: 'descending' }], page_size: 100 };
  if (startCursor) body.start_cursor = startCursor;
  if (filters?.customer) {
    body.filter = { property: '고객명', rich_text: { contains: filters.customer } };
  }

  const response = await notionFetch(`/databases/${config.consultationDbId}/query`, { method: 'POST', body });

  return {
    results: response.results.map((p: any) => {
      const props = p.properties || {};
      return {
        id: p.id,
        customerName: props['고객명']?.rich_text?.[0]?.plain_text || '',
        consultationDate: props['상담일']?.date?.start || '',
        consultationType: props['상담유형']?.select?.name || '',
        content: props['내용']?.rich_text?.[0]?.plain_text || '',
        manager: props['담당자']?.select?.name || '',
      };
    }),
    hasMore: response.has_more,
    nextCursor: response.next_cursor,
  };
}

// ═══════════════════════════════════════════════════════════
// 대시보드 (시공 기록 기반 집계)
// ═══════════════════════════════════════════════════════════

export async function getDashboardData(year: string) {
  const config = await getDbConfig();
  if (!config.serviceDbId) return null;

  const allRecords: Array<{ service: string; serviceDate: string; amount: number }> = [];
  let cursor: string | undefined;
  do {
    const result = await queryServiceRecords({}, cursor);
    allRecords.push(...result.results);
    cursor = result.hasMore && result.nextCursor ? result.nextCursor : undefined;
  } while (cursor);

  const yearRecords = allRecords.filter((r) => r.serviceDate.startsWith(year));

  const byService: Record<string, { count: number; revenue: number }> = {};
  for (const r of yearRecords) {
    const key = r.service || '기타';
    if (!byService[key]) byService[key] = { count: 0, revenue: 0 };
    byService[key].count++;
    byService[key].revenue += r.amount || 0;
  }

  const byMonth: Record<string, { count: number; revenue: number }> = {};
  for (let m = 1; m <= 12; m++) {
    byMonth[`${year}-${String(m).padStart(2, '0')}`] = { count: 0, revenue: 0 };
  }
  for (const r of yearRecords) {
    const month = r.serviceDate.slice(0, 7);
    if (byMonth[month]) { byMonth[month].count++; byMonth[month].revenue += r.amount || 0; }
  }

  const totalRevenue = yearRecords.reduce((s, r) => s + (r.amount || 0), 0);

  return {
    year,
    totalCount: yearRecords.length,
    totalRevenue,
    avgPerCase: yearRecords.length > 0 ? Math.round(totalRevenue / yearRecords.length) : 0,
    byService: Object.entries(byService).map(([name, data]) => ({ name, ...data })).sort((a, b) => b.revenue - a.revenue),
    byMonth: Object.entries(byMonth).map(([month, data]) => ({ month, ...data })),
  };
}

// ═══════════════════════════════════════════════════════════
// 견적서 DB
// ═══════════════════════════════════════════════════════════

const SHOP_INFO = {
  name: '3M 프로이즘 강남서초점',
  address: '서울특별시 서초구 서초중앙로8길 82 1동 1층 1호',
  phone: '010-7287-7140',
};

export async function createEstimatePage(input: {
  customerName: string;
  phone?: string | null;
  carModel?: string | null;
  services: string[];
  amount?: number | null;
  scheduledDate?: string | null;
  memo?: string | null;
}) {
  const config = await getDbConfig();
  if (!config.estimateDbId) throw new Error('견적서 DB가 초기화되지 않았습니다. /api/notion/init을 먼저 호출하세요.');

  const today = new Date().toISOString().split('T')[0];

  const properties: Record<string, any> = {
    '제목': { title: [{ text: { content: `견적서 - ${input.customerName} (${today})` } }] },
    '고객명': { rich_text: [{ text: { content: input.customerName } }] },
    '생성일': { date: { start: today } },
    '상태': { select: { name: '발송' } },
  };
  if (input.carModel) properties['차종'] = { rich_text: [{ text: { content: input.carModel } }] };
  if (input.services.length > 0) properties['서비스'] = { multi_select: input.services.map((s) => ({ name: s })) };
  if (input.amount) properties['예상금액'] = { number: input.amount };
  if (input.scheduledDate) properties['작업예정일'] = { date: { start: input.scheduledDate } };

  // 본문에 견적 상세 내용 포함
  const serviceList = input.services.length > 0 ? input.services.join(', ') : '-';
  const amountText = input.amount ? `${input.amount.toLocaleString()}원` : '별도 협의';
  const scheduleText = input.scheduledDate || '협의 후 결정';

  const children: any[] = [
    { type: 'heading_2', heading_2: { rich_text: [{ text: { content: '견적서' } }] } },
    { type: 'divider', divider: {} },
    { type: 'heading_3', heading_3: { rich_text: [{ text: { content: '고객 정보' } }] } },
    { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ text: { content: `고객명: ${input.customerName}` } }] } },
    { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ text: { content: `연락처: ${input.phone || '-'}` } }] } },
    { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ text: { content: `차종: ${input.carModel || '-'}` } }] } },
    { type: 'divider', divider: {} },
    { type: 'heading_3', heading_3: { rich_text: [{ text: { content: '서비스 내역' } }] } },
    { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ text: { content: `서비스: ${serviceList}` } }] } },
    { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ text: { content: `예상 금액: ${amountText}` }, annotations: { bold: true } }] } },
    { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ text: { content: `작업 예정일: ${scheduleText}` } }] } },
  ];

  if (input.memo) {
    children.push({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ text: { content: `비고: ${input.memo}` } }] } });
  }

  children.push(
    { type: 'divider', divider: {} },
    { type: 'heading_3', heading_3: { rich_text: [{ text: { content: '매장 정보' } }] } },
    { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ text: { content: SHOP_INFO.name, link: null }, annotations: { bold: true } }] } },
    { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ text: { content: `주소: ${SHOP_INFO.address}` } }] } },
    { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ text: { content: `전화: ${SHOP_INFO.phone}` } }] } },
    { type: 'divider', divider: {} },
    { type: 'callout', callout: { icon: { type: 'emoji', emoji: '💡' }, rich_text: [{ text: { content: '본 견적서는 차량 실물 확인 후 변경될 수 있습니다. 유효기간: 발행일로부터 7일' } }], color: 'gray_background' } },
  );

  const page = await notionFetch('/pages', {
    method: 'POST',
    body: {
      parent: { database_id: config.estimateDbId },
      properties,
      children,
    },
  });

  return page;
}

// ═══════════════════════════════════════════════════════════
// 시공 포트폴리오 DB
// ═══════════════════════════════════════════════════════════

export async function createPortfolioPage(input: {
  carModel?: string | null;
  service?: string | null;
  serviceDate: string;
  description?: string | null;
  photoUrl?: string | null;
}) {
  const config = await getDbConfig();
  if (!config.portfolioDbId) throw new Error('포트폴리오 DB가 초기화되지 않았습니다. /api/notion/init을 먼저 호출하세요.');

  const title = [input.carModel, input.service].filter(Boolean).join(' ') || '시공';
  const properties: Record<string, any> = {
    '제목': { title: [{ text: { content: title } }] },
    '시공일': { date: { start: input.serviceDate } },
  };
  if (input.carModel) properties['차종'] = { rich_text: [{ text: { content: input.carModel } }] };
  if (input.service) properties['서비스'] = { select: { name: input.service } };
  if (input.description) properties['설명'] = { rich_text: [{ text: { content: input.description.slice(0, 2000) } }] };
  if (input.photoUrl) properties['사진URL'] = { url: input.photoUrl };

  return notionFetch('/pages', { method: 'POST', body: { parent: { database_id: config.portfolioDbId }, properties } });
}

export async function queryPortfolio(startCursor?: string) {
  const config = await getDbConfig();
  if (!config.portfolioDbId) return { results: [], hasMore: false, nextCursor: null };

  const body: any = { sorts: [{ property: '시공일', direction: 'descending' }], page_size: 100 };
  if (startCursor) body.start_cursor = startCursor;

  const response = await notionFetch(`/databases/${config.portfolioDbId}/query`, { method: 'POST', body });
  return {
    results: response.results.map((p: any) => {
      const props = p.properties || {};
      return {
        id: p.id,
        title: props['제목']?.title?.[0]?.plain_text || '',
        carModel: props['차종']?.rich_text?.[0]?.plain_text || '',
        service: props['서비스']?.select?.name || '',
        serviceDate: props['시공일']?.date?.start || '',
        description: props['설명']?.rich_text?.[0]?.plain_text || '',
        photoUrl: props['사진URL']?.url || '',
      };
    }),
    hasMore: response.has_more,
    nextCursor: response.next_cursor,
  };
}
