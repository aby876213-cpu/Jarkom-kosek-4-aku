import React from 'react';
import { Mic, Volume2 } from 'lucide-react';

interface PttButtonProps {
  channel: number;
  isTransmitting: boolean;
  txMode: 'tx' | 'vox';
  talkAllActive: boolean;
  rxActiveSender: string | null;
  micLevel: number;
  audioOutputBlocked?: boolean;
  onUnlockAudio?: () => void;
  onStartPTT: () => void;
  onStopPTT: () => void;
}

export const PttButton: React.FC<PttButtonProps> = ({
  channel,
  isTransmitting,
  txMode,
  talkAllActive,
  rxActiveSender,
  micLevel,
  audioOutputBlocked = false,
  onUnlockAudio,
  onStartPTT,
  onStopPTT,
}) => {
  const paddedCh = String(channel).padStart(2, '0');

  return (
    <section
      aria-label="Push-To-Talk Control"
      className="py-3 flex flex-col items-center justify-center select-none"
    >
      {audioOutputBlocked && onUnlockAudio && (
        <button
          type="button"
          onClick={onUnlockAudio}
          className="mb-3 px-3.5 py-2 rounded-lg border border-amber-400/70 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 text-xs font-[var(--font-tech)] tracking-wider flex items-center gap-2 shadow-[0_0_16px_rgba(255,184,0,0.28)] animate-pulse active:scale-95 transition"
        >
          <Volume2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>TAP UNTUK AKTIFKAN SPEAKER RX</span>
        </button>
      )}

      <div
        className="w-52 h-2 bg-slate-950 rounded-full overflow-hidden border border-cyan-500/25 mb-3"
        aria-label="Microphone Input Level"
      >
        <div
          className="h-full bg-gradient-to-r from-[#00f0ff] to-[#00ff88] transition-[width] duration-75"
          style={{ width: `${micLevel}%` }}
        />
      </div>

      <button
        type="button"
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          e.preventDefault();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Ignore pointer capture unsupported
          }
          onStartPTT();
        }}
        onPointerUp={(e) => {
          try {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          } catch {
            // Ignore
          }
          onStopPTT();
        }}
        onPointerCancel={() => onStopPTT()}
        className={`ptt-circle w-44 h-44 sm:w-48 sm:h-48 rounded-full flex flex-col items-center justify-center text-center p-4 cursor-pointer focus-visible:outline-2 focus-visible:outline-white ${
          isTransmitting ? 'tx-active' : rxActiveSender ? 'rx-active' : ''
        }`}
      >
        <Mic
          className={`w-9 h-9 mb-2 pointer-events-none ${
            isTransmitting
              ? 'text-[#ff2a55]'
              : rxActiveSender
                ? 'text-[#00ff88]'
                : 'text-[#00f0ff]'
          }`}
          aria-hidden="true"
        />

        <span className="font-[var(--font-tech)] text-xs sm:text-sm tracking-wider text-cyan-50 leading-snug pointer-events-none">
          {isTransmitting
            ? talkAllActive
              ? 'TALK ALL ACTIVE - BROADCASTING'
              : txMode === 'vox'
                ? 'VOX TRANSMITTING...'
                : 'TX ACTIVE - MENGIRIM...'
            : rxActiveSender
              ? `RX MASUK · ${rxActiveSender}`
              : 'PTT READY - TAHAN / SPACEBAR'}
        </span>

        <span className="text-[10px] text-cyan-300/80 mt-1.5 tracking-widest tabular-nums pointer-events-none">
          {isTransmitting
            ? `CH ${paddedCh} · AES-GCM`
            : 'OPUS 16K · AES-GCM'}
        </span>
      </button>
    </section>
  );
};
