/**
 * 구글 드라이브 공유 폴더에서 사진 목록 읽기 (2026-11-11, 영상 자동 제작용)
 * - 사장님이 "링크가 있는 모든 사용자 보기"로 공유한 폴더 링크를 받는다
 * - 키 없이 동작하는 embeddedfolderview 페이지를 읽고, GOOGLE_API_KEY 가 있으면 Drive API 로 대신 읽는다
 * - 결과는 파일 id·이름·내려받기 주소만. 사진 자체는 깃허브 액션(렌더 단계)에서 내려받는다
 */

export interface DriveFile {
  id: string;
  name: string;
  /** 원본 내려받기 주소 (uc?export=download) */
  url: string;
  /** 미리보기용 축소 이미지 주소 (사진만) */
  thumb?: string;
  kind: 'photo' | 'video' | 'other';
}

const IMAGE_RE = /\.(jpe?g|png|heic|heif|webp)$/i;
const VIDEO_RE = /\.(mp4|mov|m4v)$/i;

export function parseDriveFolderId(link: string): string | null {
  const s = link.trim();
  const m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : null;
}

export function driveDownloadUrl(id: string): string {
  return `https://drive.google.com/uc?export=download&id=${id}`;
}

export function driveThumbUrl(id: string, size = 1600): string {
  return `https://lh3.googleusercontent.com/d/${id}=s${size}`;
}

function kindOf(name: string, mime?: string): DriveFile['kind'] {
  if ((mime && mime.startsWith('image/')) || IMAGE_RE.test(name)) return 'photo';
  if ((mime && mime.startsWith('video/')) || VIDEO_RE.test(name)) return 'video';
  return 'other';
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** 키 없이: 공개 폴더의 embeddedfolderview 페이지에서 파일 id·이름을 읽는다 */
async function listViaEmbeddedView(folderId: string): Promise<DriveFile[]> {
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${folderId}#list`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36', 'Accept-Language': 'ko,en;q=0.8' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`드라이브 폴더를 열 수 없습니다 (HTTP ${res.status}). 공유 설정이 "링크가 있는 모든 사용자"인지 확인해 주세요.`);
  const html = await res.text();
  const out: DriveFile[] = [];
  const seen = new Set<string>();
  // <div class="flip-entry" id="entry-FILEID"> ... <div class="flip-entry-title">이름</div>
  const re = /id="entry-([A-Za-z0-9_-]{10,})"[\s\S]*?class="flip-entry-title">([^<]*)</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const name = decodeEntities(m[2].trim());
    const kind = kindOf(name);
    out.push({ id, name, url: driveDownloadUrl(id), thumb: kind === 'photo' ? driveThumbUrl(id) : undefined, kind });
  }
  if (out.length === 0 && /\bsignin\b|accounts\.google\.com/i.test(html)) {
    throw new Error('드라이브 폴더가 비공개입니다. 폴더 공유를 "링크가 있는 모든 사용자 보기"로 바꿔 주세요.');
  }
  return out;
}

/** GOOGLE_API_KEY 가 있을 때: Drive API v3 로 읽는다 (하위 폴더는 보지 않음) */
async function listViaApi(folderId: string, apiKey: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000&key=${apiKey}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`드라이브 API 오류 (HTTP ${res.status})`);
    const data = await res.json() as { nextPageToken?: string; files?: { id: string; name: string; mimeType: string }[] };
    for (const f of data.files || []) {
      const kind = kindOf(f.name, f.mimeType);
      out.push({ id: f.id, name: f.name, url: `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&key=${apiKey}`, thumb: kind === 'photo' ? driveThumbUrl(f.id) : undefined, kind });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

/**
 * 공유 폴더 링크 → 사진·영상 파일 목록 (파일명 소문자 오름차순).
 * 사진이 없으면 에러 메시지를 돌려준다 (호출한 쪽에서 사용자에게 보여줌).
 */
export async function listDriveFolder(link: string): Promise<{ folderId: string; files: DriveFile[] }> {
  const folderId = parseDriveFolderId(link);
  if (!folderId) throw new Error('구글 드라이브 폴더 링크가 아닙니다. 폴더 주소(…/drive/folders/…)를 넣어 주세요.');
  const apiKey = process.env.GOOGLE_API_KEY;
  let files: DriveFile[] = [];
  if (apiKey) {
    try { files = await listViaApi(folderId, apiKey); } catch (e) { console.warn('[drive] api failed, fallback to embedded view:', e); }
  }
  if (files.length === 0) files = await listViaEmbeddedView(folderId);
  files = files
    .filter(f => f.kind !== 'other')
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'en'));
  if (files.filter(f => f.kind === 'photo').length === 0) {
    throw new Error('폴더에서 사진(JPG/PNG)을 찾지 못했습니다. 사진이 폴더 바로 아래에 있는지, 공유가 "링크가 있는 모든 사용자"인지 확인해 주세요.');
  }
  return { folderId, files };
}
