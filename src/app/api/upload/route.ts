import { NextRequest } from 'next/server';
import { writeFile, readFile } from 'fs/promises';
import path from 'path';
import { analyzeImage } from '@/lib/image-analyzer';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return Response.json({ error: '파일이 없습니다.' }, { status: 400 });
    }

    // 파일명 생성 (타임스탬프 + 원본 파일명)
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${timestamp}_${safeName}`;

    // 저장 경로
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    const filePath = path.join(uploadDir, filename);

    // 파일 저장
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filePath, buffer);

    const url = `/uploads/${filename}`;

    // Claude Vision으로 자동 분석
    let analysis = null;
    try {
      const base64Data = buffer.toString('base64');
      const mediaType = file.type || 'image/jpeg';
      analysis = await analyzeImage(base64Data, mediaType);
    } catch {
      // API 키 없거나 분석 실패 시 null
      analysis = null;
    }

    return Response.json({
      url,
      filename,
      analysis,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '업로드 실패';
    return Response.json({ error: msg }, { status: 500 });
  }
}
