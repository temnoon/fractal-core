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
