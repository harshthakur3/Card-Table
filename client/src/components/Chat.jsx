import { useEffect, useRef, useState } from 'react';
import { request } from '../lib/socket.js';
import { useToast } from './Toasts.jsx';

export function Chat({ messages, me, compact = false }) {
  const [text, setText] = useState('');
  const listRef = useRef(null);
  const toast = useToast();

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function send(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    const res = await request('chat:send', { text: t });
    if (!res.ok) {
      toast(res.error, 'error');
      setText(t);
    }
  }

  return (
    <div className={`chat ${compact ? 'chat-compact' : ''}`}>
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && <p className="muted small">No messages yet. Say hi!</p>}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.playerId === me ? 'mine' : ''}`}>
            <span className="chat-name">{m.playerId === me ? 'You' : m.nickname}</span>
            <span className="chat-text">{m.text}</span>
          </div>
        ))}
      </div>
      <form className="chat-form" onSubmit={send}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          placeholder="Message…"
          aria-label="Chat message"
        />
        <button className="btn btn-small" type="submit" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
