import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  CallLogEntry,
  CallLogType,
  ChatMessage,
  EncryptedPayload,
  EnrolledUser,
  LogFilter,
  PeerInfo,
  UnitRole,
} from '../types/comms';
import { decryptAES, deriveChannelKey, encryptAES } from '../utils/crypto';
import {
  base64ToBlobUrl,
  blobToBase64,
  CHANNEL_FREQS,
  createAudioContextSafe,
  downsampleTo16kInt16,
  encodePcm16ToWavBlob,
  mungeOpus16kSDP,
  playTacticalTone,
} from '../utils/audio';
import { clampChannel, normalizeRole, sanitizeCallsign } from '../utils/barcode';

const MAX_CHANNELS = 12;
const MAX_PCM_CHUNKS = 380; // ~48 seconds at 2048 samples / 16kHz

interface InitialInviteParams {
  token: string;
  callsign: string;
  channel: number;
  role: UnitRole;
  inviter: string;
}

function readInitialInviteFromUrl(): InitialInviteParams | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const token = params.get('invite');
  const rawCallsign = params.get('callsign');
  if (!token && !rawCallsign) return null;

  const callsign = sanitizeCallsign(rawCallsign || '') || `KOSEK-${Math.floor(10 + Math.random() * 89)}`;
  const channel = clampChannel(params.get('ch'), 12);
  const role = normalizeRole(params.get('role'));
  const inviter = sanitizeCallsign(params.get('by') || '') || 'BARCODE';

  return {
    token: (token || `K4-${String(channel).padStart(2, '0')}-${callsign}`).toUpperCase(),
    callsign,
    channel,
    role,
    inviter,
  };
}

function toInt16Array(raw: unknown): Int16Array | null {
  if (!raw) return null;
  if (raw instanceof Int16Array) return raw;
  if (raw instanceof ArrayBuffer) {
    const byteLen = raw.byteLength - (raw.byteLength % 2);
    return byteLen > 0 ? new Int16Array(raw, 0, byteLen / 2) : null;
  }
  if (ArrayBuffer.isView(raw)) {
    const view = raw as ArrayBufferView;
    const copy = new Uint8Array(view.byteLength);
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    const byteLen = copy.byteLength - (copy.byteLength % 2);
    return byteLen > 0 ? new Int16Array(copy.buffer, 0, byteLen / 2) : null;
  }
  return null;
}

export function useTacticalComms() {
  const initialInviteRef = useRef<InitialInviteParams | null>(readInitialInviteFromUrl());
  const inviteRedeemedRef = useRef<boolean>(false);

  const [channel, setChannel] = useState<number>(() => initialInviteRef.current?.channel ?? 12);
  const [callsign, setCallsign] = useState<string>(
    () => initialInviteRef.current?.callsign || `KOSEK-${Math.floor(10 + Math.random() * 89)}`
  );
  const [clientIp, setClientIp] = useState<string>('Detecting...');
  const [socketConnected, setSocketConnected] = useState<boolean>(false);
  const [pingMs, setPingMs] = useState<number>(12);
  const [micStatus, setMicStatus] = useState<'standby' | 'ready' | 'blocked'>('standby');
  const [micLevel, setMicLevel] = useState<number>(0);
  const [audioOutputBlocked, setAudioOutputBlocked] = useState<boolean>(false);

  const [isTransmitting, setIsTransmitting] = useState<boolean>(false);
  const [txMode, setTxMode] = useState<'tx' | 'vox'>('tx');
  const [rxActiveSender, setRxActiveSender] = useState<string | null>(null);

  const [voxEnabled, setVoxEnabled] = useState<boolean>(false);
  const [voxThreshold, setVoxThreshold] = useState<number>(35);
  const [gainLevel, setGainLevel] = useState<number>(3.0);
  const [overrideActive, setOverrideActive] = useState<boolean>(false);
  const [talkAllActive, setTalkAllActive] = useState<boolean>(false);
  const [emergencyMode, setEmergencyMode] = useState<boolean>(false);

  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [enrolledUsers, setEnrolledUsers] = useState<EnrolledUser[]>([]);
  const [callLogs, setCallLogs] = useState<CallLogEntry[]>([]);
  const [logFilter, setLogFilter] = useState<LogFilter>('all');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    const inv = initialInviteRef.current;
    const baseText = inv
      ? `Unit ${inv.callsign} bergabung ke CH ${String(inv.channel).padStart(2, '0')} via Barcode (diundang ${inv.inviter}).`
      : 'KOSEK IV Tactical Comms aktif. Tahan tombol PTT atau Spacebar untuk TX.';
    return [
      {
        id: 'boot-1',
        time: new Date().toTimeString().slice(0, 5),
        sender: 'SYSTEM',
        text: baseText,
        channel: inv?.channel ?? 12,
        isSos: false,
        encrypted: true,
      },
    ];
  });

  const socketRef = useRef<Socket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processedStreamRef = useRef<MediaStream | null>(null);
  const txTrackRef = useRef<MediaStreamTrack | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const pcmChunksRef = useRef<Int16Array[]>([]);
  const audioPoolRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const rxAudioNextTimeRef = useRef<Map<string, number>>(new Map());

  const rtcPeersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const rtcTrackReadyRef = useRef<Set<string>>(new Set());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const dataChannelsRef = useRef<Map<string, RTCDataChannel>>(new Map());
  const aesKeyRef = useRef<CryptoKey | null>(null);

  const peersRef = useRef<PeerInfo[]>([]);
  const gainLevelRef = useRef<number>(gainLevel);
  const pttPressedRef = useRef<boolean>(false);
  const isTransmittingRef = useRef<boolean>(false);
  const txStartRef = useRef<number>(0);
  const voxEnabledRef = useRef<boolean>(false);
  const voxThresholdRef = useRef<number>(35);
  const voxHangoverRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<number>(initialInviteRef.current?.channel ?? 12);
  const callsignRef = useRef<string>(callsign);
  const talkAllRef = useRef<boolean>(false);
  const overrideRef = useRef<boolean>(false);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  useEffect(() => {
    gainLevelRef.current = gainLevel;
  }, [gainLevel]);

  useEffect(() => {
    voxEnabledRef.current = voxEnabled;
  }, [voxEnabled]);

  useEffect(() => {
    voxThresholdRef.current = voxThreshold;
  }, [voxThreshold]);

  useEffect(() => {
    channelRef.current = channel;
  }, [channel]);

  useEffect(() => {
    callsignRef.current = callsign;
  }, [callsign]);

  useEffect(() => {
    talkAllRef.current = talkAllActive;
  }, [talkAllActive]);

  useEffect(() => {
    overrideRef.current = overrideActive;
  }, [overrideActive]);

  const appendLog = useCallback(
    (type: CallLogType, sender: string, ch: number, duration: string, audioUrl: string | null) => {
      const time = new Date().toTimeString().slice(0, 8);
      setCallLogs((prev) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          time,
          type,
          sender,
          channel: ch,
          duration,
          audioUrl,
        },
        ...prev.slice(0, 49),
      ]);
    },
    []
  );

  const appendChat = useCallback(
    (sender: string, text: string, ch: number, isSos = false) => {
      const time = new Date().toTimeString().slice(0, 5);
      setChatMessages((prev) => [
        ...prev.slice(-49),
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          time,
          sender,
          text,
          channel: ch,
          isSos,
          encrypted: true,
        },
      ]);
    },
    []
  );

  const getOrCreateAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = createAudioContextSafe(16000);
    }
    return audioCtxRef.current;
  }, []);

  const attemptPlayAudio = useCallback((audioEl: HTMLAudioElement) => {
    audioEl.muted = false;
    audioEl.volume = 1.0;
    const playPromise = audioEl.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise
        .then(() => {
          setAudioOutputBlocked(false);
        })
        .catch(() => {
          setAudioOutputBlocked(true);
        });
    }
  }, []);

  const unlockAudioOutput = useCallback(async () => {
    const ctx = getOrCreateAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }

    let anyBlocked = ctx.state === 'suspended';
    for (const audioEl of audioPoolRef.current.values()) {
      if (audioEl.srcObject) {
        try {
          audioEl.muted = false;
          audioEl.volume = 1.0;
          await audioEl.play();
        } catch {
          anyBlocked = true;
        }
      }
    }
    setAudioOutputBlocked(anyBlocked);
  }, [getOrCreateAudioContext]);

  // Global user gesture unlocker for mobile autoplay policies
  useEffect(() => {
    const handleGesture = () => {
      const ctxSuspended = audioCtxRef.current?.state === 'suspended';
      const anyPaused = Array.from(audioPoolRef.current.values()).some(
        (el) => Boolean(el.srcObject) && el.paused
      );
      if (ctxSuspended || anyPaused) {
        void unlockAudioOutput();
      }
    };

    window.addEventListener('pointerdown', handleGesture, { passive: true });
    window.addEventListener('touchstart', handleGesture, { passive: true });
    window.addEventListener('keydown', handleGesture, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', handleGesture);
      window.removeEventListener('touchstart', handleGesture);
      window.removeEventListener('keydown', handleGesture);
    };
  }, [unlockAudioOutput]);

  // ==========================================================
  // AUDIO ENGINE (OPUS 16kHz + GAIN + PCM RELAY + VOX MONITOR)
  // ==========================================================
  const attachLocalTrackToPeers = useCallback(async (track: MediaStreamTrack, stream: MediaStream) => {
    for (const [peerId, pc] of rtcPeersRef.current.entries()) {
      try {
        const audioTransceiver = pc
          .getTransceivers()
          .find(
            (t) =>
              t.receiver?.track?.kind === 'audio' ||
              t.sender?.track?.kind === 'audio' ||
              t.mid !== null
          );

        if (audioTransceiver) {
          audioTransceiver.direction = 'sendrecv';
          await audioTransceiver.sender.replaceTrack(track);
        } else {
          const existingSender = pc.getSenders().find((s) => s.track?.kind === 'audio');
          if (existingSender) {
            await existingSender.replaceTrack(track);
          } else {
            pc.addTrack(track, stream);
            if (pc.signalingState === 'stable' && socketRef.current?.connected) {
              const offer = await pc.createOffer();
              const munged = mungeOpus16kSDP(offer.sdp || '');
              try {
                await pc.setLocalDescription({ type: offer.type, sdp: munged });
              } catch {
                await pc.setLocalDescription(offer);
              }
              socketRef.current.emit('rtc-offer', {
                targetId: peerId,
                sdp: pc.localDescription,
              });
            }
          }
        }
      } catch {
        // Peer might be closing; ignore
      }
    }
  }, []);

  const ensureAudioReady = useCallback(async () => {
    const ctx = getOrCreateAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }

    if (!micStreamRef.current && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        micStreamRef.current = stream;

        const source = ctx.createMediaStreamSource(stream);
        const gainNode = ctx.createGain();
        gainNode.gain.value = gainLevelRef.current;
        gainNodeRef.current = gainNode;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;

        const dest = ctx.createMediaStreamDestination();
        source.connect(gainNode);
        gainNode.connect(analyser);
        gainNode.connect(dest);

        // Keep WebAudio graph alive on mobile Chromium/WebKit & capture 16kHz PCM relay
        const zeroGain = ctx.createGain();
        zeroGain.gain.value = 0;
        zeroGain.connect(ctx.destination);

        if (typeof ctx.createScriptProcessor === 'function') {
          const processor = ctx.createScriptProcessor(2048, 1, 1);
          processor.onaudioprocess = (ev) => {
            if (!isTransmittingRef.current) return;
            const input = ev.inputBuffer.getChannelData(0);
            const int16 = downsampleTo16kInt16(input, ctx.sampleRate);

            if (pcmChunksRef.current.length < MAX_PCM_CHUNKS) {
              pcmChunksRef.current.push(int16);
            }

            const needsRelay =
              talkAllRef.current ||
              overrideRef.current ||
              peersRef.current.some((peer) => {
                const pc = rtcPeersRef.current.get(peer.id);
                return (
                  !pc ||
                  (pc.connectionState !== 'connected' &&
                    pc.iceConnectionState !== 'connected' &&
                    pc.iceConnectionState !== 'completed')
                );
              });

            if (needsRelay && socketRef.current?.connected) {
              socketRef.current.emit('ptt-audio-chunk', {
                channel: channelRef.current,
                talkAll: talkAllRef.current,
                override: overrideRef.current,
                sampleRate: 16000,
                pcm: int16.buffer,
              });
            }
          };
          gainNode.connect(processor);
          processor.connect(zeroGain);
          processorNodeRef.current = processor;
        } else {
          gainNode.connect(zeroGain);
        }

        processedStreamRef.current = dest.stream;
        const track = dest.stream.getAudioTracks()[0];
        track.enabled = false;
        txTrackRef.current = track;

        await attachLocalTrackToPeers(track, dest.stream);
        setMicStatus('ready');
      } catch {
        setMicStatus('blocked');
      }
    }

    await unlockAudioOutput();
  }, [attachLocalTrackToPeers, getOrCreateAudioContext, unlockAudioOutput]);

  // ==========================================================
  // PTT START / STOP (MOUSE, TOUCH, SPACEBAR & VOX)
  // ==========================================================
  const stopPTT = useCallback(
    (mode: 'tx' | 'vox' = 'tx') => {
      if (mode === 'tx') {
        pttPressedRef.current = false;
      }
      if (!isTransmittingRef.current) return;
      isTransmittingRef.current = false;
      setIsTransmitting(false);
      if (txTrackRef.current) {
        txTrackRef.current.enabled = false;
      }

      const elapsedSec = Math.max(1, Math.round((Date.now() - txStartRef.current) / 1000));
      const durationStr = `00:${String(elapsedSec).padStart(2, '0')}`;
      const activeCh = channelRef.current;
      const activeCallsign = callsignRef.current;

      playTacticalTone(audioCtxRef.current, 620, 0.055, 'sine');

      const capturedPcm = pcmChunksRef.current.slice();
      pcmChunksRef.current = [];

      const emitStop = async (audioUrl: string | null, audioBlob: Blob | null) => {
        appendLog(mode, activeCallsign, activeCh, durationStr, audioUrl);

        let audioClipBase64: string | null = null;
        let audioMimeType: string | null = null;
        if (audioBlob && audioBlob.size > 0 && audioBlob.size < 1_500_000) {
          try {
            audioClipBase64 = await blobToBase64(audioBlob);
            audioMimeType = audioBlob.type || 'audio/wav';
          } catch {
            audioClipBase64 = null;
          }
        }

        if (socketRef.current?.connected) {
          socketRef.current.emit('ptt-status', {
            talking: false,
            channel: activeCh,
            talkAll: talkAllRef.current,
            override: overrideRef.current,
            duration: durationStr,
            mode,
            audioClipBase64,
            audioMimeType,
          });
        }
      };

      const wavBlob = capturedPcm.length > 0 ? encodePcm16ToWavBlob(capturedPcm, 16000) : null;
      const recorder = mediaRecorderRef.current;

      if (wavBlob) {
        if (recorder && recorder.state !== 'inactive') {
          recorder.onstop = null;
          try {
            recorder.stop();
          } catch {
            // Ignore recorder stop failure when WAV is ready
          }
        }
        const wavUrl = URL.createObjectURL(wavBlob);
        void emitStop(wavUrl, wavBlob);
      } else if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = () => {
          const mimeType = recorder.mimeType || 'audio/webm';
          const blob = new Blob(recordedChunksRef.current, { type: mimeType });
          const url = recordedChunksRef.current.length > 0 ? URL.createObjectURL(blob) : null;
          void emitStop(url, blob);
        };
        try {
          recorder.stop();
        } catch {
          void emitStop(null, null);
        }
      } else {
        void emitStop(null, null);
      }
    },
    [appendLog]
  );

  const startPTT = useCallback(
    async (mode: 'tx' | 'vox' = 'tx') => {
      if (mode === 'tx') {
        pttPressedRef.current = true;
      }
      if (isTransmittingRef.current) return;

      await ensureAudioReady();

      // Guard if user released finger/key while mic permission dialog was open
      if (mode === 'tx' && !pttPressedRef.current) return;
      if (isTransmittingRef.current) return;

      if (audioCtxRef.current?.state === 'suspended') {
        await audioCtxRef.current.resume().catch(() => {});
      }

      isTransmittingRef.current = true;
      txStartRef.current = Date.now();
      pcmChunksRef.current = [];
      setTxMode(mode);
      setIsTransmitting(true);

      if (txTrackRef.current) {
        txTrackRef.current.enabled = true;
      }

      playTacticalTone(audioCtxRef.current, 980, 0.045, 'triangle');
      if (navigator.vibrate) {
        navigator.vibrate(25);
      }

      if (processedStreamRef.current && typeof MediaRecorder !== 'undefined') {
        try {
          recordedChunksRef.current = [];
          const recorder = new MediaRecorder(processedStreamRef.current);
          recorder.ondataavailable = (ev) => {
            if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
          };
          recorder.start();
          mediaRecorderRef.current = recorder;
        } catch {
          mediaRecorderRef.current = null;
        }
      }

      if (socketRef.current?.connected) {
        socketRef.current.emit('ptt-status', {
          talking: true,
          channel: channelRef.current,
          talkAll: talkAllRef.current,
          override: overrideRef.current,
          mode,
        });
      }
    },
    [ensureAudioReady]
  );

  // Monitor RMS mic level & VOX trigger
  useEffect(() => {
    if (micStatus !== 'ready') return;

    const buffer = new Uint8Array(analyserRef.current?.frequencyBinCount || 128);
    const tick = () => {
      const analyser = analyserRef.current;
      if (analyser) {
        analyser.getByteTimeDomainData(buffer);
        let sumSq = 0;
        for (let i = 0; i < buffer.length; i++) {
          const sample = (buffer[i] - 128) / 128;
          sumSq += sample * sample;
        }
        const rms = Math.sqrt(sumSq / buffer.length);
        const pct = Math.min(100, Math.round(rms * 350));

        setMicLevel(isTransmittingRef.current || voxEnabledRef.current ? pct : 0);

        if (voxEnabledRef.current) {
          if (pct >= voxThresholdRef.current) {
            if (voxHangoverRef.current) {
              clearTimeout(voxHangoverRef.current);
              voxHangoverRef.current = null;
            }
            if (!isTransmittingRef.current) {
              void startPTT('vox');
            }
          } else if (isTransmittingRef.current && !voxHangoverRef.current) {
            voxHangoverRef.current = setTimeout(() => {
              voxHangoverRef.current = null;
              if (voxEnabledRef.current) {
                stopPTT('vox');
              }
            }, 650);
          }
        }
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [micStatus, startPTT, stopPTT]);

  // ==========================================================
  // WEBRTC PEER CONNECTIONS & E2EE DATA CHANNELS
  // ==========================================================
  const setupDataChannel = useCallback(
    (peerId: string, dc: RTCDataChannel) => {
      dataChannelsRef.current.set(peerId, dc);
      dc.onmessage = async (event) => {
        try {
          const packet = JSON.parse(event.data) as {
            sender: string;
            channel: number;
            encryptedPayload: EncryptedPayload;
          };
          const decrypted = await decryptAES(aesKeyRef.current, packet.encryptedPayload);
          if (decrypted) {
            const isSos = decrypted.text === 'SOS' || decrypted.text.startsWith('SOS');
            appendChat(packet.sender, decrypted.text, packet.channel || channelRef.current, isSos);
            if (isSos) {
              appendLog('sos', packet.sender, packet.channel || channelRef.current, '00:01', null);
            }
          }
        } catch {
          // Ignore malformed packet
        }
      };
      dc.onclose = () => {
        dataChannelsRef.current.delete(peerId);
      };
    },
    [appendChat, appendLog]
  );

  const flushPendingIce = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    const queued = pendingIceRef.current.get(peerId);
    if (!queued || queued.length === 0) return;
    pendingIceRef.current.delete(peerId);
    for (const candidate of queued) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
    }
  }, []);

  const createWebRTCPeer = useCallback(
    (peerId: string, isInitiator: boolean) => {
      const existing = rtcPeersRef.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
        ],
      });

      if (isInitiator) {
        if (processedStreamRef.current && txTrackRef.current) {
          pc.addTrack(txTrackRef.current, processedStreamRef.current);
        } else {
          // Reserve sendrecv m=audio line immediately so late replaceTrack works without renegotiation
          pc.addTransceiver('audio', { direction: 'sendrecv' });
        }
        const dc = pc.createDataChannel('e2ee-tactical', { ordered: true });
        setupDataChannel(peerId, dc);
      } else {
        pc.ondatachannel = (ev) => setupDataChannel(peerId, ev.channel);
      }

      pc.onicecandidate = (ev) => {
        if (ev.candidate && socketRef.current?.connected) {
          socketRef.current.emit('rtc-ice', { targetId: peerId, candidate: ev.candidate });
        }
      };

      pc.ontrack = (ev) => {
        rtcTrackReadyRef.current.add(peerId);
        const stream = ev.streams?.[0] ?? new MediaStream([ev.track]);

        let audioEl = audioPoolRef.current.get(peerId);
        if (!audioEl) {
          audioEl = document.createElement('audio');
          audioEl.autoplay = true;
          audioEl.setAttribute('playsinline', 'true');
          audioEl.setAttribute('webkit-playsinline', 'true');
          audioEl.muted = false;
          audioEl.volume = 1.0;
          audioEl.style.display = 'none';
          document.body.appendChild(audioEl);
          audioPoolRef.current.set(peerId, audioEl);
        }

        audioEl.srcObject = stream;
        attemptPlayAudio(audioEl);

        ev.track.onunmute = () => {
          if (audioEl) {
            attemptPlayAudio(audioEl);
          }
        };
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          const audioEl = audioPoolRef.current.get(peerId);
          if (audioEl && audioEl.paused && audioEl.srcObject) {
            attemptPlayAudio(audioEl);
          }
        }
      };

      rtcPeersRef.current.set(peerId, pc);
      return pc;
    },
    [attemptPlayAudio, setupDataChannel]
  );

  // ==========================================================
  // SOCKET.IO SIGNALING CONNECTION
  // ==========================================================
  const measurePing = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('ping-check', Date.now());
    }
  }, []);

  useEffect(() => {
    const initialCh = initialInviteRef.current?.channel ?? 12;
    deriveChannelKey(initialCh).then((k) => {
      aesKeyRef.current = k;
    });

    if (initialInviteRef.current && typeof window !== 'undefined') {
      window.history.replaceState({}, '', window.location.pathname);
    }

    const socket = io({
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
      socket.emit('join-channel', {
        channel: channelRef.current,
        callsign: callsignRef.current,
      });
      socket.emit('ping-check', Date.now());

      if (initialInviteRef.current && !inviteRedeemedRef.current) {
        inviteRedeemedRef.current = true;
        socket.emit('redeem-invite', initialInviteRef.current);
      }
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    socket.on('your-info', ({ ip }: { id: string; ip: string }) => {
      if (ip) setClientIp(ip);
    });

    socket.on('channel-peers', async (roomPeers: PeerInfo[]) => {
      const validIds = new Set(roomPeers.map((p) => p.id));
      for (const [id, pc] of rtcPeersRef.current.entries()) {
        if (!validIds.has(id)) {
          pc.close();
          rtcPeersRef.current.delete(id);
          rtcTrackReadyRef.current.delete(id);
          pendingIceRef.current.delete(id);
          dataChannelsRef.current.delete(id);
          rxAudioNextTimeRef.current.delete(id);
          const audioEl = audioPoolRef.current.get(id);
          if (audioEl) {
            audioEl.pause();
            audioEl.srcObject = null;
            audioEl.remove();
            audioPoolRef.current.delete(id);
          }
        }
      }

      const otherPeers = roomPeers.filter((p) => p.id !== socket.id);
      setPeers(otherPeers);

      const anyoneTalking = otherPeers.some((p) => p.talking);
      if (!anyoneTalking) {
        setRxActiveSender(null);
      }

      for (const peer of otherPeers) {
        if (!rtcPeersRef.current.has(peer.id) && socket.id && socket.id < peer.id) {
          try {
            const pc = createWebRTCPeer(peer.id, true);
            const offer = await pc.createOffer();
            const mungedSdp = mungeOpus16kSDP(offer.sdp || '');
            try {
              await pc.setLocalDescription({ type: offer.type, sdp: mungedSdp });
            } catch {
              await pc.setLocalDescription(offer);
            }
            socket.emit('rtc-offer', { targetId: peer.id, sdp: pc.localDescription });
          } catch {
            // Relay fallback will still deliver audio if signaling races
          }
        }
      }
    });

    socket.on(
      'rtc-offer',
      async ({ senderId, sdp }: { senderId: string; sdp: RTCSessionDescriptionInit }) => {
        try {
          const pc = rtcPeersRef.current.get(senderId) || createWebRTCPeer(senderId, false);
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          await flushPendingIce(senderId, pc);

          if (txTrackRef.current && processedStreamRef.current) {
            const audioTransceiver = pc
              .getTransceivers()
              .find(
                (t) =>
                  t.receiver?.track?.kind === 'audio' || t.sender?.track?.kind === 'audio'
              );
            if (audioTransceiver) {
              audioTransceiver.direction = 'sendrecv';
              await audioTransceiver.sender.replaceTrack(txTrackRef.current);
            } else if (!pc.getSenders().some((s) => s.track?.kind === 'audio')) {
              pc.addTrack(txTrackRef.current, processedStreamRef.current);
            }
          }

          const answer = await pc.createAnswer();
          const mungedSdp = mungeOpus16kSDP(answer.sdp || '');
          try {
            await pc.setLocalDescription({ type: answer.type, sdp: mungedSdp });
          } catch {
            await pc.setLocalDescription(answer);
          }
          socket.emit('rtc-answer', { targetId: senderId, sdp: pc.localDescription });
        } catch {
          // Relay fallback handles audio if SDP exchange fails
        }
      }
    );

    socket.on(
      'rtc-answer',
      async ({ senderId, sdp }: { senderId: string; sdp: RTCSessionDescriptionInit }) => {
        const pc = rtcPeersRef.current.get(senderId);
        if (pc) {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            await flushPendingIce(senderId, pc);
          } catch {
            // Ignore state mismatch on duplicate answers
          }
        }
      }
    );

    socket.on(
      'rtc-ice',
      async ({ senderId, candidate }: { senderId: string; candidate: RTCIceCandidateInit }) => {
        if (!candidate) return;
        const pc = rtcPeersRef.current.get(senderId);
        if (!pc || !pc.remoteDescription) {
          const queue = pendingIceRef.current.get(senderId) || [];
          queue.push(candidate);
          pendingIceRef.current.set(senderId, queue);
          return;
        }
        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      }
    );

    socket.on(
      'ptt-audio-chunk',
      ({
        senderId,
        talkAll,
        override,
        sampleRate,
        pcm,
      }: {
        senderId: string;
        callsign: string;
        channel: number;
        talkAll?: boolean;
        override?: boolean;
        sampleRate?: number;
        pcm: unknown;
      }) => {
        if (!senderId || senderId === socket.id) return;

        // If WebRTC P2P is connected and playing this peer's audio, skip Socket.IO relay to prevent double audio
        const pc = rtcPeersRef.current.get(senderId);
        const audioEl = audioPoolRef.current.get(senderId);
        const isWebRtcPlaying =
          !talkAll &&
          !override &&
          Boolean(pc) &&
          (pc!.connectionState === 'connected' ||
            pc!.iceConnectionState === 'connected' ||
            pc!.iceConnectionState === 'completed') &&
          rtcTrackReadyRef.current.has(senderId) &&
          Boolean(audioEl) &&
          !audioEl!.paused;

        if (isWebRtcPlaying) return;

        const int16 = toInt16Array(pcm);
        if (!int16 || int16.length === 0) return;

        const ctx = getOrCreateAudioContext();
        if (ctx.state === 'suspended') {
          ctx
            .resume()
            .then(() => {
              if (ctx.state === 'running') setAudioOutputBlocked(false);
            })
            .catch(() => {
              setAudioOutputBlocked(true);
            });
          if (ctx.state === 'suspended') {
            setAudioOutputBlocked(true);
          }
        }

        const rate = sampleRate || 16000;
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
          float32[i] = int16[i] / 32768;
        }

        const audioBuffer = ctx.createBuffer(1, float32.length, rate);
        audioBuffer.getChannelData(0).set(float32);

        const src = ctx.createBufferSource();
        src.buffer = audioBuffer;
        src.connect(ctx.destination);

        const now = ctx.currentTime;
        const prevNext = rxAudioNextTimeRef.current.get(senderId) ?? 0;
        const startAt = prevNext < now || prevNext > now + 0.6 ? now + 0.04 : prevNext;
        src.start(startAt);
        rxAudioNextTimeRef.current.set(senderId, startAt + audioBuffer.duration);
      }
    );

    socket.on(
      'ptt-status',
      ({
        senderId,
        callsign: remoteCallsign,
        talking,
        channel: remoteChannel,
        duration,
        audioClipBase64,
        audioMimeType,
      }: {
        senderId: string;
        callsign: string;
        talking: boolean;
        channel: number;
        duration?: string;
        audioClipBase64?: string | null;
        audioMimeType?: string | null;
      }) => {
        if (talking) {
          setRxActiveSender(remoteCallsign);
          playTacticalTone(audioCtxRef.current, 740, 0.035, 'sine');
        } else {
          setRxActiveSender(null);
          rxAudioNextTimeRef.current.delete(senderId);
          playTacticalTone(audioCtxRef.current, 540, 0.04, 'sine');
          if (duration) {
            const audioUrl = audioClipBase64
              ? base64ToBlobUrl(audioClipBase64, audioMimeType || 'audio/wav')
              : null;
            appendLog('rx', remoteCallsign, remoteChannel, duration, audioUrl);
          }
        }
      }
    );

    socket.on(
      'encrypted-chat',
      async ({
        sender,
        channel: msgChannel,
        encryptedPayload,
      }: {
        sender: string;
        channel: number;
        encryptedPayload: EncryptedPayload;
      }) => {
        const keyForMsg =
          msgChannel === channelRef.current
            ? aesKeyRef.current
            : await deriveChannelKey(msgChannel);
        const decrypted = await decryptAES(keyForMsg, encryptedPayload);
        if (decrypted) {
          const isSos = decrypted.text === 'SOS' || decrypted.text.startsWith('SOS');
          appendChat(sender, decrypted.text, msgChannel, isSos);
          if (isSos) {
            appendLog('sos', sender, msgChannel, '00:01', null);
          }
        }
      }
    );

    socket.on(
      'emergency-alert',
      ({
        sender,
        channel: alertCh,
        active,
      }: {
        senderId: string;
        sender: string;
        channel: number;
        active: boolean;
      }) => {
        if (active) {
          playTacticalTone(audioCtxRef.current, 1240, 0.16, 'square');
          appendLog('sos', sender, alertCh, '00:01', null);
        }
      }
    );

    socket.on('pong-check', (sentAt: number) => {
      setPingMs(Math.max(2, Date.now() - sentAt));
    });

    socket.on('enrolled-users', (users: EnrolledUser[]) => {
      setEnrolledUsers(users);
    });

    socket.on(
      'invite-redeemed',
      ({
        callsign: joinedCallsign,
        channel: joinedCh,
        inviter,
      }: {
        callsign: string;
        channel: number;
        inviter: string;
      }) => {
        playTacticalTone(audioCtxRef.current, 880, 0.06, 'triangle');
        appendChat(
          'SYSTEM',
          `User baru ${joinedCallsign} terhubung ke CH ${String(joinedCh).padStart(2, '0')} via Barcode (${inviter}).`,
          joinedCh,
          false
        );
      }
    );

    const pingTimer = setInterval(() => {
      if (socket.connected) {
        socket.emit('ping-check', Date.now());
      }
    }, 4000);

    return () => {
      clearInterval(pingTimer);
      socket.disconnect();
      for (const pc of rtcPeersRef.current.values()) {
        pc.close();
      }
      rtcPeersRef.current.clear();
      rtcTrackReadyRef.current.clear();
      pendingIceRef.current.clear();
      dataChannelsRef.current.clear();
      rxAudioNextTimeRef.current.clear();
      for (const audioEl of audioPoolRef.current.values()) {
        audioEl.pause();
        audioEl.srcObject = null;
        audioEl.remove();
      }
      audioPoolRef.current.clear();
    };
  }, [appendChat, appendLog, createWebRTCPeer, flushPendingIce, getOrCreateAudioContext]);

  // ==========================================================
  // SPACEBAR GLOBAL HOTKEY FOR PTT
  // ==========================================================
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        void startPTT('tx');
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        stopPTT('tx');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [startPTT, stopPTT]);

  // ==========================================================
  // CHANNEL SWITCHING & CONTROLS
  // ==========================================================
  const switchChannel = useCallback(async (nextCh: number) => {
    let target = nextCh;
    if (target < 1) target = MAX_CHANNELS;
    if (target > MAX_CHANNELS) target = 1;

    setChannel(target);
    channelRef.current = target;
    aesKeyRef.current = await deriveChannelKey(target);
    playTacticalTone(audioCtxRef.current, 1120, 0.03, 'sine');

    if (socketRef.current?.connected) {
      socketRef.current.emit('join-channel', {
        channel: target,
        callsign: callsignRef.current,
      });
    }
  }, []);

  const updateCallsign = useCallback((nextName: string) => {
    const clean = nextName.toUpperCase().slice(0, 14);
    setCallsign(clean);
    callsignRef.current = clean;
    if (socketRef.current?.connected) {
      socketRef.current.emit('join-channel', {
        channel: channelRef.current,
        callsign: clean || 'UNIT',
      });
    }
  }, []);

  const sendChatText = useCallback(
    async (rawText: string) => {
      const clean = rawText.trim();
      if (!clean) return;
      const isSos = clean === 'SOS' || clean.startsWith('SOS');
      const activeCh = channelRef.current;
      const senderName = callsignRef.current || 'UNIT';

      appendChat(senderName, clean, activeCh, isSos);
      if (isSos) {
        appendLog('sos', senderName, activeCh, '00:01', null);
        playTacticalTone(audioCtxRef.current, 1200, 0.14, 'square');
      }

      const encryptedPayload = await encryptAES(aesKeyRef.current, {
        text: clean,
        ts: Date.now(),
      });

      let sentViaP2P = false;
      if (!talkAllRef.current) {
        for (const dc of dataChannelsRef.current.values()) {
          if (dc.readyState === 'open') {
            dc.send(
              JSON.stringify({
                sender: senderName,
                channel: activeCh,
                encryptedPayload,
              })
            );
            sentViaP2P = true;
          }
        }
      }

      if (!sentViaP2P && socketRef.current?.connected) {
        socketRef.current.emit('encrypted-chat', {
          channel: activeCh,
          sender: senderName,
          encryptedPayload,
          talkAll: talkAllRef.current,
        });
      }
    },
    [appendChat, appendLog]
  );

  const toggleEmergency = useCallback(async () => {
    const nextState = !emergencyMode;
    setEmergencyMode(nextState);
    if (nextState) {
      await switchChannel(12);
      await sendChatText('SOS - EMERGENCY CHANNEL 12 AKTIF');
      socketRef.current?.emit('emergency-alert', {
        channel: 12,
        sender: callsignRef.current,
        active: true,
      });
    } else {
      socketRef.current?.emit('emergency-alert', {
        channel: channelRef.current,
        sender: callsignRef.current,
        active: false,
      });
    }
  }, [emergencyMode, sendChatText, switchChannel]);

  const toggleVox = useCallback(async () => {
    await ensureAudioReady();
    setVoxEnabled((prev) => {
      const next = !prev;
      if (!next && isTransmittingRef.current) {
        stopPTT('vox');
      }
      return next;
    });
  }, [ensureAudioReady, stopPTT]);

  const updateGain = useCallback((val: number) => {
    setGainLevel(val);
    gainLevelRef.current = val;
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = val;
    }
  }, []);

  const playLogEntry = useCallback(
    async (entry: CallLogEntry) => {
      await unlockAudioOutput();
      if (entry.audioUrl) {
        const audio = new Audio(entry.audioUrl);
        audio.setAttribute('playsinline', 'true');
        audio.volume = 1.0;
        audio.play().catch(() => {});
      } else {
        await ensureAudioReady();
        playTacticalTone(
          audioCtxRef.current,
          entry.type === 'sos' ? 1200 : 780,
          0.14,
          'square'
        );
      }
    },
    [ensureAudioReady, unlockAudioOutput]
  );

  const enrollUserByBarcode = useCallback(
    (payload: {
      token?: string;
      callsign: string;
      channel: number;
      role: UnitRole;
      method: 'barcode-scan' | 'qr-invite' | 'manual';
    }) => {
      const cleanCallsign = sanitizeCallsign(payload.callsign);
      if (!cleanCallsign) return;
      const cleanCh = clampChannel(payload.channel, channelRef.current);

      if (socketRef.current?.connected) {
        socketRef.current.emit('enroll-user-barcode', {
          token: payload.token,
          callsign: cleanCallsign,
          channel: cleanCh,
          role: payload.role,
          addedBy: callsignRef.current || 'OPERATOR',
          method: payload.method,
        });
      }

      playTacticalTone(audioCtxRef.current, 1040, 0.06, 'triangle');
      appendChat(
        'SYSTEM',
        `User ${cleanCallsign} (${payload.role}) ditambahkan ke CH ${String(cleanCh).padStart(2, '0')} via Barcode.`,
        channelRef.current,
        false
      );
    },
    [appendChat]
  );

  const removeEnrolledUser = useCallback((id: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('remove-enrolled-user', { id });
    }
  }, []);

  return {
    channel,
    channelFreq: CHANNEL_FREQS[channel - 1],
    callsign,
    clientIp,
    socketConnected,
    pingMs,
    micStatus,
    micLevel,
    audioOutputBlocked,
    isTransmitting,
    txMode,
    rxActiveSender,
    voxEnabled,
    voxThreshold,
    gainLevel,
    overrideActive,
    talkAllActive,
    emergencyMode,
    peers,
    enrolledUsers,
    callLogs,
    logFilter,
    chatMessages,
    setVoxThreshold,
    setOverrideActive,
    setTalkAllActive,
    setLogFilter,
    updateCallsign,
    switchChannel,
    toggleEmergency,
    toggleVox,
    updateGain,
    startPTT,
    stopPTT,
    measurePing,
    sendChatText,
    playLogEntry,
    ensureAudioReady,
    unlockAudioOutput,
    enrollUserByBarcode,
    removeEnrolledUser,
  };
}
