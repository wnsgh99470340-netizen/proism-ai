import { supabase } from './supabase';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';

const DATA_DIR = join(process.cwd(), 'data');
const DATA_PATH = join(DATA_DIR, 'warranties.json');

export interface Warranty {
  id: string;
  customer_name: string;
  phone?: string | null;
  car_type?: string | null;
  car_number?: string | null;
  work_details?: string | null;
  warranty_period?: string | null;
  service_date?: string | null;
  price?: string | null;
  created_at?: string;
}

// ─── 파일 스토리지 폴백 ─────────────────────────────────
async function readFileStore(): Promise<Warranty[]> {
  try { return JSON.parse(await readFile(DATA_PATH, 'utf-8')); } catch { return []; }
}
async function writeFileStore(data: Warranty[]) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_PATH, JSON.stringify(data, null, 2));
}

export async function createWarranty(input: Omit<Warranty, 'id' | 'created_at'>): Promise<Warranty> {
  const row = { ...input };

  // Supabase 시도
  try {
    const { data, error } = await supabase.from('warranties').insert(row).select().single();
    if (!error && data) return data as Warranty;
  } catch { /* 폴백 */ }

  // 파일 폴백
  const items = await readFileStore();
  const warranty: Warranty = { ...row, id: randomUUID().slice(0, 8), created_at: new Date().toISOString() };
  items.unshift(warranty);
  await writeFileStore(items);
  return warranty;
}

export async function getWarranty(id: string): Promise<Warranty | null> {
  try {
    const { data, error } = await supabase.from('warranties').select('*').eq('id', id).single();
    if (!error && data) return data as Warranty;
  } catch { /* 폴백 */ }

  const items = await readFileStore();
  return items.find((w) => w.id === id) || null;
}
