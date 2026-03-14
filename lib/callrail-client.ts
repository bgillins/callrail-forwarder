import type { CallDetailResponse, RecordingResponse } from "./types";

const BASE_URL = "https://api.callrail.com/v3";

async function callRailFetch<T>(
  accountId: string,
  apiKey: string,
  endpoint: string,
): Promise<T> {
  const url = `${BASE_URL}/a/${accountId}${endpoint}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Token token="${apiKey}"`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`CallRail API ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

/** Fetch call details with transcription field */
export async function getCallWithTranscription(
  accountId: string,
  apiKey: string,
  callId: string,
): Promise<CallDetailResponse> {
  return callRailFetch<CallDetailResponse>(
    accountId,
    apiKey,
    `/calls/${callId}.json?fields=transcription,call_summary`,
  );
}

/** Get the MP3 recording URL for a call */
export async function getRecordingUrl(
  accountId: string,
  apiKey: string,
  callId: string,
): Promise<string> {
  const data = await callRailFetch<RecordingResponse>(
    accountId,
    apiKey,
    `/calls/${callId}/recording.json`,
  );
  return data.url;
}

/** Download an MP3 recording as a Buffer */
export async function downloadRecording(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download recording: ${res.status}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}
