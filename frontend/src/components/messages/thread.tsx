"use client";

import Link from "next/link";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  AtSign, Clapperboard, CornerUpLeft, Download, FileText, Link2, Loader2, Lock, MessagesSquare, Paperclip, Pencil,
  Quote, Search, Send, ShieldAlert, Trash2, Users, X,
} from "lucide-react";
import { call, formatBytes, sendFile } from "@/lib/client-uploads";
import {
  BODY_MAX, CHANNEL_LABEL, MAX_ATTACHMENTS, bodyParts, clock, deleteMessage, editMessage, fetchThread, filterPeople,
  groupByDay, insertMention, markRead, mentionQuery, mentionedIds, mergeMessages, newestAt, postMessage, unreadLabel,
  uploadUrl, type Channel, type Message, type MessageAttachment, type Person, type Thread, type ThreadTarget, type Viewer,
} from "@/lib/messages";
import "@/components/portal/portal.css";
import "./messages.css";

const POLL_MS = 5000;

/**
 * One project's thread, as a tabbed pair of channels for the studio ("With client" and the
 * locked "Team only") or the single shared channel for a client. Polls every few seconds
 * while the tab is visible and marks what is on screen as read.
 */
export function ProjectThread({ workspaceId, projectId, chatChannelId, initialChannel = "client", initialQuote = "", variant = "studio", onUnreadChange }: {
  workspaceId: string; projectId?: string; chatChannelId?: string; initialChannel?: Channel; initialQuote?: string; variant?: "studio" | "portal";
  onUnreadChange?: (total: number) => void;
}) {
  const target: ThreadTarget = useMemo(
    () => (chatChannelId ? { workspaceId, chatChannelId, projectId } : { workspaceId, projectId: projectId as string }),
    [workspaceId, chatChannelId, projectId],
  );
  const [channel, setChannel] = useState<Channel>(variant === "portal" ? "client" : initialChannel);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [unread, setUnread] = useState<Partial<Record<Channel, number>>>({});
  // Held in a ref so a parent passing an inline callback does not restart the thread's effects.
  const listener = useRef(onUnreadChange);
  useEffect(() => { listener.current = onUnreadChange; }, [onUnreadChange]);
  const report = useCallback((thread: Thread) => {
    setViewer(thread.viewer);
    setUnread(thread.unread);
    listener.current?.(Object.values(thread.unread).reduce((sum, value) => sum + (value ?? 0), 0));
  }, []);
  const channels: Channel[] = viewer?.channels ?? (variant === "portal" ? ["client"] : ["client", "team"]);

  return <section className={`mt-thread is-${variant}${channel === "team" ? " is-team" : ""}`} aria-label="Project messages">
    {channels.length > 1 && <div className="mt-channels" role="tablist" aria-label="Channels">
      {channels.map((value) => <button
        key={value} type="button" role="tab" aria-selected={channel === value}
        className={`mt-channel${channel === value ? " is-on" : ""}${value === "team" ? " is-team" : ""}`}
        onClick={() => setChannel(value)}
      >
        {value === "team" ? <Lock aria-hidden="true" /> : <Users aria-hidden="true" />}
        <span>{CHANNEL_LABEL[value]}</span>
        {(unread[value] ?? 0) > 0 && channel !== value && <b className="mt-count" aria-label={`${unread[value]} unread`}>{unreadLabel(unread[value] ?? 0)}</b>}
      </button>)}
    </div>}
    <ChannelView key={channel} target={target} projectId={projectId} channel={channel} variant={variant} initialQuote={initialQuote} onThread={report} />
  </section>;
}

type Pending = { key: string; name: string; progress: number | null; id?: string; error?: string };
type Linked = { id: string; name: string; kind: "file" | "cut" };

function ChannelView({ target, projectId, channel, variant, initialQuote = "", onThread }: {
  target: ThreadTarget; projectId?: string; channel: Channel; variant: "studio" | "portal"; initialQuote?: string; onThread: (thread: Thread) => void;
}) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [olderBusy, setOlderBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const since = useRef<string | undefined>(undefined);
  const composerRef = useRef<ComposerHandle | null>(null);

  const read = useCallback(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    void markRead(target, channel).then((result) => {
      if (!result.ok) return;
      setThread((current) => {
        if (!current) return current;
        const next = { ...current, unread: { ...current.unread, [channel]: 0 } };
        queueMicrotask(() => onThread(next));
        return next;
      });
    });
  }, [target, channel, onThread]);

  useEffect(() => {
    let alive = true;
    void fetchThread(target, channel).then((result) => {
      if (!alive) return;
      if (!result.ok) { setError(result.status === 404 ? "This conversation is not available to you." : result.error); return; }
      setThread(result.data);
      setMessages(result.data.messages);
      since.current = newestAt(result.data.messages, result.data.server_time);
      onThread(result.data);
      if ((result.data.unread[channel] ?? 0) > 0) read();
    });
    return () => { alive = false; };
  }, [target, channel, onThread, read]);

  const ready = thread !== null;
  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void fetchThread(target, channel, { after: since.current }).then((result) => {
        if (!result.ok) return;
        const fresh = result.data.messages;
        if (fresh.length || result.data.changed.length) setMessages((current) => mergeMessages(current, fresh, result.data.changed));
        if (fresh.length) since.current = newestAt(fresh, since.current);
        setThread((current) => current ? { ...current, unread: result.data.unread, viewer: result.data.viewer, mentionable: result.data.mentionable } : result.data);
        onThread(result.data);
        if ((result.data.unread[channel] ?? 0) > 0) read();
      });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [ready, target, channel, onThread, read]);

  // Keep the newest message in view unless someone has scrolled up to read older ones.
  useEffect(() => {
    const list = listRef.current;
    if (list && stick.current) list.scrollTop = list.scrollHeight;
  }, [messages]);

  function loadOlder() {
    const first = messages[0];
    if (!first) return;
    setOlderBusy(true);
    const list = listRef.current;
    const height = list?.scrollHeight ?? 0;
    void fetchThread(target, channel, { before: first.created_at }).then((result) => {
      setOlderBusy(false);
      if (!result.ok) return;
      stick.current = false;
      setMessages((current) => mergeMessages(current, result.data.messages));
      setThread((current) => current ? { ...current, has_more: result.data.has_more } : current);
      requestAnimationFrame(() => { if (list) list.scrollTop = list.scrollHeight - height; });
    });
  }

  function replace(message: Message) {
    setMessages((current) => mergeMessages(current, [], [message]));
  }

  if (error) return <p className="mt-alert" role="alert">{error}</p>;
  if (!thread) return <div className="mt-loading" aria-busy="true"><Loader2 className="mt-spin" aria-hidden="true" />Loading messages…</div>;

  const people = thread.mentionable;
  const viewer = thread.viewer;
  const groups = groupByDay(messages);

  return <>
    {channel === "team"
      ? <p className="mt-banner is-team" role="note"><ShieldAlert aria-hidden="true" /><span><strong>Team only.</strong> Clients never see this channel, its messages or its files.</span></p>
      : variant === "studio" && !viewer.has_client
        ? <p className="mt-banner" role="note"><Users aria-hidden="true" /><span>No client team is on this project yet. Messages here become visible to the client once one is added.</span></p>
        : variant === "studio"
          ? <p className="mt-banner is-shared" role="note"><Users aria-hidden="true" /><span>Shared with the client. Use <strong>Team only</strong> for anything internal.</span></p>
          : null}

    <div className="mt-list" ref={listRef} onScroll={(event) => {
      const el = event.currentTarget;
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    }} aria-live="polite" aria-relevant="additions">
      {thread.has_more && <button type="button" className="mt-older" onClick={loadOlder} disabled={olderBusy}>{olderBusy ? "Loading…" : "Load earlier messages"}</button>}
      {messages.length === 0 && <div className="mt-empty">
        <MessagesSquare aria-hidden="true" />
        <strong>{channel === "team" ? "No internal notes yet" : variant === "portal" ? "Start the conversation" : "No messages with the client yet"}</strong>
        <p>{channel === "team" ? "Plan, hand over and flag things here without the client seeing." : variant === "portal" ? "Questions, feedback or files for the studio. The team is notified." : "Updates, questions and files for the client. They get notified."}</p>
      </div>}
      {groups.map((group) => <div className="mt-day" key={group.day}>
        <p className="mt-day-label"><span>{group.day}</span></p>
        {group.items.map(({ message, continued }) => <MessageRow
          key={message.id} message={message} continued={continued} people={people} viewer={viewer}
          target={target} onReplace={replace}
          onReply={(message) => { setReplyTo(message); composerRef.current?.focus(); }}
          onQuote={(message) => composerRef.current?.quote(message)}
        />)}
      </div>)}
    </div>

    {viewer.can_post
      ? <Composer
        ref={composerRef} target={target} projectId={projectId} channel={channel} viewer={viewer} people={people} initialQuote={initialQuote}
        replyTo={replyTo} onCancelReply={() => setReplyTo(null)}
        onSent={(message) => { stick.current = true; setReplyTo(null); setMessages((current) => mergeMessages(current, [message])); since.current = newestAt([message], since.current); }}
      />
      : <p className="mt-readonly"><Lock aria-hidden="true" />You can read this conversation. Your role doesn&apos;t include posting.</p>}
  </>;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

function MessageRow({ message, continued, people, viewer, target, onReplace, onReply, onQuote }: {
  message: Message; continued: boolean; people: Person[]; viewer: Viewer; target: ThreadTarget;
  onReplace: (message: Message) => void; onReply: (message: Message) => void; onQuote: (message: Message) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function save() {
    setBusy(true);
    void editMessage(target, message.id, draft).then((result) => {
      setBusy(false);
      if (!result.ok) { setProblem(result.error); return; }
      setEditing(false); setProblem(null); onReplace(result.data);
    });
  }
  function remove() {
    setBusy(true);
    void deleteMessage(target, message.id).then((result) => {
      setBusy(false);
      if (!result.ok) { setProblem(result.error); return; }
      onReplace({ ...message, deleted: true, body: "", attachments: [], mentions: [], can_edit: false });
    });
  }

  const who = message.author.is_client ? "Client" : "Studio";
  return <article className={`mt-msg${continued ? " is-continued" : ""}${message.mine ? " is-mine" : ""}${message.author.is_client ? " is-client" : ""}`} id={`message-${message.id}`}>
    <span className="mt-avatar" aria-hidden="true">{continued ? "" : initials(message.author.name)}</span>
    <div className="mt-msg-body">
      {!continued && <header className="mt-msg-head">
        <strong>{message.author.name}</strong>
        <span className={`mt-who is-${message.author.is_client ? "client" : "studio"}`}>{who}</span>
        <time dateTime={message.created_at}>{clock(message.created_at)}</time>
      </header>}
      {message.reply_to && <a className="mt-quote" href={`#message-${message.reply_to.id}`}>
        <CornerUpLeft aria-hidden="true" /><strong>{message.reply_to.author_name}</strong>
        <span>{message.reply_to.deleted ? "Message deleted" : message.reply_to.snippet}</span>
      </a>}
      {message.deleted
        ? <p className="mt-deleted">Message deleted</p>
        : editing
          ? <div className="mt-edit">
            <textarea aria-label="Edit message" value={draft} maxLength={BODY_MAX} onChange={(event) => setDraft(event.target.value)} rows={3}
              onKeyDown={(event) => { if (event.key === "Escape") setEditing(false); if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) save(); }} autoFocus />
            <div className="mt-edit-actions">
              <button type="button" className="pt-ghost" onClick={() => { setEditing(false); setDraft(message.body); }}>Cancel</button>
              <button type="button" className="pt-cta" onClick={save} disabled={busy || (!draft.trim() && message.attachments.length === 0)}>Save</button>
            </div>
          </div>
          : message.body && <p className="mt-text">{bodyParts(message.body, message.mentions, people).map((part, index) => part.mention ? <mark key={index} className="mt-mention">{part.text}</mark> : <span key={index}>{part.text}</span>)}
            {message.edited_at && <small className="mt-edited" title={`Edited ${new Date(message.edited_at).toLocaleString("en-GB", { timeZone: "Europe/London" })}`}> (edited)</small>}</p>}
      {!message.deleted && message.attachments.length > 0 && <ul className="mt-files">
        {message.attachments.map((item) => <li key={item.id}><AttachmentChip item={item} /></li>)}
      </ul>}
      {problem && <p className="mt-problem" role="alert">{problem}</p>}
      {confirming && <p className="mt-confirm" role="alert">Delete this message for everyone?
        <button type="button" className="pt-ghost is-danger" onClick={remove} disabled={busy}>Delete</button>
        <button type="button" className="pt-ghost" onClick={() => setConfirming(false)}>Keep</button></p>}
    </div>
    {!message.deleted && !editing && <div className="mt-actions">
      {continued && <time className="mt-side-time" dateTime={message.created_at}>{clock(message.created_at)}</time>}
      {viewer.can_post && <button type="button" onClick={() => onReply(message)} aria-label={`Reply to ${message.author.name}`} title="Reply"><CornerUpLeft /></button>}
      {viewer.can_post && message.body && <button type="button" onClick={() => onQuote(message)} aria-label="Quote in your reply" title="Quote"><Quote /></button>}
      {message.can_edit && <button type="button" onClick={() => { setDraft(message.body); setEditing(true); }} aria-label="Edit message" title="Edit"><Pencil /></button>}
      {message.can_edit && <button type="button" onClick={() => setConfirming(true)} aria-label="Delete message" title="Delete"><Trash2 /></button>}
    </div>}
  </article>;
}

function AttachmentChip({ item }: { item: MessageAttachment }) {
  const Icon = item.kind === "cut" ? Clapperboard : FileText;
  const meta = item.kind === "cut" ? "Cut" : [item.size_bytes != null ? formatBytes(item.size_bytes) : null, item.kind === "file" ? "Project file" : null].filter(Boolean).join(" · ");
  if (item.removed) return <span className="mt-file is-gone"><Icon aria-hidden="true" /><span><strong>{item.name}</strong><small>No longer available</small></span></span>;
  if (item.kind !== "cut" && item.status && item.status !== "READY") {
    return <span className="mt-file is-pending" title="Checked for safety before anyone can download it"><Loader2 className="mt-spin" aria-hidden="true" /><span><strong>{item.name}</strong><small>{item.status === "PENDING" ? "Scanning…" : "Not available"}</small></span></span>;
  }
  if (!item.href) return <span className="mt-file"><Icon aria-hidden="true" /><span><strong>{item.name}</strong><small>{meta}</small></span></span>;
  if (item.kind === "cut") return <Link className="mt-file" href={item.href}><Icon aria-hidden="true" /><span><strong>{item.name}</strong><small>Open in review</small></span></Link>;
  return <a className="mt-file" href={item.href} download><Icon aria-hidden="true" /><span><strong>{item.name}</strong><small>{meta}</small></span><Download className="mt-file-go" aria-hidden="true" /></a>;
}

type ComposerHandle = { focus: () => void; quote: (message: Message) => void };

function Composer({ ref, target, projectId, channel, viewer, people, replyTo, onCancelReply, onSent, initialQuote = "" }: {
  ref: React.Ref<ComposerHandle>; target: ThreadTarget; projectId?: string; channel: Channel; viewer: Viewer; people: Person[];
  replyTo: Message | null; onCancelReply: () => void; onSent: (message: Message) => void; initialQuote?: string;
}) {
  const [text, setText] = useState(() => initialQuote ? `Re: ${initialQuote}\n\n` : "");
  const [chosen, setChosen] = useState<Person[]>([]);
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [pending, setPending] = useState<Pending[]>([]);
  const [linked, setLinked] = useState<Linked[]>([]);
  const [picker, setPicker] = useState(false);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Where the caret goes after a programmatic edit, applied before the next keystroke lands.
  const nextCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (nextCaret.current === null || !area.current) return;
    area.current.focus();
    area.current.setSelectionRange(nextCaret.current, nextCaret.current);
    nextCaret.current = null;
  }, [text]);

  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    quote: (message: Message) => {
      const quoted = message.body.split("\n").map((line) => `> ${line}`).join("\n");
      setText((current) => `${current ? `${current}\n` : ""}${quoted}\n— ${message.author.name}\n\n`);
      nextCaret.current = BODY_MAX * 2; // clamped to the end by setSelectionRange
    },
  }), []);

  const query = mentionQuery(text, caret);
  const matches = useMemo(() => (query ? filterPeople(people, query.query) : []), [people, query]);
  const attachCount = pending.length + linked.length;
  const uploading = pending.some((item) => !item.id && !item.error);
  const canSend = !sending && !uploading && (text.trim().length > 0 || pending.some((item) => item.id) || linked.length > 0) && text.length <= BODY_MAX;

  function pick(person: Person) {
    if (!query) return;
    const next = insertMention(text, query, person);
    setText(next.text);
    setChosen((current) => current.some((row) => row.id === person.id) ? current : [...current, person]);
    setHighlight(0);
    setCaret(next.caret);
    nextCaret.current = next.caret;
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length) {
      if (event.key === "ArrowDown") { event.preventDefault(); setHighlight((value) => (value + 1) % matches.length); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setHighlight((value) => (value - 1 + matches.length) % matches.length); return; }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); pick(matches[Math.min(highlight, matches.length - 1)]); return; }
      if (event.key === "Escape") { setCaret(-1); return; }
    }
    if (event.key === "Escape" && replyTo) onCancelReply();
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (canSend) send(); }
  }

  function attach(files: FileList | null) {
    if (!files) return;
    const room = MAX_ATTACHMENTS - attachCount;
    const list = Array.from(files).slice(0, Math.max(room, 0));
    if (files.length > list.length) setProblem(`Attach up to ${MAX_ATTACHMENTS} items per message.`);
    for (const file of list) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      setPending((current) => [...current, { key, name: file.name, progress: 0 }]);
      void sendFile(uploadUrl(target), file, {}, (progress) => {
        setPending((current) => current.map((item) => item.key === key ? { ...item, progress } : item));
      }).then((result) => {
        setPending((current) => current.map((item) => item.key === key
          ? result.ok ? { ...item, progress: 1, id: (result.data as { id: string }).id } : { ...item, error: result.error }
          : item));
      });
    }
  }

  function send() {
    setSending(true);
    setProblem(null);
    void postMessage(target, {
      channel, body: text, reply_to_id: replyTo?.id ?? null, mention_user_ids: mentionedIds(text, chosen),
      attachment_ids: pending.filter((item) => item.id).map((item) => item.id as string),
      project_file_ids: linked.filter((item) => item.kind === "file").map((item) => item.id),
      media_version_ids: linked.filter((item) => item.kind === "cut").map((item) => item.id),
    }).then((result) => {
      setSending(false);
      if (!result.ok) { setProblem(result.error); return; }
      setText(""); setChosen([]); setPending([]); setLinked([]);
      onSent(result.data);
    });
  }

  const canLink = viewer.can_link_files || viewer.can_link_cuts;
  return <div className="mt-composer">
    {replyTo && <div className="mt-replying">
      <CornerUpLeft aria-hidden="true" /><span>Replying to <strong>{replyTo.author.name}</strong>: {replyTo.body.slice(0, 90) || "attachment"}</span>
      <button type="button" onClick={onCancelReply} aria-label="Cancel reply"><X /></button>
    </div>}
    {(pending.length > 0 || linked.length > 0) && <ul className="mt-staged" aria-label="Attachments for this message">
      {pending.map((item) => <li key={item.key} className={item.error ? "is-error" : item.id ? "is-ready" : ""}>
        {item.id || item.error ? <Paperclip aria-hidden="true" /> : <Loader2 className="mt-spin" aria-hidden="true" />}
        <span>{item.name}{item.error ? ` · ${item.error}` : !item.id ? ` · ${Math.round((item.progress ?? 0) * 100)}%` : ""}</span>
        <button type="button" onClick={() => setPending((current) => current.filter((row) => row.key !== item.key))} aria-label={`Remove ${item.name}`}><X /></button>
      </li>)}
      {linked.map((item) => <li key={`${item.kind}-${item.id}`} className="is-ready">
        {item.kind === "cut" ? <Clapperboard aria-hidden="true" /> : <Link2 aria-hidden="true" />}<span>{item.name}</span>
        <button type="button" onClick={() => setLinked((current) => current.filter((row) => row !== item))} aria-label={`Remove ${item.name}`}><X /></button>
      </li>)}
    </ul>}
    <div className="mt-input">
      <textarea
        ref={area} rows={2} value={text} maxLength={BODY_MAX + 200}
        aria-label={channel === "team" ? "Message the team (clients never see this)" : "Message"}
        placeholder={channel === "team" ? "Note for the team only…" : viewer.kind === "client" ? "Message the studio…" : "Message the client and team…"}
        onChange={(event) => { setText(event.target.value); setCaret(event.target.selectionStart); setHighlight(0); }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={onKey}
      />
      {matches.length > 0 && <ul className="mt-suggest" role="listbox" aria-label="Mention someone">
        {matches.map((person, index) => <li key={person.id} role="option" aria-selected={index === highlight}>
          <button type="button" onMouseDown={(event) => { event.preventDefault(); pick(person); }}>
            <span className="mt-avatar is-small" aria-hidden="true">{initials(person.name)}</span>{person.name}
            <small>{person.is_client ? "Client" : "Studio"}</small>
          </button>
        </li>)}
      </ul>}
    </div>
    <div className="mt-tools">
      <button type="button" className="mt-tool" onClick={() => fileInput.current?.click()} disabled={attachCount >= MAX_ATTACHMENTS} title="Attach files (images, PDFs, audio, Office documents up to 25 MB)">
        <Paperclip aria-hidden="true" /><span>Attach</span>
      </button>
      <input ref={fileInput} type="file" multiple hidden onChange={(event) => { attach(event.target.files); event.target.value = ""; }}
        accept="image/*,application/pdf,audio/mpeg,audio/wav,.doc,.docx,.xlsx,.pptx,.rtf" />
      {canLink && <button type="button" className="mt-tool" onClick={() => setPicker(true)} disabled={attachCount >= MAX_ATTACHMENTS}><Link2 aria-hidden="true" /><span>Link file or cut</span></button>}
      <button type="button" className="mt-tool" onClick={() => {
        const at = area.current?.selectionStart ?? text.length;
        const next = `${text.slice(0, at)}${at > 0 && !/\s$/.test(text.slice(0, at)) ? " " : ""}@${text.slice(at)}`;
        setText(next);
        const position = next.length - text.slice(at).length;
        setCaret(position);
        nextCaret.current = position;
      }} aria-label="Mention someone"><AtSign aria-hidden="true" /></button>
      <span className="mt-hint">{text.length > BODY_MAX - 200 ? `${text.length}/${BODY_MAX}` : "Enter to send · Shift+Enter for a new line"}</span>
      <button type="button" className={`pt-cta mt-send${channel === "team" ? " is-team" : ""}`} onClick={send} disabled={!canSend}>
        {sending ? <Loader2 className="mt-spin" aria-hidden="true" /> : channel === "team" ? <Lock aria-hidden="true" /> : <Send aria-hidden="true" />}
        <span>{channel === "team" ? "Send to team" : "Send"}</span>
      </button>
    </div>
    {problem && <p className="mt-problem" role="alert">{problem}</p>}
    {picker && projectId && <LinkPicker workspaceId={target.workspaceId} projectId={projectId} viewer={viewer} channel={channel}
      chosen={linked} onClose={() => setPicker(false)}
      onPick={(item) => setLinked((current) => current.some((row) => row.id === item.id && row.kind === item.kind) || attachCount >= MAX_ATTACHMENTS ? current : [...current, item])} />}
  </div>;
}

type FileRow = { id: string; file: { name: string; mime_type: string; size_bytes: number; status: string } };
type CutRow = { id: string; title: string; version_number: number; status?: string };

function LinkPicker({ workspaceId, projectId, viewer, channel, chosen, onClose, onPick }: {
  workspaceId: string; projectId: string; viewer: Viewer; channel: Channel; chosen: Linked[];
  onClose: () => void; onPick: (item: Linked) => void;
}) {
  const [kind, setKind] = useState<"file" | "cut">(viewer.can_link_cuts ? "cut" : "file");
  const [files, setFiles] = useState<FileRow[] | null>(null);
  const [cuts, setCuts] = useState<CutRow[] | null>(null);
  const [needle, setNeedle] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const project = `/workspaces/${workspaceId}/projects/${projectId}`;
    if (viewer.can_link_files) void call<FileRow[]>(`${project}/files/`).then((result) => result.ok ? setFiles(result.data) : setProblem(result.error));
    if (viewer.can_link_cuts) void call<CutRow[] | { results: CutRow[] }>(`${project}/media-versions/`).then((result) => {
      if (!result.ok) { setProblem(result.error); return; }
      const rows = Array.isArray(result.data) ? result.data : result.data.results;
      setCuts(rows.filter((row) => !row.status || row.status === "ACTIVE").sort((a, b) => b.version_number - a.version_number));
    });
  }, [workspaceId, projectId, viewer.can_link_files, viewer.can_link_cuts]);

  useEffect(() => {
    const close = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  const lower = needle.toLowerCase();
  const rows: Linked[] = kind === "file"
    ? (files ?? []).map((row) => ({ id: row.id, name: row.file.name, kind: "file" as const }))
    : (cuts ?? []).map((row) => ({ id: row.id, name: `${row.title} · V${row.version_number}`, kind: "cut" as const }));
  const shown = rows.filter((row) => row.name.toLowerCase().includes(lower)).slice(0, 40);
  const loading = kind === "file" ? files === null : cuts === null;

  return <div className="mt-picker-wrap" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="mt-picker" role="dialog" aria-modal="true" aria-labelledby="mt-picker-title">
      <header><h3 id="mt-picker-title"><Link2 aria-hidden="true" />Link from this project</h3><button type="button" onClick={onClose} aria-label="Close"><X /></button></header>
      {channel === "client" && <p className="mt-picker-note">Linked items become downloadable by the client from this message.</p>}
      <div className="mt-picker-tabs" role="tablist">
        {viewer.can_link_cuts && <button type="button" role="tab" aria-selected={kind === "cut"} className={kind === "cut" ? "is-on" : ""} onClick={() => setKind("cut")}><Clapperboard aria-hidden="true" />Cuts</button>}
        {viewer.can_link_files && <button type="button" role="tab" aria-selected={kind === "file"} className={kind === "file" ? "is-on" : ""} onClick={() => setKind("file")}><FileText aria-hidden="true" />Files</button>}
      </div>
      <label className="mt-picker-search"><Search aria-hidden="true" /><input value={needle} onChange={(event) => setNeedle(event.target.value)} placeholder={`Search ${kind === "cut" ? "cuts" : "files"}`} aria-label="Search" autoFocus /></label>
      {problem && <p className="mt-problem" role="alert">{problem}</p>}
      <ul className="mt-picker-list">
        {loading && <li className="mt-picker-empty">Loading…</li>}
        {!loading && shown.length === 0 && <li className="mt-picker-empty">Nothing to link{needle ? " matches that search" : " yet"}.</li>}
        {shown.map((row) => {
          const on = chosen.some((item) => item.id === row.id && item.kind === row.kind);
          return <li key={row.id}><button type="button" className={on ? "is-on" : ""} onClick={() => onPick(row)} disabled={on}>
            {row.kind === "cut" ? <Clapperboard aria-hidden="true" /> : <FileText aria-hidden="true" />}<span>{row.name}</span>{on && <small>Added</small>}
          </button></li>;
        })}
      </ul>
      <footer><button type="button" className="pt-cta" onClick={onClose}>Done</button></footer>
    </div>
  </div>;
}
