/** Direct WebRTC data channel; manual signalling, host candidates only. */
import { MAX_PEER_FRAME, PEER_VERSION, PeerMessage, cleanPeerName, encodePeerMessage, parsePeerMessage, validPeerName } from './protocol';

export type PeerRole = 'host' | 'guest';
export type PeerState = 'idle' | 'creating' | 'offer-ready' | 'joining' | 'answer-ready' | 'connecting' | 'connected' | 'failed' | 'disconnected';

export function encodeConnectionCode(sdp: string, role: PeerRole, name: string): string {
  if (typeof sdp !== 'string' || !sdp.startsWith('v=0') || sdp.length > 48_000) throw new Error('Invalid connection description.');
  const bytes = new TextEncoder().encode(JSON.stringify({ v: PEER_VERSION, r: role === 'host' ? 'h' : 'g', n: cleanPeerName(name, 'Player'), s: sdp }));
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  const code = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (code.length > MAX_PEER_FRAME) throw new Error('Connection description is too large.');
  return code;
}

export function decodeConnectionCode(code: string): { sdp: string; role: PeerRole; name: string } {
  const malformed = () => new Error('That code is malformed — copy the whole code and try again.');
  if (typeof code !== 'string' || code.length > MAX_PEER_FRAME) throw malformed();
  const trimmed = code.trim().replace(/\s+/g, '');
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(trimmed)) throw malformed();
  let parsed: unknown;
  try {
    const bytes = Uint8Array.from(atob(trimmed.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { throw malformed(); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw malformed();
  const value = parsed as Record<string, unknown>;
  if (value.v !== PEER_VERSION) throw new Error('This code uses a different version. Refresh both copies of CHECKMATE and create a new room.');
  if ((value.r !== 'h' && value.r !== 'g') || !validPeerName(value.n) || typeof value.s !== 'string' || !value.s.startsWith('v=0') || value.s.length > 48_000) throw malformed();
  return { sdp: value.s, role: value.r === 'h' ? 'host' : 'guest', name: value.n };
}

export interface PeerEvents {
  onState: (state: PeerState, detail?: string) => void;
  onMessage: (message: PeerMessage) => void;
}

export class PeerConnection {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private cancelIce: (() => void) | null = null;
  constructor(readonly role: PeerRole, private events: PeerEvents) {}

  async createOffer(name: string): Promise<string> {
    if (this.role !== 'host') throw new Error('Only the host creates a room.');
    this.teardown(); this.events.onState('creating');
    const pc = this.makePc(); this.pc = pc;
    this.dc = pc.createDataChannel('checkmate', { ordered: true }); this.wireChannel();
    await pc.setLocalDescription(await pc.createOffer());
    await this.waitForIce(pc);
    if (this.pc !== pc) throw new DOMException('Connection cancelled', 'AbortError');
    this.events.onState('offer-ready');
    return encodeConnectionCode(pc.localDescription!.sdp, 'host', name);
  }

  async acceptOffer(code: string, name: string): Promise<string> {
    if (this.role !== 'guest') throw new Error('Only the guest answers a room code.');
    const decoded = decodeConnectionCode(code);
    if (decoded.role !== 'host') throw new Error('That is a reply code — paste the host code instead.');
    this.teardown(); this.events.onState('joining');
    const pc = this.makePc(); this.pc = pc;
    pc.ondatachannel = (event) => {
      if (this.pc !== pc || this.dc) { event.channel.close(); return; }
      this.dc = event.channel; this.wireChannel();
    };
    await pc.setRemoteDescription({ type: 'offer', sdp: decoded.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await this.waitForIce(pc);
    if (this.pc !== pc) throw new DOMException('Connection cancelled', 'AbortError');
    this.events.onState('answer-ready');
    return encodeConnectionCode(pc.localDescription!.sdp, 'guest', name);
  }

  async acceptAnswer(code: string): Promise<void> {
    if (this.role !== 'host' || !this.pc) throw new Error('Create a room first.');
    const decoded = decodeConnectionCode(code);
    if (decoded.role !== 'guest') throw new Error('That is a host code — paste the reply code instead.');
    const pc = this.pc; this.events.onState('connecting');
    await pc.setRemoteDescription({ type: 'answer', sdp: decoded.sdp });
    if (this.pc !== pc) throw new DOMException('Connection cancelled', 'AbortError');
  }

  private makePc(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      if (pc.connectionState === 'connected') this.events.onState('connected');
      else if (pc.connectionState === 'failed') this.events.onState('failed', 'The direct connection failed. Try the same machine or local network.');
      else if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') this.events.onState('disconnected', 'The connection was interrupted.');
    };
    return pc;
  }

  private wireChannel(): void {
    const dc = this.dc;
    if (!dc) return;
    dc.onopen = () => { if (this.dc === dc) this.events.onState('connected'); };
    dc.onclose = () => { if (this.dc === dc) this.events.onState('disconnected', 'The peer closed the channel.'); };
    dc.onerror = () => { if (this.dc === dc) this.events.onState('failed', 'The data channel failed.'); };
    let windowStart = 0, frames = 0;
    dc.onmessage = (event) => {
      const now = performance.now();
      if (now - windowStart >= 1000) { windowStart = now; frames = 0; }
      if (++frames > 64) return;
      if (this.dc !== dc || typeof event.data !== 'string' || event.data.length > MAX_PEER_FRAME) return;
      try {
        const message = parsePeerMessage(JSON.parse(event.data));
        if (message) this.events.onMessage(message);
      } catch { /* malformed frame */ }
    };
  }

  private waitForIce(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); this.cancelIce = null; };
      const done = () => { cleanup(); resolve(); };
      const check = () => { if (pc.iceGatheringState === 'complete') done(); };
      const timer = setTimeout(done, 2500);
      this.cancelIce = () => { cleanup(); reject(new DOMException('Connection cancelled', 'AbortError')); };
      pc.addEventListener('icegatheringstatechange', check);
    });
  }

  send(message: PeerMessage): boolean {
    if (!this.isOpen || this.dc!.bufferedAmount > MAX_PEER_FRAME * 4) return false;
    try {
      const text = encodePeerMessage(message);
      const size = new TextEncoder().encode(text).byteLength;
      if (size > Math.min(MAX_PEER_FRAME, this.pc?.sctp?.maxMessageSize || MAX_PEER_FRAME)) return false;
      this.dc!.send(text); return true;
    } catch { return false; }
  }

  get isOpen(): boolean { return this.dc?.readyState === 'open'; }

  teardown(): void {
    this.cancelIce?.();
    const dc = this.dc, pc = this.pc;
    this.dc = null; this.pc = null;
    if (dc) { dc.onopen = dc.onclose = dc.onmessage = dc.onerror = null; try { dc.close(); } catch { /* already closed */ } }
    if (pc) { pc.onconnectionstatechange = pc.ondatachannel = null; try { pc.close(); } catch { /* already closed */ } }
  }
}
