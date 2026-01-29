/**
 * LPP Storage Service
 *
 * KV-backed persistent storage for LPP nodes, repeaters, and epoch state.
 * Falls back to in-memory storage when KV is unavailable.
 */

import type { PostSocialNode, Repeater, PulseEpoch } from '../types/lpp.js';

// KV key prefixes
const PREFIX = {
  EPOCH: 'lpp:epoch',
  REPEATER: 'lpp:repeater:',
  REPEATER_LIST: 'lpp:repeaters',
  NODE: 'lpp:node:',
  NODE_LIST: 'lpp:nodes',
  NODE_BY_ADDRESS: 'lpp:addr:',
};

// Current KV namespace (set per-request)
let currentKv: KVNamespace | undefined;

// In-memory fallback storage
const memoryStore = {
  epoch: null as PulseEpoch | null,
  repeaters: new Map<string, Repeater>(),
  nodes: new Map<string, PostSocialNode>(),
  addressIndex: new Map<string, string>(), // lpp_address -> node_id
};

/**
 * Set the KV namespace for this request
 */
export function setLppKv(kv?: KVNamespace): void {
  currentKv = kv;
}

/**
 * Check if KV is available
 */
export function hasKv(): boolean {
  return currentKv !== undefined;
}

// ============================================================================
// Epoch Storage
// ============================================================================

/**
 * Save epoch to storage
 */
export async function saveEpoch(epoch: PulseEpoch): Promise<void> {
  if (currentKv) {
    await currentKv.put(PREFIX.EPOCH, JSON.stringify(epoch));
  }
  memoryStore.epoch = epoch;
}

/**
 * Load epoch from storage
 */
export async function loadEpoch(): Promise<PulseEpoch | null> {
  if (currentKv) {
    const data = await currentKv.get(PREFIX.EPOCH);
    if (data) {
      const epoch = JSON.parse(data) as PulseEpoch;
      memoryStore.epoch = epoch;
      return epoch;
    }
  }
  return memoryStore.epoch;
}

// ============================================================================
// Repeater Storage
// ============================================================================

/**
 * Save repeater to storage
 */
export async function saveRepeater(repeater: Repeater): Promise<void> {
  const key = PREFIX.REPEATER + repeater.domain;

  if (currentKv) {
    await currentKv.put(key, JSON.stringify(repeater));

    // Update list index
    const listData = await currentKv.get(PREFIX.REPEATER_LIST);
    const list: string[] = listData ? JSON.parse(listData) : [];
    if (!list.includes(repeater.domain)) {
      list.push(repeater.domain);
      await currentKv.put(PREFIX.REPEATER_LIST, JSON.stringify(list));
    }
  }

  memoryStore.repeaters.set(repeater.domain, repeater);
}

/**
 * Load repeater by domain
 */
export async function loadRepeater(domain: string): Promise<Repeater | null> {
  if (currentKv) {
    const data = await currentKv.get(PREFIX.REPEATER + domain);
    if (data) {
      const repeater = JSON.parse(data) as Repeater;
      memoryStore.repeaters.set(domain, repeater);
      return repeater;
    }
  }
  return memoryStore.repeaters.get(domain) || null;
}

/**
 * Load all repeaters
 */
export async function loadAllRepeaters(): Promise<Repeater[]> {
  if (currentKv) {
    const listData = await currentKv.get(PREFIX.REPEATER_LIST);
    if (listData) {
      const domains: string[] = JSON.parse(listData);
      const repeaters: Repeater[] = [];

      for (const domain of domains) {
        const repeater = await loadRepeater(domain);
        if (repeater) {
          repeaters.push(repeater);
        }
      }
      return repeaters;
    }
  }
  return Array.from(memoryStore.repeaters.values());
}

/**
 * Delete repeater
 */
export async function deleteRepeater(domain: string): Promise<boolean> {
  if (currentKv) {
    await currentKv.delete(PREFIX.REPEATER + domain);

    // Update list index
    const listData = await currentKv.get(PREFIX.REPEATER_LIST);
    if (listData) {
      const list: string[] = JSON.parse(listData);
      const newList = list.filter(d => d !== domain);
      await currentKv.put(PREFIX.REPEATER_LIST, JSON.stringify(newList));
    }
  }

  return memoryStore.repeaters.delete(domain);
}

// ============================================================================
// Node Storage
// ============================================================================

/**
 * Save node to storage
 */
export async function saveNode(node: PostSocialNode): Promise<void> {
  const key = PREFIX.NODE + node.node_id;
  const addrKey = PREFIX.NODE_BY_ADDRESS + node.lpp_address;

  if (currentKv) {
    await currentKv.put(key, JSON.stringify(node));
    await currentKv.put(addrKey, node.node_id);

    // Update list index
    const listData = await currentKv.get(PREFIX.NODE_LIST);
    const list: string[] = listData ? JSON.parse(listData) : [];
    if (!list.includes(node.node_id)) {
      list.push(node.node_id);
      await currentKv.put(PREFIX.NODE_LIST, JSON.stringify(list));
    }
  }

  memoryStore.nodes.set(node.node_id, node);
  memoryStore.addressIndex.set(node.lpp_address, node.node_id);
}

/**
 * Load node by ID
 */
export async function loadNode(nodeId: string): Promise<PostSocialNode | null> {
  if (currentKv) {
    const data = await currentKv.get(PREFIX.NODE + nodeId);
    if (data) {
      const node = JSON.parse(data) as PostSocialNode;
      memoryStore.nodes.set(nodeId, node);
      memoryStore.addressIndex.set(node.lpp_address, nodeId);
      return node;
    }
  }
  return memoryStore.nodes.get(nodeId) || null;
}

/**
 * Load node by LPP address
 */
export async function loadNodeByAddress(lppAddress: string): Promise<PostSocialNode | null> {
  if (currentKv) {
    const nodeId = await currentKv.get(PREFIX.NODE_BY_ADDRESS + lppAddress);
    if (nodeId) {
      return loadNode(nodeId);
    }
  }

  const nodeId = memoryStore.addressIndex.get(lppAddress);
  if (nodeId) {
    return memoryStore.nodes.get(nodeId) || null;
  }
  return null;
}

/**
 * Load all nodes with optional filtering
 */
export async function loadAllNodes(filter?: {
  origin?: 'gutenberg' | 'arxiv' | 'original';
  repeater?: string;
  status?: 'active' | 'inactive';
}): Promise<PostSocialNode[]> {
  let nodes: PostSocialNode[] = [];

  if (currentKv) {
    const listData = await currentKv.get(PREFIX.NODE_LIST);
    if (listData) {
      const nodeIds: string[] = JSON.parse(listData);

      for (const nodeId of nodeIds) {
        const node = await loadNode(nodeId);
        if (node) {
          nodes.push(node);
        }
      }
    }
  } else {
    nodes = Array.from(memoryStore.nodes.values());
  }

  // Apply filters
  if (filter?.origin) {
    nodes = nodes.filter(n => n.origin === filter.origin);
  }
  if (filter?.repeater) {
    nodes = nodes.filter(n => n.sync_state.repeater === filter.repeater);
  }
  if (filter?.status) {
    nodes = nodes.filter(n => n.status === filter.status);
  }

  return nodes;
}

/**
 * Delete node
 */
export async function deleteNode(nodeId: string): Promise<boolean> {
  const node = await loadNode(nodeId);
  if (!node) return false;

  if (currentKv) {
    await currentKv.delete(PREFIX.NODE + nodeId);
    await currentKv.delete(PREFIX.NODE_BY_ADDRESS + node.lpp_address);

    // Update list index
    const listData = await currentKv.get(PREFIX.NODE_LIST);
    if (listData) {
      const list: string[] = JSON.parse(listData);
      const newList = list.filter(id => id !== nodeId);
      await currentKv.put(PREFIX.NODE_LIST, JSON.stringify(newList));
    }
  }

  memoryStore.addressIndex.delete(node.lpp_address);
  return memoryStore.nodes.delete(nodeId);
}

/**
 * Get storage stats
 */
export async function getStorageStats(): Promise<{
  kv_available: boolean;
  node_count: number;
  repeater_count: number;
  has_epoch: boolean;
}> {
  const nodes = await loadAllNodes();
  const repeaters = await loadAllRepeaters();
  const epoch = await loadEpoch();

  return {
    kv_available: hasKv(),
    node_count: nodes.length,
    repeater_count: repeaters.length,
    has_epoch: epoch !== null,
  };
}
