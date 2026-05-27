import type { CallRailCallEvent, CallRailTextEvent, CompanyConfig } from "./types";
import { downloadRecording, fetchRecordingByCallId } from "./callrail-client";
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
      let mp3Buffer: Buffer;

      const recordingStr = String(event.recording);
      if (recordingStr.startsWith("http")) {
        // Direct URL from webhook (app.callrail.com with access_key) — no auth needed
        mp3Buffer = await downloadRecording(recordingStr);
      } else {
        // No URL — try by call ID via API as fallback
        mp3Buffer = await fetchRecordingByCallId(
          config.accountId,
          config.apiKey,
          event.id,
        );
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

/**
 * Handle a Voice Assist message-taken event.
 * This is separate from normal answered calls so AI-handled leads still alert.
 */
export async function handleVoiceAssistMessage(
  event: CallRailCallEvent,
  config: CompanyConfig,
  voiceAssistMessage: unknown,
): Promise<{ forwarded: boolean; message?: string; error?: string }> {
  const callerPhone = event.customer_phone_number;
  const caller = formatCaller(callerPhone, event.customer_name);
  const normalizedMessage = normalizeVoiceAssistMessage(voiceAssistMessage);
  const urgency = extractVoiceAssistUrgency(normalizedMessage);
  const urgencyText = urgency ? ` Urgency: ${urgency}.` : "";
  const details = formatVoiceAssistDetails(normalizedMessage);
  const detailsText = details ? ` Details: ${details}` : "";
  const smsMessage = truncateSms(
    `[${config.label}] Voice Assist message from ${caller}.${urgencyText}${detailsText} Review lead ASAP.`,
    480,
  );

  try {
    await sendSms(config.forwardTo, smsMessage);
    console.log(`[${config.label}] Forwarded Voice Assist message from ${caller}`);
    return { forwarded: true, message: smsMessage };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[${config.label}] Failed to forward Voice Assist message:`, error);
    return { forwarded: false, error };
  }
}

function normalizeVoiceAssistMessage(voiceAssistMessage: unknown): Record<string, unknown> | null {
  if (typeof voiceAssistMessage === "string") {
    const trimmed = voiceAssistMessage.trim();
    if (!trimmed) return null;

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return normalizeVoiceAssistMessage(parsed);
    } catch {
      return { contents: { message: trimmed } };
    }
  }

  if (!voiceAssistMessage || typeof voiceAssistMessage !== "object") {
    return null;
  }

  return voiceAssistMessage as Record<string, unknown>;
}

function extractVoiceAssistUrgency(voiceAssistMessage: Record<string, unknown> | null): string | null {
  const urgency = voiceAssistMessage?.urgency;
  return typeof urgency === "string" && urgency.trim().length > 0
    ? urgency.trim()
    : null;
}

function formatVoiceAssistDetails(voiceAssistMessage: Record<string, unknown> | null): string {
  const contents = normalizeVoiceAssistContents(voiceAssistMessage?.contents);
  if (!contents) return "";

  return Object.entries(contents)
    .map(([question, answer]) => {
      const formattedAnswer = formatVoiceAssistAnswer(answer);
      if (!formattedAnswer) return null;

      return `${formatVoiceAssistLabel(question)}: ${formattedAnswer}`;
    })
    .filter((detail): detail is string => !!detail)
    .join("; ");
}

function normalizeVoiceAssistContents(contents: unknown): Record<string, unknown> | null {
  if (typeof contents === "string") {
    const trimmed = contents.trim();
    if (!trimmed) return null;

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return normalizeVoiceAssistContents(parsed);
    } catch {
      return { message: trimmed };
    }
  }

  if (!contents || typeof contents !== "object" || Array.isArray(contents)) {
    return null;
  }

  return contents as Record<string, unknown>;
}

function formatVoiceAssistLabel(label: string): string {
  return label
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatVoiceAssistAnswer(answer: unknown): string {
  if (answer === null || answer === undefined) return "";

  if (Array.isArray(answer)) {
    return answer.map(formatVoiceAssistAnswer).filter(Boolean).join(", ");
  }

  if (typeof answer === "object") {
    return Object.entries(answer as Record<string, unknown>)
      .map(([key, value]) => {
        const formatted = formatVoiceAssistAnswer(value);
        return formatted ? `${formatVoiceAssistLabel(key)} ${formatted}` : null;
      })
      .filter((detail): detail is string => !!detail)
      .join(", ");
  }

  return String(answer).replace(/\s+/g, " ").trim();
}

function truncateSms(message: string, maxLength: number): string {
  if (message.length <= maxLength) return message;
  return `${message.slice(0, maxLength - 3).trimEnd()}...`;
}
