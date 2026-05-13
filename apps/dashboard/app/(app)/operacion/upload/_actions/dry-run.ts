'use server';

import { dryRun } from '@faka/connectors/csv';
import { requireRole, ForbiddenError } from '@faka/auth';
import { createClient } from '@/lib/supabase/server';

export interface DryRunInput {
  uploadId: string;
  profileId: string;
  sampleSize?: number;
}

export interface DryRunResult {
  ok: boolean;
  error?: string;
  rowsValid?: number;
  rowsWarning?: number;
  rowsError?: number;
  errors?: Array<{ row_number: number; field?: string; message: string }>;
  projected?: {
    newMasterSkus: number;
    autoMatches: number;
    llmCandidates: number;
    validationQueue: number;
  };
}

export async function dryRunAction(input: DryRunInput): Promise<DryRunResult> {
  const supabase = createClient();

  try {
    await requireRole(supabase, ['super_admin', 'admin', 'manager']);
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: 'forbidden' };
    return { ok: false, error: 'auth_failed' };
  }

  try {
    const result = await dryRun({
      supabase,
      uploadId: input.uploadId,
      profileId: input.profileId,
      sampleSize: input.sampleSize ?? 500,
    });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
