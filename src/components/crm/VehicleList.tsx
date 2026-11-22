'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadVehicles, addVehicle, updateVehicle, deleteVehicle, setPrimaryVehicle, vehiclesTableMissing, vehicleLabel, type Vehicle, type VehicleInput } from '@/lib/vehicles';

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

  const reload = useCallback(async () => {
    const v = await loadVehicles(customerId);
    setMissing(vehiclesTableMissing());
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
      const payload: VehicleInput = { brand: form.brand.trim() || null, model: form.model.trim() || null, year: form.year.trim() || null, color: form.color.trim() || null, plate: form.plate.trim() || null };
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="브랜드 (BMW)" className={input} />
        <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="차종 (X5)" className={input} />
        <input value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} placeholder="연식" className={input} />
        <input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} placeholder="색상" className={input} />
        <input value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} placeholder="차량번호" className={input} />
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
            <div key={v.id} className="flex items-center gap-3 rounded-lg border border-[var(--c-border)] px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-[var(--c-text-1)] font-medium truncate">{vehicleLabel(v) || '차량'}{v.is_primary && <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gold/15 text-gold align-middle">대표</span>}</div>
                <div className="text-xs text-[var(--c-text-3)] mt-0.5">{[v.year, v.color, v.plate].filter(Boolean).join(' · ') || '연식·색상·차량번호 없음'}</div>
              </div>
              {!v.is_primary && <button onClick={() => makePrimary(v)} className="text-[11px] text-[var(--c-text-3)] hover:text-[var(--c-text-1)]">대표로</button>}
              <button onClick={() => startEdit(v)} className="text-[11px] text-[var(--c-text-3)] hover:text-[var(--c-text-1)]">수정</button>
              <button onClick={() => remove(v)} className="text-[11px] text-[var(--c-text-3)] hover:text-danger">삭제</button>
            </div>
          ))}
          {adding && FormRow}
        </div>
      )}
    </div>
  );
}
