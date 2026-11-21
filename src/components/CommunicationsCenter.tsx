import type { PhoneLinkSettings } from '@/lib/settingsPreferences';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Activity, BrainCircuit, Download, Mail, MessageCircle, Paperclip, Phone, RefreshCw, Send, ShieldCheck, Smartphone } from 'lucide-react';
import {
  getCommsAttachmentDownloadUrl, getCommsAttachmentStatuses, getCommsConversations,
  getCommsStatus, prepareCommsAttachments, requestCommsApproval, getCommsApprovalStatus,
  sendCommsMessage, assistCommsConversation, uploadCommsAttachment, publishPhoneLinkEvent,
  sendInAppCommsMessage, getInAppCommsReply,
  type CommsAttachment, type CommsChannel, type CommsConversation, type CommsStatus,
} from '@/lib/commsApi';

const channels: { id: CommsChannel; label: string; icon: typeof MessageCircle }[] = [
  { id: 'in_app', label: 'RyanAI chat', icon: MessageCircle },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { id: 'sms', label: 'SMS', icon: MessageCircle },
  { id: 'voice', label: 'Voice call', icon: Phone },
  { id: 'email', label: 'Email', icon: Mail },
];

const statusChannels = [
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { id: 'sms', label: 'SMS', icon: MessageCircle },
  { id: 'voice', label: 'Voice call', icon: Phone },
  { id: 'email', label: 'Outbound email (SMTP)', icon: Mail },
  { id: 'inboundEmail', label: 'Inbound email (Resend)', icon: Mail },
  { id: 'attachments', label: 'Private attachments', icon: Paperclip },
  { id: 'openai', label: 'Central OpenAI API', icon: BrainCircuit },
];

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString();
}

export default function CommunicationsCenter({ userId, phoneLinkSettings }: { userId: string; phoneLinkSettings?: PhoneLinkSettings }) {
  const refreshRequestId = useRef(0);
  const [status, setStatus] = useState<CommsStatus | null>(null);
  const [conversations, setConversations] = useState<CommsConversation[]>([]);
  const [activeId, setActiveId] = useState('');
  const [channel, setChannel] = useState<CommsChannel>('whatsapp');
  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [attachmentStatuses, setAttachmentStatuses] = useState<CommsAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [approvalId, setApprovalId] = useState('');
  const [approvalStatus, setApprovalStatus] = useState('');
  const [assistBusy, setAssistBusy] = useState(false);
  const [assistOutput, setAssistOutput] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conversationSearch, setConversationSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState<'all' | CommsChannel>('all');
  const attachmentsEnabled = status?.channels?.attachments === true;
  const communicationsEnabled = status?.enabled === true;

  function startNewDraft() {
    setApprovalId('');
    setApprovalStatus('');
    setIdempotencyKey(crypto.randomUUID());
    setAttachmentIds([]);
    setAttachmentStatuses([]);
  }

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestId.current;
    try {
      const [statusResult, conversationsResult] = await Promise.allSettled([
        getCommsStatus(userId), getCommsConversations(userId),
      ]);
      if (requestId !== refreshRequestId.current) return;
      const failures: string[] = [];
      if (statusResult.status === 'fulfilled') setStatus(statusResult.value);
      else failures.push(statusResult.reason instanceof Error ? statusResult.reason.message : 'Channel status is unavailable.');
      if (conversationsResult.status === 'fulfilled') {
        const nextConversations = conversationsResult.value;
        setConversations(nextConversations);
        setActiveId((current) => current && nextConversations.some((item) => item.id === current)
          ? current : nextConversations[0]?.id ?? '');
      } else failures.push(conversationsResult.reason instanceof Error ? conversationsResult.reason.message : 'Conversation history is unavailable.');
      setError(failures.length === 2
        ? failures.join(' ')
        : failures.length === 1 ? `Some Comms information is unavailable. ${failures[0]}` : '');
    } finally {
      if (requestId === refreshRequestId.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    let disposed = false;
    const runRefresh = () => {
      if (!disposed) void refresh();
    };
    queueMicrotask(runRefresh);
    const interval = window.setInterval(runRefresh, 15000);
    return () => {
      disposed = true;
      refreshRequestId.current += 1;
      window.clearInterval(interval);
    };
  }, [refresh]);

  const active = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [conversations, activeId],
  );
  const visibleConversations = useMemo(() => {
    const query = conversationSearch.trim().toLowerCase();
    return conversations.filter((conversation) => {
      if (channelFilter !== 'all' && conversation.channel !== channelFilter) return false;
      if (!query) return true;
      return conversation.externalAddress.toLowerCase().includes(query)
        || conversation.messages.some((item) => item.body.toLowerCase().includes(query));
    });
  }, [conversations, conversationSearch, channelFilter]);

  const messageCount = conversations.reduce((total, item) => total + item.messages.length, 0);
  const inboundCount = active?.messages.filter(item => item.direction === 'inbound').length ?? 0;
  const outboundCount = active?.messages.filter(item => item.direction === 'outbound').length ?? 0;
  const configuredChannelCount = [status?.channels?.whatsapp, status?.channels?.sms, status?.channels?.voice, status?.channels?.email]
    .filter(value => value === true).length;

  async function runConversationAssist(operation: 'summarize' | 'draft' | 'translate' | 'extract_tasks') {
    if (!active?.id || assistBusy) return;
    setAssistBusy(true);
    setAssistOutput('');
    setError('');
    try {
      const result = await assistCommsConversation({
        operation,
        conversationId: active.id,
        language: operation === 'translate' ? 'en-ZA' : undefined,
      }, userId);
      setAssistOutput(result.output);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Communications intelligence is unavailable.');
    } finally {
      setAssistBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim() || sending) return;
    setError('');
    setNotice('');
    setReviewing(true);
  }

  async function dispatchReviewedMessage() {
    if (!reviewing || !message.trim() || sending) return;
    setSending(true);
    setError('');
    setNotice('');
    try {
      if (channel === 'in_app') {
        if (selectedFiles.length || attachmentIds.length) throw new Error('File attachments are not enabled for private in-app chat yet.');
        let outcome = await sendInAppCommsMessage({ message: message.trim(), idempotencyKey }, userId);
        for (let attempt = 0; outcome.status === 'processing' && outcome.messageId && attempt < 20; attempt += 1) {
          await new Promise(resolve => window.setTimeout(resolve, 1500));
          outcome = await getInAppCommsReply(outcome.messageId, userId);
        }
        setNotice(outcome.status === 'replied'
          ? 'RyanAI has replied. Your private conversation has been saved.'
          : 'Your message is saved. RyanAI is still processing it; the conversation will show the reply when the AgentRun completes.');
        setMessage('');
        setSelectedFiles([]);
        setAttachmentIds([]);
        setAttachmentStatuses([]);
        setApprovalId('');
        setApprovalStatus('');
        startNewDraft();
        await refresh();
        return;
      }
      let currentIds = attachmentIds;

      if (
        (selectedFiles.length > 0 || currentIds.length > 0) &&
        !attachmentsEnabled
      ) {
        throw new Error(
          'Private attachments are unavailable until storage and malware scanning are configured.'
        );
      }

      if (selectedFiles.length) {
        if (channel === 'voice') throw new Error('Voice calls cannot include file attachments.');
        if (selectedFiles.length > 8 || selectedFiles.reduce((sum, file) => sum + file.size, 0) > 40 * 1024 * 1024) {
          throw new Error('Choose at most 8 files with a combined size no larger than 40 MiB.');
        }
        const prepared = await prepareCommsAttachments({
          channel,
          message: message.trim(),
          idempotencyKey,
          files: selectedFiles.map(file => ({ name: file.name, mimeType: file.type, size: file.size })),
          ...(recipient.trim() ? { recipient: recipient.trim() } : {}),
          ...(channel === 'email' && subject.trim() ? { subject: subject.trim() } : {}),
        }, userId);
        currentIds = prepared.attachments.map(item => item.id);
        setAttachmentIds(currentIds);
        const beforeUpload = await getCommsAttachmentStatuses(currentIds, userId);
        const byId = new Map(beforeUpload.map(item => [item.id, item]));
        for (const [index, intent] of prepared.attachments.entries()) {
          if (byId.get(intent.id)?.status !== 'missing') continue;
          const file = selectedFiles[index];
          if (!file) throw new Error('The selected attachment list changed; please select the files again.');
          await uploadCommsAttachment(intent, file, userId);
        }
        const states = await getCommsAttachmentStatuses(currentIds, userId);
        setAttachmentStatuses(states);
        if (states.some(item => item.status === 'missing')) {
          throw new Error('One or more files are not uploaded yet. Retry to finish the secure upload.');
        }
        setSelectedFiles([]);
        if (states.some(item => item.status !== 'clean')) {
          setNotice('Files are uploaded and queued for malware scanning. RyanAI will send only after every scan is clean. Press Check and send again to refresh.');
          return;
        }
      } else if (currentIds.length) {
        const states = await getCommsAttachmentStatuses(currentIds, userId);
        setAttachmentStatuses(states);
        if (states.some(item => item.status !== 'clean')) {
          setNotice(states.some(item => item.status === 'infected' || item.status === 'failed')
            ? 'An attachment was blocked by the security scanner. Remove the files and select clean replacements.'
            : 'Attachments are still being scanned. Press Check and send again after every file is clean.');
          return;
        }
      }
      const approval = await requestCommsApproval({
        channel,
        message: message.trim(),
        idempotencyKey,
        ...(recipient.trim() ? { recipient: recipient.trim() } : {}),
        ...(channel === 'email' && subject.trim() ? { subject: subject.trim() } : {}),
        ...(currentIds.length ? { attachmentIds: currentIds } : {}),
      }, userId);
      setApprovalId(approval.approvalId);
      setApprovalStatus('pending');
      setNotice(`Owner approval requested. From your verified WhatsApp number, reply exactly: APPROVE ${approval.approvalId} or REJECT ${approval.approvalId}. Then check the approval status here. No provider dispatch has occurred.`);
      setReviewing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The message could not be sent.');
    } finally {
      setSending(false);
      setReviewing(false);
    }
  }

  async function checkApprovalStatus() {
    if (!approvalId || sending) return;
    setSending(true);
    setError('');
    try {
      const result = await getCommsApprovalStatus(approvalId, userId);
      setApprovalStatus(result.status);
      setNotice(result.status === 'approved'
        ? 'Your verified Comms reply approved this exact message. Select Send approved message to dispatch it.'
        : result.status === 'rejected'
          ? 'Your Comms reply rejected this message. It cannot be dispatched.'
          : result.status === 'pending'
            ? 'Still awaiting your verified Comms reply. No provider dispatch has occurred.'
            : `Approval state: ${result.status}. This request is not ready to send.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Approval status could not be checked.');
    } finally {
      setSending(false);
    }
  }

  async function sendApprovedMessage() {
    if (!approvalId || approvalStatus !== 'approved' || sending) return;
    setSending(true);
    setError('');
    setNotice('');
    try {
      const result = await sendCommsMessage({
        channel,
        message: message.trim(),
        idempotencyKey,
        approvalId,
        ...(recipient.trim() ? { recipient: recipient.trim() } : {}),
        ...(channel === 'email' && subject.trim() ? { subject: subject.trim() } : {}),
        ...(attachmentIds.length ? { attachmentIds } : {}),
      }, userId);
      let phoneLinkQueued = 0;
      if (!result.replayed && phoneLinkSettings?.notifyComms !== false) {
        try {
          const bridge = await publishPhoneLinkEvent({
            type: 'comms.dispatch.accepted',
            title: 'RyanAI Comms update',
            body: `${result.channel} request accepted by provider (${result.status}). Delivery still requires a provider status callback.`,
            metadata: { channel: result.channel, status: result.status },
          }, userId);
          phoneLinkQueued = bridge.queued;
        } catch {
          // The provider dispatch result remains authoritative.
        }
      }
      setNotice((result.replayed
        ? `Duplicate submission suppressed. Existing request status: ${result.status}. No second provider request was sent.`
        : `${result.channel} request accepted by provider (${result.status}). Delivery requires a verified provider callback.`)
        + (phoneLinkQueued ? ` PhoneLink queued an update for ${phoneLinkQueued} paired device(s).` : ''));
      setMessage('');
      setSelectedFiles([]);
      setAttachmentIds([]);
      setAttachmentStatuses([]);
      setApprovalId('');
      setApprovalStatus('');
      startNewDraft();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The approved message could not be sent.');
    } finally {
      setSending(false);
    }
  }

  async function downloadAttachment(attachment: CommsAttachment) {
    try {
      const url = await getCommsAttachmentDownloadUrl(attachment.id, userId);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.name;
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Attachment download is unavailable.');
    }
  }

  function clearAttachmentDraft() {
    setSelectedFiles([]);
    setAttachmentIds([]);
    setAttachmentStatuses([]);
    startNewDraft();
  }

  return (
    <section className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:p-8" aria-labelledby="comms-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300">Unified communications</p>
          <h1 id="comms-title" className="mt-2 text-2xl font-semibold text-white sm:text-3xl">RyanAI Comms</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">Private in-app chat with RyanAI, plus WhatsApp, SMS, voice and email through one authenticated API and durable conversation history.</p>
          <a href="#/phonelink" className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-cyan-300 hover:text-cyan-200"><Smartphone className="h-4 w-4" /> Manage PhoneLink destinations</a>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/30 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-400/10 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {loading && !status && !error && (
        <div role="status" aria-live="polite" className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] p-4 text-sm text-cyan-100">
          <div className="flex items-center gap-3"><RefreshCw className="h-4 w-4 animate-spin" /> Loading Comms configuration and persisted conversation history…</div>
          <p className="mt-2 text-xs text-cyan-100/60">RyanAI is contacting the authenticated Comms API. This can take a moment on a cold-started backend.</p>
        </div>
      )}

      {status && !communicationsEnabled && (
        <div role="status" aria-live="polite" className="rounded-xl border border-amber-300/20 bg-amber-300/[0.04] p-4 text-sm text-amber-100">
          <p className="font-semibold">Outbound Comms is currently disabled by the server configuration.</p>
          <p className="mt-1 text-xs text-amber-100/70">Private in-app chat remains available. External provider credentials and explicit outbound test authorization are separate gates and are not enabled by this UI.</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {statusChannels.map(({ id, label, icon: Icon }) => {
          const configured = id === 'openai'
            ? status?.ai?.openai?.status === 'configured_unverified'
            : status?.channels?.[id] === true;
          const statusLabel = id === 'attachments'
            ? configured ? 'Configured · scan-gated' : 'Disabled · storage/scanner required'
            : configured ? 'Configured · unverified' : 'Credentials missing';
          const statusDetail = id === 'attachments'
            ? 'Uploads require owner-bound private storage and the malware scanner; every file must pass its scan before sending.'
            : 'Configuration presence only; live connectivity is not implied.';
          return (
            <div key={id} className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium text-slate-200"><Icon className="h-4 w-4 text-cyan-300" />{label}</span>
                <span className={`rounded-full px-2 py-1 text-[10px] ${configured ? 'bg-amber-400/10 text-amber-200' : 'bg-slate-700 text-slate-300'}`}>{statusLabel}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">{statusDetail}</p>
            </div>
          );
        })}
      </div>

      <section aria-label="Conversation intelligence" className="rounded-xl border border-cyan-400/15 bg-slate-950/60 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Conversation intelligence</p>
            <p className="mt-1 text-xs text-slate-500">Owner-scoped analysis of persisted history. Analysis and drafts never authorize dispatch.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void runConversationAssist('summarize')} disabled={!active || assistBusy} className="rounded-lg border border-cyan-400/20 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40">Summarize</button>
            <button type="button" onClick={() => void runConversationAssist('draft')} disabled={!active || assistBusy} className="rounded-lg border border-cyan-400/20 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40">Draft reply</button>
            <button type="button" onClick={() => void runConversationAssist('translate')} disabled={!active || assistBusy} className="rounded-lg border border-cyan-400/20 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40">Translate</button>
            <button type="button" onClick={() => void runConversationAssist('extract_tasks')} disabled={!active || assistBusy} className="rounded-lg border border-cyan-400/20 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40">Extract tasks</button>
          </div>
        </div>
        {assistBusy && <p className="mt-3 text-xs text-cyan-200">RyanAI is analysing the selected conversation…</p>}
        {assistOutput && <div role="region" aria-label="Conversation intelligence result" className="mt-3 rounded-lg border border-white/10 bg-slate-900/70 p-3 text-sm leading-6 text-slate-200"><pre className="whitespace-pre-wrap font-sans">{assistOutput}</pre></div>}
      </section>

      <section aria-label="Communication overview" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <article className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Conversations</p>
          <p className="mt-2 text-2xl font-semibold text-white">{conversations.length}</p>
          <p className="mt-1 text-[11px] text-slate-500">{visibleConversations.length} match current filters</p>
        </article>
        <article className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Messages loaded</p>
          <p className="mt-2 text-2xl font-semibold text-white">{messageCount}</p>
          <p className="mt-1 text-[11px] text-slate-500">Persisted conversation history</p>
        </article>
        <article className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Configured channels</p>
          <p className="mt-2 text-2xl font-semibold text-white">{configuredChannelCount}<span className="text-sm font-normal text-slate-500"> / 4</span></p>
          <p className="mt-1 text-[11px] text-slate-500">Configuration only, not connectivity</p>
        </article>
        <article className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Attachments</p>
          <p className={`mt-2 text-lg font-semibold ${attachmentsEnabled ? 'text-amber-200' : 'text-slate-300'}`}>{attachmentsEnabled ? 'Scan-gated' : 'Disabled'}</p>
          <p className="mt-1 text-[11px] text-slate-500">Only clean scans can be shared</p>
        </article>
      </section>

      <div role="note" aria-label="Attachment security" className="flex items-start gap-3 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.04] p-4 text-sm text-cyan-100">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" />
        <div><p className="font-semibold">Private Comms attachments</p><p className="mt-1 text-xs leading-5 text-cyan-100/70">{attachmentsEnabled ? 'The API reports private storage and scanner controls as configured. Sending and downloading remain blocked until each file has a clean scan. RyanAI does not yet interpret uploaded images, audio, video or documents.' : 'File selection is available. Upload and sharing are accepted only when owner-bound private storage and malware scanning are configured; the API enforces this gate and rejects unsafe or unavailable uploads.'}</p></div>
      </div>
      {error && <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-950/30 p-3 text-sm text-rose-200">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-cyan-400/20 bg-cyan-950/20 p-3 text-sm text-cyan-100">{notice}</p>}

      <div className="grid min-h-[560px] gap-4 xl:grid-cols-[minmax(230px,0.72fr)_minmax(0,1.7fr)_minmax(220px,0.7fr)]">
        <aside className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/60">
          <div className="space-y-3 border-b border-white/10 p-4">
            <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold text-white">Conversations</h2><span className="text-xs text-slate-500">{visibleConversations.length} / {conversations.length}</span></div>
            <label className="block text-[11px] text-slate-500">Search messages or addresses<input value={conversationSearch} onChange={event => setConversationSearch(event.target.value)} maxLength={120} placeholder="Search this inbox…" className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white placeholder:text-slate-600" /></label>
            <label className="block text-[11px] text-slate-500">Channel<select value={channelFilter} onChange={event => setChannelFilter(event.target.value as 'all' | CommsChannel)} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white"><option value="all">All channels</option>{channels.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          </div>
          <div className="max-h-[680px] overflow-y-auto">
            {loading && <p role="status" className="p-4 text-sm text-slate-400">Loading persisted conversation history…</p>}
            {!loading && error && conversations.length === 0 && <div className="space-y-2 p-4"><p className="text-sm text-rose-200">Conversation history could not be loaded.</p><button type="button" onClick={() => void refresh()} className="rounded-lg border border-cyan-400/20 px-3 py-2 text-xs text-cyan-200 hover:bg-cyan-400/10">Retry history</button></div>}
            {!loading && !error && conversations.length === 0 && <p className="p-4 text-sm text-slate-500">No persisted conversations yet. New inbound and outbound events will appear here.</p>}
            {!loading && conversations.length > 0 && visibleConversations.length === 0 && <p className="p-4 text-sm text-slate-500">No conversations match these filters.</p>}
            {visibleConversations.map((conversation) => (
              <button key={conversation.id} type="button" onClick={() => setActiveId(conversation.id)} className={`block w-full border-b border-white/5 p-4 text-left hover:bg-white/5 ${activeId === conversation.id ? 'bg-cyan-400/10' : ''}`}>
                <span className="flex items-center justify-between gap-2 text-xs uppercase tracking-wide text-cyan-200">
                  {conversation.channel === 'in_app' ? 'RyanAI chat' : conversation.channel}<span className="truncate text-slate-500 normal-case">{conversation.externalAddress}</span>
                </span>
                <span className="mt-2 block truncate text-sm text-slate-200">{conversation.messages.at(-1)?.body ?? 'No message content'}</span>
                <span className="mt-1 block text-[11px] text-slate-500">{dateLabel(conversation.updatedAt)}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-900/60">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-white">{active ? (active.channel === 'in_app' ? 'RYANAI CHAT' : active.channel.toUpperCase()) : 'Conversation timeline'}</h2>
              <p className="text-xs text-slate-500">{active?.externalAddress ?? 'Select a conversation to inspect its history'}</p>
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><ShieldCheck className="h-3.5 w-3.5 text-cyan-300" /> Owner-only history</span>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {active?.messages.map((item) => (
              <div key={item.id} className={`flex ${item.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                <article className={`max-w-[85%] rounded-xl border p-3 ${item.direction === 'outbound' ? 'border-cyan-400/20 bg-cyan-950/40' : 'border-white/10 bg-slate-800/70'}`}>
                  <p className="whitespace-pre-wrap break-words text-sm text-slate-100">{item.body}</p>
                  {item.attachments?.map((attachment) => (
                    <div key={attachment.id} className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-950/40 p-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs text-slate-200">{attachment.name}</p>
                        <p className="mt-0.5 text-[10px] text-slate-500">{Math.ceil(attachment.size / 1024)} KB · {attachment.status}</p>
                      </div>
                      {attachment.status === 'clean' && <button type="button" onClick={() => void downloadAttachment(attachment)} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-cyan-400/30 px-2 py-1 text-[10px] text-cyan-200 hover:bg-cyan-400/10"><Download className="h-3 w-3" />Download</button>}
                    </div>
                  ))}
                  <p className="mt-2 flex items-center gap-2 text-[10px] text-slate-400"><Activity className="h-3 w-3" />{item.direction} · {item.status} · {dateLabel(item.createdAt)}</p>
                </article>
              </div>
            ))}
            {!active && <p className="text-sm text-slate-500">Conversation messages will be shown here after the first event is persisted.</p>}
          </div>

          <form onSubmit={submit} className="space-y-3 border-t border-white/10 bg-slate-950/50 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-slate-400">Channel
                <select value={channel} disabled={reviewing || sending} onChange={(event) => { setChannel(event.target.value as CommsChannel); startNewDraft(); }} className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white">
                  {channels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              {channel !== 'in_app' && <label className="space-y-1 text-xs text-slate-400">Recipient (optional; defaults to owner)
                <input value={recipient} disabled={reviewing || sending} onChange={(event) => { setRecipient(event.target.value); startNewDraft(); }} placeholder={channel === 'email' ? 'name@example.com' : '+27…'} className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white" />
              </label>}
            </div>
            {channel === 'email' && <label className="block space-y-1 text-xs text-slate-400">Subject
              <input value={subject} disabled={reviewing || sending} onChange={(event) => { setSubject(event.target.value); startNewDraft(); }} maxLength={180} placeholder="RyanAI update" className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white" />
            </label>}
            <label className="block space-y-1 text-xs text-slate-400">Message
              <textarea value={message} disabled={reviewing || sending} onChange={(event) => { setMessage(event.target.value); startNewDraft(); }} required maxLength={4000} rows={3} placeholder={channel === 'in_app' ? 'Message RyanAI privately…' : 'Write a message for RyanAI to send…'} className="w-full resize-y rounded-lg border border-white/10 bg-slate-900 p-3 text-sm text-white placeholder:text-slate-600" />
            </label>
            <div className="space-y-2">
              {channel !== 'in_app' && <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5">
                <Paperclip className="h-4 w-4 text-cyan-300" /> Attach files
                <input type="file" multiple disabled={sending || reviewing || channel === 'voice'} accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg,audio/mp4,application/pdf,text/plain,text/markdown,text/csv,application/json,application/xml,application/zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation" className="sr-only" onChange={(event) => { setSelectedFiles(Array.from(event.target.files ?? [])); setAttachmentIds([]); setAttachmentStatuses([]); setIdempotencyKey(crypto.randomUUID()); }} />
              </label>}
              {selectedFiles.length > 0 && <div className="space-y-1 rounded-lg border border-white/10 p-2">
                {selectedFiles.map((file, index) => <p key={index} className="truncate text-xs text-slate-400">{file.name} · {Math.ceil(file.size / 1024)} KB</p>)}
              </div>}
              {attachmentStatuses.length > 0 && <div className="space-y-1 rounded-lg border border-white/10 p-2">
                {attachmentStatuses.map(file => <p key={file.id} className="truncate text-xs text-slate-400">{file.name} · scan: {file.status}</p>)}
              </div>}
              {attachmentIds.length > 0 && <button type="button" onClick={clearAttachmentDraft} disabled={sending} className="text-xs text-rose-300 hover:text-rose-200">Remove attached files</button>}
            </div>
            {approvalId && <div role="status" aria-label="Owner Comms approval" className="space-y-2 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.04] p-3 text-xs text-cyan-50">
              <p className="font-semibold">Human approval through RyanAI Comms</p>
              <p>Status: <span className="font-semibold uppercase">{approvalStatus || 'pending'}</span></p>
              <p className="break-all text-cyan-100/80">Approval ID: {approvalId}</p>
              <p className="leading-5 text-cyan-100/80">From your verified owner WhatsApp number, send exactly one reply to RyanAI: <strong>APPROVE {approvalId}</strong> or <strong>REJECT {approvalId}</strong>. The signed inbound webhook records your decision against this exact message. No message is dispatched before that approval.</p>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void checkApprovalStatus()} disabled={sending} className="rounded-lg border border-cyan-300/30 px-3 py-2 text-xs text-cyan-100 hover:bg-cyan-300/10 disabled:opacity-50">{sending ? 'Checking…' : 'Check approval status'}</button>
                {approvalStatus === 'approved' && <button type="button" onClick={() => void sendApprovedMessage()} disabled={sending || !communicationsEnabled} className="rounded-lg bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-50">{sending ? 'Sending…' : 'Send approved message'}</button>}
              </div>
            </div>}
            {reviewing && <div role="status" aria-label="Message review" className="rounded-lg border border-amber-300/20 bg-amber-300/[0.04] p-3 text-xs text-amber-100">
              <p className="font-semibold">{channel === 'in_app' ? 'Send private message to RyanAI' : 'Review before dispatch'}</p>
              <p className="mt-1 text-amber-100/75">{channel === 'in_app' ? 'This message stays in your owner-only RyanAI conversation and is processed through a durable AgentRun. No external provider message is sent.' : 'Check the channel, recipient and exact message. This creates a pending request only. RyanAI waits for your separate, verified Comms reply before dispatch.'}</p>
              {channel !== 'in_app' && <p className="mt-2 break-all text-slate-200">Channel: {channel} · Recipient: {recipient.trim() || 'Owner default'}</p>}
              {channel === 'email' && subject.trim() && <p className="mt-1 text-slate-300">Subject: {subject}</p>}
              <p className="mt-2 whitespace-pre-wrap break-words text-slate-100">{message}</p>
            </div>}
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-slate-500">Provider acceptance is not a delivery receipt. Attachments are sent only after clean scans.</p>
              {reviewing ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button type="button" onClick={() => setReviewing(false)} disabled={sending} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50">Back to edit</button>
                  <button type="button" onClick={() => void dispatchReviewedMessage()} disabled={sending || !message.trim() || (channel !== 'in_app' && !communicationsEnabled)} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">
                    <ShieldCheck className="h-4 w-4" />{sending ? 'Working…' : channel === 'in_app' ? 'Send to RyanAI' : communicationsEnabled ? 'Request owner approval' : 'Outbound disabled'}
                  </button>
                </div>
              ) : (
                <button type="submit" disabled={sending || !message.trim() || (channel !== 'in_app' && !communicationsEnabled)} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">
                  <Send className="h-4 w-4" />{channel === 'in_app' ? 'Chat with RyanAI' : 'Review message'}
                </button>
              )}
            </div>
          </form>
        </div>

        <aside aria-label="Conversation details" className="space-y-4 rounded-xl border border-white/10 bg-slate-900/60 p-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Context panel</p>
            <h2 className="mt-2 text-sm font-semibold text-white">Conversation details</h2>
            <p className="mt-1 text-xs text-slate-500">Verified details from the selected persisted thread.</p>
          </div>
          {active ? <>
            <section className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Channel identity</p>
              <p className="mt-2 break-all text-sm font-medium text-slate-100">{active.externalAddress}</p>
              <p className="mt-1 text-xs capitalize text-cyan-200">{active.channel}</p>
            </section>
            <section className="space-y-3">
              <h3 className="text-xs font-semibold text-slate-200">Conversation activity</h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-slate-950/50 p-3"><p className="text-[10px] text-slate-500">Messages</p><p className="mt-1 text-xl text-white">{active.messages.length}</p></div>
                <div className="rounded-lg bg-slate-950/50 p-3"><p className="text-[10px] text-slate-500">Inbound</p><p className="mt-1 text-xl text-white">{inboundCount}</p></div>
                <div className="rounded-lg bg-slate-950/50 p-3"><p className="text-[10px] text-slate-500">Outbound</p><p className="mt-1 text-xl text-white">{outboundCount}</p></div>
                <div className="rounded-lg bg-slate-950/50 p-3"><p className="text-[10px] text-slate-500">Latest event</p><p className="mt-1 text-xs text-slate-200">{dateLabel(active.updatedAt)}</p></div>
              </div>
            </section>
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-200">Latest message status</h3>
              <p className="rounded-lg border border-white/10 bg-slate-950/40 p-3 text-xs text-slate-300">{active.messages.at(-1)?.status ?? 'No message status available'}</p>
              <p className="text-[11px] leading-5 text-slate-500">Provider acceptance is not a delivery receipt. Final delivery state depends on a verified provider callback.</p>
            </section>
          </> : <p className="rounded-lg border border-dashed border-white/10 p-4 text-xs leading-5 text-slate-500">Select a conversation to inspect its channel identity, message counts and latest recorded status.</p>}
          <section className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.04] p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-cyan-100"><ShieldCheck className="h-4 w-4" /> Privacy boundary</div>
            <p className="mt-2 text-[11px] leading-5 text-slate-400">This panel displays only the owner-authorised thread returned by the Comms API. Cross-channel identity linking, AI memory retrieval and agent handover are not enabled by this view.</p>
          </section>
        </aside>
      </div>
    </section>
  );
}
