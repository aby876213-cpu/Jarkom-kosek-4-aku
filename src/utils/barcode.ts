import jsQR from 'jsqr';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { UnitRole } from '../types/comms';

export interface ParsedBarcodeResult {
  isValid: boolean;
  token: string;
  callsign: string;
  channel: number;
  role: UnitRole;
  inviter: string;
  error?: string;
}

const VALID_ROLES: UnitRole[] = ['OPERATOR', 'COMMAND', 'RECON', 'MEDIC'];

export function sanitizeCallsign(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 14);
}

export function normalizeRole(raw?: string | null): UnitRole {
  const upper = (raw || '').toUpperCase().trim() as UnitRole;
  return VALID_ROLES.includes(upper) ? upper : 'OPERATOR';
}

export function clampChannel(raw: unknown, fallback = 12): number {
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(12, Math.max(1, Math.round(num)));
}

export function generateInviteToken(channel: number, callsign: string): string {
  const ch = String(clampChannel(channel)).padStart(2, '0');
  const clean = sanitizeCallsign(callsign).replace(/-/g, '').slice(0, 8) || 'UNIT';
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `K4-${ch}-${clean}-${rand}`;
}

export function buildJoinUrl(params: {
  token: string;
  callsign: string;
  channel: number;
  role: UnitRole;
  inviter: string;
}): string {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const url = new URL(origin);
  url.searchParams.set('invite', params.token);
  url.searchParams.set('ch', String(clampChannel(params.channel)));
  url.searchParams.set('callsign', sanitizeCallsign(params.callsign) || 'UNIT');
  url.searchParams.set('role', normalizeRole(params.role));
  if (params.inviter) {
    url.searchParams.set('by', sanitizeCallsign(params.inviter));
  }
  return url.toString();
}

export function parseBarcodeInput(rawInput: string, defaultChannel = 12): ParsedBarcodeResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      isValid: false,
      token: '',
      callsign: '',
      channel: defaultChannel,
      role: 'OPERATOR',
      inviter: 'SCANNER',
      error: 'Kode barcode kosong.',
    };
  }

  // 1. URL format (?invite=...&ch=12&callsign=ALPHA-01&role=OPERATOR)
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.includes('invite=')) {
    try {
      const url = trimmed.startsWith('http')
        ? new URL(trimmed)
        : new URL(trimmed, 'http://localhost');
      const token = url.searchParams.get('invite') || '';
      const callsign = sanitizeCallsign(url.searchParams.get('callsign') || '');
      const channel = clampChannel(url.searchParams.get('ch'), defaultChannel);
      const role = normalizeRole(url.searchParams.get('role'));
      const inviter = sanitizeCallsign(url.searchParams.get('by') || '') || 'QR-LINK';

      if (callsign || token) {
        const finalCallsign = callsign || `UNIT-${token.slice(-4)}`;
        return {
          isValid: true,
          token: token || generateInviteToken(channel, finalCallsign),
          callsign: finalCallsign,
          channel,
          role,
          inviter,
        };
      }
    } catch {
      // Continue to other formats
    }
  }

  // 2. JSON payload
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const callsign = sanitizeCallsign(String(parsed.callsign || parsed.name || ''));
      const channel = clampChannel(parsed.channel ?? parsed.ch, defaultChannel);
      const role = normalizeRole(String(parsed.role || 'OPERATOR'));
      const token = String(parsed.token || parsed.invite || '').trim();
      const inviter = sanitizeCallsign(String(parsed.inviter || parsed.by || '')) || 'QR-JSON';

      if (callsign) {
        return {
          isValid: true,
          token: token || generateInviteToken(channel, callsign),
          callsign,
          channel,
          role,
          inviter,
        };
      }
    } catch {
      // Continue
    }
  }

  // 3. Compact 1D Code-128 tactical token: K4-12-ELANG01-7F3A or K4|12|ELANG01|OPERATOR
  const upper = trimmed.toUpperCase();
  const pipeParts = upper.split('|');
  if (pipeParts.length >= 3 && pipeParts[0].startsWith('K4')) {
    const channel = clampChannel(pipeParts[1].replace(/\D/g, ''), defaultChannel);
    const callsign = sanitizeCallsign(pipeParts[2]);
    const role = normalizeRole(pipeParts[3]);
    if (callsign) {
      return {
        isValid: true,
        token: generateInviteToken(channel, callsign),
        callsign,
        channel,
        role,
        inviter: 'BARCODE-1D',
      };
    }
  }

  const dashMatch = upper.match(/^K4-(?:CH)?(\d{1,2})-([A-Z0-9]+)-([A-Z0-9]{2,8})$/);
  if (dashMatch) {
    const channel = clampChannel(dashMatch[1], defaultChannel);
    const callsign = sanitizeCallsign(dashMatch[2]);
    return {
      isValid: true,
      token: upper,
      callsign,
      channel,
      role: 'OPERATOR',
      inviter: 'BARCODE-128',
    };
  }

  // 4. Direct alphanumeric token / callsign (minimum 2 chars)
  const fallbackCallsign = sanitizeCallsign(upper);
  if (fallbackCallsign.length >= 2) {
    return {
      isValid: true,
      token: generateInviteToken(defaultChannel, fallbackCallsign),
      callsign: fallbackCallsign,
      channel: defaultChannel,
      role: 'OPERATOR',
      inviter: 'MANUAL',
    };
  }

  return {
    isValid: false,
    token: '',
    callsign: '',
    channel: defaultChannel,
    role: 'OPERATOR',
    inviter: 'SCANNER',
    error: 'Format barcode tidak dikenali. Gunakan QR Link atau token K4-CH-CALLSIGN-XXXX.',
  };
}

interface NativeBarcodeDetection {
  rawValue?: string;
}

interface NativeBarcodeDetectorCtor {
  new (options?: { formats?: string[] }): {
    detect: (source: HTMLCanvasElement | HTMLVideoElement) => Promise<NativeBarcodeDetection[]>;
  };
}

export async function decodeBarcodeFromCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D
): Promise<string | null> {
  const { width, height } = canvas;
  if (width === 0 || height === 0) return null;

  const imageData = ctx.getImageData(0, 0, width, height);
  const qrResult = jsQR(imageData.data, width, height, {
    inversionAttempts: 'attemptBoth',
  });
  if (qrResult?.data) {
    return qrResult.data;
  }

  const win = window as unknown as { BarcodeDetector?: NativeBarcodeDetectorCtor };
  if (typeof win.BarcodeDetector === 'function') {
    try {
      const detector = new win.BarcodeDetector({
        formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'codabar'],
      });
      const results = await detector.detect(canvas);
      const firstValue = results.find((item) => item.rawValue)?.rawValue;
      if (firstValue) return firstValue;
    } catch {
      // Ignore unsupported format errors
    }
  }

  return null;
}

export async function exportBarcodePassPng(params: {
  callsign: string;
  channel: number;
  role: UnitRole;
  token: string;
  joinUrl: string;
}): Promise<void> {
  const width = 640;
  const height = 420;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Background
  ctx.fillStyle = '#040812';
  ctx.fillRect(0, 0, width, height);

  // Border
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 3;
  ctx.strokeRect(12, 12, width - 24, height - 24);

  // Header
  ctx.fillStyle = '#00f0ff';
  ctx.font = 'bold 20px monospace';
  ctx.fillText('TACTICAL COMMS KOSEK IV // AKSES BARCODE', 32, 48);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '13px monospace';
  ctx.fillText(`CALLSIGN: ${params.callsign}   |   CHANNEL: CH ${String(params.channel).padStart(2, '0')}   |   ROLE: ${params.role}`, 32, 74);

  // QR white box
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, params.joinUrl, {
    width: 210,
    margin: 2,
    color: { dark: '#040812', light: '#ffffff' },
  });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(32, 96, 224, 224);
  ctx.drawImage(qrCanvas, 39, 103);

  // 1D Barcode white box
  const barcodeCanvas = document.createElement('canvas');
  JsBarcode(barcodeCanvas, params.token, {
    format: 'CODE128',
    lineColor: '#040812',
    background: '#ffffff',
    width: 1.7,
    height: 76,
    displayValue: true,
    fontSize: 13,
    margin: 10,
  });

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(280, 148, 328, 120);
  const scale = Math.min(312 / barcodeCanvas.width, 106 / barcodeCanvas.height);
  const bw = barcodeCanvas.width * scale;
  const bh = barcodeCanvas.height * scale;
  ctx.drawImage(barcodeCanvas, 280 + (328 - bw) / 2, 148 + (120 - bh) / 2, bw, bh);

  ctx.fillStyle = '#cffafe';
  ctx.font = 'bold 14px monospace';
  ctx.fillText('SCAN QR ATAU BARCODE CODE-128', 280, 124);

  ctx.fillStyle = '#67e8f9';
  ctx.font = '12px monospace';
  ctx.fillText(`TOKEN: ${params.token}`, 32, 356);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px monospace';
  ctx.fillText('Gunakan menu Barcode di aplikasi atau kamera HP untuk bergabung.', 32, 382);

  const link = document.createElement('a');
  link.download = `KOSEK-IV-${params.callsign}-CH${String(params.channel).padStart(2, '0')}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
