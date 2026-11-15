import React from 'react';
import { Play } from 'lucide-react';
import { CallLogEntry, LogFilter } from '../types/comms';

interface CallLogPanelProps {
  logs: CallLogEntry[];
  activeFilter: LogFilter;
  onFilterChange: (filter: LogFilter) => void;
  onPlayEntry: (entry: CallLogEntry) => void;
}

const FILTER_TABS: { id: LogFilter; label: string }[] = [
  { id: 'all', label: 'Semua' },
  { id: 'tx', label: 'TX/VOX' },
  { id: 'rx', label: 'RX Masuk' },
  { id: 'sos', label: 'SOS' },
];

export const CallLogPanel: React.FC<CallLogPanelProps> = ({
  logs,
  activeFilter,
  onFilterChange,
  onPlayEntry,
}) => {
  const filteredLogs = logs.filter((entry) => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'tx') return entry.type === 'tx' || entry.type === 'vox';
    return entry.type === activeFilter;
  });

  return (
    <section aria-label="Call Log" className="tactical-card rounded-xl p-3">
      <div className="flex flex-wrap items-center justify-between mb-2.5 gap-2">
        <span className="text-xs tracking-[0.12em] text-cyan-300/85 font-medium whitespace-nowrap">
          Log Panggilan
        </span>

        <div className="flex gap-1 flex-wrap" role="tablist" aria-label="Filter Log Panggilan">
          {FILTER_TABS.map((tab) => {
            const isActive = activeFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onFilterChange(tab.id)}
                className={`min-h-[32px] px-2.5 py-1 rounded text-[11px] border transition whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#00f0ff] ${
                  isActive
                    ? 'bg-[#00f0ff] text-[#040812] border-[#00f0ff] font-bold shadow-[0_0_10px_rgba(0,240,255,0.45)]'
                    : 'bg-slate-900/75 text-cyan-200 border-cyan-500/30 hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scroll text-xs">
        {filteredLogs.length === 0 ? (
          <div className="py-4 text-center text-xs text-cyan-400/70">
            Belum ada rekaman transmisi pada filter ini.
          </div>
        ) : (
          filteredLogs.map((log) => {
            const typeBadgeClass =
              log.type === 'tx' || log.type === 'vox'
                ? 'text-[#00f0ff] border-cyan-500/40'
                : log.type === 'sos'
                  ? 'text-rose-300 border-rose-500/60 bg-rose-950/40'
                  : 'text-[#00ff88] border-emerald-500/45';

            return (
              <div
                key={log.id}
                className="flex items-center justify-between gap-2 bg-slate-950/75 border border-cyan-500/15 rounded-lg px-2.5 py-1.5"
              >
                <div className="flex items-center gap-2 min-w-0 text-[11px] tabular-nums">
                  <span className="text-cyan-400/80 shrink-0">{log.time}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded border text-[10px] font-[var(--font-tech)] uppercase shrink-0 ${typeBadgeClass}`}
                  >
                    {log.type}
                  </span>
                  <span className="text-cyan-100 font-bold truncate">{log.sender}</span>
                  <span className="text-cyan-400/80 shrink-0">
                    CH{String(log.channel).padStart(2, '0')}
                  </span>
                  <span className="text-cyan-200 shrink-0">{log.duration}</span>
                </div>

                <button
                  type="button"
                  onClick={() => onPlayEntry(log)}
                  aria-label={`Putar rekaman ${log.sender} jam ${log.time}`}
                  className="shrink-0 min-h-[32px] px-2.5 py-1 rounded bg-cyan-950/75 border border-cyan-400/40 text-cyan-200 hover:text-white hover:border-[#00f0ff] text-[11px] font-[var(--font-tech)] flex items-center gap-1 transition active:scale-95 whitespace-nowrap"
                >
                  <Play className="w-3 h-3" aria-hidden="true" />
                  <span>Play</span>
                </button>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
