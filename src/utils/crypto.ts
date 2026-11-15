import { EncryptedPayload } from '../types/comms';

export async function deriveChannelKey(channelNumber: number): Promise<CryptoKey | null> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) return null;
  const secret = `KOSEK-IV-CH-${channelNumber}-E2EE-AES-GCM-2026`;
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return window.crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptAES(
  key: CryptoKey | null,
  dataObj: { text: string; ts: number }
): Promise<EncryptedPayload> {
  if (!key || typeof window === 'undefined' || !window.crypto?.subtle) {
    return { plain: dataObj };
  }
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(dataObj));
  const cipherBuffer = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  return {
    iv: btoa(String.fromCharCode(...iv)),
    cipher: btoa(String.fromCharCode(...new Uint8Array(cipherBuffer))),
  };
}

export async function decryptAES(
  key: CryptoKey | null,
  payload: EncryptedPayload
): Promise<{ text: string; ts: number } | null> {
  if (payload?.plain) return payload.plain;
  if (!key || !payload?.iv || !payload?.cipher || !window.crypto?.subtle) return null;

  try {
    const iv = Uint8Array.from(atob(payload.iv), (c) => c.charCodeAt(0));
    const cipher = Uint8Array.from(atob(payload.cipher), (c) => c.charCodeAt(0));
    const plainBuffer = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return JSON.parse(new TextDecoder().decode(plainBuffer));
  } catch {
    return null;
  }
}
