import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { toFile } from "openai";
import { transcribeAudio } from "@/lib/transcribe";
import { summarizeForSms } from "@/lib/summarize";
import { sendSms } from "@/lib/sms";
import { getCompanyConfigs } from "@/lib/config";

export const maxDuration = 300;

/**
 * Test endpoint — simulates the full voicemail pipeline.
 *
 * POST /api/test
 * {
 *   "text": "Hi this is John, I'm calling about getting my floors cleaned...",
 *   "companyId": "458066901",    // optional, defaults to first company
 *   "callerName": "John Smith",  // optional
 *   "callerPhone": "+17025551234", // optional
 *   "skipSms": false              // optional, set true to test without sending SMS
 * }
 *
 * Pipeline: text → TTS audio → Whisper transcription → GPT summarize → SMS
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.text) {
    return NextResponse.json(
      { error: "text is required — the voicemail script to simulate" },
      { status: 400 },
    );
  }

  const configs = getCompanyConfigs();
  const config = body.companyId
    ? configs.find((c) => c.companyId === body.companyId)
    : configs[0];

  if (!config) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const callerName = body.callerName || "Test Caller";
  const callerPhone = body.callerPhone || "+17025551234";
  const caller = `${callerName} (${callerPhone})`;
  const skipSms = body.skipSms === true;

  const steps: Record<string, unknown> = {};

  try {
    // Step 1: Generate audio from text using OpenAI TTS
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const ttsResponse = await openai.audio.speech.create({
      model: "tts-1",
      voice: "onyx",
      input: body.text,
      response_format: "mp3",
    });

    const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());
    steps.tts = {
      success: true,
      audioSizeBytes: audioBuffer.length,
    };

    // Step 2: Transcribe with Whisper
    const transcription = await transcribeAudio(audioBuffer);
    steps.transcription = {
      success: true,
      text: transcription,
    };

    // Step 3: Summarize for SMS
    const smsMessage = await summarizeForSms(transcription, caller, config.label);
    steps.summarize = {
      success: true,
      message: smsMessage,
      length: smsMessage.length,
    };

    // Step 4: Send SMS (unless skipped)
    if (!skipSms) {
      await sendSms(config.forwardTo, smsMessage);
      steps.sms = { success: true, sentTo: config.forwardTo };
    } else {
      steps.sms = { skipped: true };
    }

    return NextResponse.json({
      success: true,
      company: config.label,
      originalText: body.text,
      steps,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, steps, error },
      { status: 500 },
    );
  }
}
