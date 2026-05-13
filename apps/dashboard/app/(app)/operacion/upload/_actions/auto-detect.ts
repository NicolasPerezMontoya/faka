"use server";

import { autoDetect } from "@faka/connectors/csv";
import { ChannelSchema } from "@faka/schema";
import { createClient } from "@/lib/supabase/server";

export interface AutoDetectInput {
  channel: string;
  headers: string[];
}

export async function autoDetectAction(input: AutoDetectInput) {
  const channelParse = ChannelSchema.safeParse(input.channel);
  if (!channelParse.success) {
    return { ok: false, error: "invalid_channel" as const, suggestions: [] };
  }

  const supabase = createClient();
  const { data: profiles, error } = await supabase
    .from("csv_mapping_profiles")
    .select("id, canal, column_map_json, is_active")
    .eq("canal", channelParse.data)
    .eq("is_active", true);

  if (error) {
    return {
      ok: false,
      error: "profiles_fetch_failed" as const,
      suggestions: [],
    };
  }

  const profilesShaped = (profiles ?? []).map((p) => ({
    id: p.id,
    channel: p.canal,
    column_map: p.column_map_json as Record<string, string>,
    is_active: p.is_active,
  }));

  const suggestions = autoDetect(
    input.headers,
    channelParse.data,
    profilesShaped,
  );
  return { ok: true as const, suggestions };
}
