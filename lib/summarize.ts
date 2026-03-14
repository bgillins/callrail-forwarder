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
        content: `You summarize voicemail transcriptions into SMS-length notes (${maxBodyLength} chars max).

Rules:
- Relay what the caller said in plain language. Always produce a summary even if the message is short or unclear.
- Focus on: what service or help they want, any materials/surfaces/stone types mentioned, timeline, and whether they asked for a quote or callback.
- Never editorialize, judge tone, or say things like "no action needed" or "seems unsure." Just report what was said.
- If the message is unclear or brief, describe what you can hear: "Called asking about stone services, wants a callback." Never say "no actionable request."

Examples:
- "Asking about marble countertop polishing, wants a quote."
- "Needs travertine tile repair in kitchen, asking for availability this week."
- "Inquiring about stone cleaning services, requested a callback."
- "Left a message asking about getting floors done, wants a call back."`,
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
