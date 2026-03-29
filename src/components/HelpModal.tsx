'use client';

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

export default function HelpModal({ open, onClose }: HelpModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#111113] border border-[#1e1e22] rounded-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[#fafaf9] font-bold text-base">사용 가이드</h2>
            <button onClick={onClose} className="text-[#71717a] hover:text-[#fafaf9] text-lg">×</button>
          </div>

          <div className="space-y-4 text-sm text-[#a1a1aa] leading-relaxed">
            <div>
              <h3 className="text-[#C8A951] font-semibold mb-1.5">1단계: 프로그램 켜기</h3>
              <p>브라우저(크롬, 엣지 등)를 열고 주소창에 <span className="text-[#fafaf9] bg-[#1e1e22] px-1.5 py-0.5 rounded text-xs">localhost:3000</span> 을 입력하면 이 화면이 나옵니다.</p>
            </div>

            <div>
              <h3 className="text-[#C8A951] font-semibold mb-1.5">2단계: 사진 올리기</h3>
              <p>화면 아래쪽 <span className="text-[#fafaf9]">"📷 사진을 드래그하거나 클릭"</span> 부분을 누르세요.</p>
              <p className="mt-1">파일 선택 창이 뜨면 시공 사진을 선택합니다. 여러 장 한번에 가능!</p>
              <p className="mt-1">또는 바탕화면의 사진을 끌어다가 놓아도 됩니다.</p>
              <p className="mt-1 text-[#71717a]">→ AI가 자동으로 사진을 분석해서 차종, 시공 단계를 알려줍니다.</p>
            </div>

            <div>
              <h3 className="text-[#C8A951] font-semibold mb-1.5">3단계: 글 작성 요청</h3>
              <p>아래 입력창에 이렇게 써보세요:</p>
              <div className="bg-[#1e1e22] rounded-lg p-2.5 mt-1.5 text-xs text-[#fafaf9] space-y-1">
                <p>"BMW M4 전체 PPF 시공기 써줘"</p>
                <p>"벤츠 E클래스 썬팅 후기 작성해줘"</p>
                <p>"포르쉐 카이엔 PPF 블로그 글 만들어줘"</p>
              </div>
              <p className="mt-1 text-[#71717a]">→ AI가 3M 프로이즘 스타일로 블로그 글을 작성합니다.</p>
            </div>

            <div>
              <h3 className="text-[#C8A951] font-semibold mb-1.5">4단계: 수정하기</h3>
              <p>글이 맘에 안 들면 그냥 말하듯 수정 요청하세요:</p>
              <div className="bg-[#1e1e22] rounded-lg p-2.5 mt-1.5 text-xs text-[#fafaf9] space-y-1">
                <p>"첫 번째 문단 좀 더 자연스럽게 바꿔줘"</p>
                <p>"사진 순서 바꿔줘"</p>
                <p>"마지막에 예약 안내 넣어줘"</p>
              </div>
            </div>

            <div>
              <h3 className="text-[#C8A951] font-semibold mb-1.5">5단계: 네이버에 올리기</h3>
              <p>오른쪽 미리보기에서 <span className="text-[#fafaf9]">"📋 HTML 복사"</span> 버튼을 누르세요.</p>
              <p className="mt-1">→ 네이버 블로그 에디터를 열고</p>
              <p>→ 상단 메뉴에서 <span className="text-[#fafaf9]">"HTML"</span> 모드 클릭</p>
              <p>→ <span className="text-[#fafaf9]">Ctrl+V</span> (붙여넣기)</p>
              <p>→ 다시 "에디터" 모드로 돌아오면 예쁘게 적용됩니다!</p>
            </div>

            <div className="border-t border-[#1e1e22] pt-3">
              <h3 className="text-[#C8A951] font-semibold mb-1.5">유용한 기능</h3>
              <div className="space-y-1 text-xs">
                <p>• <span className="text-[#fafaf9]">"QA 채점"</span> 버튼 → 글 품질 점수 확인 (85점 이상 추천)</p>
                <p>• <span className="text-[#fafaf9]">"인사이트"</span> 탭 → SEO 점수, 키워드 추천</p>
                <p>• 상단 팀원 아이콘 → 누가 작업 중인지 확인</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
