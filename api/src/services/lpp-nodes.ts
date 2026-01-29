/**
 * LPP Node and Repeater Management Service
 *
 * Manages Post-Social nodes and repeaters in the LPP network.
 * Handles registration, routing, and topology.
 * Persisted to KV when available, falls back to in-memory.
 */

import type { PostSocialNode, Repeater, RouteResult, LPPAddress } from '../types/lpp.js';
import { fingerprintHash } from './lpp-sync.js';
import {
  saveRepeater,
  loadRepeater,
  loadAllRepeaters,
  saveNode,
  loadNode,
  loadNodeByAddress,
  loadAllNodes,
} from './lpp-storage.js';

// Origin is always fractal-core.com
const ORIGIN_DOMAIN = 'fractal-core.com';

/**
 * Generate LPP address string from components
 */
export function formatLPPAddress(address: LPPAddress): string {
  const fpHash = fingerprintHash(address.fingerprint);
  const classChar = address.repeater_class === 'odd' ? 'odd' : 'even';
  const path = address.repeater_path.join('/');
  return `LPP::${address.origin_index}@${fpHash}/${classChar}/${path}`;
}

/**
 * Parse LPP address string to components
 */
export function parseLPPAddress(addressStr: string): LPPAddress | null {
  const match = addressStr.match(/^LPP::(\d+)@([a-f0-9]+)\/(odd|even)\/(.+)$/);
  if (!match) return null;

  const [, indexStr, , classStr, pathStr] = match;
  return {
    origin_index: parseInt(indexStr, 10),
    fingerprint: [],
    repeater_class: classStr as 'even' | 'odd',
    repeater_path: pathStr.split('/'),
    timestamp_corrected: 0,
  };
}

/**
 * Register a repeater (persisted)
 */
export async function registerRepeater(
  domain: string,
  endpoint: string,
  repeaterClass: 'even' | 'odd',
  upstream: string = ORIGIN_DOMAIN,
  location?: { label: string; coordinates?: [number, number] }
): Promise<Repeater> {
  const id = `repeater_${domain.replace(/[^a-z0-9]/gi, '_')}`;
  const now = new Date().toISOString();

  const repeater: Repeater = {
    id,
    domain,
    endpoint,
    class: repeaterClass,
    location,
    upstream: upstream || ORIGIN_DOMAIN,
    registered_at: now,
    last_seen_at: now,
    status: 'active',
  };

  await saveRepeater(repeater);
  return repeater;
}

/**
 * Get repeater by domain (from KV or memory)
 */
export async function getRepeater(domain: string): Promise<Repeater | null> {
  return loadRepeater(domain);
}

/**
 * List all repeaters
 */
export async function listRepeaters(): Promise<Repeater[]> {
  return loadAllRepeaters();
}

/**
 * Update repeater heartbeat (persisted)
 */
export async function repeaterHeartbeat(domain: string): Promise<boolean> {
  const repeater = await loadRepeater(domain);
  if (!repeater) return false;

  repeater.last_seen_at = new Date().toISOString();
  repeater.status = 'active';
  await saveRepeater(repeater);
  return true;
}

/**
 * Build repeater path from node's repeater to origin
 */
async function buildRepeaterPath(repeaterDomain: string): Promise<string[]> {
  const path: string[] = [];
  let current = repeaterDomain;

  // Walk up the chain, with a safety limit
  for (let i = 0; i < 20; i++) {
    if (!current || current === ORIGIN_DOMAIN) break;
    path.push(current);
    const repeater = await loadRepeater(current);
    if (!repeater) break;
    current = repeater.upstream;
  }

  path.push(ORIGIN_DOMAIN);
  return path;
}

/**
 * Register a Post-Social node (persisted)
 */
export async function registerNode(
  nodeId: string,
  title: string,
  origin: 'gutenberg' | 'arxiv' | 'original',
  syncState: {
    origin_index: number;
    fingerprint: number[];
    repeater: string;
    latency_to_origin_ms?: number;
  },
  options?: {
    topics?: string[];
    source_url?: string;
    dns_domain?: string;
  }
): Promise<PostSocialNode> {
  const now = new Date().toISOString();

  const repeaterPath = await buildRepeaterPath(syncState.repeater);
  const repeaterClass: 'even' | 'odd' = syncState.origin_index % 2 === 0 ? 'even' : 'odd';

  const lppAddress: LPPAddress = {
    origin_index: syncState.origin_index,
    fingerprint: syncState.fingerprint,
    repeater_class: repeaterClass,
    repeater_path: repeaterPath,
    timestamp_corrected: syncState.origin_index,
  };

  const node: PostSocialNode = {
    node_id: nodeId,
    title,
    origin,
    topics: options?.topics,
    source_url: options?.source_url,
    sync_state: {
      origin_index: syncState.origin_index,
      fingerprint: syncState.fingerprint,
      repeater: syncState.repeater,
      latency_to_origin_ms: syncState.latency_to_origin_ms ?? 0,
    },
    lpp_address: formatLPPAddress(lppAddress),
    dns_domain: options?.dns_domain,
    registered_at: now,
    last_seen_at: now,
    status: 'active',
  };

  await saveNode(node);
  return node;
}

/**
 * Get node by ID
 */
export async function getNode(nodeId: string): Promise<PostSocialNode | null> {
  return loadNode(nodeId);
}

/**
 * Get node by LPP address
 */
export async function getNodeByAddress(lppAddress: string): Promise<PostSocialNode | null> {
  return loadNodeByAddress(lppAddress);
}

/**
 * List all nodes with optional filtering
 */
export async function listNodes(filter?: {
  origin?: 'gutenberg' | 'arxiv' | 'original';
  repeater?: string;
  status?: 'active' | 'inactive';
}): Promise<PostSocialNode[]> {
  return loadAllNodes(filter);
}

/**
 * Update node heartbeat (persisted)
 */
export async function nodeHeartbeat(nodeId: string): Promise<boolean> {
  const node = await loadNode(nodeId);
  if (!node) return false;

  node.last_seen_at = new Date().toISOString();
  node.status = 'active';
  await saveNode(node);
  return true;
}

/**
 * Find common ancestor in repeater paths
 */
function findCommonAncestor(pathA: string[], pathB: string[]): string {
  const setB = new Set(pathB);
  for (const domain of pathA) {
    if (setB.has(domain)) {
      return domain;
    }
  }
  return ORIGIN_DOMAIN;
}

/**
 * Compute route between two nodes
 */
export async function computeRoute(fromAddress: string, toAddress: string): Promise<RouteResult | null> {
  const fromNode = await loadNodeByAddress(fromAddress);
  const toNode = await loadNodeByAddress(toAddress);

  if (!fromNode || !toNode) {
    return null;
  }

  const fromPath = await buildRepeaterPath(fromNode.sync_state.repeater);
  const toPath = await buildRepeaterPath(toNode.sync_state.repeater);

  const ancestor = findCommonAncestor(fromPath, toPath);

  const upPath = fromPath.slice(0, fromPath.indexOf(ancestor) + 1);
  const downPath = toPath.slice(0, toPath.indexOf(ancestor)).reverse();
  const route = [...upPath, ...downPath.filter(d => d !== ancestor)];

  const estimatedLatency = route.length * 10 +
    fromNode.sync_state.latency_to_origin_ms +
    toNode.sync_state.latency_to_origin_ms;

  return {
    from: fromAddress,
    to: toAddress,
    route,
    hops: route.length,
    estimated_latency_ms: estimatedLatency,
  };
}

/**
 * Get network topology summary
 */
export async function getTopology(): Promise<{
  origin: string;
  repeaters: { domain: string; upstream: string; nodes: number }[];
  total_nodes: number;
  total_repeaters: number;
}> {
  const repeaterList = await loadAllRepeaters();
  const nodeList = await loadAllNodes();

  const repeaterSummary = repeaterList.map(r => ({
    domain: r.domain,
    upstream: r.upstream,
    nodes: nodeList.filter(n => n.sync_state.repeater === r.domain).length,
  }));

  return {
    origin: ORIGIN_DOMAIN,
    repeaters: repeaterSummary,
    total_nodes: nodeList.length,
    total_repeaters: repeaterList.length,
  };
}
