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
  companyLabel: string,
): Promise<string> {
  const phonePrefix = `[${companyLabel}] VM from ${caller}: `;
  const maxBodyLength = 160 - phonePrefix.length;

  const response = await getClient().chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 100,
    messages: [
      {
        role: "system",
        content: `You summarize voicemail transcriptions into SMS-length notes (${maxBodyLength} chars max). Focus on WHAT the caller wants: the service they need, materials/surfaces mentioned, and any details like timeline or location. Never editorialize, judge tone, or suggest whether action is needed — just relay what was said. Examples: "Asking about marble countertop polishing, wants a quote." / "Needs travertine tile repair in kitchen, asking for availability this week." If the caller mentions a specific stone, surface, or service, always include it.`,
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
