import React from 'react';
import { Mic, MicOff, QrCode, Radio, Trash2 } from 'lucide-react';
import { EnrolledUser, PeerInfo } from '../types/comms';

interface ActivePeersPanelProps {
  channel: number;
  peers: PeerInfo[];
  enrolledUsers: EnrolledUser[];
  micStatus: 'standby' | 'ready' | 'blocked';
  onEnableMic: () => void;
  onOpenBarcodeModal: () => void;
  onRemoveEnrolledUser: (id: string) => void;
  onSwitchChannel: (ch: number) => void;
}

export const ActivePeersPanel: React.FC<ActivePeersPanelProps> = ({
  channel,
  peers,
  enrolledUsers,
  micStatus,
  onEnableMic,
  onOpenBarcodeModal,
  onRemoveEnrolledUser,
  onSwitchChannel,
}) => {
  return (
    <section aria-label="Active Peers" className="tactical-card rounded-xl p-3 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs tracking-[0.12em] text-cyan-300/85 font-medium whitespace-nowrap">
          Active Peers · CH {String(channel).padStart(2, '0')}
        </span>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onOpenBarcodeModal}
            className="text-[11px] font-[var(--font-tech)] px-2.5 py-1 rounded border border-[#00f0ff]/55 bg-cyan-500/15 text-[#00f0ff] hover:bg-cyan-500/25 transition flex items-center gap-1 whitespace-nowrap active:scale-95"
          >
            <QrCode className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Barcode User</span>
          </button>

          <button
            type="button"
            onClick={onEnableMic}
            className={`text-[11px] font-[var(--font-tech)] px-2.5 py-1 rounded border transition whitespace-nowrap ${
              micStatus === 'ready'
                ? 'bg-emerald-950/50 border-emerald-500/45 text-[#00ff88]'
                : micStatus === 'blocked'
                  ? 'bg-rose-950/50 border-rose-500/45 text-rose-300'
                  : 'bg-slate-900 border-cyan-500/35 text-cyan-200 hover:bg-slate-800'
            }`}
          >
            {micStatus === 'ready'
              ? 'MIC READY (16k)'
              : micStatus === 'blocked'
                ? 'MIC BLOCKED'
                : 'ARM MIC'}
          </button>
        </div>
      </div>

      {peers.length === 0 ? (
        <div className="bg-slate-950/70 border border-cyan-500/15 rounded-lg px-3 py-3 text-center text-xs text-cyan-400/80">
          Menunggu unit lain bergabung di Channel {String(channel).padStart(2, '0')}. Gunakan{' '}
          <strong className="text-[#00f0ff]">Barcode User</strong> untuk menambah unit baru.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-32 overflow-y-auto custom-scroll">
          {peers.map((peer) => (
            <div
              key={peer.id}
              className={`flex items-center justify-between px-2.5 py-2 rounded-lg border transition ${
                peer.talking
                  ? 'border-[#00ff88] bg-emerald-950/40 shadow-[0_0_10px_rgba(0,255,136,0.22)]'
                  : 'border-cyan-500/20 bg-slate-950/75'
              }`}
            >
              <div className="min-w-0">
                <div className="font-[var(--font-tech)] text-xs text-cyan-100 flex items-center gap-1.5 truncate">
                  <span
                    className={`w-1.5 h-1.5 shrink-0 rounded-full ${
                      peer.talking ? 'bg-[#00ff88] animate-pulse' : 'bg-cyan-400'
                    }`}
                  />
                  <span className="truncate">{peer.name}</span>
                </div>
                <div className="text-[10px] text-cyan-400/75 tabular-nums truncate">
                  {peer.ip}
                </div>
              </div>

              <span
                className={`shrink-0 ml-2 flex items-center gap-1 text-[11px] font-[var(--font-tech)] ${
                  peer.talking ? 'text-[#00ff88]' : 'text-cyan-400/75'
                }`}
              >
                {peer.talking ? (
                  <>
                    <Mic className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>TX</span>
                  </>
                ) : (
                  <>
                    <MicOff className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>IDLE</span>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {enrolledUsers.length > 0 && (
        <div className="pt-2 border-t border-cyan-500/15 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-cyan-300/80">
            <span className="tracking-wider">User Terdaftar (Barcode)</span>
            <span className="font-[var(--font-tech)] text-[#00f0ff] tabular-nums">
              {enrolledUsers.length} UNIT
            </span>
          </div>

          <div className="space-y-1.5 max-h-32 overflow-y-auto custom-scroll">
            {enrolledUsers.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between gap-2 bg-slate-950/75 border border-cyan-500/15 rounded-lg px-2.5 py-1.5 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 font-[var(--font-tech)] text-cyan-100 truncate">
                    <span
                      className={`w-1.5 h-1.5 shrink-0 rounded-full ${
                        user.online ? 'bg-[#00ff88]' : 'bg-slate-500'
                      }`}
                    />
                    <span className="truncate">{user.callsign}</span>
                    <span className="text-[10px] text-cyan-400/75">· {user.role}</span>
                  </div>
                  <div className="text-[10px] text-cyan-400/70 tabular-nums truncate">
                    CH {String(user.channel).padStart(2, '0')} ·{' '}
                    {user.online ? 'ONLINE' : 'STANDBY'} · {user.token}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {user.channel !== channel && (
                    <button
                      type="button"
                      onClick={() => onSwitchChannel(user.channel)}
                      title={`Pindah ke Channel ${String(user.channel).padStart(2, '0')}`}
                      className="min-h-[28px] px-2 py-1 rounded bg-cyan-950/70 border border-cyan-500/35 text-[10px] font-[var(--font-tech)] text-cyan-200 hover:text-white hover:border-[#00f0ff] flex items-center gap-1 whitespace-nowrap"
                    >
                      <Radio className="w-3 h-3" aria-hidden="true" />
                      <span>CH{String(user.channel).padStart(2, '0')}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onRemoveEnrolledUser(user.id)}
                    aria-label={`Hapus ${user.callsign}`}
                    title={`Hapus ${user.callsign}`}
                    className="min-h-[28px] min-w-[28px] rounded bg-slate-900 border border-rose-500/30 text-rose-300/80 hover:text-rose-200 hover:border-rose-400 flex items-center justify-center transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
