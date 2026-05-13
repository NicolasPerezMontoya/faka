'use server';

import { z } from 'zod';
import { ChannelSchema, ProfileTypeSchema } from '@faka/schema';
import { requireRole, ForbiddenError } from '@faka/auth';
import { auditLog } from '@faka/db';
import { createClient } from '@/lib/supabase/server';

const SaveMappingInput = z.object({
  channel: ChannelSchema,
  tipo: ProfileTypeSchema,
  nombre: z.string().min(3).max(120),
  column_map: z.record(z.string(), z.string()),
});

export interface SaveMappingResult {
  ok: boolean;
  error?: string;
  profile_id?: string;
  version?: number;
}

export async function saveMappingAction(formData: FormData): Promise<SaveMappingResult> {
  const supabase = createClient();

  let ctx;
  try {
    ctx = await requireRole(supabase, ['super_admin', 'admin', 'manager']);
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: 'forbidden' };
    return { ok: false, error: 'auth_failed' };
  }

  const parsed = SaveMappingInput.safeParse({
    channel: formData.get('channel'),
    tipo: formData.get('tipo'),
    nombre: formData.get('nombre'),
    column_map: JSON.parse(String(formData.get('column_map') ?? '{}')),
  });
  if (!parsed.success) {
    return { ok: false, error: `invalid: ${parsed.error.issues[0]?.message ?? 'unknown'}` };
  }

  // Find max version for (canal, tipo, nombre) to bump.
  const { data: existing } = await supabase
    .from('csv_mapping_profiles')
    .select('version')
    .eq('canal', parsed.data.channel)
    .eq('tipo', parsed.data.tipo)
    .eq('nombre', parsed.data.nombre)
    .order('version', { ascending: false })
    .limit(1);

  const nextVersion = (existing?.[0]?.version ?? 0) + 1;

  const { data: inserted, error } = await supabase
    .from('csv_mapping_profiles')
    .insert({
      nombre: parsed.data.nombre,
      canal: parsed.data.channel,
      tipo: parsed.data.tipo,
      column_map_json: parsed.data.column_map,
      version: nextVersion,
      is_active: true,
      creado_por: ctx.user.id,
    })
    .select('id, version')
    .single();

  if (error || !inserted) {
    return { ok: false, error: `insert_failed: ${error?.message ?? 'unknown'}` };
  }

  await auditLog(supabase, {
    user_id: ctx.user.id,
    role_at_time: ctx.role,
    action: 'csv_mapping_profile_created',
    target_table: 'csv_mapping_profiles',
    target_id: inserted.id,
    payload_json: {
      canal: parsed.data.channel,
      tipo: parsed.data.tipo,
      version: inserted.version,
      nombre: parsed.data.nombre,
    },
  });

  return { ok: true, profile_id: inserted.id, version: inserted.version };
}
