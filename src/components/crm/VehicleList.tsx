'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadVehicles, addVehicle, updateVehicle, deleteVehicle, setPrimaryVehicle, vehiclesTableMissing, vehicleLabel, vehiclePhotosSupport, setVehiclePhotos, VEHICLE_PHOTO_MAX, vehicleDriveSupport, setVehicleDriveFolder, isDriveFolderLink, vehicleDriveUsedSupport, setVehicleDriveUsed, applyUsedIds, type Vehicle, type VehicleInput } from '@/lib/vehicles';
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
              {driveCol && <DriveFolderRow v={v} onSaved={reload} usedSupported={vehicleDriveUsedSupport()} />}
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
function DriveFolderRow({ v, onSaved, usedSupported }: { v: Vehicle; onSaved: () => void | Promise<void>; usedSupported: boolean }) {
  const link = (v.drive_folder || '').trim();
  const used = new Set(Array.isArray(v.drive_used_ids) ? v.drive_used_ids : []);
  const [grid, setGrid] = useState(false);
  const [photos, setPhotos] = useState<DriveThumb[] | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!link) { setPhotos(null); setErr(''); return; }
    let alive = true;
    setPhotos(null); setErr('');
    fetch(`/api/drive/photos?folder=${encodeURIComponent(link)}&limit=8`, { cache: 'no-store' })
      .then(async (r) => { const j = await r.json(); if (!alive) return; if (!r.ok) setErr("폴더가 '링크가 있는 모든 사용자 보기'가 아니면 읽을 수 없어요"); else { setPhotos(j.photos || []); setTotal(j.total || 0); } })
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
              <button type="button" onClick={() => setGrid(true)} className="whitespace-nowrap text-[11px] font-semibold rounded-full px-2.5 py-1 bg-[var(--c-text-1)] text-[var(--c-card)]">전체 보기</button>
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
        <>
          <div className="text-[10px] text-[var(--c-text-4)] mt-0.5 break-keep">사진 {total}장 중 {photos.length}장 · 이름순으로 고르게 뽑음{usedSupported && used.size > 0 ? ` · 후기에 쓴 사진 ${used.size}장` : ''}</div>
          <div className="flex items-end gap-1.5 overflow-x-auto mt-1 pb-1">
            {photos.map((p, i) => (
              <a key={p.id} href={p.view} target="_blank" rel="noreferrer" className="shrink-0 relative" title={p.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumb} alt={p.name} referrerPolicy="no-referrer" className={`${i === 0 ? 'w-20 h-20' : 'w-14 h-14'} object-cover rounded-md border border-[var(--c-border)] bg-[var(--c-subtle)]`} />
                {used.has(p.id) && <span className="absolute top-0.5 left-0.5 text-[9px] font-bold px-1 rounded bg-brand text-white">후기</span>}
              </a>
            ))}
          </div>
        </>
      )}
      {grid && link && <DriveGridModal v={v} link={link} usedSupported={usedSupported} onSaved={onSaved} onClose={() => setGrid(false)} />}
    </div>
  );
}

/**
 * 드라이브 폴더 전체 보기 (2026-11-27 사장님 "후기 요청 때 쓴 사진 표시" + "사진 저장 눌러서 바로 내 핸드폰 갤러리로")
 * - 이름순 3열 격자, 48장씩 더 보기. 탭 = 선택, 모서리 아이콘 = 새 탭에서 크게
 * - 갤러리에 저장: /api/drive/file 로 받아 navigator.share({files}) (안드로이드 공유창 → 갤러리·카톡), 안 되면 한 장씩 내려받기. 최대 10장
 * - 후기에 사용함 표시: vehicles.drive_used_ids (열 없으면 버튼 숨김). 시공기와는 연결하지 않음
 */
const SAVE_MAX = 10;
function DriveGridModal({ v, link, usedSupported, onSaved, onClose }: { v: Vehicle; link: string; usedSupported: boolean; onSaved: () => void | Promise<void>; onClose: () => void }) {
  const [items, setItems] = useState<DriveThumb[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [progress, setProgress] = useState('');
  const [used, setUsed] = useState<string[]>(Array.isArray(v.drive_used_ids) ? v.drive_used_ids : []);
  const loadMore = useCallback(async (offset: number) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/drive/photos?folder=${encodeURIComponent(link)}&all=1&offset=${offset}&limit=48`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) { setErr("폴더가 '링크가 있는 모든 사용자 보기'가 아니면 읽을 수 없어요"); return; }
      setTotal(j.total || 0);
      setItems((prev) => (offset === 0 ? j.photos : [...prev, ...j.photos]));
    } catch { setErr('폴더를 읽지 못했습니다'); } finally { setLoading(false); }
  }, [link]);
  useEffect(() => { loadMore(0); }, [loadMore]);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const byId = new Map(items.map((p) => [p.id, p]));

  const saveToGallery = async () => {
    const pick = sel.slice(0, SAVE_MAX).map((id) => byId.get(id)).filter((x): x is DriveThumb => !!x);
    if (sel.length > SAVE_MAX) alert(`한 번에 ${SAVE_MAX}장까지 저장합니다. 앞의 ${SAVE_MAX}장만 받습니다`);
    const files: File[] = []; const failed: string[] = [];
    for (let i = 0; i < pick.length; i++) {
      setProgress(`${i + 1}/${pick.length} 받는 중…`);
      try {
        const r = await fetch(`/api/drive/file?id=${pick[i].id}&name=${encodeURIComponent(pick[i].name)}`, { cache: 'no-store' });
        if (!r.ok) throw new Error();
        const b = await r.blob();
        files.push(new File([b], pick[i].name, { type: b.type || 'image/jpeg' }));
      } catch { failed.push(pick[i].name); }
    }
    setProgress('');
    if (failed.length) alert(`받지 못한 사진: ${failed.join(', ')}`);
    if (!files.length) return;
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav.canShare && nav.canShare({ files }) && 'share' in navigator) {
      try { await navigator.share({ files }); return; } catch (e) { if (e instanceof Error && e.name === 'AbortError') return; }
    }
    for (const f of files) {
      const url = URL.createObjectURL(f);
      const a = document.createElement('a'); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  };
  const mark = async (on: boolean) => {
    const next = applyUsedIds(used, sel, on);
    const e = await setVehicleDriveUsed(v.id, next);
    if (e) { alert(e); return; }
    setUsed(next); setSel([]); await onSaved();
  };
  const usedSet = new Set(used);
  return (
    <div className="fixed inset-0 z-50 bg-black/50 overflow-y-auto" onClick={onClose}>
      <div className="max-w-2xl mx-auto px-3 py-4" onClick={(e) => e.stopPropagation()}>
        <div className="bg-[var(--c-card)] rounded-2xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-base font-bold text-[var(--c-text-1)] min-w-0 truncate">드라이브 사진 {total !== null ? <span className="text-[var(--c-text-3)] font-normal text-sm">{total}장</span> : null}</h3>
            <button type="button" onClick={onClose} aria-label="닫기" className="ml-auto shrink-0 w-8 h-8 rounded-full border border-[var(--c-border)] flex items-center justify-center text-[var(--c-text-2)] text-lg leading-none">×</button>
          </div>
          <div className="sticky top-0 z-10 bg-[var(--c-card)] py-2 flex flex-wrap items-center gap-1.5 border-b border-[var(--c-border)] mb-2">
            <span className="text-xs font-semibold text-[var(--c-text-2)] whitespace-nowrap mr-1">선택 {sel.length}장</span>
            <button type="button" disabled={!sel.length || !!progress} onClick={saveToGallery} className="whitespace-nowrap text-xs font-semibold rounded-full px-3 py-1.5 bg-brand text-white disabled:opacity-40">{progress || '갤러리에 저장'}</button>
            {usedSupported && <button type="button" disabled={!sel.length} onClick={() => mark(true)} className="whitespace-nowrap text-xs font-semibold rounded-full px-3 py-1.5 border border-[var(--c-border)] text-[var(--c-text-1)] disabled:opacity-40">후기에 사용함 표시</button>}
            {usedSupported && <button type="button" disabled={!sel.length} onClick={() => mark(false)} className="whitespace-nowrap text-xs rounded-full px-3 py-1.5 text-[var(--c-text-3)] disabled:opacity-40">표시 지우기</button>}
            {sel.length > 0 && <button type="button" onClick={() => setSel([])} className="whitespace-nowrap text-xs text-[var(--c-text-3)] underline ml-auto">선택 해제</button>}
          </div>
          {err && <div className="text-sm text-[var(--c-text-3)] py-4 break-keep">{err}</div>}
          <div className="grid grid-cols-3 gap-1.5">
            {items.map((p) => {
              const on = sel.includes(p.id);
              return (
                <div key={p.id} className="relative aspect-square">
                  <button type="button" onClick={() => toggle(p.id)} className={`w-full h-full rounded-md overflow-hidden border-2 ${on ? 'border-brand' : 'border-transparent'}`} aria-pressed={on} title={p.name}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.thumb} alt={p.name} loading="lazy" referrerPolicy="no-referrer" className={`w-full h-full object-cover bg-[var(--c-subtle)] ${on ? 'opacity-80' : ''}`} />
                  </button>
                  {on && <span className="absolute top-1 left-1 w-5 h-5 rounded-full bg-brand text-white text-[11px] font-bold flex items-center justify-center pointer-events-none">✓</span>}
                  {usedSet.has(p.id) && <span className="absolute bottom-1 left-1 text-[9px] font-bold px-1 rounded bg-brand text-white pointer-events-none">후기</span>}
                  <a href={p.view} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} aria-label="크게 보기" className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/50 text-white flex items-center justify-center">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
                  </a>
                </div>
              );
            })}
          </div>
          {loading && <div className="text-xs text-[var(--c-text-4)] text-center py-3">불러오는 중…</div>}
          {!loading && total !== null && items.length < total && (
            <button type="button" onClick={() => loadMore(items.length)} className="w-full mt-3 rounded-full border border-[var(--c-border)] py-2.5 text-sm font-semibold">더 보기 ({items.length}/{total})</button>
          )}
        </div>
      </div>
    </div>
  );
}
