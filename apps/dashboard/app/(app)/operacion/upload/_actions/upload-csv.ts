"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ChannelSchema, ProfileTypeSchema } from "@faka/schema";
import { requireRole, ForbiddenError } from "@faka/auth";
import { auditLog } from "@faka/db";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_MIME_TYPES = new Set([
  "text/csv",
  "application/vnd.ms-excel",
  "application/csv",
  "text/plain",
]);

const FILENAME_REGEX = /^[A-Za-z0-9._-]+\.csv$/i;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024; // 20MB per ADR-001 Storage bucket cap.

const UploadInput = z.object({
  channel: ChannelSchema,
  tipo: ProfileTypeSchema,
  profileId: z.string().uuid().nullable().optional(),
});

export interface UploadCsvResult {
  ok: boolean;
  error?: string;
  upload_id?: string;
}

function sanitizeFilename(name: string): string | null {
  // Basename only — strip path traversal vectors. Then enforce safe charset.
  const base = name.split(/[\\/]/).pop() ?? name;
  if (!FILENAME_REGEX.test(base)) return null;
  return base;
}

export async function uploadCsvAction(
  formData: FormData,
): Promise<UploadCsvResult> {
  const supabase = createClient();

  let ctx;
  try {
    ctx = await requireRole(supabase, ["super_admin", "admin", "manager"]);
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: "forbidden" };
    return { ok: false, error: "auth_failed" };
  }

  const parsedMeta = UploadInput.safeParse({
    channel: formData.get("channel"),
    tipo: formData.get("tipo"),
    profileId: formData.get("profileId") || null,
  });
  if (!parsedMeta.success) {
    return {
      ok: false,
      error: `invalid_metadata: ${parsedMeta.error.issues[0]?.message ?? ""}`,
    };
  }
  if (parsedMeta.data.channel === "falabella") {
    return { ok: false, error: "channel_disabled" };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "no_file" };
  }

  const maxBytes = Number(process.env.CSV_MAX_BYTES ?? DEFAULT_MAX_BYTES);
  if (file.size > maxBytes) {
    return { ok: false, error: `FILE_TOO_LARGE_${file.size}_max_${maxBytes}` };
  }
  if (file.size === 0) {
    return { ok: false, error: "empty_file" };
  }
  if (!ALLOWED_MIME_TYPES.has(file.type) && file.type !== "") {
    return { ok: false, error: `unsupported_type_${file.type}` };
  }

  const safeName = sanitizeFilename(file.name);
  if (!safeName) {
    return { ok: false, error: "invalid_filename" };
  }

  const uploadId = crypto.randomUUID();
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const storagePath = `${parsedMeta.data.channel}/${yyyy}/${mm}/${dd}/${uploadId}-${safeName}`;

  // Stream upload to Storage. supabase-js v2 buffers internally; for >5MB
  // files this is the simplest path that stays within Server Action limits.
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: storageErr } = await supabase.storage
    .from("csv-uploads")
    .upload(storagePath, buffer, {
      contentType: "text/csv",
      upsert: false,
    });

  if (storageErr) {
    return { ok: false, error: `storage_upload_failed: ${storageErr.message}` };
  }

  // Insert metadata row.
  const { error: insertErr } = await supabase.from("raw_csv_uploads").insert({
    upload_id: uploadId,
    canal_declarado: parsedMeta.data.channel,
    tipo: parsedMeta.data.tipo,
    filename: safeName,
    bytes: file.size,
    row_count: 0,
    uploaded_by: ctx.user.id,
    storage_path: storagePath,
    mapping_profile_id: parsedMeta.data.profileId ?? null,
    status: "uploaded",
  });

  if (insertErr) {
    // Roll back the Storage object so we don't leave orphans.
    await supabase.storage.from("csv-uploads").remove([storagePath]);
    return { ok: false, error: `db_insert_failed: ${insertErr.message}` };
  }

  await auditLog(supabase, {
    user_id: ctx.user.id,
    role_at_time: ctx.role,
    action: "csv_upload_created",
    target_table: "raw_csv_uploads",
    target_id: uploadId,
    payload_json: {
      filename: safeName,
      bytes: file.size,
      canal: parsedMeta.data.channel,
      tipo: parsedMeta.data.tipo,
      profile_id: parsedMeta.data.profileId ?? null,
    },
  });

  revalidatePath("/operacion");
  revalidatePath("/operacion/historial");

  // Don't redirect from here; client builds the new URL with the upload_id.
  return { ok: true, upload_id: uploadId };
}

export async function uploadCsvAndAdvance(formData: FormData) {
  const result = await uploadCsvAction(formData);
  if (!result.ok || !result.upload_id) return result;
  const channel = String(formData.get("channel") ?? "");
  const tipo = String(formData.get("tipo") ?? "");
  const profileId = String(formData.get("profileId") ?? "");
  const params = new URLSearchParams();
  params.set("step", "3");
  params.set("channel", channel);
  params.set("tipo", tipo);
  if (profileId) params.set("profile", profileId);
  params.set("upload", result.upload_id);
  redirect(`/operacion/upload?${params.toString()}`);
}
