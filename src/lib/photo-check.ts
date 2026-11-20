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

const MAX_SAMPLE = 12; // 2026-11-20: 6장이라 장면이 부족해 글이 일반 설명으로 채워졌음(Q7 신차패키지). 12장으로

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

/**
 * 요청 범위 밖 작업이 사진에 보일 때 (2026-11-20 Q7: "실내 PPF 없음"이라고 적어 줬는데도 센터콘솔 필름 장면을 보고 실내 PPF 문단을 두 번 씀)
 * 장면 문구가 아래 그룹에 걸리는데 요청문에 그 작업이 없으면 "요청 범위 밖 — 쓰지 않는다" 표시를 붙이고 접수 요약에 알린다
 */
const SCOPE_GROUPS: { name: string; scene: RegExp; request: RegExp }[] = [
  { name: '실내 PPF', scene: /센터\s*콘솔|기어\s*(주변|노브)|센터\s*페시아|디스플레이|하이\s*글로시|하이\s*그로시|실내[^\n]{0,12}(패널|필름|트림)/, request: /실내|하이\s*글로시|하이\s*그로시|센터|콘솔|디스플레이|네비|트림/ },
  { name: '루프·스포일러 필름', scene: /루프|스포일러/, request: /루프|스포일러|전체/ },
  { name: '선루프 썬팅', scene: /선루프|썬루프|파노라마/, request: /선루프|썬루프|파노라마/ },
  { name: '신차검수', scene: /진단기|스캐너|도막|두께\s*측정|열화상|배터리/, request: /검수/ },
  { name: '휠·캘리퍼 작업', scene: /휠\s*(에|을|필름|도색)|캘리퍼/, request: /휠|캘리퍼/ },
];
function flagOutOfScope(scenes: string[], requestText: string): { scenes: string[]; out: string[] } {
  if (!requestText.trim()) return { scenes, out: [] };
  const out: string[] = [];
  const marked = scenes.map((s, i) => {
    const hit = SCOPE_GROUPS.find(g => g.scene.test(s) && !g.request.test(requestText));
    if (!hit) return s;
    out.push(`${hit.name}(${i + 1}번)`);
    return `${s} ⚠ 요청 범위에 없는 작업으로 보임(${hit.name}) — 글에 쓰지 않는다`;
  });
  return { scenes: marked, out };
}

export async function inspectPhotos(photosUrl: string, hint: { carModel?: string | null; serviceType?: string; request?: string } = {}): Promise<PhotoFacts> {
  const { files } = await listDriveFolder(photosUrl);
  const photos = files.filter(f => f.kind === 'photo');
  const sample = pickEvenly(photos, MAX_SAMPLE);
  const fetched = await Promise.all(sample.map(async f => ({ f, img: await fetchImage(f.id) })));
  const okFiles = fetched.filter(x => x.img).map(x => x.f);
  const images = fetched.map(x => x.img).filter((x): x is { data: string; mediaType: string } => Boolean(x));
  if (images.length === 0) throw new Error('드라이브 사진을 내려받지 못했습니다 (공유 설정 확인)');

  const prompt = `위 사진들은 자동차 시공점에서 찍은 ${[hint.carModel, hint.serviceType].filter(Boolean).join(' ')} 시공 사진입니다. 블로그 글을 쓰기 전에 사실을 확인하려는 것이니 보이는 것만 적고 추측하지 마세요.
JSON 한 개로만 답하세요:
{"color":"차량 외장 색상 한 단어(예: 화이트, 블랙, 그레이, 실버, 블루, 레드). 확실하지 않으면 \"불확실\"",
 "car":"보이는 차종(브랜드+모델). 확실하지 않으면 \"\"",
 "body":"차체 형태: 쿠페(2도어) / 세단(4도어) / 그란쿠페·4도어쿠페 / SUV / 해치백 / 왜건 / 컨버터블 중 하나. 도어 수를 세어 보고 확실하지 않으면 \"불확실\"",
 "roof":"루프 상태: 도장 루프 / 글라스·선루프 / 카본 루프 / 안 보임 중 하나",
 "panels":["사진에 보이는 시공 부위·패널 (본넷, 앞범퍼, 도어, 휀더, 루프, 트렁크, 뒷범퍼, 실내 등)"],
 "scenes":["사진 순서대로 한 장에 한 줄씩, 사진 수와 같은 개수로. 무엇을 어디에 어떻게 하는 장면인지 구체적으로 (예: 앞유리 상단 가장자리에 열풍기로 필름을 맞추는 중 / 도어 유리에 시공액이 흥건한 상태로 스퀴지 작업 / 트렁크 쪽에서 본 완성 전경)"],
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
  const panels = list(j.panels), rawScenes = list(j.scenes, MAX_SAMPLE), notes = list(j.notes, 6), unsure = list(j.unsure, 4);
  // 장면에 폴더 안 순번·파일명을 붙인다 → 글이 [사진 N]을 이 장면에 맞춰 쓰고, 사장님은 그 순서대로 올리면 된다
  const numbered = rawScenes.map((s, i) => {
    const f = okFiles[i];
    const idx = f ? photos.findIndex(p => p.id === f.id) + 1 : 0;
    return f ? `${i + 1}번(폴더 ${idx}번째 ${f.name}): ${s.replace(/^사진\s*\d+\s*[:：]\s*/, '')}` : s;
  });
  const { scenes, out: outOfScope } = flagOutOfScope(numbered, hint.request || '');

  const context = [
    '[사진 확인 결과 — 작성 전 실제 시공 사진을 확인한 사실. 요청·이 블록과 어긋나는 차량 색상·부위·장면은 쓰지 않는다]',
    `- 사진 ${photos.length}장 중 ${images.length}장 확인`,
    `- 차량 색상: ${color}${color === '불확실' ? ' (색을 모르면 글에서 색 이야기를 하지 않는다)' : ''}`,
    car ? `- 사진 속 차종: ${car}` : '',
    // 2026-11-13 4시리즈 쿠페를 그란쿠페(도어 4짝)로 쓴 일: 차체 형태·루프는 사진과 요청을 따르고 조사 자료를 따르지 않는다
    body && body !== '불확실' ? `- 차체 형태: ${body} (조사 자료에 다른 차체가 섞여 있어도 이것을 따른다. 도어 수·루프 구조를 다르게 쓰지 않는다)` : '',
    roof && roof !== '안 보임' ? `- 루프: ${roof}${/글라스|선루프|카본/.test(roof) ? ' (루프에 필름을 올리는 묘사 금지)' : ''}` : '',
    panels.length ? `- 보이는 부위: ${panels.join(', ')}` : '',
    scenes.length ? `- 장면(이 글의 재료. 장면이 있는 일은 그 장면으로 쓰고, 사진에 없는 과정은 일반 설명으로 채우지 않는다. 사진 배치는 대표가 직접 하니 글에 사진 번호를 쓰지 않는다):\n  ${scenes.join('\n  ')}` : '',
    notes.length ? `- 참고: ${notes.join(' / ')}` : '',
    unsure.length ? `- 불확실(쓰지 않기): ${unsure.join(' / ')}` : '',
    outOfScope.length ? `- 요청 범위 밖으로 보이는 장면(이 작업은 하지 않은 것으로 본다. 글에 쓰지 않는다): ${outOfScope.join(', ')}` : '',
  ].filter(Boolean).join('\n');
  // 2026-11-20 사장님 "규칙에서 사진도 빼, 사진은 알아서 넣을 테니까": 글에 사진 번호를 안 쓰므로 순서 줄도 안 보여 준다
  const summary = `📷 사진 ${photos.length}장 확인 — 차량 색상 ${color}${body && body !== '불확실' ? `, 차체 ${body}` : ''}${panels.length ? `, 보이는 부위 ${panels.slice(0, 5).join('·')}` : ''}`
    + (outOfScope.length ? `\n⚠ 사진에 요청 범위 밖 작업이 보여 글에 안 썼습니다: ${outOfScope.join(', ')} — 실제로 했으면 알려 주세요` : '');
  return { count: photos.length, sampled: images.length, color, car, body, roof, panels, scenes, notes, unsure, context, summary };
}

/** [사진 확인 결과] 블록에서 차량 색상만 꺼낸다 (검사용) */
export function photoColorFromContext(context: string | null | undefined): string | null {
  const m = (context || '').match(/- 차량 색상: ([^\n(]+)/);
  const c = m ? m[1].trim() : '';
  return c && c !== '불확실' ? c : null;
}
