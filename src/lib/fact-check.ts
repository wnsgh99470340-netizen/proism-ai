/**
 * 제품·시공 팩트체크 (결정론적).
 * 근거: CLAUDE.md "제품 스펙"·"시공 규칙", proism_context_full_v2.md 4절.
 * 점수를 매기지 않는다. 사실과 어긋나는 문장만 잡아 "빼기/고치기" 수정에 넘긴다.
 */

export interface FactIssue {
  rule: string;
  detail: string;
}

interface FactInput {
  body: string;
  serviceType: string;   // 'PPF' | '컬러PPF(PWF)' | '랩핑' | '크롬죽이기' | '썬팅' | '신차패키지' | '실내PPF' | '유리막코팅' | '시공'
  product?: string;      // 폼에서 고른 제품 (없을 수 있음)
}

/** 문장 단위로 나눈다 (줄바꿈·마침표 기준) */
function sentences(body: string): string[] {
  return body.split(/(?<=[.!?。])\s+|\n+/).map(s => s.trim()).filter(Boolean);
}

function firstMatch(body: string, re: RegExp): string | null {
  const m = body.match(re);
  return m ? m[0].slice(0, 40) : null;
}

export function factCheck({ body, serviceType, product = '' }: FactInput): FactIssue[] {
  const issues: FactIssue[] = [];
  const svc = serviceType;
  const isPPF = /^PPF$/.test(svc) || svc === '신차패키지';
  const isInteriorPPF = svc === '실내PPF';
  const isPWF = /PWF|컬러PPF/.test(svc);
  const isWrap = svc === '랩핑';
  const isChrome = svc === '크롬죽이기';
  const isTint = svc === '썬팅' || svc === '신차패키지';
  const sents = sentences(body);

  // F1. 시리즈50·시리즈100 에서 발수코팅 언급 금지
  if (/시리즈\s*(50|100)\b/.test(body) || /시리즈\s*(50|100)/.test(product)) {
    const hits = sents.filter(s => /발수/.test(s)).map(s => s.trim().slice(0, 40));
    if (hits.length > 0) issues.push({ rule: 'hydrophobic_50_100', detail: `시리즈50·100 글에서는 발수코팅을 한 번도 언급하지 않는다(다른 등급과 비교하는 문장도 포함). 다음 ${hits.length}개 문장을 모두 삭제: ${hits.map(h => `"${h}"`).join(', ')}` });
  }

  // F2. 랩핑·PWF·크롬죽이기는 건식 — "습식"으로 서술 금지 (PPF·썬팅 비교 문장은 허용)
  if (isWrap || isPWF || isChrome) {
    const hit = sents.find(s => /습식/.test(s) && !/PPF|썬팅|틴팅/.test(s));
    if (hit) issues.push({ rule: 'dry_process', detail: `${svc}은 건식 시공인데 습식으로 서술: "${hit.slice(0, 40)}"` });
  }

  // F3. PPF 외부 패널에 컴퓨터 재단·플로터 언급 금지 (실내 문맥만 허용)
  if (isPPF || isPWF) {
    const hit = sents.find(s => /컴퓨터\s*재단|플로터|기계\s*재단|컷팅\s*기계|프리컷|프리\s*컷/.test(s) && !/실내|도어\s*컵|도어\s*엣지|피아노\s*블랙|트림|콘솔/.test(s));
    if (hit) issues.push({ rule: 'computer_cut_exterior', detail: `외부 PPF는 판시공 핸드커팅. 컴퓨터 재단 언급: "${hit.slice(0, 40)}"` });
  }

  // F4. QC 2주는 PPF·컬러PPF·PWF 만. 랩핑·썬팅·크롬죽이기 글에 QC 언급 금지
  if (isWrap || isChrome || svc === '썬팅') {
    const m = firstMatch(body, /QC[^\n]{0,20}|[^\n]{0,10}품질\s*점검\s*기간[^\n]{0,10}/i);
    if (m) issues.push({ rule: 'qc_scope', detail: `${svc}에는 QC 기간이 없음: "${m}"` });
  }

  // F5. 크리스탈라인 겹수·농도 오류
  if (/크리스탈\s*라인|크리스탈라인/.test(body) || /크리스탈라인/.test(product)) {
    const m240 = firstMatch(body, /2[0-9]{2}\s*겹/);
    if (m240 && !/^200\s*겹/.test(m240) && !/200\s*겹\s*이상/.test(body)) {
      issues.push({ rule: 'crystalline_layers', detail: `크리스탈라인은 "MOF 200겹 이상"으로만: "${m240}"` });
    }
    const badDensity = firstMatch(body, /(?:전면|측후면|측면|후면|농도)[^\n]{0,12}\b(?:30|15|35|25)\s*(?:%|퍼센트)?/);
    if (badDensity) issues.push({ rule: 'crystalline_density', detail: `크리스탈라인 농도는 20/40/50/60/70만: "${badDensity}"` });
  }

  // F6. 썬팅 열성형은 "수축". "늘린다/당긴다"로 서술 금지. 필름 제거에 히팅건 금지(스팀기)
  if (isTint) {
    const stretch = firstMatch(body, /(?:필름을|열로|열을\s*가해)[^\n]{0,15}(?:늘[려리]|당[겨기]|잡아당)/);
    if (stretch) issues.push({ rule: 'tint_shrink', detail: `썬팅 열성형은 필름을 수축시키는 것: "${stretch}"` });
    const removal = sents.find(s => /(?:제거|탈거|벗겨|떼어)/.test(s) && /히팅\s*건|열풍기|드라이기/.test(s));
    if (removal) issues.push({ rule: 'tint_removal_steam', detail: `기존 필름 제거는 스팀기로: "${removal.slice(0, 40)}"` });
  }

  // F7. 랩핑 관리: 고체왁스·유리막코팅 권장 금지 (물왁스만)
  if (isWrap) {
    const hit = sents.find(s => /(?:고체\s*왁스|유리막\s*코팅)/.test(s) && /(?:추천|권장|해\s*주|하시면|주시면|올[리려]|시공해|바르)/.test(s) && !/(?:금지|안\s*됩|하지\s*마|피하)/.test(s));
    if (hit) issues.push({ rule: 'wrap_care', detail: `랩핑 위에는 고체왁스·유리막코팅 금지(물왁스만): "${hit.slice(0, 40)}"` });
  }

  // F8. 팀장님·작업자 소개 금지 (2026-11-11 이팀장님 퇴사. 썬팅도 시공 내용으로만) / 대표 정비소 운영 서술
  {
    const m = firstMatch(body, /(?:이\s*)?팀장님?|하루\s*한\s*대|1인\s*시공|출장\s*(?:작업|시공|기사)/);
    if (m) issues.push({ rule: 'team_leader', detail: `작업자 소개 금지(팀장님·1인 시공·하루 한 대·출장 작업자). 해당 문장을 빼고 시공 내용으로 채울 것: "${m}"` });
  }
  const garage = firstMatch(body, /정비소[를을]?\s*(?:운영|차렸|했었)/);
  if (garage) issues.push({ rule: 'owner_history', detail: `대표는 BMW 서비스센터 근무 이력(정비소 운영 아님): "${garage}"` });

  // F9. PPF·PWF 글에 타사 필름 브랜드 언급 금지 (제품은 사용자가 알려준 것만)
  if (isPPF || isPWF || isInteriorPPF) {
    const m = firstMatch(body, /XPEL|엑스펠|STEK|스텍|SunTek|썬텍|NOBLE|노블\s*필름|KAVACA|카바카/i);
    if (m) issues.push({ rule: 'foreign_brand', detail: `프로이즘이 쓰지 않는 필름 브랜드: "${m}"` });
  }

  // F10. 투명 PPF의 "투명도가 높아 색감 유지"는 당연한 말 — 금지 (시리즈50은 광택 깊이감으로)
  if (isPPF || isInteriorPPF) {
    const m = firstMatch(body, /투명도[가도]?\s*(?:높|좋|뛰어)[^\n]{0,20}/);
    if (m) issues.push({ rule: 'transparency_cliche', detail: `"투명도가 높다"류 서술 금지: "${m}"` });
  }

  // F11. PPF 라인업 두께 오기 (185/190/200 외)
  if (isPPF || isInteriorPPF) {
    const m = firstMatch(body, /\b(?!185|190|200)\d{3}\s*(?:μm|㎛|마이크로|미크론)/);
    if (m) issues.push({ rule: 'ppf_thickness', detail: `PPF 두께는 185/190/200μm만: "${m}"` });
    const pair = body.match(/시리즈\s*(50|100|150)[^\n]{0,15}(\d{3})\s*(?:μm|㎛|마이크로)/);
    if (pair) {
      const expect: Record<string, string> = { '50': '185', '100': '190', '150': '190' };
      if (expect[pair[1]] !== pair[2]) issues.push({ rule: 'ppf_thickness', detail: `시리즈${pair[1]}은 ${expect[pair[1]]}μm: "${pair[0].slice(0, 40)}"` });
    }
  }

  // F12. 제품 혼동: PWF를 랩핑 필름이라고 쓰거나, 랩핑 글에서 PWF를 썼다고 쓰는 경우
  if (isPWF) {
    const m = firstMatch(body, /PWF[^\n]{0,10}(?:랩핑\s*필름|2080)/);
    if (m) issues.push({ rule: 'pwf_vs_wrap', detail: `PWF는 컬러PPF(랩핑 아님): "${m}"` });
  }
  if (isWrap || isChrome) {
    const m = firstMatch(body, /PWF/);
    if (m && !/PWF[^\n]{0,20}(?:달리|다르|아닌|와는)/.test(body)) issues.push({ rule: 'pwf_vs_wrap', detail: `${svc} 글에 PWF 언급(제품은 3M 2080)` });
  }

  return issues;
}
