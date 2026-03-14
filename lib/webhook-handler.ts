import type { CallRailCallEvent, CallRailTextEvent, CompanyConfig } from "./types";
import { getCallWithTranscription, getRecordingUrl, downloadRecording } from "./callrail-client";
import { transcribeAudio } from "./transcribe";
import { summarizeForSms } from "./summarize";
import { sendSms } from "./sms";

/**
 * Handle a voicemail or missed call event.
 *
 * Pipeline:
 * 1. Check if CallRail already has a transcription in the payload
 * 2. If not, fetch call details with ?fields=transcription
 * 3. If still no transcription, download recording → Whisper STT
 * 4. Summarize via GPT-4o-mini to fit SMS length
 * 5. Forward via TextBelt
 */
export async function handleVoicemail(
  event: CallRailCallEvent,
  config: CompanyConfig,
): Promise<{ forwarded: boolean; message?: string; error?: string }> {
  const callerPhone = event.customer_phone_number;
  let transcription = event.transcription || null;

  // Step 1: Try fetching transcription from CallRail API if not in payload
  if (!transcription) {
    try {
      const callDetail = await getCallWithTranscription(
        config.accountId,
        config.apiKey,
        event.id,
      );
      transcription = callDetail.transcription || null;
    } catch (err) {
      console.warn(`[${config.label}] Failed to fetch call transcription:`, err);
    }
  }

  // Step 2: Fall back to Whisper if no transcription and recording exists
  if (!transcription && event.recording) {
    try {
      const recordingUrl = await getRecordingUrl(
        config.accountId,
        config.apiKey,
        event.id,
      );
      const mp3Buffer = await downloadRecording(recordingUrl);
      transcription = await transcribeAudio(mp3Buffer);
    } catch (err) {
      console.error(`[${config.label}] Failed to transcribe recording:`, err);
    }
  }

  // Step 3: Build the SMS
  let smsMessage: string;

  if (transcription && transcription.trim().length > 0) {
    smsMessage = await summarizeForSms(transcription, callerPhone);
  } else {
    // No transcription available — send a basic notification
    smsMessage = `VM from ${callerPhone}: New voicemail received (no transcription available). Call them back.`;
    if (smsMessage.length > 160) {
      smsMessage = `VM from ${callerPhone}: New voicemail. Call back.`;
    }
  }

  // Step 4: Forward
  try {
    await sendSms(config.forwardTo, smsMessage);
    console.log(`[${config.label}] Forwarded voicemail from ${callerPhone}`);
    return { forwarded: true, message: smsMessage };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[${config.label}] Failed to forward voicemail:`, error);
    return { forwarded: false, error };
  }
}

/**
 * Handle an incoming text message event.
 *
 * Simply forwards the text content + sender phone via SMS.
 */
export async function handleTextMessage(
  event: CallRailTextEvent,
  config: CompanyConfig,
): Promise<{ forwarded: boolean; message?: string; error?: string }> {
  const senderPhone = event.source_number;
  const content = event.content || "(empty message)";

  // Build SMS — keep under 160 chars
  const prefix = `TXT from ${senderPhone}: `;
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
