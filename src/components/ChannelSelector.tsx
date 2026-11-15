import React from 'react';

interface ChannelSelectorProps {
  channel: number;
  channelFreq: string;
  emergencyMode: boolean;
  onPrevChannel: () => void;
  onNextChannel: () => void;
  onToggleEmergency: () => void;
}

export const ChannelSelector: React.FC<ChannelSelectorProps> = ({
  channel,
  channelFreq,
  emergencyMode,
  onPrevChannel,
  onNextChannel,
  onToggleEmergency,
}) => {
  const paddedChannel = String(channel).padStart(2, '0');

  return (
    <section aria-label="Channel Selector" className="tactical-card rounded-xl p-3.5">
      <div className="flex items-center justify-between mb-2.5 gap-2">
        <span className="text-xs tracking-[0.14em] text-cyan-300/85 font-medium whitespace-nowrap">
          Selector · 12 Channel
        </span>
        <button
          type="button"
          onClick={onToggleEmergency}
          className={`min-h-[36px] px-3 py-1 rounded text-xs font-bold tracking-wider border transition active:scale-95 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-rose-400 ${
            emergencyMode
              ? 'border-rose-400 bg-rose-600/80 text-white shadow-[0_0_16px_rgba(255,42,85,0.6)]'
              : 'border-rose-500/75 bg-rose-950/60 text-rose-200 hover:bg-rose-900/70 shadow-[0_0_10px_rgba(255,42,85,0.28)]'
          }`}
        >
          {emergencyMode ? 'Clear Emergency' : 'Emergency CL'}
        </button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onPrevChannel}
          aria-label="Channel sebelumnya"
          className="rotary-dial w-14 h-14 shrink-0 rounded-full flex items-center justify-center border-2 border-cyan-400/55 text-cyan-200 active:scale-90 transition focus-visible:outline-2 focus-visible:outline-[#00f0ff]"
        >
          <span className="font-[var(--font-tech)] text-sm font-bold whitespace-nowrap">CH -</span>
        </button>

        <div
          className={`flex-1 bg-[#02060e] border rounded-xl py-2.5 px-3 text-center transition ${
            emergencyMode
              ? 'border-rose-500/70 shadow-[inset_0_0_24px_rgba(255,42,85,0.22)]'
              : 'border-cyan-400/45 shadow-[inset_0_0_22px_rgba(0,240,255,0.14)]'
          }`}
        >
          <div
            className={`font-[var(--font-tech)] text-2xl sm:text-[26px] tracking-[0.14em] tabular-nums ${
              emergencyMode
                ? 'text-rose-400 drop-shadow-[0_0_10px_rgba(255,42,85,0.75)]'
                : 'text-[#00f0ff] drop-shadow-[0_0_10px_rgba(0,240,255,0.75)]'
            }`}
          >
            CHANNEL {paddedChannel}
          </div>
          <div className="text-[11px] text-cyan-300/80 tracking-wider tabular-nums mt-0.5">
            {emergencyMode
              ? 'EMERGENCY PRIORITY · CH 12'
              : `${channelFreq} MHz · AES-GCM LOCK`}
          </div>
        </div>

        <button
          type="button"
          onClick={onNextChannel}
          aria-label="Channel berikutnya"
          className="rotary-dial w-14 h-14 shrink-0 rounded-full flex items-center justify-center border-2 border-cyan-400/55 text-cyan-200 active:scale-90 transition focus-visible:outline-2 focus-visible:outline-[#00f0ff]"
        >
          <span className="font-[var(--font-tech)] text-sm font-bold whitespace-nowrap">CH +</span>
        </button>
      </div>
    </section>
  );
};
