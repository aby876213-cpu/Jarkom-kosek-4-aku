export const CHANNEL_FREQS = [
  '446.006',
  '446.018',
  '446.031',
  '446.043',
  '446.056',
  '446.068',
  '446.081',
  '446.093',
  '446.106',
  '446.118',
  '446.131',
  '446.150',
] as const;

export function mungeOpus16kSDP(sdp: string): string {
  const match = sdp.match(/a=rtpmap:(\d+) opus\/48000/i);
  if (!match) return sdp;
  const opusPt = match[1];
  const fmtpRegex = new RegExp(`a=fmtp:${opusPt} ([^\\r\\n]*)`, 'g');
  const extraParams = [
    ['sprop-maxcapturerate', '16000'],
    ['maxaveragebitrate', '16000'],
    ['minptime', '10'],
    ['ptime', '10'],
    ['useinbandfec', '1'],
    ['stereo', '0'],
  ];

  return sdp.replace(fmtpRegex, (_full, existing: string) => {
    const parts = existing
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    const kv = new Map<string, string>();
    for (const part of parts) {
      const eqIdx = part.indexOf('=');
      if (eqIdx > 0) {
        kv.set(part.slice(0, eqIdx).trim(), part.slice(eqIdx + 1).trim());
      }
    }
    for (const [k, v] of extraParams) {
      kv.set(k, v);
    }
    const merged = Array.from(kv.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join(';');
    return `a=fmtp:${opusPt} ${merged}`;
  });
}

export function createAudioContextSafe(preferredRate = 16000): AudioContext {
  const AudioContextCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  try {
    return new AudioContextCtor({
      sampleRate: preferredRate,
      latencyHint: 'interactive',
    });
  } catch {
    return new AudioContextCtor({
      latencyHint: 'interactive',
    });
  }
}

export function downsampleTo16kInt16(input: Float32Array, inputSampleRate: number): Int16Array {
  const targetRate = 16000;
  if (inputSampleRate === targetRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  const ratio = inputSampleRate / targetRate;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += input[j];
      count++;
    }
    const avg = count > 0 ? sum / count : 0;
    const s = Math.max(-1, Math.min(1, avg));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function encodePcm16ToWavBlob(chunks: Int16Array[], sampleRate = 16000): Blob | null {
  let totalSamples = 0;
  for (const chunk of chunks) {
    totalSamples += chunk.length;
  }
  if (totalSamples === 0) return null;

  const dataByteLength = totalSamples * 2;
  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataByteLength, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      view.setInt16(offset, chunk[i], true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export function playTacticalTone(
  ctx: AudioContext | null,
  freq = 880,
  duration = 0.045,
  type: OscillatorType = 'sine'
) {
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {
    // Ignore audio context autoplay guard failures
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = typeof reader.result === 'string' ? reader.result : '';
      const base64 = res.includes(',') ? res.split(',')[1] : res;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function base64ToBlobUrl(base64: string, mimeType = 'audio/wav'): string | null {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}
