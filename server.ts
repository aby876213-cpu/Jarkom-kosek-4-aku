import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ClientRecord {
  id: string;
  name: string;
  ip: string;
  channel: number;
  talking: boolean;
  override: boolean;
}

type UnitRole = 'OPERATOR' | 'COMMAND' | 'RECON' | 'MEDIC';

interface EnrolledUserRecord {
  id: string;
  token: string;
  callsign: string;
  channel: number;
  role: UnitRole;
  addedBy: string;
  addedAt: string;
  method: 'barcode-scan' | 'qr-invite' | 'manual';
}

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: '*' },
    maxHttpBufferSize: 5e6,
  });

  const activeClients = new Map<string, ClientRecord>();
  const enrolledUsers = new Map<string, EnrolledUserRecord>();

  function getEnrolledUsersWithStatus() {
    const activeNames = new Set(
      Array.from(activeClients.values()).map((client) => client.name.toUpperCase())
    );
    return Array.from(enrolledUsers.values()).map((user) => ({
      ...user,
      online: activeNames.has(user.callsign.toUpperCase()),
    }));
  }

  function broadcastEnrolledUsers() {
    io.emit('enrolled-users', getEnrolledUsersWithStatus());
  }

  function broadcastChannelPeers(channel: number) {
    const room = `CH-${channel}`;
    const peers: ClientRecord[] = [];
    for (const client of activeClients.values()) {
      if (client.channel === channel) {
        peers.push(client);
      }
    }
    io.to(room).emit('channel-peers', peers);
  }

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      activeUnits: activeClients.size,
      enrolledUsers: enrolledUsers.size,
    });
  });

  io.on('connection', (socket) => {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    const rawIp = Array.isArray(forwarded)
      ? forwarded[0]
      : forwarded || socket.handshake.address || '127.0.0.1';
    const cleanIp = rawIp.replace('::ffff:', '').split(',')[0].trim();

    socket.emit('your-info', { id: socket.id, ip: cleanIp });
    socket.emit('enrolled-users', getEnrolledUsersWithStatus());

    socket.on('join-channel', ({ channel, callsign }: { channel: number; callsign: string }) => {
      const prev = activeClients.get(socket.id);
      if (prev) {
        socket.leave(`CH-${prev.channel}`);
      }

      const chNum = Math.min(12, Math.max(1, Number(channel) || 12));
      socket.join(`CH-${chNum}`);

      const cleanName = (callsign || `KOSEK-${socket.id.slice(0, 4).toUpperCase()}`)
        .trim()
        .slice(0, 16);

      activeClients.set(socket.id, {
        id: socket.id,
        name: cleanName,
        ip: cleanIp,
        channel: chNum,
        talking: false,
        override: false,
      });

      if (prev && prev.channel !== chNum) {
        broadcastChannelPeers(prev.channel);
      }
      broadcastChannelPeers(chNum);
      broadcastEnrolledUsers();
    });

    socket.on('rtc-offer', ({ targetId, sdp }) => {
      io.to(targetId).emit('rtc-offer', { senderId: socket.id, sdp });
    });

    socket.on('rtc-answer', ({ targetId, sdp }) => {
      io.to(targetId).emit('rtc-answer', { senderId: socket.id, sdp });
    });

    socket.on('rtc-ice', ({ targetId, candidate }) => {
      io.to(targetId).emit('rtc-ice', { senderId: socket.id, candidate });
    });

    socket.on(
      'ptt-status',
      ({
        talking,
        channel,
        talkAll,
        override,
        duration,
        mode,
        audioClipBase64,
        audioMimeType,
      }: {
        talking: boolean;
        channel: number;
        talkAll?: boolean;
        override?: boolean;
        duration?: string;
        mode?: 'tx' | 'vox' | 'sos';
        audioClipBase64?: string | null;
        audioMimeType?: string | null;
      }) => {
        const client = activeClients.get(socket.id);
        if (!client) return;

        client.talking = talking;
        client.override = Boolean(override);

        const payload = {
          senderId: socket.id,
          callsign: client.name,
          talking,
          channel,
          talkAll: Boolean(talkAll),
          override: Boolean(override),
          duration,
          mode: mode || 'tx',
          audioClipBase64: audioClipBase64 || null,
          audioMimeType: audioMimeType || null,
        };

        if (talkAll || override) {
          socket.broadcast.emit('ptt-status', payload);
        } else {
          socket.to(`CH-${channel}`).emit('ptt-status', payload);
        }

        broadcastChannelPeers(client.channel);
      }
    );

    socket.on(
      'ptt-audio-chunk',
      (data: {
        channel: number;
        talkAll?: boolean;
        override?: boolean;
        sampleRate?: number;
        pcm: ArrayBuffer | Buffer;
      }) => {
        const client = activeClients.get(socket.id);
        if (!client || !data?.pcm) return;

        const payload = {
          senderId: socket.id,
          callsign: client.name,
          channel: data.channel,
          talkAll: Boolean(data.talkAll),
          override: Boolean(data.override),
          sampleRate: data.sampleRate || 16000,
          pcm: data.pcm,
        };

        if (data.talkAll || data.override) {
          socket.broadcast.emit('ptt-audio-chunk', payload);
        } else {
          socket.to(`CH-${data.channel}`).emit('ptt-audio-chunk', payload);
        }
      }
    );

    socket.on('encrypted-chat', ({ channel, sender, encryptedPayload, talkAll }) => {
      const targetPayload = {
        senderId: socket.id,
        sender,
        channel,
        encryptedPayload,
      };
      if (talkAll) {
        socket.broadcast.emit('encrypted-chat', targetPayload);
      } else {
        socket.to(`CH-${channel}`).emit('encrypted-chat', targetPayload);
      }
    });

    socket.on('emergency-alert', ({ channel, sender, active }) => {
      io.emit('emergency-alert', {
        senderId: socket.id,
        sender,
        channel,
        active,
      });
    });

    socket.on(
      'enroll-user-barcode',
      ({
        token,
        callsign,
        channel,
        role,
        addedBy,
        method,
      }: {
        token?: string;
        callsign: string;
        channel: number;
        role?: UnitRole;
        addedBy?: string;
        method?: 'barcode-scan' | 'qr-invite' | 'manual';
      }) => {
        const cleanCallsign = (callsign || '')
          .toUpperCase()
          .replace(/[^A-Z0-9-]/g, '')
          .slice(0, 14);
        if (!cleanCallsign) return;

        const chNum = Math.min(12, Math.max(1, Number(channel) || 12));
        const validRoles: UnitRole[] = ['OPERATOR', 'COMMAND', 'RECON', 'MEDIC'];
        const cleanRole: UnitRole = role && validRoles.includes(role) ? role : 'OPERATOR';
        const cleanToken =
          (token || '').trim().toUpperCase().slice(0, 40) ||
          `K4-${String(chNum).padStart(2, '0')}-${cleanCallsign.replace(/-/g, '').slice(0, 8)}`;

        // Idempotent upsert by normalized callsign so duplicate scans don't create duplicate rows
        const key = cleanCallsign;
        const existing = enrolledUsers.get(key);
        const record: EnrolledUserRecord = {
          id: existing?.id || `usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          token: cleanToken,
          callsign: cleanCallsign,
          channel: chNum,
          role: cleanRole,
          addedBy: (addedBy || 'OPERATOR').toUpperCase().slice(0, 14),
          addedAt: existing?.addedAt || new Date().toTimeString().slice(0, 8),
          method: method || 'barcode-scan',
        };

        enrolledUsers.set(key, record);
        socket.emit('user-enrolled-ack', record);
        broadcastEnrolledUsers();
      }
    );

    socket.on(
      'redeem-invite',
      ({
        token,
        callsign,
        channel,
        role,
        inviter,
      }: {
        token?: string;
        callsign: string;
        channel: number;
        role?: UnitRole;
        inviter?: string;
      }) => {
        const cleanCallsign = (callsign || '')
          .toUpperCase()
          .replace(/[^A-Z0-9-]/g, '')
          .slice(0, 14);
        if (!cleanCallsign) return;

        const chNum = Math.min(12, Math.max(1, Number(channel) || 12));
        const validRoles: UnitRole[] = ['OPERATOR', 'COMMAND', 'RECON', 'MEDIC'];
        const cleanRole: UnitRole = role && validRoles.includes(role) ? role : 'OPERATOR';
        const cleanToken =
          (token || '').trim().toUpperCase().slice(0, 40) ||
          `K4-${String(chNum).padStart(2, '0')}-${cleanCallsign.replace(/-/g, '').slice(0, 8)}`;

        const existing = enrolledUsers.get(cleanCallsign);
        if (!existing) {
          enrolledUsers.set(cleanCallsign, {
            id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            token: cleanToken,
            callsign: cleanCallsign,
            channel: chNum,
            role: cleanRole,
            addedBy: (inviter || 'QR-INVITE').toUpperCase().slice(0, 14),
            addedAt: new Date().toTimeString().slice(0, 8),
            method: 'qr-invite',
          });
        }

        broadcastEnrolledUsers();
        socket.broadcast.emit('invite-redeemed', {
          callsign: cleanCallsign,
          channel: chNum,
          role: cleanRole,
          inviter: inviter || 'BARCODE',
        });
      }
    );

    socket.on('remove-enrolled-user', ({ id, callsign }: { id?: string; callsign?: string }) => {
      if (callsign) {
        enrolledUsers.delete(callsign.toUpperCase());
      } else if (id) {
        for (const [k, v] of enrolledUsers.entries()) {
          if (v.id === id) {
            enrolledUsers.delete(k);
            break;
          }
        }
      }
      broadcastEnrolledUsers();
    });

    socket.on('ping-check', (sentAt: number) => {
      socket.emit('pong-check', sentAt);
    });

    socket.on('disconnect', () => {
      const client = activeClients.get(socket.id);
      if (client) {
        activeClients.delete(socket.id);
        broadcastChannelPeers(client.channel);
        broadcastEnrolledUsers();
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[TACTICAL COMMS KOSEK IV] Server active on http://0.0.0.0:${PORT}`);
  });
}

startServer();
