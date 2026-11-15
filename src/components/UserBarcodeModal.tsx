import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import {
  Camera,
  CameraOff,
  Check,
  Copy,
  Download,
  QrCode,
  RefreshCw,
  ScanLine,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import { EnrolledUser, UnitRole } from '../types/comms';
import {
  buildJoinUrl,
  decodeBarcodeFromCanvas,
  exportBarcodePassPng,
  generateInviteToken,
  parseBarcodeInput,
  sanitizeCallsign,
} from '../utils/barcode';

interface UserBarcodeModalProps {
  isOpen: boolean;
  currentChannel: number;
  currentCallsign: string;
  enrolledUsers: EnrolledUser[];
  onClose: () => void;
  onEnrollUser: (payload: {
    token?: string;
    callsign: string;
    channel: number;
    role: UnitRole;
    method: 'barcode-scan' | 'qr-invite' | 'manual';
  }) => void;
  onSwitchChannel: (ch: number) => void;
}

type ModalTab = 'generate' | 'scan';

const ROLE_OPTIONS: UnitRole[] = ['OPERATOR', 'COMMAND', 'RECON', 'MEDIC'];

export const UserBarcodeModal: React.FC<UserBarcodeModalProps> = ({
  isOpen,
  currentChannel,
  currentCallsign,
  enrolledUsers,
  onClose,
  onEnrollUser,
  onSwitchChannel,
}) => {
  const [activeTab, setActiveTab] = useState<ModalTab>('generate');

  // Generate Barcode State
  const [targetCallsign, setTargetCallsign] = useState<string>(
    () => `UNIT-${Math.floor(10 + Math.random() * 89)}`
  );
  const [targetChannel, setTargetChannel] = useState<number>(currentChannel);
  const [targetRole, setTargetRole] = useState<UnitRole>('OPERATOR');
  const [tokenSeed, setTokenSeed] = useState<string>(() =>
    generateInviteToken(currentChannel, 'UNIT')
  );
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [registeredBanner, setRegisteredBanner] = useState<string | null>(null);

  // Scan Barcode State
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState<string>('');
  const [scanFeedback, setScanFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
    callsign?: string;
    channel?: number;
    role?: UnitRole;
  } | null>(null);

  const barcodeSvgRef = useRef<SVGSVGElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const scanRafRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const cleanTargetCallsign = useMemo(
    () => sanitizeCallsign(targetCallsign) || 'UNIT-BARU',
    [targetCallsign]
  );

  const activeToken = useMemo(() => {
    const parts = tokenSeed.split('-');
    const suffix = parts[parts.length - 1] || 'K4X9';
    const ch = String(targetChannel).padStart(2, '0');
    const cs = cleanTargetCallsign.replace(/-/g, '').slice(0, 8) || 'UNIT';
    return `K4-${ch}-${cs}-${suffix}`;
  }, [cleanTargetCallsign, targetChannel, tokenSeed]);

  const joinUrl = useMemo(
    () =>
      buildJoinUrl({
        token: activeToken,
        callsign: cleanTargetCallsign,
        channel: targetChannel,
        role: targetRole,
        inviter: currentCallsign || 'KOSEK',
      }),
    [activeToken, cleanTargetCallsign, targetChannel, targetRole, currentCallsign]
  );

  // Sync default channel when modal opens
  useEffect(() => {
    if (isOpen) {
      setTargetChannel(currentChannel);
      setRegisteredBanner(null);
      setScanFeedback(null);
      setCameraError(null);
    }
  }, [isOpen, currentChannel]);

  // Render QR Code Data URL
  useEffect(() => {
    if (!isOpen || activeTab !== 'generate') return;
    let cancelled = false;

    QRCode.toDataURL(joinUrl, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#040812', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, activeTab, joinUrl]);

  // Render 1D Code-128 Barcode
  useEffect(() => {
    if (!isOpen || activeTab !== 'generate' || !barcodeSvgRef.current) return;
    try {
      JsBarcode(barcodeSvgRef.current, activeToken, {
        format: 'CODE128',
        lineColor: '#040812',
        background: '#ffffff',
        width: 1.55,
        height: 58,
        displayValue: true,
        font: 'monospace',
        fontSize: 11,
        margin: 6,
      });
    } catch {
      // Ignore transient invalid characters while typing
    }
  }, [isOpen, activeTab, activeToken]);

  const stopCamera = useCallback(() => {
    if (scanRafRef.current) {
      cancelAnimationFrame(scanRafRef.current);
      scanRafRef.current = 0;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  // Stop camera on close, tab switch, or Escape key
  useEffect(() => {
    if (!isOpen || activeTab !== 'scan') {
      stopCamera();
    }
  }, [isOpen, activeTab, stopCamera]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopCamera();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, stopCamera]);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  const processDecodedString = useCallback(
    (rawValue: string, method: 'barcode-scan' | 'manual') => {
      const parsed = parseBarcodeInput(rawValue, currentChannel);
      if (!parsed.isValid) {
        setScanFeedback({
          type: 'error',
          message: parsed.error || 'Barcode tidak valid.',
        });
        return false;
      }

      onEnrollUser({
        token: parsed.token,
        callsign: parsed.callsign,
        channel: parsed.channel,
        role: parsed.role,
        method,
      });

      setScanFeedback({
        type: 'success',
        message: `User ${parsed.callsign} berhasil ditambahkan ke CH ${String(parsed.channel).padStart(2, '0')}.`,
        callsign: parsed.callsign,
        channel: parsed.channel,
        role: parsed.role,
      });
      return true;
    },
    [currentChannel, onEnrollUser]
  );

  const startCamera = useCallback(async () => {
    setCameraError(null);
    setScanFeedback(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Browser tidak mendukung akses kamera. Gunakan upload gambar atau input kode.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setCameraActive(true);

      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });

      const scanFrame = async () => {
        const video = videoRef.current;
        const canvas = scanCanvasRef.current;
        if (!cameraStreamRef.current) return;

        if (video && canvas && video.readyState >= 2 && video.videoWidth > 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const decoded = await decodeBarcodeFromCanvas(canvas, ctx);
            if (decoded) {
              const ok = processDecodedString(decoded, 'barcode-scan');
              if (ok) {
                stopCamera();
                return;
              }
            }
          }
        }
        scanRafRef.current = requestAnimationFrame(scanFrame);
      };

      scanRafRef.current = requestAnimationFrame(scanFrame);
    } catch {
      setCameraError(
        'Izin kamera ditolak atau kamera tidak ditemukan. Gunakan upload gambar atau input manual.'
      );
      stopCamera();
    }
  }, [processDecodedString, stopCamera]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setScanFeedback(null);
    const imgUrl = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Gagal memuat gambar'));
        img.src = imgUrl;
      });

      const canvas = scanCanvasRef.current || document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const decoded = await decodeBarcodeFromCanvas(canvas, ctx);
      if (decoded) {
        processDecodedString(decoded, 'barcode-scan');
      } else {
        setScanFeedback({
          type: 'error',
          message: 'Tidak ada QR atau barcode yang terbaca dari gambar tersebut.',
        });
      }
    } catch {
      setScanFeedback({
        type: 'error',
        message: 'File gambar tidak dapat dibaca.',
      });
    } finally {
      URL.revokeObjectURL(imgUrl);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (processDecodedString(manualInput, 'manual')) {
      setManualInput('');
    }
  };

  const handleRegisterGenerated = () => {
    onEnrollUser({
      token: activeToken,
      callsign: cleanTargetCallsign,
      channel: targetChannel,
      role: targetRole,
      method: 'qr-invite',
    });
    setRegisteredBanner(
      `User ${cleanTargetCallsign} didaftarkan di CH ${String(targetChannel).padStart(2, '0')}. Siap dipindai!`
    );
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      // Fallback ignored
    }
  };

  const handleDownloadPng = () => {
    exportBarcodePassPng({
      callsign: cleanTargetCallsign,
      channel: targetChannel,
      role: targetRole,
      token: activeToken,
      joinUrl,
    });
  };

  const handleUseMyUnit = () => {
    setTargetCallsign(currentCallsign || 'KOSEK-01');
    setTargetChannel(currentChannel);
    setTokenSeed(generateInviteToken(currentChannel, currentCallsign || 'KOSEK'));
    setRegisteredBanner(null);
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="barcode-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#02060e]/85 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          stopCamera();
          onClose();
        }
      }}
    >
      <div className="tactical-shell w-full max-w-xl max-h-[92vh] overflow-y-auto custom-scroll rounded-2xl border border-cyan-400/45 shadow-[0_0_50px_rgba(0,240,255,0.2)] flex flex-col">
        {/* Header */}
        <div className="bg-[#081122] border-b border-cyan-500/30 px-4 py-3 flex items-center justify-between gap-3 sticky top-0 z-10">
          <div className="flex items-center gap-2 min-w-0">
            <QrCode className="w-5 h-5 text-[#00f0ff] shrink-0" aria-hidden="true" />
            <h2
              id="barcode-modal-title"
              className="font-[var(--font-tech)] text-sm sm:text-base tracking-[0.1em] text-[#00f0ff] truncate"
            >
              TAMBAH USER · KODE BARCODE
            </h2>
          </div>

          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            aria-label="Tutup modal barcode"
            className="min-h-[40px] min-w-[40px] rounded-lg border border-cyan-500/30 bg-slate-900 text-cyan-200 hover:text-white hover:border-[#00f0ff] flex items-center justify-center transition"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="px-4 pt-3">
          <div
            role="tablist"
            aria-label="Mode Barcode User"
            className="grid grid-cols-2 gap-2 p-1 bg-slate-950/90 border border-cyan-500/25 rounded-xl"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'generate'}
              onClick={() => setActiveTab('generate')}
              className={`min-h-[42px] px-3 py-2 rounded-lg text-xs font-[var(--font-tech)] tracking-wider flex items-center justify-center gap-2 transition whitespace-nowrap ${
                activeTab === 'generate'
                  ? 'bg-[#00f0ff] text-[#040812] font-bold shadow-[0_0_14px_rgba(0,240,255,0.4)]'
                  : 'text-cyan-200 hover:bg-slate-900'
              }`}
            >
              <QrCode className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Buat Barcode</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'scan'}
              onClick={() => setActiveTab('scan')}
              className={`min-h-[42px] px-3 py-2 rounded-lg text-xs font-[var(--font-tech)] tracking-wider flex items-center justify-center gap-2 transition whitespace-nowrap ${
                activeTab === 'scan'
                  ? 'bg-[#00f0ff] text-[#040812] font-bold shadow-[0_0_14px_rgba(0,240,255,0.4)]'
                  : 'text-cyan-200 hover:bg-slate-900'
              }`}
            >
              <ScanLine className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Scan / Input Kode</span>
            </button>
          </div>
        </div>

        <div className="p-4 space-y-3.5">
          {activeTab === 'generate' ? (
            <>
              {/* Target User Config */}
              <div className="tactical-card rounded-xl p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-cyan-300/85 tracking-wider">
                    Konfigurasi User Baru
                  </span>
                  <button
                    type="button"
                    onClick={handleUseMyUnit}
                    className="text-[11px] font-[var(--font-tech)] text-[#00f0ff] hover:underline whitespace-nowrap"
                  >
                    Pakai Unit Saya ({currentCallsign})
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label
                      htmlFor="barcode-callsign"
                      className="block text-[10px] text-cyan-400/80 tracking-widest mb-1"
                    >
                      CALLSIGN USER
                    </label>
                    <div className="flex gap-1">
                      <input
                        id="barcode-callsign"
                        type="text"
                        maxLength={14}
                        value={targetCallsign}
                        onChange={(e) => {
                          setTargetCallsign(e.target.value.toUpperCase());
                          setRegisteredBanner(null);
                        }}
                        placeholder="ELANG-01"
                        className="w-full min-h-[40px] bg-slate-950 border border-cyan-500/35 rounded-lg px-2.5 text-xs font-[var(--font-tech)] text-cyan-100 focus:outline-none focus:border-[#00f0ff]"
                      />
                      <button
                        type="button"
                        title="Acak Callsign"
                        onClick={() => {
                          const next = `UNIT-${Math.floor(10 + Math.random() * 89)}`;
                          setTargetCallsign(next);
                          setTokenSeed(generateInviteToken(targetChannel, next));
                          setRegisteredBanner(null);
                        }}
                        className="min-h-[40px] px-2.5 rounded-lg bg-slate-900 border border-cyan-500/30 text-cyan-300 hover:text-white shrink-0"
                      >
                        <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="barcode-channel"
                      className="block text-[10px] text-cyan-400/80 tracking-widest mb-1"
                    >
                      CHANNEL
                    </label>
                    <select
                      id="barcode-channel"
                      value={targetChannel}
                      onChange={(e) => {
                        setTargetChannel(Number(e.target.value));
                        setRegisteredBanner(null);
                      }}
                      className="w-full min-h-[40px] bg-slate-950 border border-cyan-500/35 rounded-lg px-2.5 text-xs font-[var(--font-tech)] text-cyan-100 focus:outline-none focus:border-[#00f0ff]"
                    >
                      {Array.from({ length: 12 }, (_, idx) => idx + 1).map((ch) => (
                        <option key={ch} value={ch}>
                          CH {String(ch).padStart(2, '0')}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="barcode-role"
                      className="block text-[10px] text-cyan-400/80 tracking-widest mb-1"
                    >
                      PERAN UNIT
                    </label>
                    <select
                      id="barcode-role"
                      value={targetRole}
                      onChange={(e) => {
                        setTargetRole(e.target.value as UnitRole);
                        setRegisteredBanner(null);
                      }}
                      className="w-full min-h-[40px] bg-slate-950 border border-cyan-500/35 rounded-lg px-2.5 text-xs font-[var(--font-tech)] text-cyan-100 focus:outline-none focus:border-[#00f0ff]"
                    >
                      {ROLE_OPTIONS.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Dual Barcode Render Card (QR + 1D Code-128) */}
              <div className="tactical-card rounded-xl p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="font-[var(--font-tech)] text-[#00ff88] tracking-wider">
                    QR + BARCODE CODE-128 SIAP PINDAI
                  </span>
                  <span className="text-cyan-300/85 tabular-nums">
                    {cleanTargetCallsign} · CH {String(targetChannel).padStart(2, '0')} · {targetRole}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                  {/* 2D QR Code */}
                  <div className="bg-white rounded-xl p-3 flex flex-col items-center justify-center shadow-inner">
                    {qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt={`QR Code untuk menambah ${cleanTargetCallsign}`}
                        className="w-40 h-40 object-contain"
                      />
                    ) : (
                      <div className="w-40 h-40 flex items-center justify-center text-slate-600 text-xs">
                        Membuat QR...
                      </div>
                    )}
                    <span className="mt-1 text-[10px] font-mono font-bold text-slate-800 tracking-wider">
                      SCAN KAMERA HP / APP
                    </span>
                  </div>

                  {/* 1D Code-128 Barcode + Metadata */}
                  <div className="space-y-2.5">
                    <div className="bg-white rounded-xl p-2.5 flex flex-col items-center justify-center overflow-hidden">
                      <svg
                        ref={barcodeSvgRef}
                        aria-label={`Barcode Code 128 ${activeToken}`}
                        className="w-full max-w-[230px] h-auto"
                      />
                    </div>

                    <div className="bg-slate-950/85 border border-cyan-500/20 rounded-lg p-2.5 text-[11px] space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-cyan-400/75">Token Unit</span>
                        <span className="font-[var(--font-tech)] text-[#00f0ff] tabular-nums truncate">
                          {activeToken}
                        </span>
                      </div>
                      <p className="text-[10px] text-cyan-300/75 leading-relaxed">
                        Pindai QR dengan kamera HP untuk langsung gabung ke CH{' '}
                        {String(targetChannel).padStart(2, '0')}, atau scan barcode di tab{' '}
                        <strong>Scan / Input Kode</strong>.
                      </p>
                    </div>
                  </div>
                </div>

                {registeredBanner && (
                  <div className="bg-emerald-950/60 border border-emerald-400/50 rounded-lg px-3 py-2 text-xs text-[#00ff88] flex items-center gap-2">
                    <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{registeredBanner}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleRegisterGenerated}
                    className="min-h-[44px] px-3 py-2 rounded-lg bg-[#00f0ff] text-[#040812] font-[var(--font-tech)] text-xs font-bold hover:bg-cyan-300 active:scale-95 transition flex items-center justify-center gap-1.5 whitespace-nowrap"
                  >
                    <UserPlus className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Daftarkan User</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="min-h-[44px] px-3 py-2 rounded-lg bg-slate-900 border border-cyan-500/40 text-cyan-100 hover:border-[#00f0ff] font-[var(--font-tech)] text-xs active:scale-95 transition flex items-center justify-center gap-1.5 whitespace-nowrap"
                  >
                    {copiedLink ? (
                      <>
                        <Check className="w-4 h-4 text-[#00ff88] shrink-0" aria-hidden="true" />
                        <span className="text-[#00ff88]">Link Tersalin</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>Salin Link</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadPng}
                    className="min-h-[44px] px-3 py-2 rounded-lg bg-slate-900 border border-cyan-500/40 text-cyan-100 hover:border-[#00f0ff] font-[var(--font-tech)] text-xs active:scale-95 transition flex items-center justify-center gap-1.5 whitespace-nowrap"
                  >
                    <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Unduh PNG</span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Camera + Image Scanner */}
              <div className="tactical-card rounded-xl p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-cyan-300/85 tracking-wider">
                    Pindai QR / Barcode Unit
                  </span>

                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="min-h-[40px] px-3 py-1.5 rounded-lg bg-slate-900 border border-cyan-500/35 text-cyan-100 hover:border-[#00f0ff] text-xs font-[var(--font-tech)] flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Upload className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>Upload Gambar</span>
                    </button>

                    <button
                      type="button"
                      onClick={cameraActive ? stopCamera : startCamera}
                      className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-[var(--font-tech)] border flex items-center gap-1.5 whitespace-nowrap transition ${
                        cameraActive
                          ? 'bg-rose-950/70 border-rose-500/70 text-rose-200 hover:bg-rose-900/80'
                          : 'bg-cyan-500/20 border-[#00f0ff]/70 text-[#00f0ff] hover:bg-cyan-500/30'
                      }`}
                    >
                      {cameraActive ? (
                        <>
                          <CameraOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>Stop Kamera</span>
                        </>
                      ) : (
                        <>
                          <Camera className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>Aktifkan Kamera</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Camera Preview Frame */}
                <div className="relative w-full h-52 rounded-xl overflow-hidden bg-slate-950 border border-cyan-500/30 flex items-center justify-center">
                  {cameraActive ? (
                    <>
                      <video
                        ref={videoRef}
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                      />
                      {/* Tactical Corner Reticle */}
                      <div className="pointer-events-none absolute inset-6 border border-cyan-400/35 rounded-lg">
                        <span className="absolute -top-0.5 -left-0.5 w-5 h-5 border-t-2 border-l-2 border-[#00f0ff]" />
                        <span className="absolute -top-0.5 -right-0.5 w-5 h-5 border-t-2 border-r-2 border-[#00f0ff]" />
                        <span className="absolute -bottom-0.5 -left-0.5 w-5 h-5 border-b-2 border-l-2 border-[#00f0ff]" />
                        <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 border-b-2 border-r-2 border-[#00f0ff]" />
                      </div>
                      <span className="absolute bottom-2 px-2.5 py-0.5 rounded bg-slate-950/80 text-[10px] font-[var(--font-tech)] text-[#00f0ff]">
                        ARAHKAN KE QR ATAU BARCODE
                      </span>
                    </>
                  ) : (
                    <div className="text-center px-4 space-y-1.5">
                      <ScanLine className="w-9 h-9 text-cyan-400/60 mx-auto" aria-hidden="true" />
                      <p className="text-xs text-cyan-200">
                        Kamera belum aktif. Klik <strong>Aktifkan Kamera</strong> atau{' '}
                        <strong>Upload Gambar</strong> barcode.
                      </p>
                      <p className="text-[10px] text-cyan-400/70">
                        Mendukung QR Code dan Barcode Code-128.
                      </p>
                    </div>
                  )}
                </div>

                <canvas ref={scanCanvasRef} className="hidden" />

                {cameraError && (
                  <div className="bg-amber-950/50 border border-amber-500/45 rounded-lg px-3 py-2 text-xs text-amber-200">
                    {cameraError}
                  </div>
                )}
              </div>

              {/* Manual Barcode / Link Entry */}
              <form onSubmit={handleManualSubmit} className="tactical-card rounded-xl p-3.5 space-y-2">
                <label
                  htmlFor="manual-barcode-input"
                  className="block text-xs text-cyan-300/85 tracking-wider"
                >
                  Atau Masukkan Kode Barcode / Link Undangan
                </label>
                <div className="flex gap-2">
                  <input
                    id="manual-barcode-input"
                    type="text"
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    placeholder="Contoh: K4-12-ELANG01-7F3A atau URL QR"
                    className="flex-1 min-h-[44px] bg-slate-950 border border-cyan-500/35 rounded-lg px-3 text-xs text-cyan-100 placeholder-cyan-700 focus:outline-none focus:border-[#00f0ff]"
                  />
                  <button
                    type="submit"
                    className="min-h-[44px] px-4 rounded-lg bg-[#00f0ff] text-[#040812] font-[var(--font-tech)] text-xs font-bold hover:bg-cyan-300 active:scale-95 transition whitespace-nowrap"
                  >
                    Tambah User
                  </button>
                </div>
              </form>

              {scanFeedback && (
                <div
                  className={`rounded-xl px-3.5 py-2.5 border text-xs flex flex-wrap items-center justify-between gap-2 ${
                    scanFeedback.type === 'success'
                      ? 'bg-emerald-950/55 border-emerald-400/55 text-[#00ff88]'
                      : 'bg-rose-950/55 border-rose-500/55 text-rose-200'
                  }`}
                >
                  <span>{scanFeedback.message}</span>
                  {scanFeedback.type === 'success' &&
                    scanFeedback.channel &&
                    scanFeedback.channel !== currentChannel && (
                      <button
                        type="button"
                        onClick={() => {
                          onSwitchChannel(scanFeedback.channel!);
                          onClose();
                        }}
                        className="px-2.5 py-1 rounded bg-emerald-500/20 border border-emerald-400/60 text-white font-[var(--font-tech)] text-[11px] whitespace-nowrap"
                      >
                        Pindah ke CH {String(scanFeedback.channel).padStart(2, '0')}
                      </button>
                    )}
                </div>
              )}
            </>
          )}

          {/* Footer Roster Summary */}
          <div className="flex items-center justify-between text-[11px] text-cyan-400/80 px-1 pt-1 border-t border-cyan-500/15">
            <span>Total User Terdaftar via Barcode</span>
            <span className="font-[var(--font-tech)] text-[#00f0ff] tabular-nums">
              {enrolledUsers.length} UNIT
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
