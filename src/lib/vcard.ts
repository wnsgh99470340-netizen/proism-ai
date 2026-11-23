/**
 * 고객을 폰 연락처에 저장 (2026-11-23 사장님 "고객 목록의 고객들, 버튼 한 번이면 내 연락처에 저장되게")
 * - 연락처 쓰기 API 는 브라우저에 없다 → vCard(.vcf) 파일을 만들어 폰에 넘긴다. 폰이 그 파일을 열면 연락처 앱이 "저장" 을 묻는다
 * - 여러 명은 vCard 를 한 파일에 이어 붙인다(안드로이드·아이폰 연락처 앱 모두 한 번에 여러 명 가져오기 지원)
 * - 이름 뒤에 차종을 붙여 전화가 올 때 누구인지 바로 보이게 ("김수희 기아 EV3"), 회사 칸은 "프로이즘 고객"/"딜러"
 */
import { isMobileDevice } from './device';

export interface ContactInput {
  name: string;
  phone: string | null | undefined;
  /** 차종 등 이름 뒤에 붙일 말 */
  tag?: string | null;
  /** 회사 칸 (기본 '프로이즘 고객') */
  org?: string | null;
  note?: string | null;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\;');

/** vCard 3.0 한 장. 전화가 없으면 null */
export function buildVCard(c: ContactInput): string | null {
  const digits = (c.phone || '').replace(/\D/g, '');
  if (digits.length < 9) return null;
  const name = (c.name || '').trim() || '고객';
  const fn = [name, (c.tag || '').trim()].filter(Boolean).join(' ');
  const lines = [
    'BEGIN:VCARD', 'VERSION:3.0',
    `N:${esc(name)};;;;`,
    `FN:${esc(fn)}`,
    `ORG:${esc((c.org || '프로이즘 고객').trim())}`,
    `TEL;TYPE=CELL:${digits}`,
  ];
  if (c.note && c.note.trim()) lines.push(`NOTE:${esc(c.note.trim())}`);
  lines.push('END:VCARD');
  return lines.join('\r\n') + '\r\n';
}

/** 여러 명을 한 파일로. 전화 없는 분은 빠진다 → { text, count } */
export function buildVCards(list: ContactInput[]): { text: string; count: number } {
  const cards = list.map(buildVCard).filter((v): v is string => !!v);
  return { text: cards.join(''), count: cards.length };
}

/** .vcf 를 폰에 넘긴다: 폰이면 공유창(연락처 앱 고르기), 아니면 내려받기. 돌려준 값 = 어떻게 넘겼는지 */
export async function deliverVcf(text: string, filename: string): Promise<'shared' | 'downloaded' | 'failed'> {
  if (typeof window === 'undefined' || !text) return 'failed';
  const file = new File([text], filename, { type: 'text/vcard' });
  try {
    if (isMobileDevice() && typeof navigator !== 'undefined' && 'share' in navigator && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') return 'shared'; // 공유창을 닫은 것
    /* 아래 내려받기로 */
  }
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/vcard;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return 'downloaded';
  } catch { return 'failed'; }
}

export const VCF_HINT = {
  shared: '공유창에서 "연락처"를 고르면 저장됩니다.',
  downloaded: '내려받은 .vcf 파일을 열면 연락처 앱이 저장을 묻습니다. (폰: 알림의 파일을 누르기 / PC: 파일을 열거나 구글 주소록에 가져오기)',
  failed: '파일을 만들지 못했습니다.',
} as const;
