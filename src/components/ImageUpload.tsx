'use client';

import { useCallback, useState, useRef } from 'react';

interface UploadedImage {
  url: string;
  filename: string;
  file: File;
  analysis?: {
    vehicle: string;
    stage: string;
    description: string;
    suggestion: string;
    recommendedPosition: string;
    caption: string;
  } | null;
}

interface ImageUploadProps {
  images: UploadedImage[];
  onImagesChange: (images: UploadedImage[]) => void;
  onAnalysisComplete?: (results: UploadedImage[]) => void;
}

export default function ImageUpload({ images, onImagesChange, onAnalysisComplete }: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      setUploading(true);
      const newImages: UploadedImage[] = [];

      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;

        const formData = new FormData();
        formData.append('file', file);

        try {
          const res = await fetch('/api/upload', { method: 'POST', body: formData });
          const data = await res.json();

          if (data.url) {
            newImages.push({
              url: data.url,
              filename: data.filename,
              file,
              analysis: data.analysis,
            });
          }
        } catch {
          // 업로드 실패 시 로컬 URL로 대체
          newImages.push({
            url: URL.createObjectURL(file),
            filename: file.name,
            file,
            analysis: null,
          });
        }
      }

      const updated = [...images, ...newImages];
      onImagesChange(updated);
      if (onAnalysisComplete && newImages.some((img) => img.analysis)) {
        onAnalysisComplete(newImages);
      }
      setUploading(false);
    },
    [images, onImagesChange, onAnalysisComplete]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) uploadFiles(files);
    },
    [uploadFiles]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) uploadFiles(files);
      e.target.value = '';
    },
    [uploadFiles]
  );

  const removeImage = (index: number) => {
    const updated = images.filter((_, i) => i !== index);
    onImagesChange(updated);
  };

  return (
    <div className="border-t border-[#1e1e22] bg-[#0d0d0f]">
      {/* 썸네일 행 */}
      {images.length > 0 && (
        <div className="flex gap-2 px-4 py-2 overflow-x-auto">
          {images.map((img, i) => (
            <div key={i} className="relative group shrink-0">
              <img
                src={img.url}
                alt={img.filename}
                className="w-14 h-14 object-cover rounded-lg border border-[#1e1e22]"
              />
              <button
                onClick={() => removeImage(i)}
                className="absolute -top-1 -right-1 w-4 h-4 bg-[#E4002B] rounded-full text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ×
              </button>
              {img.analysis && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-[8px] text-center text-[#C8A951] rounded-b-lg px-0.5 truncate">
                  {img.analysis.stage}
                </div>
              )}
            </div>
          ))}
          <button
            onClick={() => inputRef.current?.click()}
            className="w-14 h-14 rounded-lg border border-dashed border-[#1e1e22] flex items-center justify-center text-[#71717a] hover:border-[#C8A951] hover:text-[#C8A951] transition-colors shrink-0"
          >
            +
          </button>
        </div>
      )}

      {/* 드래그앤드롭 영역 */}
      {images.length === 0 && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`mx-4 my-2 border border-dashed rounded-xl p-3 text-center cursor-pointer transition-colors ${
            dragOver
              ? 'border-[#C8A951] bg-[#C8A951]/5'
              : 'border-[#1e1e22] hover:border-[#71717a]'
          }`}
        >
          {uploading ? (
            <div className="text-[#C8A951] text-xs">업로드 + AI 분석 중...</div>
          ) : (
            <div className="text-[#71717a] text-xs">
              📷 사진을 드래그하거나 클릭하여 업로드 (여러 장 가능)
            </div>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}

export type { UploadedImage };
