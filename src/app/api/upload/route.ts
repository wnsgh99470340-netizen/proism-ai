import { NextRequest } from 'next/server';
import { writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const TARGET_SIZE = 4 * 1024 * 1024; // 4MB

async function compressImage(buffer: Buffer, mimeType: string): Promise<Buffer> {
  const isImage = mimeType.startsWith('image/');
  if (!isImage) return buffer;

  let quality = 80;
  let result = await sharp(buffer).jpeg({ quality }).toBuffer();

  while (result.length > TARGET_SIZE && quality > 10) {
    quality -= 10;
    result = await sharp(buffer).jpeg({ quality }).toBuffer();
  }

  // 품질만으로 부족하면 리사이즈
  if (result.length > TARGET_SIZE) {
    const metadata = await sharp(buffer).metadata();
    let width = metadata.width || 1920;
    while (result.length > TARGET_SIZE && width > 400) {
      width = Math.floor(width * 0.7);
      result = await sharp(buffer)
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer();
    }
  }

  return result;
}

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
    // 5MB 초과 이미지는 JPEG로 변환되므로 확장자 변경
    const bytes = await file.arrayBuffer();
    const originalBuffer = Buffer.from(bytes);
    let buffer: Buffer<ArrayBuffer> = originalBuffer;
    const needsCompress = buffer.length > MAX_SIZE && file.type.startsWith('image/');
    const ext = needsCompress ? '.jpg' : '';
    const baseFilename = safeName.replace(/\.[^.]+$/, '');
    const filename = needsCompress
      ? `${timestamp}_${baseFilename}${ext}`
      : `${timestamp}_${safeName}`;

    // 5MB 초과 시 자동 압축
    if (needsCompress) {
      buffer = await compressImage(buffer, file.type) as Buffer<ArrayBuffer>;
    }

    // 저장 경로
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    const filePath = path.join(uploadDir, filename);

    // 파일 저장
    await writeFile(filePath, buffer);

    const url = `/uploads/${filename}`;

    return Response.json({
      url,
      filename,
      compressed: needsCompress,
      originalSize: originalBuffer.length,
      finalSize: buffer.length,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '업로드 실패';
    return Response.json({ error: msg }, { status: 500 });
  }
}
