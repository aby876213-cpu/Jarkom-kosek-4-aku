import React from 'react';

interface TacticalHeaderProps {
  socketConnected: boolean;
  pingMs: number;
  emergencyMode: boolean;
}

export const TacticalHeader: React.FC<TacticalHeaderProps> = ({
  socketConnected,
  pingMs,
  emergencyMode,
}) => {
  const txRxDelay = Math.max(4, pingMs - 1);

  return (
    <header className="bg-[#081122]/95 border-b border-cyan-500/35 px-4 py-3 flex flex-col gap-1.5 backdrop-blur-md">
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          aria-label={socketConnected ? 'Signaling connected' : 'Signaling disconnected'}
          className={`w-2.5 h-2.5 shrink-0 rounded-full ${
            emergencyMode
              ? 'bg-rose-500 shadow-[0_0_10px_#ff2a55] animate-pulse'
              : socketConnected
                ? 'bg-[#00f0ff] shadow-[0_0_8px_#00f0ff]'
                : 'bg-amber-400'
          }`}
        />
        <h1 className="font-[var(--font-tech)] text-base sm:text-lg tracking-[0.12em] text-[#00f0ff] drop-shadow-[0_0_8px_rgba(0,240,255,0.55)] truncate whitespace-nowrap">
          TACTICAL COMMS KOSEK IV
        </h1>
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px] text-cyan-300/85 tracking-wider border-t border-cyan-500/15 pt-1.5">
        <span className="truncate tabular-nums">
          AES-GCM · OPUS 16k · TX/RX delay{' '}
          <strong className="text-[#00ff88]">{txRxDelay}ms</strong>
        </span>
        <span className="shrink-0 text-[10px] font-[var(--font-tech)] tracking-widest text-[#00f0ff] whitespace-nowrap">
          {socketConnected ? 'LINK ONLINE · E2EE' : 'RECONNECTING'}
        </span>
      </div>
    </header>
  );
};
