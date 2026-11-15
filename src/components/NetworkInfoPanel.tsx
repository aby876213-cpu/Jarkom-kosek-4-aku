import React from 'react';
import { Activity } from 'lucide-react';

interface NetworkInfoPanelProps {
  pingMs: number;
  callsign: string;
  clientIp: string;
  peerCount: number;
  onCallsignChange: (nextName: string) => void;
  onPingClick: () => void;
}

export const NetworkInfoPanel: React.FC<NetworkInfoPanelProps> = ({
  pingMs,
  callsign,
  clientIp,
  peerCount,
  onCallsignChange,
  onPingClick,
}) => {
  return (
    <section aria-label="Network Information" className="tactical-card rounded-xl p-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <button
          type="button"
          onClick={onPingClick}
          title="Uji Latensi Ping"
          className="bg-slate-950/75 hover:bg-cyan-950/50 border border-cyan-500/20 hover:border-cyan-400/50 rounded-lg py-2 px-1.5 flex flex-col items-center justify-center active:scale-95 transition focus-visible:outline-2 focus-visible:outline-[#00f0ff]"
        >
          <div className="flex items-center justify-center gap-1 text-[10px] text-cyan-400/75 tracking-widest">
            <Activity className="w-3 h-3 text-[#00ff88]" aria-hidden="true" />
            <span>Ping RTT</span>
          </div>
          <div
            className={`font-[var(--font-tech)] text-base tabular-nums mt-0.5 ${
              pingMs < 40 ? 'text-[#00ff88]' : 'text-amber-400'
            }`}
          >
            {pingMs} ms
          </div>
        </button>

        <div className="bg-slate-950/75 border border-cyan-500/20 rounded-lg py-1.5 px-2 flex flex-col justify-center">
          <label
            htmlFor="callsign-input"
            className="text-[10px] text-cyan-400/75 tracking-widest block"
          >
            Client / IP
          </label>
          <input
            id="callsign-input"
            type="text"
            value={callsign}
            maxLength={14}
            onChange={(e) => onCallsignChange(e.target.value)}
            aria-label="Client Callsign"
            className="w-full bg-transparent text-center font-[var(--font-tech)] text-xs text-cyan-100 border-b border-cyan-500/30 focus:border-[#00f0ff] focus:outline-none py-0.5"
          />
          <div className="text-[10px] text-cyan-400/80 tabular-nums truncate mt-0.5">
            {clientIp}
          </div>
        </div>

        <div className="bg-slate-950/75 border border-cyan-500/20 rounded-lg py-2 px-1.5 flex flex-col justify-center">
          <div className="text-[10px] text-cyan-400/75 tracking-widest">Peer Aktif</div>
          <div className="font-[var(--font-tech)] text-base text-[#00f0ff] tabular-nums mt-0.5">
            {peerCount} TARGET
          </div>
        </div>
      </div>
    </section>
  );
};
