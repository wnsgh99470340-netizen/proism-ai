/**
 * 글 작성 전 사진 확인 (2026-11-12 사장님: "사진 주소 넣어주면 사진부터 확인하고 글 작업 들어가야".
 * 사진은 흰 차인데 색을 안 적었더니 글이 블랙으로 썼던 일)
 * - 드라이브 폴더의 사진 중 고르게 몇 장을 내려받아 Claude 비전으로 차량 색상·보이는 부위·장면을 읽는다
 * - 결과는 작성 프롬프트의 [사진 확인 결과] 블록과 접수 메시지 한 줄로 쓴다
 * - 사진을 못 읽어도 글 작성은 계속한다 (호출한 쪽에서 실패 메시지만 남김)
 */
import { listDriveFolder, driveThumbUrl } from './drive';
import { analyzeImagesWithClaude } from './claude-client';

export interface PhotoFacts {
  count: number;
  sampled: number;
  color: string;
  car: string;
  /** 차체 형태(쿠페·세단·SUV…) / 루프 상태(도장·글라스·카본) — 2026-11-13 */
  body: string;
  roof: string;
  panels: string[];
  scenes: string[];
  notes: string[];
  unsure: string[];
  /** 시스템 프롬프트에 붙이는 블록 */
  context: string;
  /** 사용자에게 보여줄 한 줄 */
  summary: string;
}

const MAX_SAMPLE = 6;

function pickEvenly<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (n - 1))]);
  return Array.from(new Set(out));
}

async function fetchImage(id: string): Promise<{ data: string; mediaType: string } | null> {
  try {
    const res = await fetch(driveThumbUrl(id, 1200), { cache: 'no-store', redirect: 'follow' });
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!/^image\/(jpeg|png|webp|gif)$/.test(ct)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000 || buf.length > 5 * 1024 * 1024) return null;
    return { data: buf.toString('base64'), mediaType: ct };
  } catch {
    return null;
  }
}

const list = (v: unknown, max = 8): string[] => (Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean).slice(0, max) : []);

export async function inspectPhotos(photosUrl: string, hint: { carModel?: string | null; serviceType?: string } = {}): Promise<PhotoFacts> {
  const { files } = await listDriveFolder(photosUrl);
  const photos = files.filter(f => f.kind === 'photo');
  const sample = pickEvenly(photos, MAX_SAMPLE);
  const images = (await Promise.all(sample.map(f => fetchImage(f.id)))).filter((x): x is { data: string; mediaType: string } => Boolean(x));
  if (images.length === 0) throw new Error('드라이브 사진을 내려받지 못했습니다 (공유 설정 확인)');

  const prompt = `위 사진들은 자동차 시공점에서 찍은 ${[hint.carModel, hint.serviceType].filter(Boolean).join(' ')} 시공 사진입니다. 블로그 글을 쓰기 전에 사실을 확인하려는 것이니 보이는 것만 적고 추측하지 마세요.
JSON 한 개로만 답하세요:
{"color":"차량 외장 색상 한 단어(예: 화이트, 블랙, 그레이, 실버, 블루, 레드). 확실하지 않으면 \"불확실\"",
 "car":"보이는 차종(브랜드+모델). 확실하지 않으면 \"\"",
 "body":"차체 형태: 쿠페(2도어) / 세단(4도어) / 그란쿠페·4도어쿠페 / SUV / 해치백 / 왜건 / 컨버터블 중 하나. 도어 수를 세어 보고 확실하지 않으면 \"불확실\"",
 "roof":"루프 상태: 도장 루프 / 글라스·선루프 / 카본 루프 / 안 보임 중 하나",
 "panels":["사진에 보이는 시공 부위·패널 (본넷, 앞범퍼, 도어, 휀더, 루프, 트렁크, 뒷범퍼, 실내 등)"],
 "scenes":["사진 순서대로 장면 요약 1줄씩 (예: 본넷 필름 밀착 중, 엠블럼 탈거 상태, 완성 전경)"],
 "notes":["글에 쓸 만한 눈에 띄는 사실 (엠블럼·손잡이 탈거 여부, 마스킹, 실내/실외, 특별한 장비 등)"],
 "unsure":["확실하지 않은 것"]}`;
  const raw = await analyzeImagesWithClaude(images, prompt);
  const m = raw.match(/\{[\s\S]*\}/);
  let j: Record<string, unknown> = {};
  try { if (m) j = JSON.parse(m[0]) as Record<string, unknown>; } catch { /* 아래 기본값 */ }

  const color = String(j.color || '불확실').trim() || '불확실';
  const car = String(j.car || '').trim();
  const body = String(j.body || '').trim();
  const roof = String(j.roof || '').trim();
  const panels = list(j.panels), scenes = list(j.scenes), notes = list(j.notes, 6), unsure = list(j.unsure, 4);

  const context = [
    '[사진 확인 결과 — 작성 전 실제 시공 사진을 확인한 사실. 요청·이 블록과 어긋나는 차량 색상·부위·장면은 쓰지 않는다]',
    `- 사진 ${photos.length}장 중 ${images.length}장 확인`,
    `- 차량 색상: ${color}${color === '불확실' ? ' (색을 모르면 글에서 색 이야기를 하지 않는다)' : ''}`,
    car ? `- 사진 속 차종: ${car}` : '',
    // 2026-11-13 4시리즈 쿠페를 그란쿠페(도어 4짝)로 쓴 일: 차체 형태·루프는 사진과 요청을 따르고 조사 자료를 따르지 않는다
    body && body !== '불확실' ? `- 차체 형태: ${body} (조사 자료에 다른 차체가 섞여 있어도 이것을 따른다. 도어 수·루프 구조를 다르게 쓰지 않는다)` : '',
    roof && roof !== '안 보임' ? `- 루프: ${roof}${/글라스|선루프|카본/.test(roof) ? ' (루프에 필름을 올리는 묘사 금지)' : ''}` : '',
    panels.length ? `- 보이는 부위: ${panels.join(', ')}` : '',
    scenes.length ? `- 장면: ${scenes.join(' / ')}` : '',
    notes.length ? `- 참고: ${notes.join(' / ')}` : '',
    unsure.length ? `- 불확실(쓰지 않기): ${unsure.join(' / ')}` : '',
  ].filter(Boolean).join('\n');
  const summary = `📷 사진 ${photos.length}장 확인 — 차량 색상 ${color}${body && body !== '불확실' ? `, 차체 ${body}` : ''}${panels.length ? `, 보이는 부위 ${panels.slice(0, 5).join('·')}` : ''}`;
  return { count: photos.length, sampled: images.length, color, car, body, roof, panels, scenes, notes, unsure, context, summary };
}

/** [사진 확인 결과] 블록에서 차량 색상만 꺼낸다 (검사용) */
export function photoColorFromContext(context: string | null | undefined): string | null {
  const m = (context || '').match(/- 차량 색상: ([^\n(]+)/);
  const c = m ? m[1].trim() : '';
  return c && c !== '불확실' ? c : null;
}
