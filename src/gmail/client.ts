import { google } from "googleapis";
import type { gmail_v1 } from "googleapis";

export interface GmailClientOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  userEmail?: string;
}

let cachedOAuth2Client: InstanceType<typeof google.auth.OAuth2> | null = null;
let cachedGmail: gmail_v1.Gmail | null = null;

function getOAuth2Client(options: GmailClientOptions) {
  if (!cachedOAuth2Client) {
    const oauth2 = new google.auth.OAuth2(
      options.clientId,
      options.clientSecret,
      "https://developers.google.com/oauthplayground"
    );
    oauth2.setCredentials({ refresh_token: options.refreshToken });
    cachedOAuth2Client = oauth2;
  }
  return cachedOAuth2Client;
}

export function getGmailClient(options: GmailClientOptions): gmail_v1.Gmail {
  if (!cachedGmail) {
    const auth = getOAuth2Client(options);
    cachedGmail = google.gmail({ version: "v1", auth });
  }
  return cachedGmail;
}

export interface GmailMessagePart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number };
  parts?: GmailMessagePart[];
  headers?: Array<{ name: string; value: string }>;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    body?: { data?: string };
    parts?: GmailMessagePart[];
    mimeType?: string;
  };
  internalDate?: string;
}

export async function fetchMessage(
  gmail: gmail_v1.Gmail,
  userId: string,
  messageId: string
): Promise<GmailMessage> {
  const res = await gmail.users.messages.get({
    userId,
    id: messageId,
    format: "full",
  });
  const msg = res.data;
  if (!msg.id) throw new Error("Message has no id");
  return msg as GmailMessage;
}

export function getHeader(msg: GmailMessage, name: string): string | undefined {
  const headers = msg.payload?.headers ?? [];
  const lower = name.toLowerCase();
  return headers.find((h) => h.name?.toLowerCase() === lower)?.value;
}

/** Normalize for comparison (NFC) so emoji/unicode match Gmail’s stored names. */
function normalizeLabelName(name: string): string {
  return (name ?? "").normalize("NFC").toLowerCase();
}

/** ASCII-only skeleton for fallback match (emoji can differ between send and Gmail storage). */
function asciiSkeleton(s: string): string {
  return (s ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\x20-\x7e]/g, "");
}

/** Canonical form for matching: hyphens, no leading dash (e.g. "info-account-alert"). Handles Gmail "Info/Account Alert" vs our "info-account-alert". */
function canonicalSkeleton(s: string): string {
  return asciiSkeleton(s)
    .replace(/\s+/g, "-")
    .replace(/\//g, "-")
    .replace(/^-+/, "")
    .toLowerCase();
}

/** Match when NFC/NFD normalized names equal, or ASCII skeleton (e.g. -category-subcategory) equal. */
function labelNameMatches(want: string, listName: string): boolean {
  const n = (s: string) => (s ?? "").toLowerCase();
  const a = n(want);
  const b = n(listName);
  if (a === b) return true;
  if (a === b.normalize("NFC")) return true;
  if (a === b.normalize("NFD")) return true;
  if (a.normalize("NFD") === b) return true;
  const wantSkel = asciiSkeleton(want);
  const listSkel = asciiSkeleton(listName);
  if (wantSkel && wantSkel === listSkel) return true;
  const dash = want.indexOf("-");
  if (dash >= 0) {
    const suffix = want.slice(dash);
    const listNorm = listName.normalize("NFC").toLowerCase();
    if (listNorm.endsWith(suffix) || listNorm === suffix.slice(1)) return true;
  }
  return false;
}

/** List label IDs for the user; optionally create if missing. */
export async function ensureLabelExists(
  gmail: gmail_v1.Gmail,
  userId: string,
  labelName: string
): Promise<string> {
  const want = normalizeLabelName(labelName);

  const findExisting = (labels: gmail_v1.Schema$Label[] = []) =>
    labels.find((l) => l.name != null && labelNameMatches(want, l.name));

  let list = await gmail.users.labels.list({ userId });
  let existing = findExisting(list.data.labels ?? []);
  if (existing?.id) return existing.id;

  try {
    const create = await gmail.users.labels.create({
      userId,
      requestBody: {
        name: labelName,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      },
    });
    if (!create.data.id) throw new Error(`Failed to create label: ${labelName}`);
    return create.data.id;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const body = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? "";
    const isExistsOrConflict =
      /exists|conflict|already exists|invalid.*label|label.*invalid/i.test(msg) ||
      /exists|conflict|already exists|invalid.*label|label.*invalid/i.test(body);
    if (isExistsOrConflict) {
      list = await gmail.users.labels.list({ userId });
      const labels = list.data.labels ?? [];
      existing = findExisting(labels);
      if (!existing?.id) {
        const wantCanon = canonicalSkeleton(labelName);
        const bySkeleton = labels.filter(
          (l) =>
            l.name != null &&
            l.name !== "" &&
            (l.type === "user" || l.type === undefined) &&
            canonicalSkeleton(l.name) === wantCanon
        );
        if (bySkeleton.length >= 1 && bySkeleton[0].id)
          existing = bySkeleton[0];
      }
      if (existing?.id) return existing.id;
    }
    throw err;
  }
}

/** Add labels to a message; remove INBOX to archive. */
export async function modifyMessageLabels(
  gmail: gmail_v1.Gmail,
  userId: string,
  messageId: string,
  addLabelIds: string[],
  removeLabelIds: string[]
): Promise<void> {
  await gmail.users.messages.modify({
    userId,
    id: messageId,
    requestBody: { addLabelIds, removeLabelIds },
  });
}

/** Get INBOX label id for the user. */
export async function getInboxLabelId(
  gmail: gmail_v1.Gmail,
  userId: string
): Promise<string> {
  const list = await gmail.users.labels.list({ userId });
  const inbox = list.data.labels?.find((l) => l.id === "INBOX");
  if (!inbox?.id) throw new Error("INBOX label not found");
  return inbox.id;
}

/** Gmail system label IDs (inbox, spam, categories, etc.). Messages with only these are "unlabeled" by our system. */
const SYSTEM_LABEL_IDS = new Set([
  "INBOX",
  "SPAM",
  "TRASH",
  "UNREAD",
  "STARRED",
  "IMPORTANT",
  "SENT",
  "DRAFT",
  "CATEGORY_PERSONAL",
  "CATEGORY_SOCIAL",
  "CATEGORY_PROMOTIONS",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
]);

function hasOnlySystemLabels(labelIds: string[] | null | undefined): boolean {
  if (!labelIds?.length) return true;
  return labelIds.every((id) => SYSTEM_LABEL_IDS.has(id));
}

/**
 * List message IDs matching a query that have no user-applied label (only system labels).
 * @param query — Gmail search query (e.g. "in:inbox" or "-in:spam -in:trash" for all mail except spam/trash).
 */
export async function listMessageIdsWithoutUserLabels(
  gmail: gmail_v1.Gmail,
  userId: string,
  maxResults: number,
  query: string
): Promise<string[]> {
  const candidateSize = Math.min(maxResults * 4, 100);
  const listRes = await gmail.users.messages.list({
    userId,
    q: query,
    maxResults: candidateSize,
  });
  const candidateIds = (listRes.data.messages ?? []).map((m) => m.id!).filter(Boolean);
  if (candidateIds.length === 0) return [];

  const out: string[] = [];
  const batchSize = 10;
  for (let i = 0; i < candidateIds.length && out.length < maxResults; i += batchSize) {
    const batch = candidateIds.slice(i, i + batchSize);
    const messages = await Promise.all(
      batch.map((id) =>
        gmail.users.messages.get({ userId, id, format: "minimal" }).then((r) => r.data)
      )
    );
    for (const msg of messages) {
      if (hasOnlySystemLabels(msg.labelIds)) {
        if (msg.id) out.push(msg.id);
        if (out.length >= maxResults) break;
      }
    }
  }
  return out;
}

/** List inbox message IDs that have no user-applied label (only system labels like INBOX). */
export async function listInboxMessageIdsWithoutUserLabels(
  gmail: gmail_v1.Gmail,
  userId: string,
  maxResults: number
): Promise<string[]> {
  return listMessageIdsWithoutUserLabels(gmail, userId, maxResults, "in:inbox");
}

/** List message IDs matching a query (e.g. "in:inbox -label:AI/processed newer_than:2d"). */
export async function listMessageIds(
  gmail: gmail_v1.Gmail,
  userId: string,
  query: string,
  maxResults = 50
): Promise<string[]> {
  const res = await gmail.users.messages.list({
    userId,
    q: query,
    maxResults,
  });
  const ids = (res.data.messages ?? []).map((m) => m.id!).filter(Boolean);
  return ids;
}

/** Get current label IDs for a message (minimal fetch). */
export async function getMessageLabelIds(
  gmail: gmail_v1.Gmail,
  userId: string,
  messageId: string
): Promise<string[]> {
  const res = await gmail.users.messages.get({
    userId,
    id: messageId,
    format: "minimal",
  });
  const ids = res.data.labelIds;
  return Array.isArray(ids) ? [...ids] : [];
}
