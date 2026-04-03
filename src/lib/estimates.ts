import { supabase } from './supabase';

export interface Estimate {
  id: string;
  customer_name: string;
  phone?: string | null;
  car_model?: string | null;
  services: string[];
  amount?: number | null;
  scheduled_date?: string | null;
  memo?: string | null;
  created_at?: string;
}

export async function createEstimate(input: {
  customerName: string;
  phone?: string | null;
  carModel?: string | null;
  services: string[];
  amount?: number | null;
  scheduledDate?: string | null;
  memo?: string | null;
}): Promise<Estimate> {
  const { data, error } = await supabase
    .from('estimates')
    .insert({
      customer_name: input.customerName,
      phone: input.phone || null,
      car_model: input.carModel || null,
      services: input.services,
      amount: input.amount || null,
      scheduled_date: input.scheduledDate || null,
      memo: input.memo || null,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`견적서 저장 실패: ${error?.message || 'unknown'}`);
  }

  return data as Estimate;
}

export async function getEstimate(id: string): Promise<Estimate | null> {
  const { data } = await supabase
    .from('estimates')
    .select('*')
    .eq('id', id)
    .single();

  return (data as Estimate) || null;
}
