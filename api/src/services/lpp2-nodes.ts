/**
 * LPP2 Node Service — D1-backed node registry
 *
 * Source of truth is D1. KV is used as a cache for hot-path lookups
 * (address resolution, node-by-id). The existing v1 KV-only node
 * service remains for backwards compatibility.
 */

import type { Env } from '../types/env.js';
import type { LPP2Node, LPP2NodeType, LPP2NodeStatus } from '../types/lpp.js';
import { formatLPP2Address } from '../types/lpp.js';
import { computeFingerprint } from './lpp-pulse.js';
import { fingerprintHash } from './lpp-sync.js';

// KV cache prefixes (distinct from v1 prefixes)
const KV_PREFIX = {
  NODE: 'lpp2:node:',
  ADDR: 'lpp2:addr:',
};

// KV cache TTL (1 hour)
const CACHE_TTL = 3600;

/**
 * Generate a UUID (crypto.randomUUID available in Workers)
 */
function uuid(): string {
  return crypto.randomUUID();
}

/**
 * Generate LPP2 address for a node based on registration order.
 * Uses prime at the node's assigned index to compute the address.
 */
function generateAddress(primeIndex: number, clientDomain: string): string {
  const fingerprint = computeFingerprint(primeIndex);
  const fpHash = fingerprintHash(fingerprint);
  const parity = primeIndex % 2 === 0 ? 'even' : 'odd';
  return formatLPP2Address({
    primeIndex,
    networkFingerprint: fpHash,
    parity: parity as 'odd' | 'even',
    clientDomain,
  });
}

/**
 * Convert D1 row to LPP2Node
 */
function rowToNode(row: Record<string, unknown>): LPP2Node {
  return {
    id: row.id as string,
    clientId: row.client_id as string,
    name: row.name as string,
    address: row.address as string,
    endpoint: row.endpoint as string,
    nodeType: row.node_type as LPP2NodeType,
    identity: row.identity_json ? JSON.parse(row.identity_json as string) : undefined,
    worldModel: row.world_model_json
      ? JSON.parse(row.world_model_json as string)
      : { knownNodes: [], networkMemberships: [], horizon: [], blindSpots: [] },
    capabilities: row.capabilities_json
      ? JSON.parse(row.capabilities_json as string)
      : { canConverse: false, canCurate: false, canCite: false, canTransform: false, tools: [], contentTypes: [] },
    status: row.status as LPP2NodeStatus,
    lastHeartbeat: (row.last_heartbeat as string) || '',
    registeredAt: row.registered_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Cache a node in KV (fire-and-forget)
 */
async function cacheNode(kv: KVNamespace | undefined, node: LPP2Node): Promise<void> {
  if (!kv) return;
  try {
    await Promise.all([
      kv.put(KV_PREFIX.NODE + node.id, JSON.stringify(node), { expirationTtl: CACHE_TTL }),
      kv.put(KV_PREFIX.ADDR + node.address, node.id, { expirationTtl: CACHE_TTL }),
    ]);
  } catch {
    // Cache failures are non-fatal
  }
}

/**
 * Invalidate node cache
 */
async function invalidateCache(kv: KVNamespace | undefined, nodeId: string, address: string): Promise<void> {
  if (!kv) return;
  try {
    await Promise.all([
      kv.delete(KV_PREFIX.NODE + nodeId),
      kv.delete(KV_PREFIX.ADDR + address),
    ]);
  } catch {
    // Cache failures are non-fatal
  }
}

// ============================================================================
// CRUD Operations
// ============================================================================

export interface CreateNodeInput {
  clientId: string;
  name: string;
  endpoint: string;
  nodeType?: LPP2NodeType;
  primeIndex?: number;       // Optional: specific prime index for address. Auto-assigned if omitted.
  identity?: LPP2Node['identity'];
  worldModel?: Partial<LPP2Node['worldModel']>;
  capabilities?: Partial<LPP2Node['capabilities']>;
}

/**
 * Register a new LPP2 node
 */
export async function createNode(env: Env, input: CreateNodeInput): Promise<LPP2Node> {
  const db = env.LPP_DB;
  if (!db) throw new Error('LPP_DB not available');

  const id = uuid();
  const now = new Date().toISOString();

  // Determine prime index: use provided or auto-assign based on current node count
  let primeIndex = input.primeIndex;
  if (!primeIndex) {
    const countResult = await db.prepare('SELECT COUNT(*) as cnt FROM lpp2_nodes').first<{ cnt: number }>();
    primeIndex = (countResult?.cnt || 0) + 100; // Start at index 100 to avoid tiny primes
  }

  const address = generateAddress(primeIndex, input.clientId);

  const worldModel = {
    knownNodes: [],
    networkMemberships: [],
    horizon: [],
    blindSpots: [],
    ...input.worldModel,
  };

  const capabilities = {
    canConverse: false,
    canCurate: false,
    canCite: false,
    canTransform: false,
    tools: [],
    contentTypes: [],
    ...input.capabilities,
  };

  await db.prepare(`
    INSERT INTO lpp2_nodes (id, client_id, name, address, endpoint, node_type, identity_json, world_model_json, capabilities_json, status, last_heartbeat, registered_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).bind(
    id,
    input.clientId,
    input.name,
    address,
    input.endpoint,
    input.nodeType || 'custom',
    input.identity ? JSON.stringify(input.identity) : null,
    JSON.stringify(worldModel),
    JSON.stringify(capabilities),
    now,
    now,
    now,
  ).run();

  const node: LPP2Node = {
    id,
    clientId: input.clientId,
    name: input.name,
    address,
    endpoint: input.endpoint,
    nodeType: input.nodeType || 'custom',
    identity: input.identity,
    worldModel,
    capabilities,
    status: 'active',
    lastHeartbeat: now,
    registeredAt: now,
    updatedAt: now,
  };

  await cacheNode(env.LPP_KV, node);
  return node;
}

/**
 * Get node by ID (checks KV cache first)
 */
export async function getNodeById(env: Env, id: string): Promise<LPP2Node | null> {
  // Try KV cache
  if (env.LPP_KV) {
    try {
      const cached = await env.LPP_KV.get(KV_PREFIX.NODE + id);
      if (cached) return JSON.parse(cached) as LPP2Node;
    } catch { /* fall through */ }
  }

  // D1 lookup
  const db = env.LPP_DB;
  if (!db) return null;

  const row = await db.prepare('SELECT * FROM lpp2_nodes WHERE id = ?').bind(id).first();
  if (!row) return null;

  const node = rowToNode(row);
  await cacheNode(env.LPP_KV, node);
  return node;
}

/**
 * Resolve LPP2 address to node
 */
export async function resolveAddress(env: Env, address: string): Promise<LPP2Node | null> {
  // Try KV cache for address → ID
  if (env.LPP_KV) {
    try {
      const nodeId = await env.LPP_KV.get(KV_PREFIX.ADDR + address);
      if (nodeId) {
        const node = await getNodeById(env, nodeId);
        if (node) return node;
      }
    } catch { /* fall through */ }
  }

  // D1 lookup
  const db = env.LPP_DB;
  if (!db) return null;

  const row = await db.prepare('SELECT * FROM lpp2_nodes WHERE address = ?').bind(address).first();
  if (!row) return null;

  const node = rowToNode(row);
  await cacheNode(env.LPP_KV, node);
  return node;
}

/**
 * List nodes with optional filtering
 */
export async function listNodes(
  env: Env,
  filter?: {
    clientId?: string;
    nodeType?: LPP2NodeType;
    status?: LPP2NodeStatus;
    limit?: number;
    offset?: number;
  }
): Promise<{ nodes: LPP2Node[]; total: number }> {
  const db = env.LPP_DB;
  if (!db) return { nodes: [], total: 0 };

  const conditions: string[] = [];
  const params: string[] = [];

  if (filter?.clientId) {
    conditions.push('client_id = ?');
    params.push(filter.clientId);
  }
  if (filter?.nodeType) {
    conditions.push('node_type = ?');
    params.push(filter.nodeType);
  }
  if (filter?.status) {
    conditions.push('status = ?');
    params.push(filter.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(filter?.limit || 50, 100);
  const offset = filter?.offset || 0;

  // Get total count
  const countStmt = db.prepare(`SELECT COUNT(*) as cnt FROM lpp2_nodes ${where}`);
  const countResult = await (params.length > 0
    ? countStmt.bind(...params)
    : countStmt
  ).first<{ cnt: number }>();
  const total = countResult?.cnt || 0;

  // Get page
  const queryStmt = db.prepare(
    `SELECT * FROM lpp2_nodes ${where} ORDER BY registered_at DESC LIMIT ? OFFSET ?`
  );
  const allParams = [...params, limit.toString(), offset.toString()];
  const result = await queryStmt.bind(...allParams).all();

  const nodes = (result.results || []).map(row => rowToNode(row as Record<string, unknown>));
  return { nodes, total };
}

/**
 * Update node metadata
 */
export async function updateNode(
  env: Env,
  id: string,
  updates: {
    name?: string;
    endpoint?: string;
    nodeType?: LPP2NodeType;
    identity?: LPP2Node['identity'];
    worldModel?: Partial<LPP2Node['worldModel']>;
    capabilities?: Partial<LPP2Node['capabilities']>;
  }
): Promise<LPP2Node | null> {
  const db = env.LPP_DB;
  if (!db) return null;

  const existing = await getNodeById(env, id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: string[] = [];

  if (updates.name !== undefined) {
    sets.push('name = ?');
    params.push(updates.name);
  }
  if (updates.endpoint !== undefined) {
    sets.push('endpoint = ?');
    params.push(updates.endpoint);
  }
  if (updates.nodeType !== undefined) {
    sets.push('node_type = ?');
    params.push(updates.nodeType);
  }
  if (updates.identity !== undefined) {
    sets.push('identity_json = ?');
    params.push(JSON.stringify(updates.identity));
  }
  if (updates.worldModel !== undefined) {
    const merged = { ...existing.worldModel, ...updates.worldModel };
    sets.push('world_model_json = ?');
    params.push(JSON.stringify(merged));
  }
  if (updates.capabilities !== undefined) {
    const merged = { ...existing.capabilities, ...updates.capabilities };
    sets.push('capabilities_json = ?');
    params.push(JSON.stringify(merged));
  }

  if (sets.length === 0) return existing;

  sets.push('updated_at = ?');
  const now = new Date().toISOString();
  params.push(now);
  params.push(id);

  await db.prepare(`UPDATE lpp2_nodes SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();

  await invalidateCache(env.LPP_KV, id, existing.address);
  return getNodeById(env, id);
}

/**
 * Update node heartbeat
 */
export async function heartbeatNode(env: Env, id: string): Promise<boolean> {
  const db = env.LPP_DB;
  if (!db) return false;

  const now = new Date().toISOString();
  const result = await db.prepare(
    `UPDATE lpp2_nodes SET last_heartbeat = ?, status = 'active', updated_at = ? WHERE id = ?`
  ).bind(now, now, id).run();

  if (result.meta.changes === 0) return false;

  // Invalidate cache so next read gets fresh data
  const existing = await getNodeById(env, id);
  if (existing) {
    await invalidateCache(env.LPP_KV, id, existing.address);
  }
  return true;
}

/**
 * Deregister a node (soft delete — sets status to deregistered)
 */
export async function deregisterNode(env: Env, id: string): Promise<boolean> {
  const db = env.LPP_DB;
  if (!db) return false;

  const existing = await getNodeById(env, id);
  if (!existing) return false;

  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE lpp2_nodes SET status = 'deregistered', updated_at = ? WHERE id = ?`
  ).bind(now, id).run();

  await invalidateCache(env.LPP_KV, id, existing.address);
  return true;
}

/**
 * Update node capabilities
 */
export async function updateCapabilities(
  env: Env,
  id: string,
  capabilities: LPP2Node['capabilities']
): Promise<LPP2Node | null> {
  return updateNode(env, id, { capabilities });
}
