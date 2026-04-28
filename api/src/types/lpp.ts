/**
 * Lamish Pulse Protocol Types
 */

// Pulse epoch and state
export interface PulseEpoch {
  epoch_id: string;
  started_at: string;           // ISO 8601
  interval_ms: number;
  origin_domain: string;
}

export interface PulseEvent {
  epoch_id: string;
  index: number;                // Current prime index
  prime: string;                // Current prime value
  timestamp: string;            // ISO 8601
  fingerprint: number[];        // Current Δ² signature (4 ratios)
  d2: number;                   // Current second difference
  interval_ms: number;
}

// Relativistic frame (simplified for terrestrial)
export interface TerrestrialFrame {
  velocity: 0;
  potential: 0;
  gamma: 1;
  redshift_factor: 1;
  latency_ms: number;
}

// LPP Address
export interface LPPAddress {
  origin_index: number;
  fingerprint: number[];
  repeater_class: 'even' | 'odd';
  repeater_path: string[];
  timestamp_corrected: number;
}

// Repeater registration
export interface Repeater {
  id: string;
  domain: string;
  endpoint: string;
  class: 'even' | 'odd';
  location?: {
    label: string;
    coordinates?: [number, number];
  };
  upstream: string;             // Parent repeater or 'origin'
  registered_at: string;
  last_seen_at: string;
  status: 'active' | 'inactive';
}

// Node registration
export interface PostSocialNode {
  node_id: string;
  title: string;
  origin: 'gutenberg' | 'arxiv' | 'original';
  topics?: string[];
  source_url?: string;
  sync_state: {
    origin_index: number;
    fingerprint: number[];
    repeater: string;
    latency_to_origin_ms: number;
  };
  lpp_address: string;
  dns_domain?: string;
  registered_at: string;
  last_seen_at: string;
  status: 'active' | 'inactive';
}

// Sync result
export interface SyncResult {
  candidates: number[];
  confidence: number;
  next_prime: string;
  next_gap_estimate: number;
  matched_at: string;
}

// Route computation
export interface RouteResult {
  from: string;
  to: string;
  route: string[];
  hops: number;
  estimated_latency_ms: number;
}

// LamishPacket structures
export type PacketType = 'SYN' | 'ACK' | 'DATA' | 'ROUTE' | 'PING' | 'REPLY';

export interface LamishHeader {
  sync_index: number;
  fingerprint: number[];
  type: PacketType;
  length: number;
  checksum: string;
}

export interface LamishRouting {
  from: string;
  to: string;
}

export interface LamishPayload {
  encoding: 'text' | 'json' | 'binary';
  data: string;
}

export interface LamishPacket {
  version: string;
  header: LamishHeader;
  routing: LamishRouting;
  payload: LamishPayload;
}

// WebSocket message types
export type WSMessageType = 'pulse' | 'subscribe' | 'unsubscribe' | 'error';

export interface WSMessage {
  type: WSMessageType;
  data?: PulseEvent | string;
  error?: string;
}

// ============================================================================
// LPP2 Types — Catuskoti Machine, Enhanced Nodes, Networks
// ============================================================================

// Residue channels (prime mod 10 → catuskoti logic)
export type Residue = 1 | 3 | 7 | 9;
export type Channel = 'agreement' | 'tension' | 'discovery' | 'silence';
export type Catuskoti = 'is' | 'is_not' | 'both' | 'neither';
export type QuaternaryBits = '00' | '01' | '10' | '11';

export const RESIDUE_MAP: Record<Residue, { channel: Channel; catuskoti: Catuskoti; bits: QuaternaryBits }> = {
  1: { channel: 'agreement', catuskoti: 'is', bits: '00' },
  3: { channel: 'tension', catuskoti: 'is_not', bits: '01' },
  7: { channel: 'discovery', catuskoti: 'both', bits: '10' },
  9: { channel: 'silence', catuskoti: 'neither', bits: '11' },
};

export interface ResidueResponse {
  pulseIndex: number;
  prime: string;
  residue: Residue;
  channel: Channel;
  catuskoti: Catuskoti;
  quaternaryBits: QuaternaryBits;
  neighborhood?: {
    k: number;
    primes: string[];
    residues: Residue[];
    stream: string;  // concatenated quaternary bits
  };
}

export interface ChannelScheduleEntry {
  pulseIndex: number;
  prime: string;
  residue: Residue;
  channel: Channel;
  catuskoti: Catuskoti;
  quaternaryBits: QuaternaryBits;
}

// LPP2 Node (enhanced version of PostSocialNode)
export type LPP2NodeType = 'book' | 'archive' | 'curator' | 'gateway' | 'relay' | 'custom';
export type LPP2NodeStatus = 'active' | 'idle' | 'unreachable' | 'deregistered';

export interface LPP2Node {
  id: string;
  clientId: string;            // Which client app (post-social, dreegle, humanizer, gravity-press)
  name: string;
  address: string;             // LPP2 address string
  endpoint: string;            // HTTP callback URL

  nodeType: LPP2NodeType;
  identity?: {
    essentialTeachings?: string[];
    embodiedText?: string;
    voiceProfile?: string;
  };

  worldModel: {
    knownNodes: string[];
    networkMemberships: string[];
    horizon: string[];
    blindSpots: string[];
  };

  capabilities: {
    canConverse: boolean;
    canCurate: boolean;
    canCite: boolean;
    canTransform: boolean;
    tools: string[];
    contentTypes: string[];
  };

  status: LPP2NodeStatus;
  lastHeartbeat: string;
  registeredAt: string;
  updatedAt: string;
}

// LPP2 Network
export type JoinPolicy = 'open' | 'invite' | 'approval';

export interface LPP2Network {
  id: string;
  name: string;
  description: string;

  rules: {
    conversationCadence: string;
    channelMapping: Record<Residue, string>;
    maxNodes: number;
    joinPolicy: JoinPolicy;
    contentPolicy: string;
  };

  federatedWith: string[];
  gatewayNodes: string[];
  memberCount: number;
  lastActivity: string;
  createdAt: string;
  createdBy: string;
}

// LPP2 Address format: LPP::<primeIndex>@<networkFingerprint>/<parity>/<clientDomain>
export interface LPP2Address {
  primeIndex: number;
  networkFingerprint: string;
  parity: 'odd' | 'even';
  clientDomain: string;
}

export function formatLPP2Address(addr: LPP2Address): string {
  return `LPP::${addr.primeIndex}@${addr.networkFingerprint}/${addr.parity}/${addr.clientDomain}`;
}

export function parseLPP2Address(str: string): LPP2Address | null {
  const match = str.match(/^LPP::(\d+)@([a-f0-9]+)\/(odd|even)\/(.+)$/);
  if (!match) return null;
  return {
    primeIndex: parseInt(match[1], 10),
    networkFingerprint: match[2],
    parity: match[3] as 'odd' | 'even',
    clientDomain: match[4],
  };
}
