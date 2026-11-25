/**
 * 폰 사진을 1600px 로 줄여 /api/care/photo(Blob uploads/care/) 에 올린다 (2026-11-25, 점검 기록 창의 코드를 공용으로)
 * 작업 내역서 완료 때 작업 사진, QC·메인터넌스 점검 사진이 같이 쓴다. 비전 읽기 없음
 */
export async function resizeAndUploadPhoto(file: File, maxEdge = 1600): Promise<{ url: string } | { error: string }> {
  if (!/^image\//.test(file.type)) return { error: '이미지 파일만 올릴 수 있습니다' };
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  const res = await fetch('/api/care/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: dataUrl.split(',')[1], mediaType: 'image/jpeg', name: file.name }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) return { error: j.error || '사진 업로드 실패' };
  return { url: j.url as string };
}
