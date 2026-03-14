import type { CallRailCallEvent, CallRailTextEvent, CompanyConfig } from "./types";
import { getRecordingUrl, downloadRecording } from "./callrail-client";
import { transcribeAudio } from "./transcribe";
import { summarizeForSms } from "./summarize";
import { sendSms } from "./sms";

// --- Spam filter ---
// CallRail CNAM for spam/robocalls typically shows as city names or generic labels.
// All comparisons are case-insensitive and trimmed.
const SPAM_NAME_PATTERNS = [
  "las vegas",
  "laughlin",
  "logandale",
  "mount charleston",
  "mt charleston",
  "searchlight",
  "nelson",
  "henderson",
  "north las vegas",
  "boulder city",
  "pahrump",
  "mesquite",
  "wireless caller",
  "unknown",
  "unavailable",
  "toll free",
  "toll-free",
  "anonymous",
  "private caller",
  "no caller id",
];

/**
 * Returns true if the caller name looks like spam (city name, generic label, or empty).
 */
function isSpamCaller(callerName: string | null | undefined): boolean {
  if (!callerName || callerName.trim().length === 0) return true;

  const normalized = callerName.trim().toLowerCase();

  // Exact match or starts-with match (handles "Laughlin NV", "Nelson NV", etc.)
  return SPAM_NAME_PATTERNS.some(
    (pattern) => normalized === pattern || normalized.startsWith(pattern + " "),
  );
}

/** Format caller identity for SMS — include name when available */
function formatCaller(
  phone: string,
  name: string | null | undefined,
): string {
  if (name && name.trim().length > 0 && !isSpamCaller(name)) {
    return `${name.trim()} (${phone})`;
  }
  return phone;
}

/**
 * Handle a post-call event.
 *
 * Two paths:
 * A) VOICEMAIL: transcribe → summarize → forward SMS (always, regardless of caller name)
 * B) MISSED CALL (no voicemail): only forward if caller name is NOT a spam pattern
 */
export async function handleCall(
  event: CallRailCallEvent,
  config: CompanyConfig,
): Promise<{ forwarded: boolean; message?: string; error?: string; reason?: string }> {
  const callerPhone = event.customer_phone_number;
  const callerName = event.customer_name;
  const caller = formatCaller(callerPhone, callerName);

  // --- PATH A: Voicemail ---
  if (event.voicemail) {
    return handleVoicemail(event, config, caller, callerPhone);
  }

  // --- PATH B: Missed call (no voicemail, not answered) ---
  if (!event.answered) {
    // Spam filter — skip if caller name is a city/generic label
    if (isSpamCaller(callerName)) {
      console.log(`[${config.label}] Skipped spam caller: "${callerName}" ${callerPhone}`);
      return { forwarded: false, reason: "spam_filtered" };
    }

    const smsMessage = `[${config.label}] Missed call from ${caller}`;

    try {
      await sendSms(config.forwardTo, smsMessage);
      console.log(`[${config.label}] Forwarded missed call from ${caller}`);
      return { forwarded: true, message: smsMessage };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[${config.label}] Failed to forward missed call:`, error);
      return { forwarded: false, error };
    }
  }

  // Answered call — ignore
  return { forwarded: false, reason: "answered_call" };
}

/**
 * Handle a voicemail: download recording → Whisper transcribe → summarize → forward.
 *
 * We always use our own Whisper transcription (cheaper than CallRail's
 * Conversation Intelligence plan at $0.003/min via gpt-4o-mini-transcribe).
 *
 * Pipeline:
 * 1. Fetch recording URL from CallRail API
 * 2. Download MP3 → transcribe with Whisper
 * 3. Summarize via GPT-4o-mini to fit SMS length
 * 4. Forward via TextBelt
 */
async function handleVoicemail(
  event: CallRailCallEvent,
  config: CompanyConfig,
  caller: string,
  callerPhone: string,
): Promise<{ forwarded: boolean; message?: string; error?: string }> {
  let transcription: string | null = null;

  // Download recording and transcribe with Whisper
  if (event.recording) {
    try {
      let mp3Buffer: Buffer | null = null;

      // The recording field may be a direct URL or an API endpoint URL.
      // Try downloading directly first (handles both cases).
      const recordingStr = String(event.recording);
      if (recordingStr.startsWith("http")) {
        try {
          mp3Buffer = await downloadRecording(recordingStr);
        } catch {
          console.log(`[${config.label}] Direct download failed, trying API...`);
        }
      }

      // Fall back to fetching recording URL via CallRail API
      if (!mp3Buffer) {
        const recordingUrl = await getRecordingUrl(
          config.accountId,
          config.apiKey,
          event.id,
        );
        mp3Buffer = await downloadRecording(recordingUrl);
      }

      transcription = await transcribeAudio(mp3Buffer);
      console.log(`[${config.label}] Transcribed voicemail (${mp3Buffer.length} bytes) from ${caller}`);
    } catch (err) {
      console.error(`[${config.label}] Failed to transcribe recording:`, err);
    }
  }

  // Step 3: Build the SMS
  let smsMessage: string;

  if (transcription && transcription.trim().length > 0) {
    smsMessage = await summarizeForSms(transcription, caller, config.label);
  } else {
    smsMessage = `[${config.label}] VM from ${caller}: New voicemail (no transcription). Call back.`;
    if (smsMessage.length > 160) {
      smsMessage = `[${config.label}] VM from ${callerPhone}: Voicemail. Call back.`;
    }
  }

  // Step 4: Forward
  try {
    await sendSms(config.forwardTo, smsMessage);
    console.log(`[${config.label}] Forwarded voicemail from ${caller}`);
    return { forwarded: true, message: smsMessage };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[${config.label}] Failed to forward voicemail:`, error);
    return { forwarded: false, error };
  }
}

/**
 * Handle an incoming text message event.
 * Forwards the text content + sender phone via SMS.
 */
export async function handleTextMessage(
  event: CallRailTextEvent,
  config: CompanyConfig,
): Promise<{ forwarded: boolean; message?: string; error?: string }> {
  const senderPhone = event.source_number;
  const content = event.content || "(empty message)";

  // Build SMS — keep under 160 chars
  const prefix = `[${config.label}] TXT from ${senderPhone}: `;
  const maxBody = 160 - prefix.length;
  const body =
    content.length > maxBody
      ? content.slice(0, maxBody - 3) + "..."
      : content;
  const smsMessage = `${prefix}${body}`;

  try {
    await sendSms(config.forwardTo, smsMessage);
    console.log(`[${config.label}] Forwarded text from ${senderPhone}`);
    return { forwarded: true, message: smsMessage };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[${config.label}] Failed to forward text:`, error);
    return { forwarded: false, error };
  }
}
