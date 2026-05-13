'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { ChannelSchema, ProfileTypeSchema } from '@faka/schema';
import { requireRole, ForbiddenError } from '@faka/auth';
import { createClient } from '@/lib/supabase/server';

const SelectSourceInput = z.object({
  channel: ChannelSchema,
  tipo: ProfileTypeSchema,
  profileId: z.string().uuid().nullable().optional(),
});

export interface SelectSourceState {
  ok: boolean;
  error?: string;
}

export async function selectSource(_prev: SelectSourceState, formData: FormData): Promise<SelectSourceState> {
  const supabase = createClient();

  try {
    await requireRole(supabase, ['super_admin', 'admin', 'manager']);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { ok: false, error: 'forbidden' };
    }
    return { ok: false, error: 'auth_failed' };
  }

  const parsed = SelectSourceInput.safeParse({
    channel: formData.get('channel'),
    tipo: formData.get('tipo'),
    profileId: formData.get('profileId') || null,
  });

  if (!parsed.success) {
    return { ok: false, error: `invalid_input: ${parsed.error.issues[0]?.message ?? 'unknown'}` };
  }

  if (parsed.data.channel === 'falabella') {
    return { ok: false, error: 'channel_disabled' };
  }

  const params = new URLSearchParams();
  params.set('step', '2');
  params.set('channel', parsed.data.channel);
  params.set('tipo', parsed.data.tipo);
  if (parsed.data.profileId) params.set('profile', parsed.data.profileId);

  redirect(`/operacion/upload?${params.toString()}`);
}
