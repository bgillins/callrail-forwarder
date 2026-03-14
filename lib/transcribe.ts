import OpenAI from "openai";
import { toFile } from "openai";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

/**
 * Transcribe an MP3 audio buffer using OpenAI gpt-4o-mini-transcribe.
 * Half the cost of whisper-1 ($0.003/min vs $0.006/min) with better accuracy.
 */
export async function transcribeAudio(mp3Buffer: Buffer): Promise<string> {
  const client = getClient();

  const file = await toFile(mp3Buffer, "voicemail.mp3", {
    type: "audio/mpeg",
  });

  const result = await client.audio.transcriptions.create({
    model: "gpt-4o-mini-transcribe",
    file,
  });

  return result.text;
}
