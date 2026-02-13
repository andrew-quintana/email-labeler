import * as cheerio from "cheerio";
import type { GmailMessage } from "../gmail/client.js";

export interface NormalizedEmail {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  bodyPlain: string;
  bodyHtml: string;
  /** Extracted text from HTML for LLM (normalized, no tags). */
  bodyText: string;
}

function decodeBase64Url(data: string | undefined): string {
  if (!data) return "";
  try {
    const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(base64, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

/** Get header from payload or nested parts. */
function getPartHeader(
  msg: GmailMessage,
  name: string
): string | undefined {
  const fromPayload = msg.payload?.headers?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase()
  )?.value;
  if (fromPayload) return fromPayload;
  for (const part of msg.payload?.parts ?? []) {
    const v = part.headers?.find(
      (h) => h.name?.toLowerCase() === name.toLowerCase()
    )?.value;
    if (v) return v;
  }
  return undefined;
}

/** Parse Gmail message with cheerio; produce normalized email object. */
export function parseEmail(msg: GmailMessage): NormalizedEmail {
  const from = getPartHeader(msg, "From") ?? "";
  const to = getPartHeader(msg, "To") ?? "";
  const subject = getPartHeader(msg, "Subject") ?? "";
  const date = getPartHeader(msg, "Date") ?? "";

  let bodyPlain = "";
  let bodyHtml = "";

  if (msg.payload?.body?.data) {
    const decoded = decodeBase64Url(msg.payload.body.data);
    const mime = (msg.payload.mimeType ?? "").toLowerCase();
    if (mime === "text/html") {
      bodyHtml = decoded;
      bodyPlain = cheerio.load(decoded).text();
    } else {
      bodyPlain = decoded;
    }
  }

  for (const part of msg.payload?.parts ?? []) {
    const mime = (part.mimeType ?? "").toLowerCase();
    if (mime === "text/plain" && !bodyPlain) {
      bodyPlain = decodeBase64Url(part.body?.data);
    }
    if (mime === "text/html" && !bodyHtml) {
      bodyHtml = decodeBase64Url(part.body?.data);
    }
  }

  if (!bodyPlain && bodyHtml) {
    bodyPlain = cheerio.load(bodyHtml).text();
  }

  const bodyText = bodyPlain.trim() || cheerio.load(bodyHtml || "").text().trim();
  const snippet = (msg.snippet ?? "").trim();
  const forLlm = bodyText || snippet;

  return {
    id: msg.id,
    threadId: msg.threadId ?? "",
    from,
    to,
    subject,
    date,
    snippet,
    bodyPlain,
    bodyHtml,
    bodyText: forLlm.slice(0, 25_000),
  };
}
