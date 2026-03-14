import type { RecordingResponse } from "./types";

const BASE_URL = "https://api.callrail.com/v3";

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Token token="${apiKey}"`,
    "Content-Type": "application/json",
  };
}

async function callRailFetch<T>(
  accountId: string,
  apiKey: string,
  endpoint: string,
): Promise<T> {
  const url = `${BASE_URL}/a/${accountId}${endpoint}`;
  const res = await fetch(url, { headers: authHeaders(apiKey) });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`CallRail API ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Fetch the MP3 recording for a call.
 *
 * The webhook's `recording` field is an authenticated API URL like:
 *   https://api.callrail.com/v3/a/{account_id}/calls/{id}/recording.json
 * which returns JSON: { "url": "https://...mp3-redirect-url" }
 *
 * We call that URL with auth, get the redirect URL, then download the MP3.
 */
export async function fetchRecording(
  apiKey: string,
  recordingApiUrl: string,
): Promise<Buffer> {
  // Step 1: Call the recording API URL (with auth) to get the MP3 redirect URL
  const res = await fetch(recordingApiUrl, { headers: authHeaders(apiKey) });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`CallRail recording API ${res.status}: ${text}`);
  }

  const data = (await res.json()) as RecordingResponse;
  if (!data.url) {
    throw new Error("CallRail recording API returned no URL");
  }

  // Step 2: Download the actual MP3 from the redirect URL (no auth needed)
  const mp3Res = await fetch(data.url);
  if (!mp3Res.ok) {
    throw new Error(`Failed to download MP3: ${mp3Res.status}`);
  }

  const arrayBuf = await mp3Res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/**
 * Fallback: fetch recording via call ID if the webhook recording URL isn't available.
 */
export async function fetchRecordingByCallId(
  accountId: string,
  apiKey: string,
  callId: string,
): Promise<Buffer> {
  const recordingApiUrl = `${BASE_URL}/a/${accountId}/calls/${callId}/recording.json`;
  return fetchRecording(apiKey, recordingApiUrl);
}

/** Download an MP3 recording directly from a URL (no auth) */
export async function downloadRecording(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download recording: ${res.status}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}
