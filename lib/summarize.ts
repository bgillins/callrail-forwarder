import OpenAI from "openai";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

/**
 * Summarize a voicemail transcription into an SMS-ready message.
 * Output is kept under 160 characters (single SMS segment) including
 * the caller identity prefix.
 */
export async function summarizeForSms(
  transcription: string,
  caller: string,
): Promise<string> {
  const phonePrefix = `VM from ${caller}: `;
  const maxBodyLength = 160 - phonePrefix.length;

  const response = await getClient().chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 100,
    messages: [
      {
        role: "system",
        content: `You are an SMS forwarding assistant. Summarize voicemail transcriptions into brief, actionable messages. The summary MUST be ${maxBodyLength} characters or fewer. Include the key intent and any callback request. No quotes, no labels, just the summary.`,
      },
      {
        role: "user",
        content: transcription,
      },
    ],
  });

  const summary =
    response.choices[0]?.message?.content?.trim() ||
    "Voicemail received (unable to summarize)";

  // Hard-truncate if model exceeded limit
  const truncated =
    summary.length > maxBodyLength
      ? summary.slice(0, maxBodyLength - 3) + "..."
      : summary;

  return `${phonePrefix}${truncated}`;
}
