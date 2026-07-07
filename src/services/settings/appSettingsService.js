import { supabase } from '../supabase/client'

// Read a single global setting value (string) or null if absent.
export async function getSetting(key) {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data?.value ?? null
}

// Upsert a global setting. RLS restricts writes to admin/superadmin.
export async function setSetting(key, value) {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value: String(value) })
  if (error) throw new Error(error.message)
}
