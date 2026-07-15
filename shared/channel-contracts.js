export const CHANNELS = ['web','whatsapp_business','chatbot_municipal','internal','future_channel'];
export const INTENTS = ['pickup_schedule','missed_pickup','illegal_dump','report_status','sector_delay_status'];
export function buildCitizenIntent({ channel='web', intent, municipality_id='laguna-salada-rd', sector_id, folio, description }) {
  if (!CHANNELS.includes(channel)) throw new Error('Unsupported channel');
  if (!INTENTS.includes(intent)) throw new Error('Unsupported intent');
  return { channel, intent, municipality_id, sector_id, folio, description, correlation_id:`demo-${Date.now()}` };
}
export function validateEvidenceFile(fileLike) {
  if (!fileLike) return { ok:true, reason:'no_file' };
  const maxBytes = 5 * 1024 * 1024;
  const allowed = ['image/jpeg','image/png','image/webp','application/pdf'];
  if (fileLike.size > maxBytes) return { ok:false, reason:'too_large' };
  if (fileLike.type && !allowed.includes(fileLike.type)) return { ok:false, reason:'unsupported_type' };
  return { ok:true, reason:'accepted_for_local_preview_only' };
}
