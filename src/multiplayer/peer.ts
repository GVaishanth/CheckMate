/**
 * Peer-to-peer multiplayer over a WebRTC data channel with manual signaling:
 * players exchange two short connection codes by any means they like.
 *
 * Architecture:
 *   - Host is authoritative: it owns the GameController, validates every
 *     guest move against the rules, and broadcasts accepted moves.
 *   - Guest sends move requests and mirrors the host's state.
 *   - No signaling server, no STUN/TURN: host candidates only, so this works
 *     between two browsers on the same machine or the same local network.
 */

export type PeerRole = 'host' | 'guest';

export type PeerState =
  | 'idle'
  | 'creating' // host: generating offer
  | 'offer-ready' // host: code ready to send
  | 'joining' // guest: processing host code
  | 'answer-ready' // guest: reply code ready
  | 'connecting' // host: processing guest answer
  | 'connected'
  | 'failed'
  | 'disconnected';

/** A connection code is base64(JSON({v, sdp})) — compact enough to paste anywhere. */
export function encodeConnectionCode(sdp: string, role: PeerRole, name: string): string {
  const payload = JSON.stringify({ v: 1, r: role === 'host' ? 'h' : 'g', n: name, s: sdp });
  const bytes = new TextEncoder().encode(payload);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeConnectionCode(code: string): { sdp: string; role: 'host' | 'guest'; name: string } {
  const trimmed = code.trim().replace(/\s+/g, '');
  const b64 = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new Error('That code is malformed — copy the whole thing and try again.');
  }
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  let json: string;
  try {
    json = new TextDecoder().decode(bytes);
  } catch {
    throw new Error('That code is malformed — copy the whole thing and try again.');
  }
  let parsed: { v?: number; r?: string; n?: string; s?: string };
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('That code is malformed — copy the whole thing and try again.');
  }
  if (!parsed.s || !parsed.r) throw new Error('That code is missing connection data.');
  return { sdp: parsed.s, role: parsed.r === 'h' ? 'host' : 'guest', name: parsed.n ?? 'Player' };
}

export interface PeerEvents {
  onState: (state: PeerState, detail?: string) => void;
  onMessage: (msg: Record<string, unknown>) => void;
}

/** Thin wrapper managing the RTCPeerConnection lifecycle. */
export class PeerConnection {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  readonly role: PeerRole;
  private events: PeerEvents;

  constructor(role: PeerRole, events: PeerEvents) {
    this.role = role;
    this.events = events;
  }

  /** Host: create the offer code players exchange first. */
  async createOffer(name: string): Promise<string> {
    this.teardown();
    this.pc = this.makePc();
    this.dc = this.pc.createDataChannel('checkmate', { ordered: true });
    this.wireChannel();
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.waitForIce(this.pc);
    this.events.onState('offer-ready');
    return encodeConnectionCode(this.pc.localDescription!.sdp, 'host', name);
  }

  /** Guest: consume the host's offer code, produce the answer code. */
  async acceptOffer(code: string, name: string): Promise<string> {
    this.teardown();
    const { sdp, role } = decodeConnectionCode(code);
    if (role !== 'host') throw new Error('That is a reply code — paste the host code instead.');
    this.pc = this.makePc();
    this.pc.ondatachannel = (e) => {
      this.dc = e.channel;
      this.wireChannel();
    };
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this.waitForIce(this.pc);
    this.events.onState('answer-ready');
    return encodeConnectionCode(this.pc.localDescription!.sdp, 'guest', name);
  }

  /** Host: consume the guest's answer code → connection opens. */
  async acceptAnswer(code: string): Promise<void> {
    if (!this.pc) throw new Error('Create a room first.');
    const { sdp, role } = decodeConnectionCode(code);
    if (role !== 'guest') throw new Error('That is a host code — paste the reply code instead.');
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
    this.events.onState('connecting');
  }

  private makePc(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: [] }); // fully serverless: host candidates only
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') this.events.onState('connected');
      else if (st === 'failed') this.events.onState('failed', 'The direct connection failed. Both browsers must be on the same machine or local network.');
      else if (st === 'disconnected' || st === 'closed') this.events.onState('disconnected', 'The connection was interrupted.');
    };
    return pc;
  }

  private wireChannel(): void {
    const dc = this.dc;
    if (!dc) return;
    dc.onopen = () => this.events.onState('connected');
    dc.onclose = () => this.events.onState('disconnected', 'The peer closed the channel.');
    dc.onmessage = (e) => {
      try {
        const msg = JSON.parse(String(e.data)) as Record<string, unknown>;
        this.events.onMessage(msg);
      } catch {
        /* ignore malformed frames */
      }
    };
  }

  private waitForIce(pc: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      const done = () => {
        pc.removeEventListener('icegatheringstatechange', check);
        window.clearTimeout(timer);
        resolve();
      };
      const check = () => {
        if (pc.iceGatheringState === 'complete') done();
      };
      const timer = window.setTimeout(done, timeoutMs);
      pc.addEventListener('icegatheringstatechange', check);
    });
  }

  send(msg: Record<string, unknown>): boolean {
    if (this.dc?.readyState !== 'open') return false;
    try {
      this.dc!.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  get isOpen(): boolean {
    return this.dc?.readyState === 'open';
  }

  teardown(): void {
    try {
      this.dc?.close();
    } catch { /* ignore */ }
    try {
      this.pc?.close();
    } catch { /* ignore */ }
    this.dc = null;
    this.pc = null;
  }
}
