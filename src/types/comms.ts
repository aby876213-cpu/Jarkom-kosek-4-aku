export interface PeerInfo {
  id: string;
  name: string;
  ip: string;
  channel: number;
  talking: boolean;
  override?: boolean;
}

export type CallLogType = 'tx' | 'vox' | 'rx' | 'sos';
export type LogFilter = 'all' | 'tx' | 'rx' | 'sos';

export interface CallLogEntry {
  id: string;
  time: string;
  type: CallLogType;
  sender: string;
  channel: number;
  duration: string;
  audioUrl: string | null;
}

export interface ChatMessage {
  id: string;
  time: string;
  sender: string;
  text: string;
  channel: number;
  isSos: boolean;
  encrypted: boolean;
}

export interface EncryptedPayload {
  iv?: string;
  cipher?: string;
  plain?: {
    text: string;
    ts: number;
  };
}

export type UnitRole = 'OPERATOR' | 'COMMAND' | 'RECON' | 'MEDIC';

export interface EnrolledUser {
  id: string;
  token: string;
  callsign: string;
  channel: number;
  role: UnitRole;
  addedBy: string;
  addedAt: string;
  method: 'barcode-scan' | 'qr-invite' | 'manual';
  online?: boolean;
}

export interface BarcodeInviteData {
  token: string;
  callsign: string;
  channel: number;
  role: UnitRole;
  inviter: string;
  joinUrl: string;
  createdAt: number;
}
