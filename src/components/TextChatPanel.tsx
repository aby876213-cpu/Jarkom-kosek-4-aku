import React, { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { ChatMessage } from '../types/comms';

interface TextChatPanelProps {
  channel: number;
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
}

const PRESET_MESSAGES = [
  { label: 'SIAP 86!', tone: 'cyan' },
  { label: 'MONITOR', tone: 'cyan' },
  { label: 'AMAN', tone: 'emerald' },
  { label: 'SOS', tone: 'rose' },
] as const;

export const TextChatPanel: React.FC<TextChatPanelProps> = ({
  channel,
  messages,
  onSendMessage,
}) => {
  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const channelMessages = messages.filter(
    (msg) => msg.channel === channel || msg.sender === 'SYSTEM'
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [channelMessages.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText);
    setInputText('');
  };

  return (
    <section aria-label="Encrypted Text Chat" className="tactical-card rounded-xl p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs tracking-[0.12em] text-cyan-300/85 font-medium whitespace-nowrap">
          Text Chat · CH {String(channel).padStart(2, '0')}
        </span>
        <span className="text-[10px] font-[var(--font-tech)] text-[#00ff88] whitespace-nowrap">
          AES-GCM DATA
        </span>
      </div>

      <div
        ref={scrollRef}
        className="h-32 overflow-y-auto custom-scroll bg-slate-950/75 border border-cyan-500/20 rounded-lg p-2.5 space-y-1.5 text-xs"
      >
        {channelMessages.map((msg) => (
          <div
            key={msg.id}
            className={msg.isSos ? 'text-rose-300 font-bold' : 'text-cyan-100'}
          >
            <span className="text-cyan-500 tabular-nums">[{msg.time}]</span>{' '}
            <span className="text-[#00f0ff] font-bold">{msg.sender}:</span>{' '}
            <span className="break-words">{msg.text}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {PRESET_MESSAGES.map((preset) => {
          const toneStyle =
            preset.tone === 'rose'
              ? 'border-rose-500/65 bg-rose-950/50 text-rose-200 hover:bg-rose-900/60'
              : preset.tone === 'emerald'
                ? 'border-emerald-500/45 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/50'
                : 'border-cyan-500/35 bg-cyan-950/45 text-cyan-100 hover:bg-cyan-900/55';

          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => onSendMessage(preset.label)}
              className={`min-h-[38px] py-1.5 px-1 rounded-lg text-[11px] font-[var(--font-tech)] border active:scale-95 transition whitespace-nowrap ${toneStyle}`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={`Kirim pesan ke CH ${String(channel).padStart(2, '0')}...`}
          aria-label="Pesan teks terenkripsi"
          className="flex-1 min-h-[42px] bg-slate-950 border border-cyan-500/30 rounded-lg px-3 py-2 text-xs text-cyan-100 placeholder-cyan-700 focus:outline-none focus:border-[#00f0ff]"
        />
        <button
          type="submit"
          className="min-h-[42px] px-4 py-2 rounded-lg bg-cyan-500/20 border border-[#00f0ff]/60 text-[#00f0ff] font-[var(--font-tech)] text-xs hover:bg-cyan-500/30 active:scale-95 transition flex items-center gap-1.5 whitespace-nowrap"
        >
          <Send className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Kirim</span>
        </button>
      </form>
    </section>
  );
};
