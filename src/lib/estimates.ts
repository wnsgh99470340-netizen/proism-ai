import { supabase } from './supabase';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';

const DATA_DIR = join(process.cwd(), 'data');
const DATA_PATH = join(DATA_DIR, 'estimates.json');

export interface Estimate {
  id: string;
  customer_name: string;
  phone?: string | null;
  car_model?: string | null;
  services: string[];
  service_details?: Record<string, string> | null;
  amount?: number | null;
  scheduled_date?: string | null;
  memo?: string | null;
  created_at?: string;
}

// ─── 파일 스토리지 (Supabase 테이블 없을 때 폴백) ────────
async function readFileStore(): Promise<Estimate[]> {
  try {
    const raw = await readFile(DATA_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch { return []; }
}

async function writeFileStore(data: Estimate[]) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_PATH, JSON.stringify(data, null, 2));
}

async function fileCreate(input: Omit<Estimate, 'id' | 'created_at'>): Promise<Estimate> {
  const items = await readFileStore();
  const estimate: Estimate = { ...input, id: randomUUID().slice(0, 8), created_at: new Date().toISOString() };
  items.unshift(estimate);
  await writeFileStore(items);
  return estimate;
}

async function fileGet(id: string): Promise<Estimate | null> {
  const items = await readFileStore();
  return items.find((e) => e.id === id) || null;
}

// ─── Supabase 시도 → 실패 시 파일 폴백 ─────────────────
export async function createEstimate(input: {
  customerName: string;
  phone?: string | null;
  carModel?: string | null;
  services: string[];
  serviceDetails?: Record<string, string> | null;
  amount?: number | null;
  scheduledDate?: string | null;
  memo?: string | null;
}): Promise<Estimate> {
  const row = {
    customer_name: input.customerName,
    phone: input.phone || null,
    car_model: input.carModel || null,
    services: input.services,
    service_details: input.serviceDetails || null,
    amount: input.amount || null,
    scheduled_date: input.scheduledDate || null,
    memo: input.memo || null,
  };

  // Supabase 시도
  try {
    const { data, error } = await supabase
      .from('estimates')
      .insert(row)
      .select()
      .single();
    if (!error && data) return data as Estimate;
  } catch { /* Supabase 불가 — 파일 폴백 */ }

  // 파일 폴백
  return fileCreate(row);
}

export async function getEstimate(id: string): Promise<Estimate | null> {
  // Supabase 시도
  try {
    const { data, error } = await supabase
      .from('estimates')
      .select('*')
      .eq('id', id)
      .single();
    if (!error && data) return data as Estimate;
  } catch { /* 폴백 */ }

  // 파일 폴백
  return fileGet(id);
}
