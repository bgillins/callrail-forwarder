// --- CallRail Webhook Payloads ---

/** Call webhook payload (pre-call, post-call, call-modified) */
export interface CallRailCallEvent {
  id: string;
  company_id: string;
  company_name?: string;
  answered: boolean;
  voicemail: boolean;
  direction: "inbound" | "outbound";
  duration: number;
  recording?: string | null;
  recording_duration?: string | null;
  recording_player?: string | null;
  customer_phone_number: string;
  customer_name?: string | null;
  customer_city?: string | null;
  customer_state?: string | null;
  tracking_phone_number: string;
  business_phone_number?: string | null;
  start_time: string;
  agent_email?: string | null;
  // Optional fields (require ?fields= on API, but may appear in webhook)
  call_type?: string;
  transcription?: string | null;
  call_summary?: string | null;
}

/** Text message webhook payload (sms_received, sms_sent) */
export interface CallRailTextEvent {
  id: number;
  resource_id: string;
  source_number: string;
  destination_number: string;
  content: string;
  timestamp: string;
  lead_status?: string | null;
  conversation_id: string;
  company_resource_id: string;
  person_resource_id?: string;
  agent?: string; // present on sms_sent only
}

/** Config for a single business/company mapping */
export interface CompanyConfig {
  /** CallRail company ID (e.g. "COM8154748ae6bd...") */
  companyId: string;
  /** Friendly label */
  label: string;
  /** Phone number(s) to forward SMS notifications to */
  forwardTo: string | string[];
  /** HMAC signing key for this company's webhook */
  signingKey: string;
  /** CallRail API key (for fetching recordings/transcriptions) */
  apiKey: string;
  /** CallRail account ID */
  accountId: string;
}

/**
 * Raw form-encoded fields from a CallRail post_call / call_modified webhook.
 *
 * CallRail sends webhooks as application/x-www-form-urlencoded.
 * Field names differ from the JSON API (e.g. `resource_id` not `id`,
 * `callernum` not `customer_phone_number`, booleans as "true"/"false" strings).
 */
export interface CallRailWebhookFormFields {
  resource_id: string;        // call ID like "CAL019cecf..."
  company_id: string;
  company_resource_id?: string;
  callernum: string;          // caller phone
  customer_phone_number?: string; // sometimes also present
  callername?: string;        // CNAM caller name
  customer_name?: string;     // sometimes also present
  trackingnum?: string;
  destinationnum?: string;
  recording?: string;         // direct URL: https://app.callrail.com/calls/.../recording?access_key=...
  voicemail?: string;         // "true" / "false"
  answered?: string;          // "true" / "false"
  duration?: string;          // number as string
  direction?: string;
  callsource?: string;
  device_type?: string;
  landingpage?: string;
  referrer?: string;
  call_type?: string;
  start_time?: string;
  // Text message fields (form-encoded)
  content?: string;
  source_number?: string;
  destination_number?: string;
}

/**
 * Normalize raw form fields into our internal CallRailCallEvent shape.
 */
export function normalizeCallWebhook(
  fields: CallRailWebhookFormFields,
): CallRailCallEvent {
  return {
    id: fields.resource_id,
    company_id: fields.company_id || fields.company_resource_id || "",
    answered: fields.answered === "true",
    voicemail: fields.voicemail === "true",
    direction: (fields.direction as "inbound" | "outbound") || "inbound",
    duration: Number(fields.duration) || 0,
    recording: fields.recording || null,
    customer_phone_number:
      fields.customer_phone_number || fields.callernum || "",
    customer_name: fields.customer_name || fields.callername || null,
    tracking_phone_number: fields.trackingnum || "",
    business_phone_number: fields.destinationnum || null,
    start_time: fields.start_time || new Date().toISOString(),
    call_type: fields.call_type,
  };
}

/**
 * Normalize raw form fields into our internal CallRailTextEvent shape.
 */
export function normalizeTextWebhook(
  fields: CallRailWebhookFormFields,
): CallRailTextEvent {
  return {
    id: 0,
    resource_id: fields.resource_id,
    source_number: fields.source_number || fields.callernum || "",
    destination_number: fields.destination_number || fields.trackingnum || "",
    content: fields.content || "",
    timestamp: fields.start_time || new Date().toISOString(),
    conversation_id: "",
    company_resource_id: fields.company_resource_id || fields.company_id || "",
  };
}

/** Recording response from CallRail API */
export interface RecordingResponse {
  url: string;
}

/** Call detail response with optional transcription field */
export interface CallDetailResponse {
  id: string;
  voicemail: boolean;
  transcription?: string | null;
  call_summary?: string | null;
  recording?: string | null;
  customer_phone_number: string;
}
