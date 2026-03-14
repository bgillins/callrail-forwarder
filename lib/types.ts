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
  /** Phone number to forward SMS notifications to */
  forwardTo: string;
  /** HMAC signing key for this company's webhook */
  signingKey: string;
  /** CallRail API key (for fetching recordings/transcriptions) */
  apiKey: string;
  /** CallRail account ID */
  accountId: string;
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
