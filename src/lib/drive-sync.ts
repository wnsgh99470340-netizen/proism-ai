/**
 * 드라이브 작업 사진 폴더 ↔ CRM 차량 자동 연결 (2026-11-27 사장님 "새 작업 하고 드라이브에 폴더 만들면 알아서 연결되게")
 * - 드라이브 구조: 루트 "2026년도 작업사진"(DRIVE_PHOTO_ROOT) → "1월"~"12월" → "YYMMDD 차종 (성함) 작업" 폴더
 * - 드라이브는 읽기만(embeddedfolderview). CRM 에는 vehicles.drive_folder 를 **비어 있을 때만** 기록(이미 다른 폴더가 있으면 안 덮음)
 * - 확실한 것만 붙이고, 후보·없음은 아침 브리핑에서 사장님께 묻는다. 시공기·공개 페이지와는 연결하지 않음
 * - 매칭 규칙은 .backup/drive-match-2026-11-27.mjs(한 번 돌린 스크립트)에서 옮김: 날짜 ±4일 + 차종 토큰, 성함이 있으면 성함까지
 */
import { supabase } from './supabase';
import { listDriveSubfolders, parseDriveFolderId } from './drive';
import { todaySeoul } from './local-date';

export const DEFAULT_DRIVE_PHOTO_ROOT = '1wOMbh_Dw2vjDoLDBLTcJl45jzmNDliML';
export const driveFolderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;

const WORK_WORDS = /(전체|프론트|패키지|신차|실내|생활보호|크롬죽이기|크딜|랩핑|제거|재시공|썬팅|썬|유리막|광택|보험수리|사고수리|보험|루프스킨|루프슨킨|투톤|포인트|그릴|앞범퍼|뒷범퍼|도어|발판|사이드미러|윈도우몰딩|윈드쉴드|기어패널|문콕|앞유리|뒷유리|측면|1열|전면|메인터넌스|주니퍼|롱바디|블랙|컬러|ppf|pwf|주의|재정비|사진섞여서|수정|도구사용|검정|회색|및|낙수물|조|님|김실장|류대표|포항)/gi;
const WORK_WORD_EXACT = new RegExp(`^${WORK_WORDS.source}$`, 'i');
const BRAND = /(bmw|아우디|벤츠|테슬라|포르쉐|랜드로버|렉서스|현대|기아|제네시스|볼보|푸조|포드|마세라티|람보르기니|벤틀리|에스턴마틴)/gi;
/** 사장님·직원 내부 차 폴더 — 손님 차가 아님 */
const INTERNAL_RE = /(김실장|류대표|실장님|대표님)/;
/** 성함으로 오인하기 쉬운 한글 차종·일반 단어 */
const NOT_NAME = new Set(['모델', '마칸', '카이엔', '타이칸', '파나메라', '디펜더', '디팬더', '레인지로버', '기블리', '르반떼', '우루스', '우라칸', '고스트', '컬리넌', '팬텀', '벤테이가', '마이바흐', '그랜저', '아반떼', '쏘나타', '싼타페', '투싼', '코나', '아이오닉', '니로', '셀토스', '스포티지', '쏘렌토', '카니발', '팰리세이드', '모닝', '레이', '스팅어', '구형', '신형', '부분', '하단', '상단', '전후면', '시공', '작업', '마감', '추가', '고객', '손님', '딜러', '전시장', '정비', '수리', '교체']);
const SURNAME = /^[김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예봉경]/;

export const normCar = (s: string | null | undefined) => (s || '').toLowerCase().replace(/\s+/g, '').replace(/디팬더/g, '디펜더').replace(/-/g, '');
const plus = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);

export interface ParsedFolder { date: string | null; carTokens: string[]; nameToken?: string; work: string; internal: boolean }

/** 폴더 이름 → 날짜·차종 토큰·성함 후보. year 는 4자리(MMDD) 날짜의 해 */
export function parseFolderName(name: string, year = Number(todaySeoul().slice(0, 4))): ParsedFolder {
  const raw = (name || '').trim();
  const m = raw.match(/^(\d{6}|\d{4})\s*(.*)$/);
  let date: string | null = null;
  let rest = raw;
  if (m) {
    const d = m[1]; rest = m[2];
    date = d.length === 6 ? `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}` : `${year}-${d.slice(0, 2)}-${d.slice(2, 4)}`;
    if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)) date = null;
  }
  const internal = INTERNAL_RE.test(rest);
  // 성함: 공백으로 나눈 낱말 중 한글 2~4자, 성씨로 시작, 작업·차종 낱말이 아님
  let nameToken: string | undefined;
  for (const w of rest.split(/\s+/)) {
    const t = w.replace(/[()]/g, '');
    if (/^[가-힣]{2,4}$/.test(t) && SURNAME.test(t) && !WORK_WORD_EXACT.test(t) && !NOT_NAME.has(t) && !new RegExp(`^${BRAND.source}$`, 'i').test(t)) { nameToken = t; break; }
  }
  const carPart = nameToken ? rest.replace(nameToken, ' ') : rest;
  const tokens = normCar(carPart.replace(WORK_WORDS, ' ').replace(BRAND, ' ').replace(/[()]/g, ' ')).match(/[a-z0-9가-힣]+/g) || [];
  const carTokens = [...new Set(tokens.filter((t) => t.length >= 2 || /^[a-z]\d$|^\d{3}$/.test(t)))];
  const work = (rest.match(WORK_WORDS) || []).join(' ');
  return { date, carTokens, nameToken, work, internal };
}

export interface SyncCustomer { id: string; name: string; car_brand?: string | null; car_model?: string | null; kind?: string | null }
export interface SyncVehicle { id: string; customer_id: string; brand?: string | null; model?: string | null; is_primary?: boolean | null; drive_folder?: string | null }
export interface SyncRecord { customer_id: string | null; vehicle_id?: string | null; start: string; end: string; type?: string | null; kind: '시공' | '예약' }
export interface MatchCandidate { customer_id: string; customer: string; vehicle_id: string | null; car: string; recs: string[] }
export interface MatchResult { status: '확실' | '후보' | '없음'; candidates: MatchCandidate[] }

/** 폴더 하나를 CRM 기록과 맞춘다 (순수). month 는 날짜 없는 폴더용 "N" */
export function matchFolder(folder: { name: string; month?: number; year?: number }, data: { customers: SyncCustomer[]; vehicles: SyncVehicle[]; records: SyncRecord[] }): MatchResult {
  const p = parseFolderName(folder.name, folder.year);
  if (p.internal || p.carTokens.length === 0) return { status: '없음', candidates: [] };
  const cmap = new Map(data.customers.map((c) => [c.id, c]));
  const vByC = new Map<string, SyncVehicle[]>();
  for (const v of data.vehicles) { const a = vByC.get(v.customer_id) || []; a.push(v); vByC.set(v.customer_id, a); }
  const cands = new Map<string, MatchCandidate>();
  for (const r of data.records) {
    if (!r.customer_id) continue;
    const c = cmap.get(r.customer_id);
    if (!c || c.kind === '딜러') continue;
    if (p.date) { if (!(p.date >= plus(r.start, -4) && p.date <= plus(r.end, 4))) continue; }
    else if (!folder.month || Number(r.start.slice(5, 7)) !== folder.month) continue;
    const vs = vByC.get(c.id) || [];
    const v = vs.find((x) => x.id === r.vehicle_id) || vs.find((x) => x.is_primary) || vs[0] || null;
    const carStr = v ? normCar(`${v.brand || ''}${v.model || ''}`) : normCar(`${c.car_brand || ''}${c.car_model || ''}`);
    if (!p.carTokens.some((t) => carStr.includes(t))) continue;
    if (p.nameToken && c.name.replace(/\s+/g, '') !== p.nameToken) continue; // 성함이 있으면 같아야
    const key = `${c.id}|${v?.id || ''}`;
    const prev = cands.get(key) || { customer_id: c.id, customer: c.name, vehicle_id: v?.id || null, car: v ? `${v.brand || ''} ${v.model || ''}`.trim() : `${c.car_brand || ''} ${c.car_model || ''}`.trim(), recs: [] };
    prev.recs.push(`${r.kind} ${r.start}${r.end !== r.start ? `~${r.end}` : ''} ${r.type || ''}`.trim());
    cands.set(key, prev);
  }
  const list = [...cands.values()];
  if (list.length === 1 && list[0].vehicle_id) return { status: '확실', candidates: list };
  return { status: list.length ? '후보' : '없음', candidates: list };
}

/** CRM 읽기 (읽기만) */
export async function loadSyncData() {
  const [{ data: cs }, { data: vs, error: ve }, { data: ss }, { data: as }] = await Promise.all([
    supabase.from('customers').select('id,name,car_brand,car_model,kind'),
    supabase.from('vehicles').select('id,customer_id,brand,model,is_primary,drive_folder'),
    supabase.from('services').select('customer_id,vehicle_id,service_type,service_date'),
    supabase.from('appointments').select('customer_id,vehicle_id,service_type,appointment_date,end_date,status').neq('status', '취소'),
  ]);
  if (ve) throw new Error(`차량 표를 못 읽음: ${ve.message}`);
  const records: SyncRecord[] = [];
  for (const s of (ss || []) as { customer_id: string | null; vehicle_id: string | null; service_type: string | null; service_date: string | null }[]) if (s.service_date) records.push({ kind: '시공', customer_id: s.customer_id, vehicle_id: s.vehicle_id, start: s.service_date, end: s.service_date, type: s.service_type });
  for (const a of (as || []) as { customer_id: string | null; vehicle_id: string | null; service_type: string | null; appointment_date: string; end_date: string | null }[]) records.push({ kind: '예약', customer_id: a.customer_id, vehicle_id: a.vehicle_id, start: a.appointment_date, end: a.end_date || a.appointment_date, type: a.service_type });
  return { customers: (cs || []) as SyncCustomer[], vehicles: (vs || []) as SyncVehicle[], records };
}

/** 드라이브 읽기 5분 캐시 (폴더 id 키) */
const SUB_CACHE = new Map<string, { at: number; list: { id: string; name: string }[] }>();
async function subfolders(id: string) {
  const hit = SUB_CACHE.get(id);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.list;
  const list = await listDriveSubfolders(id);
  SUB_CACHE.set(id, { at: Date.now(), list });
  return list;
}

export interface MonthFolder { id: string; name: string; month: number; year: number }
/** 루트에서 고른 달("N월")의 차종 폴더들 (월 폴더는 병렬로 읽음) */
export async function readMonthFolders(rootId: string, months: number[], year: number): Promise<MonthFolder[]> {
  const root = await subfolders(rootId);
  const picked = root.map((f) => ({ ...f, m: Number((f.name.match(/^(\d{1,2})월$/) || [])[1]) })).filter((f) => f.m && months.includes(f.m));
  const lists = await Promise.all(picked.map(async (mf) => (await subfolders(mf.id)).map((f) => ({ id: f.id, name: f.name, month: mf.m, year }))));
  return lists.flat();
}

export interface SyncReport {
  linked: { folder: string; folderId: string; customer: string; car: string }[];
  ambiguous: { folder: string; folderId: string; candidates: string[] }[];
  unmatched: { folder: string; folderId: string }[];
  hasFolder: { folder: string; customer: string; car: string }[];
  skipped: number;
  months: number[];
}

/** 이번 달(+지난 달) 폴더를 읽어 확실한 것만 차량에 붙인다. dry 면 계산만 */
export async function syncDriveFolders({ rootFolderId = process.env.DRIVE_PHOTO_ROOT || DEFAULT_DRIVE_PHOTO_ROOT, monthsBack = 2, dry = false, today = todaySeoul() }: { rootFolderId?: string; monthsBack?: number; dry?: boolean; today?: string } = {}): Promise<SyncReport> {
  const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
  const months = Array.from({ length: monthsBack }, (_, i) => month - i).filter((m) => m >= 1); // 1월이면 지난해 12월은 지난해 루트라 안 읽음
  const [folders, data] = await Promise.all([readMonthFolders(rootFolderId, months, year), loadSyncData()]);
  const linkedIds = new Set(data.vehicles.map((v) => parseDriveFolderId(v.drive_folder || '')).filter(Boolean) as string[]);
  const vehicleHas = new Map(data.vehicles.map((v) => [v.id, !!(v.drive_folder || '').trim()]));
  const rep: SyncReport = { linked: [], ambiguous: [], unmatched: [], hasFolder: [], skipped: 0, months };
  for (const f of folders) {
    const p = parseFolderName(f.name, f.year);
    if (linkedIds.has(f.id) || p.internal || /^@/.test(f.name)) { rep.skipped++; continue; }
    const r = matchFolder(f, data);
    if (r.status === '확실') {
      const c = r.candidates[0];
      if (vehicleHas.get(c.vehicle_id!)) { rep.hasFolder.push({ folder: f.name, customer: c.customer, car: c.car }); continue; }
      if (!dry) {
        const { error } = await supabase.from('vehicles').update({ drive_folder: driveFolderUrl(f.id) }).eq('id', c.vehicle_id!).or('drive_folder.is.null,drive_folder.eq.');
        if (error) { rep.ambiguous.push({ folder: f.name, folderId: f.id, candidates: [`${c.customer} ${c.car} (기록 실패: ${error.message})`] }); continue; }
      }
      vehicleHas.set(c.vehicle_id!, true);
      rep.linked.push({ folder: f.name, folderId: f.id, customer: c.customer, car: c.car });
    } else if (r.status === '후보') rep.ambiguous.push({ folder: f.name, folderId: f.id, candidates: r.candidates.map((c) => `${c.customer} ${c.car}`) });
    else rep.unmatched.push({ folder: f.name, folderId: f.id });
  }
  return rep;
}

/** 아침 브리핑 사실 묶음 줄 — 연결·못 맞춤이 없으면 빈 배열 */
export function driveSyncFactLines(r: SyncReport | null | undefined): string[] {
  if (!r) return [];
  const ask = [...r.ambiguous.map((a) => `${a.folder}(후보: ${a.candidates.join(', ')})`), ...r.unmatched.map((u) => u.folder)];
  if (!r.linked.length && !ask.length) return [];
  const out = ['\n## 8 드라이브 새 폴더'];
  if (r.linked.length) out.push(`자동 연결 ${r.linked.length}개: ${r.linked.map((l) => `${l.folder} → ${l.customer} ${l.car}`).join(' | ')}`);
  if (ask.length) out.push(`못 맞춘 폴더 ${ask.length}개: ${ask.join(' | ')}`);
  return out;
}

/** 차량 하나에 맞는 폴더 후보 (고객 상세 '폴더 찾기') — 그 손님 기록이 있는 달만 읽음 */
export async function findFoldersForVehicle(vehicleId: string, rootFolderId = process.env.DRIVE_PHOTO_ROOT || DEFAULT_DRIVE_PHOTO_ROOT, today = todaySeoul()) {
  const data = await loadSyncData();
  const v = data.vehicles.find((x) => x.id === vehicleId);
  if (!v) return { error: '차량을 찾지 못했습니다', folders: [] as { id: string; name: string; url: string; status: string; elsewhere: boolean }[] };
  const year = Number(today.slice(0, 4));
  const recs = data.records.filter((r) => r.customer_id === v.customer_id && r.start.startsWith(String(year)));
  const months = [...new Set(recs.flatMap((r) => [Number(r.start.slice(5, 7)), Number(r.end.slice(5, 7))]))].slice(0, 6);
  if (!months.length) return { error: `${year}년 시공·예약 기록이 없어 찾을 달이 없습니다`, folders: [] };
  const folders = await readMonthFolders(rootFolderId, months, year);
  const linkedTo = new Map<string, string>();
  for (const x of data.vehicles) { const id = parseDriveFolderId(x.drive_folder || ''); if (id) linkedTo.set(id, x.id); }
  const out: { id: string; name: string; url: string; status: string; elsewhere: boolean }[] = [];
  for (const f of folders) {
    if (parseFolderName(f.name, f.year).internal) continue;
    const r = matchFolder(f, data);
    if (!r.candidates.some((c) => c.customer_id === v.customer_id)) continue;
    const other = linkedTo.get(f.id);
    out.push({ id: f.id, name: f.name, url: driveFolderUrl(f.id), status: r.status, elsewhere: !!other && other !== v.id });
  }
  return { error: null, folders: out };
}
