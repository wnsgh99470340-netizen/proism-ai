// PWA 아이콘 생성: node scripts/gen-icons.mjs
// public/icons/logo-source.jpg(2000x2000) → 192/512(any), 512 maskable(안전영역 확보), 180 apple-touch-icon
import sharp from 'sharp';
import path from 'node:path';

const SRC = path.resolve('public/icons/logo-source.jpg');
const OUT = path.resolve('public/icons');
const BG = { r: 236, g: 27, b: 48, alpha: 1 }; // 로고 배경 레드 (원본에서 샘플)

const outputs = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
];
for (const { file, size } of outputs) {
  await sharp(SRC).resize(size, size).png().toFile(path.join(OUT, file));
}

// maskable: 안드로이드가 원형/둥근사각으로 잘라도 글자가 잘리지 않게 로고를 80%로 축소하고 여백은 같은 빨강으로 채움
const inner = Math.round(512 * 0.8);
const logo = await sharp(SRC).resize(inner, inner).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: BG } })
  .composite([{ input: logo, gravity: 'centre' }])
  .png()
  .toFile(path.join(OUT, 'icon-512-maskable.png'));

console.log('icons generated:', outputs.map((o) => o.file).join(', '), 'icon-512-maskable.png');
