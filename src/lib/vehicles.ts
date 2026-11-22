/**
 * 차량 (2026-11-22 사장님 "같은 사람 차 n대 구조"): 고객 1명 : 차량 N대
 * - 표 vehicles (docs/차량-vehicles-표-만들기.sql, Supabase 에서 수동 실행). 표가 아직 없으면 모든 함수가 빈 값/false 를 돌려주고 화면은 예전처럼 고객 칸의 차 한 대로 돈다
 * - 대표 차(is_primary)는 customers.car_* 와 같은 값으로 맞춘다(목록·검색·옛 코드 호환)
 * - 예약·시공 기록의 vehicle_id 로 "어느 차에 한 작업인지"가 남고, 손님 페이지는 차량별로 묶어 보여 준다
 */
import { supabase } from './supabase';

export interface Vehicle {
  id: string;
  customer_id: string;
  brand: string | null;
  model: string | null;
  year: string | null;
  color: string | null;
  plate: string | null;
  memo?: string | null;
  is_primary: boolean;
  created_at?: string;
}

let tableMissing: boolean | null = null;
/** 42P01 = 표 없음. 한 번 확인하면 세션 동안 기억 */
function missing(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === '42P01' || /relation .*vehicles.* does not exist|schema cache/i.test(err.message || '')) { tableMissing = true; return true; }
  return false;
}
export function vehiclesTableMissing(): boolean { return tableMissing === true; }

export function vehicleLabel(v: Pick<Vehicle, 'brand' | 'model' | 'plate'> | null | undefined, withPlate = false): string {
  if (!v) return '';
  const name = [v.brand, v.model].filter(Boolean).join(' ').trim();
  return withPlate && v.plate ? `${name || '차량'} (${v.plate})` : name;
}

export async function loadVehicles(customerId: string): Promise<Vehicle[]> {
  if (tableMissing) return [];
  const { data, error } = await supabase.from('vehicles').select('*').eq('customer_id', customerId).order('is_primary', { ascending: false }).order('created_at', { ascending: true });
  if (error) { missing(error); return []; }
  return (data || []) as Vehicle[];
}

/** 여러 고객의 차량을 한 번에 (고객 목록 "외 N대") */
export async function loadAllVehicles(): Promise<Map<string, Vehicle[]>> {
  const map = new Map<string, Vehicle[]>();
  if (tableMissing) return map;
  const { data, error } = await supabase.from('vehicles').select('*').order('is_primary', { ascending: false }).order('created_at', { ascending: true });
  if (error) { missing(error); return map; }
  for (const v of (data || []) as Vehicle[]) { const arr = map.get(v.customer_id) || []; arr.push(v); map.set(v.customer_id, arr); }
  return map;
}

export type VehicleInput = { brand?: string | null; model?: string | null; year?: string | null; color?: string | null; plate?: string | null; memo?: string | null };

/** 대표 차와 customers.car_* 를 같은 값으로 */
async function syncPrimaryToCustomer(customerId: string, v: VehicleInput) {
  await supabase.from('customers').update({ car_brand: v.brand || null, car_model: v.model || null, car_year: v.year || null, car_color: v.color || null }).eq('id', customerId);
}

export async function addVehicle(customerId: string, input: VehicleInput, makePrimary = false): Promise<Vehicle | null> {
  if (tableMissing) return null;
  const existing = await loadVehicles(customerId);
  if (tableMissing) return null;
  const isPrimary = makePrimary || existing.length === 0;
  if (isPrimary && existing.length) await supabase.from('vehicles').update({ is_primary: false }).eq('customer_id', customerId);
  const { data, error } = await supabase.from('vehicles').insert({ customer_id: customerId, brand: input.brand || null, model: input.model || null, year: input.year || null, color: input.color || null, plate: input.plate || null, memo: input.memo || null, is_primary: isPrimary }).select('*').single();
  if (error) { missing(error); return null; }
  if (isPrimary) await syncPrimaryToCustomer(customerId, input);
  return data as Vehicle;
}

export async function updateVehicle(v: Vehicle, input: VehicleInput): Promise<boolean> {
  if (tableMissing) return false;
  const { error } = await supabase.from('vehicles').update({ brand: input.brand ?? v.brand, model: input.model ?? v.model, year: input.year ?? v.year, color: input.color ?? v.color, plate: input.plate ?? v.plate, memo: input.memo ?? v.memo ?? null }).eq('id', v.id);
  if (error) { missing(error); return false; }
  if (v.is_primary) await syncPrimaryToCustomer(v.customer_id, { ...v, ...input });
  return true;
}

export async function setPrimaryVehicle(v: Vehicle): Promise<void> {
  if (tableMissing) return;
  await supabase.from('vehicles').update({ is_primary: false }).eq('customer_id', v.customer_id);
  await supabase.from('vehicles').update({ is_primary: true }).eq('id', v.id);
  await syncPrimaryToCustomer(v.customer_id, v);
}

export async function deleteVehicle(v: Vehicle): Promise<string | null> {
  if (tableMissing) return '차량 표가 없습니다';
  const { count: s } = await supabase.from('services').select('id', { count: 'exact', head: true }).eq('vehicle_id', v.id);
  const { count: a } = await supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('vehicle_id', v.id);
  if ((s || 0) + (a || 0) > 0) return `이 차에 시공 기록 ${s || 0}건·예약 ${a || 0}건이 붙어 있어 지울 수 없습니다. 다른 차로 옮기거나 그대로 두세요`;
  const { error } = await supabase.from('vehicles').delete().eq('id', v.id);
  return error ? error.message : null;
}

/**
 * 고객 등록·수정 때 고객 칸의 차를 대표 차량으로 맞춘다 (표가 있을 때만)
 * - 차량이 하나도 없으면 대표로 새로 만들고, 대표가 있으면 그 값을 고친다
 */
export async function ensurePrimaryVehicle(customerId: string, input: VehicleInput): Promise<void> {
  if (tableMissing) return;
  if (!input.brand && !input.model) return;
  const list = await loadVehicles(customerId);
  if (tableMissing) return;
  const primary = list.find((v) => v.is_primary) || list[0];
  if (!primary) { await supabase.from('vehicles').insert({ customer_id: customerId, brand: input.brand || null, model: input.model || null, year: input.year || null, color: input.color || null, is_primary: true }); return; }
  if (primary.brand !== (input.brand || null) || primary.model !== (input.model || null) || primary.year !== (input.year || null) || primary.color !== (input.color || null)) {
    await supabase.from('vehicles').update({ brand: input.brand || null, model: input.model || null, year: input.year || null, color: input.color || null }).eq('id', primary.id);
  }
}

/** 작업 내역서의 차량번호를 그 차에 적어 둔다 (비어 있을 때만) */
export async function fillPlateIfEmpty(vehicleId: string | null | undefined, plate: string | null | undefined): Promise<void> {
  if (tableMissing || !vehicleId || !plate?.trim()) return;
  const { data } = await supabase.from('vehicles').select('plate').eq('id', vehicleId).maybeSingle();
  if (data && !data.plate) await supabase.from('vehicles').update({ plate: plate.trim() }).eq('id', vehicleId);
}
