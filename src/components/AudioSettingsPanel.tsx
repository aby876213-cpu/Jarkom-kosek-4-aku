import React from 'react';
import { Radio, Zap } from 'lucide-react';

interface AudioSettingsPanelProps {
  voxEnabled: boolean;
  voxThreshold: number;
  gainLevel: number;
  overrideActive: boolean;
  talkAllActive: boolean;
  onToggleVox: () => void;
  onVoxThresholdChange: (val: number) => void;
  onGainChange: (val: number) => void;
  onToggleOverride: () => void;
  onToggleTalkAll: () => void;
}

export const AudioSettingsPanel: React.FC<AudioSettingsPanelProps> = ({
  voxEnabled,
  voxThreshold,
  gainLevel,
  overrideActive,
  talkAllActive,
  onToggleVox,
  onVoxThresholdChange,
  onGainChange,
  onToggleOverride,
  onToggleTalkAll,
}) => {
  return (
    <section aria-label="Audio Settings" className="tactical-card rounded-xl p-3 space-y-2.5">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 flex-1 bg-slate-950/65 border border-cyan-500/20 rounded-lg px-2.5 py-2">
          <button
            type="button"
            onClick={onToggleVox}
            className={`min-h-[40px] px-3 py-1.5 rounded text-xs font-[var(--font-tech)] border transition whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#00f0ff] ${
              voxEnabled
                ? 'bg-cyan-500/25 border-[#00f0ff] text-white shadow-[0_0_12px_rgba(0,240,255,0.3)]'
                : 'bg-slate-900 border-cyan-500/40 text-cyan-200 hover:bg-slate-800'
            }`}
          >
            VOX: {voxEnabled ? 'ON' : 'OFF'}
          </button>

          <div className="flex-1 flex flex-col">
            <div className="flex justify-between text-[11px] text-cyan-300/85 tabular-nums">
              <label htmlFor="vox-threshold-slider">THR</label>
              <span>{voxThreshold}%</span>
            </div>
            <input
              id="vox-threshold-slider"
              type="range"
              min={5}
              max={90}
              value={voxThreshold}
              onChange={(e) => onVoxThresholdChange(Number(e.target.value))}
              className="tactical-slider w-full mt-1.5"
            />
          </div>
        </div>

        <div className="sm:w-[138px] bg-slate-950/65 border border-cyan-500/20 rounded-lg px-2.5 py-2 flex flex-col justify-center">
          <div className="flex justify-between text-[11px] text-cyan-300/85 tabular-nums">
            <label htmlFor="gain-slider">GAIN</label>
            <span className="text-[#00f0ff] font-bold">{gainLevel.toFixed(1)}x</span>
          </div>
          <input
            id="gain-slider"
            type="range"
            min={0.5}
            max={5.0}
            step={0.5}
            value={gainLevel}
            onChange={(e) => onGainChange(parseFloat(e.target.value))}
            className="tactical-slider w-full mt-1.5"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onToggleOverride}
          className={`min-h-[42px] py-2 px-3 rounded-lg text-xs font-[var(--font-tech)] tracking-wider border flex items-center justify-center gap-1.5 transition whitespace-nowrap focus-visible:outline-2 focus-visible:outline-amber-400 ${
            overrideActive
              ? 'border-amber-400 bg-amber-500/25 text-amber-100 shadow-[0_0_12px_rgba(255,184,0,0.3)]'
              : 'border-amber-500/45 bg-amber-950/20 text-amber-300 hover:bg-amber-900/30'
          }`}
        >
          <Zap className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>OVERRIDE: {overrideActive ? 'ON' : 'OFF'}</span>
        </button>

        <button
          type="button"
          onClick={onToggleTalkAll}
          className={`min-h-[42px] py-2 px-3 rounded-lg text-xs font-[var(--font-tech)] tracking-wider border flex items-center justify-center gap-1.5 transition whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#00f0ff] ${
            talkAllActive
              ? 'border-[#00f0ff] bg-cyan-500/25 text-white shadow-[0_0_12px_rgba(0,240,255,0.35)]'
              : 'border-cyan-500/45 bg-cyan-950/30 text-cyan-200 hover:bg-cyan-900/40'
          }`}
        >
          <Radio className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>TALK ALL: {talkAllActive ? 'ON' : 'OFF'}</span>
        </button>
      </div>
    </section>
  );
};
