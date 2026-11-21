import { authenticatedFetch } from './authenticatedFetch';
import { supabase } from './supabase';

export type CommsChannel = 'in_app' | 'whatsapp' | 'sms' | 'voice' | 'email';
export interface CommsAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  status: string;
}
export interface CommsAttachmentUploadIntent {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadPath: string;
  uploadToken: string;
}
export interface CommsMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  status: string;
  providerMessageId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  attachments?: CommsAttachment[];
}
export interface CommsConversation {
  id: string;
  channel: CommsChannel;
  externalAddress: string;
  updatedAt: string;
  messages: CommsMessage[];
}
export interface CommsStatus {
  status: 'configuration_snapshot';
  enabled: boolean;
  channels: Record<string, boolean>;
  ai?: { openai?: { status: 'configured_unverified' | 'missing_credentials' } };
  note: string;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === 'string' ? body.error : `Communications request failed (HTTP ${response.status}).`;
    throw new Error(message);
  }
  return body as T;
}

export async function getCommsStatus(userId: string): Promise<CommsStatus> {
  const response = await authenticatedFetch('/api/comms/status', undefined, userId);
  return readJson<CommsStatus>(response);
}

export async function getCommsConversations(userId: string, limit = 50): Promise<CommsConversation[]> {
  const safeLimit = Number.isFinite(limit)
    ? Math.min(100, Math.max(1, Math.floor(limit)))
    : 50;
  const response = await authenticatedFetch(`/api/comms/conversations?limit=${safeLimit}`, undefined, userId);
  const body = await readJson<{ conversations: CommsConversation[] }>(response);
  return Array.isArray(body.conversations) ? body.conversations : [];
}

export interface InAppCommsReply {
  messageId: string;
  runId?: string;
  status: 'processing' | 'replied';
  reply?: { id: string; body: string; createdAt: string; status: string };
}

export async function sendInAppCommsMessage(input: {
  message: string;
  idempotencyKey: string;
}, userId: string): Promise<InAppCommsReply> {
  const response = await authenticatedFetch('/api/comms/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, userId);
  return readJson<InAppCommsReply>(response);
}

export async function getInAppCommsReply(messageId: string, userId: string): Promise<InAppCommsReply> {
  const response = await authenticatedFetch('/api/comms/chat/' + encodeURIComponent(messageId), undefined, userId);
  return readJson<InAppCommsReply>(response);
}

export async function prepareCommsAttachments(input: {
  channel: Exclude<CommsChannel, 'voice'>;
  recipient?: string;
  message: string;
  subject?: string;
  idempotencyKey: string;
  files: Array<{ name: string; mimeType: string; size: number }>;
}, userId: string): Promise<{ success: boolean; messageId: string; replayed: boolean; attachments: CommsAttachmentUploadIntent[] }> {
  const response = await authenticatedFetch('/api/comms/attachments/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, userId);
  return readJson(response);
}

export async function uploadCommsAttachment(intent: CommsAttachmentUploadIntent, file: File, userId: string): Promise<void> {
  if (!supabase) throw new Error('Secure file upload is unavailable because Supabase client configuration is missing.');
  const { data: identity, error: identityError } = await supabase.auth.getUser();
  if (identityError || !identity.user || identity.user.id !== userId) throw new Error('Your signed-in account changed. Sign in again before uploading this attachment.');
  const { error } = await supabase.storage
    .from('ryanai-comms-attachments')
    .uploadToSignedUrl(intent.uploadPath, intent.uploadToken, file, {
      contentType: file.type,
      upsert: false,
    });
  if (error) throw new Error(error.message || 'Attachment upload failed.');
}

export async function getCommsAttachmentStatuses(ids: readonly string[], userId: string): Promise<CommsAttachment[]> {
  if (!ids.length) return [];
  const query = new URLSearchParams({ ids: ids.join(',') });
  const response = await authenticatedFetch('/api/comms/attachments/status?' + query.toString(), undefined, userId);
  const body = await readJson<{ attachments: CommsAttachment[] }>(response);
  return Array.isArray(body.attachments) ? body.attachments : [];
}

export async function getCommsAttachmentDownloadUrl(id: string, userId: string): Promise<string> {
  const response = await authenticatedFetch('/api/comms/attachments/' + encodeURIComponent(id) + '/download', undefined, userId);
  const body = await readJson<{ url?: string }>(response);
  if (typeof body.url !== 'string' || !body.url.startsWith('https://')) throw new Error('The clean attachment download URL was not returned.');
  return body.url;
}

export type CommsAssistOperation = 'summarize' | 'draft' | 'translate' | 'extract_tasks';

export interface CommsAssistResult {
  operation: CommsAssistOperation;
  output: string;
  sourceMessageCount: number;
}

export async function assistCommsConversation(input: {
  operation: CommsAssistOperation;
  conversationId: string;
  language?: string;
  instruction?: string;
}, userId: string): Promise<CommsAssistResult> {
  const response = await authenticatedFetch('/api/comms/assist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, idempotencyKey: crypto.randomUUID() }),
  }, userId);
  return readJson<CommsAssistResult>(response);
}

export interface CommsApprovalRequest {
  approvalId: string;
  status: 'pending';
  expiresInSeconds: number;
  policy: { decision: string; ruleId: string };
}

export async function requestCommsApproval(input: {
  channel: CommsChannel;
  recipient?: string;
  message: string;
  subject?: string;
  idempotencyKey: string;
  attachmentIds?: string[];
}, userId: string): Promise<CommsApprovalRequest> {
  const response = await authenticatedFetch('/api/comms/approvals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, userId);
  return readJson<CommsApprovalRequest>(response);
}

export async function getCommsApprovalStatus(approvalId: string, userId: string): Promise<{
  approvalId: string;
  status: 'pending' | 'approved' | 'rejected' | 'dispatching' | 'accepted' | 'unknown' | 'failed';
  channel: CommsChannel;
  recipient: string;
  expiresAt: string;
}> {
  const response = await authenticatedFetch(`/api/comms/approvals/${encodeURIComponent(approvalId)}`, {}, userId);
  return readJson(response);
}

export async function sendCommsMessage(input: {
  channel: CommsChannel;
  recipient?: string;
  message: string;
  subject?: string;
  idempotencyKey: string;
  attachmentIds?: string[];
  approvalId: string;
}, userId: string): Promise<{ success: boolean; channel: CommsChannel; providerId: string | null; status: string; replayed?: boolean }> {
  const response = await authenticatedFetch('/api/comms/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, userId);
  return readJson(response);
}

export async function publishPhoneLinkEvent(input: {
  type: 'comms.dispatch.accepted' | 'comms.delivery.updated' | 'studio.task.updated' | 'file.ready';
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}, userId: string): Promise<{ queued: number; eventIds: string[] }> {
  const response = await authenticatedFetch('/api/phonelink/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, userId);
  return readJson(response);
}
