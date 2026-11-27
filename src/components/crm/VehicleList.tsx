'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadVehicles, addVehicle, updateVehicle, deleteVehicle, setPrimaryVehicle, vehiclesTableMissing, vehicleLabel, vehiclePhotosSupport, setVehiclePhotos, VEHICLE_PHOTO_MAX, vehicleDriveSupport, setVehicleDriveFolder, isDriveFolderLink, type Vehicle, type VehicleInput } from '@/lib/vehicles';
import { resizeAndUploadPhoto } from '@/lib/photo-upload';

/**
 * 고객 상세 "차량" 카드 (2026-11-22): 한 사람의 차 여러 대. 대표 차는 고객 칸(차량·연식·색상)과 같은 값으로 맞춰진다
 * 표(vehicles)가 아직 없으면 안내 한 줄만 보인다 (docs/차량-vehicles-표-만들기.sql)
 */
const input = 'bg-[var(--c-input)] border border-[var(--c-border)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--c-text-1)] outline-none focus:border-gold/50 w-full';
const EMPTY = { brand: '', model: '', year: '', color: '', plate: '' };

export default function VehicleList({ customerId, onChange }: { customerId: string; onChange?: (vehicles: Vehicle[]) => void }) {
  const [list, setList] = useState<Vehicle[]>([]);
  const [missing, setMissing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [photoCol, setPhotoCol] = useState<boolean | null>(null); // vehicles.photos 열 (2026-11-27)
  const [driveCol, setDriveCol] = useState<boolean | null>(null); // vehicles.drive_folder 열 (2026-11-27)

  const reload = useCallback(async () => {
    const v = await loadVehicles(customerId);
    setMissing(vehiclesTableMissing());
    setPhotoCol(await vehiclePhotosSupport());
    setDriveCol(v.length ? vehicleDriveSupport() : null);
    setList(v);
    onChange?.(v);
  }, [customerId, onChange]);
  useEffect(() => { reload(); }, [reload]);

  const startAdd = () => { setEditId(null); setForm({ ...EMPTY }); setAdding(true); };
  const startEdit = (v: Vehicle) => { setAdding(false); setEditId(v.id); setForm({ brand: v.brand || '', model: v.model || '', year: v.year || '', color: v.color || '', plate: v.plate || '' }); };
  const cancel = () => { setAdding(false); setEditId(null); };
  const save = async () => {
    if (!form.brand.trim() && !form.model.trim()) { alert('브랜드나 차종은 적어 주세요'); return; }
    setBusy(true);
    try {
      const payload: VehicleInput = { brand: form.brand.trim() || null, model: form.model.trim() || null, plate: form.plate.trim() || null }; // 연식·색상은 고객 정보 칸에서 (2026-11-23)
      if (editId) { const v = list.find((x) => x.id === editId); if (v) await updateVehicle(v, payload); }
      else await addVehicle(customerId, payload);
      cancel();
      await reload();
    } finally { setBusy(false); }
  };
  const remove = async (v: Vehicle) => {
    if (!confirm(`${vehicleLabel(v, true) || '이 차량'}을(를) 지울까요?`)) return;
    const err = await deleteVehicle(v);
    if (err) alert(err); else await reload();
  };
  const makePrimary = async (v: Vehicle) => { await setPrimaryVehicle(v); await reload(); };

  const FormRow = (
    <div className="rounded-lg border border-[var(--c-border)] bg-[var(--c-subtle)] p-3 space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="브랜드 (BMW)" className={input} />
        <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="차종 (X5)" className={input} />
        <input value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} placeholder="차량번호 (12가 3456)" className={input} />
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={cancel} className="text-xs px-3 py-1.5 rounded-full border border-[var(--c-border)] text-[var(--c-text-2)]">취소</button>
        <button onClick={save} disabled={busy} className="text-xs px-3 py-1.5 rounded-full bg-brand text-white disabled:opacity-50">{busy ? '저장 중…' : editId ? '수정 저장' : '차량 추가'}</button>
      </div>
    </div>
  );

  return (
    <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold text-[var(--c-text-3)]">차량 {list.length > 0 && <span className="text-[var(--c-text-4)] font-normal">{list.length}대</span>}</div>
        {!missing && !adding && <button onClick={startAdd} className="text-xs font-semibold rounded-full px-3 py-1.5 border border-[var(--c-border)] bg-[var(--c-card)] hover:bg-[var(--c-subtle)] text-[var(--c-text-1)] transition-colors">＋ 차량 추가</button>}
      </div>
      {missing ? (
        <div className="text-xs text-[var(--c-text-3)]">차량 표가 아직 없습니다. docs/차량-vehicles-표-만들기.sql 을 Supabase 에서 실행하면 여기서 차를 여러 대 관리할 수 있습니다. 지금은 고객 정보의 차량 한 대로 돕니다.</div>
      ) : (
        <div className="space-y-2">
          {list.length === 0 && !adding && <div className="text-xs text-[var(--c-text-3)]">등록된 차량이 없습니다. 고객 정보의 차종을 적으면 대표 차량으로 들어옵니다.</div>}
          {list.map((v) => editId === v.id ? <div key={v.id}>{FormRow}</div> : (
            <div key={v.id} className="rounded-lg border border-[var(--c-border)] px-3 py-2">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-[var(--c-text-1)] font-medium truncate">{vehicleLabel(v) || '차량'}{v.is_primary && <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gold/15 text-gold align-middle">대표</span>}</div>
                  <div className="text-xs text-[var(--c-text-3)] mt-0.5">{v.plate ? `차량번호 ${v.plate}` : '차량번호 없음 — 작업 내역서에 적으면 자동으로 들어옵니다'}</div>
                </div>
                {!v.is_primary && <button onClick={() => makePrimary(v)} className="text-[11px] text-[var(--c-text-3)] hover:text-[var(--c-text-1)]">대표로</button>}
                <button onClick={() => startEdit(v)} className="text-[11px] text-[var(--c-text-3)] hover:text-[var(--c-text-1)]">수정</button>
                <button onClick={() => remove(v)} className="text-[11px] text-[var(--c-text-3)] hover:text-danger">삭제</button>
              </div>
              {photoCol && <VehiclePhotos v={v} onSaved={reload} />}
              {driveCol && <DriveFolderRow v={v} onSaved={reload} />}
            </div>
          ))}
          {adding && FormRow}
          {photoCol === false && list.length > 0 && <div className="text-[11px] text-[var(--c-text-4)]">차량 사진을 쓰려면 docs/차량-사진-열-추가-2026-11-27.sql 실행</div>}
          {driveCol === false && list.length > 0 && <div className="text-[11px] text-[var(--c-text-4)] break-keep">드라이브 폴더 링크를 붙이려면 docs/차량-드라이브-폴더-열-추가-2026-11-27.sql 실행</div>}
        </div>
      )}
    </div>
  );
}

/** 차량 사진 (2026-11-27 사장님 "차량 카드에 사진 추가") — 입고 상태·문제 부위 같은 내부용. 손님·딜러·직원 페이지에는 안 나감 */
function VehiclePhotos({ v, onSaved }: { v: Vehicle; onSaved: () => void | Promise<void> }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [big, setBig] = useState<string | null>(null);
  const urls = Array.isArray(v.photos) ? v.photos.filter((u) => typeof u === 'string') : [];
  const add = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      let next = [...urls];
      for (const f of Array.from(files).slice(0, Math.max(0, VEHICLE_PHOTO_MAX - next.length))) {
        const r = await resizeAndUploadPhoto(f);
        if ('error' in r) { alert(r.error); continue; }
        next = [...next, r.url];
      }
      const err = await setVehiclePhotos(v.id, next);
      if (err) alert(err); else await onSaved();
    } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };
  const remove = async (u: string) => {
    if (!confirm('이 사진을 지울까요?')) return;
    const err = await setVehiclePhotos(v.id, urls.filter((x) => x !== u));
    if (err) alert(err); else { setBig(null); await onSaved(); }
  };
  return (
    <div className="mt-2 pt-2 border-t border-[var(--c-border)]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-[var(--c-text-2)] whitespace-nowrap">사진 {urls.length}장</span>
        <input ref={ref} type="file" accept="image/*" multiple className="hidden" onChange={(e) => add(e.target.files)} />
        <button type="button" onClick={() => ref.current?.click()} disabled={busy || urls.length >= VEHICLE_PHOTO_MAX} className="shrink-0 whitespace-nowrap text-[11px] font-semibold rounded-full px-2.5 py-1 border border-[var(--c-border)] text-[var(--c-text-1)] hover:bg-[var(--c-subtle)] disabled:opacity-40">{busy ? '올리는 중…' : '사진 추가'}</button>
      </div>
      <div className="text-[10px] text-[var(--c-text-4)] mt-0.5 break-keep">내부용 — 손님·딜러·직원 페이지에 안 보임</div>
      {urls.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto mt-1.5 pb-1">
          {urls.map((u) => (
            <button key={u} type="button" onClick={() => setBig(u)} className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="차량 사진" className="w-14 h-14 object-cover rounded-md border border-[var(--c-border)]" />
            </button>
          ))}
        </div>
      )}
      {big && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setBig(null)}>
          <div className="max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={big} alt="차량 사진" className="w-full max-h-[80dvh] object-contain rounded-lg bg-black" />
            <div className="flex justify-end gap-2 mt-3">
              <button type="button" onClick={() => remove(big)} className="text-xs font-semibold rounded-full px-3 py-1.5 bg-danger/90 text-white">삭제</button>
              <button type="button" onClick={() => setBig(null)} className="text-xs font-semibold rounded-full px-3 py-1.5 bg-white text-black">닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 드라이브 폴더 (2026-11-27 사장님 "복사하지 않고 드라이브를 그대로 읽는다") — CRM 안에서 보기 전용. 시공기 프리필에는 안 넘김(사장님 "시공기 쓸 때도 사진은 건들지 마") */
type DriveThumb = { id: string; name: string; thumb: string; view: string; modifiedTime: string | null };
function DriveFolderRow({ v, onSaved }: { v: Vehicle; onSaved: () => void | Promise<void> }) {
  const link = (v.drive_folder || '').trim();
  const [photos, setPhotos] = useState<DriveThumb[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!link) { setPhotos(null); setErr(''); return; }
    let alive = true;
    setPhotos(null); setErr('');
    fetch(`/api/drive/photos?folder=${encodeURIComponent(link)}&limit=12`, { cache: 'no-store' })
      .then(async (r) => { const j = await r.json(); if (!alive) return; if (!r.ok) setErr("폴더가 '링크가 있는 모든 사용자 보기'가 아니면 읽을 수 없어요"); else setPhotos(j.photos || []); })
      .catch(() => { if (alive) setErr('폴더를 읽지 못했습니다'); });
    return () => { alive = false; };
  }, [link]);
  const edit = async () => {
    const next = prompt('이 차의 구글 드라이브 폴더 링크 (…/drive/folders/…)', link);
    if (next === null) return;
    const t = next.trim();
    if (t && !isDriveFolderLink(t)) { alert('구글 드라이브 폴더 링크(…/drive/folders/…)만 넣을 수 있어요'); return; }
    const e = await setVehicleDriveFolder(v.id, t || null);
    if (e) alert(e); else await onSaved();
  };
  const clear = async () => {
    if (!confirm('드라이브 폴더 링크를 지울까요? (드라이브의 사진은 그대로입니다)')) return;
    const e = await setVehicleDriveFolder(v.id, null);
    if (e) alert(e); else await onSaved();
  };
  return (
    <div className="mt-2 pt-2 border-t border-[var(--c-border)]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-[var(--c-text-2)] whitespace-nowrap">드라이브 폴더</span>
        <span className="flex items-center gap-1.5 shrink-0">
          {link ? (
            <>
              <a href={link} target="_blank" rel="noreferrer" className="whitespace-nowrap text-[11px] font-semibold rounded-full px-2.5 py-1 border border-[var(--c-border)] text-[var(--c-text-1)] hover:bg-[var(--c-subtle)]">폴더 열기</a>
              <button type="button" onClick={edit} className="whitespace-nowrap text-[11px] text-[var(--c-text-3)] hover:text-[var(--c-text-1)]">바꾸기</button>
              <button type="button" onClick={clear} className="whitespace-nowrap text-[11px] text-[var(--c-text-3)] hover:text-danger">지우기</button>
            </>
          ) : (
            <button type="button" onClick={edit} className="whitespace-nowrap text-[11px] font-semibold rounded-full px-2.5 py-1 border border-[var(--c-border)] text-[var(--c-text-1)] hover:bg-[var(--c-subtle)]">링크 붙이기</button>
          )}
        </span>
      </div>
      {!link && <div className="text-[10px] text-[var(--c-text-4)] mt-0.5 break-keep">작업 과정·출고 사진 폴더 — 복사하지 않고 여기서 바로 봅니다</div>}
      {link && err && <div className="text-[11px] text-[var(--c-text-3)] mt-1 break-keep">{err}</div>}
      {link && !err && photos === null && <div className="text-[11px] text-[var(--c-text-4)] mt-1">불러오는 중…</div>}
      {link && !err && photos && photos.length === 0 && <div className="text-[11px] text-[var(--c-text-4)] mt-1">폴더에 사진이 없습니다</div>}
      {link && photos && photos.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto mt-1.5 pb-1">
          {photos.map((p) => (
            <a key={p.id} href={p.view} target="_blank" rel="noreferrer" className="shrink-0" title={p.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumb} alt={p.name} referrerPolicy="no-referrer" className="w-14 h-14 object-cover rounded-md border border-[var(--c-border)] bg-[var(--c-subtle)]" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
