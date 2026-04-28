/**
 * LPP2 Protocol Routes — Enhanced Node Registry
 *
 * D1-backed node CRUD, address resolution, capabilities.
 * Mounted at /lpp/v2/ alongside existing v1 routes.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../types/env.js';
import {
  createNode,
  getNodeById,
  resolveAddress,
  listNodes,
  updateNode,
  heartbeatNode,
  deregisterNode,
  updateCapabilities,
} from '../services/lpp2-nodes.js';

export const lpp2Route = new Hono<{ Bindings: Env }>();

/**
 * GET /lpp2/status — LPP2 service status
 */
lpp2Route.get('/status', (c) => {
  return c.json({
    service: 'lpp2',
    version: '2.0.0',
    db_available: !!c.env.LPP_DB,
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// Node CRUD
// ============================================================================

const CreateNodeSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().min(1),
  endpoint: z.string().url(),
  nodeType: z.enum(['book', 'archive', 'curator', 'gateway', 'relay', 'custom']).optional(),
  primeIndex: z.number().int().min(1).optional(),
  identity: z.object({
    essentialTeachings: z.array(z.string()).optional(),
    embodiedText: z.string().optional(),
    voiceProfile: z.string().optional(),
  }).optional(),
  worldModel: z.object({
    knownNodes: z.array(z.string()).optional(),
    networkMemberships: z.array(z.string()).optional(),
    horizon: z.array(z.string()).optional(),
    blindSpots: z.array(z.string()).optional(),
  }).optional(),
  capabilities: z.object({
    canConverse: z.boolean().optional(),
    canCurate: z.boolean().optional(),
    canCite: z.boolean().optional(),
    canTransform: z.boolean().optional(),
    tools: z.array(z.string()).optional(),
    contentTypes: z.array(z.string()).optional(),
  }).optional(),
});

/**
 * POST /lpp/v2/nodes — Register a new LPP2 node
 */
lpp2Route.post('/nodes', async (c) => {
  const body = await c.req.json();
  const parsed = CreateNodeSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({
      error: 'Invalid request body',
      code: 'INVALID_INPUT',
      details: parsed.error.issues,
    }, 400);
  }

  try {
    const node = await createNode(c.env, parsed.data);
    return c.json(node, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('UNIQUE constraint')) {
      return c.json({ error: 'Node address already exists', code: 'ADDRESS_CONFLICT' }, 409);
    }
    return c.json({ error: message, code: 'CREATE_FAILED' }, 500);
  }
});

/**
 * GET /lpp/v2/nodes — List nodes with filters
 */
lpp2Route.get('/nodes', async (c) => {
  const clientId = c.req.query('client_id');
  const nodeType = c.req.query('node_type') as any;
  const status = c.req.query('status') as any;
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const result = await listNodes(c.env, { clientId, nodeType, status, limit, offset });
  return c.json({
    nodes: result.nodes,
    total: result.total,
    limit,
    offset,
  });
});

/**
 * GET /lpp/v2/nodes/:id — Get node by ID
 */
lpp2Route.get('/nodes/:id', async (c) => {
  const id = c.req.param('id');
  const node = await getNodeById(c.env, id);

  if (!node) {
    return c.json({ error: 'Node not found', code: 'NODE_NOT_FOUND' }, 404);
  }

  return c.json(node);
});

/**
 * PATCH /lpp/v2/nodes/:id — Update node metadata
 */
lpp2Route.patch('/nodes/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const UpdateSchema = z.object({
    name: z.string().min(1).optional(),
    endpoint: z.string().url().optional(),
    nodeType: z.enum(['book', 'archive', 'curator', 'gateway', 'relay', 'custom']).optional(),
    identity: z.object({
      essentialTeachings: z.array(z.string()).optional(),
      embodiedText: z.string().optional(),
      voiceProfile: z.string().optional(),
    }).optional(),
    worldModel: z.object({
      knownNodes: z.array(z.string()).optional(),
      networkMemberships: z.array(z.string()).optional(),
      horizon: z.array(z.string()).optional(),
      blindSpots: z.array(z.string()).optional(),
    }).optional(),
    capabilities: z.object({
      canConverse: z.boolean().optional(),
      canCurate: z.boolean().optional(),
      canCite: z.boolean().optional(),
      canTransform: z.boolean().optional(),
      tools: z.array(z.string()).optional(),
      contentTypes: z.array(z.string()).optional(),
    }).optional(),
  });

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      error: 'Invalid request body',
      code: 'INVALID_INPUT',
      details: parsed.error.issues,
    }, 400);
  }

  const node = await updateNode(c.env, id, parsed.data);
  if (!node) {
    return c.json({ error: 'Node not found', code: 'NODE_NOT_FOUND' }, 404);
  }

  return c.json(node);
});

/**
 * DELETE /lpp/v2/nodes/:id — Deregister node
 */
lpp2Route.delete('/nodes/:id', async (c) => {
  const id = c.req.param('id');
  const success = await deregisterNode(c.env, id);

  if (!success) {
    return c.json({ error: 'Node not found', code: 'NODE_NOT_FOUND' }, 404);
  }

  return c.json({ status: 'deregistered', id });
});

/**
 * POST /lpp/v2/nodes/:id/heartbeat — Node liveness signal
 */
lpp2Route.post('/nodes/:id/heartbeat', async (c) => {
  const id = c.req.param('id');
  const success = await heartbeatNode(c.env, id);

  if (!success) {
    return c.json({ error: 'Node not found', code: 'NODE_NOT_FOUND' }, 404);
  }

  return c.json({ status: 'ok', id, timestamp: new Date().toISOString() });
});

/**
 * POST /lpp/v2/nodes/:id/capabilities — Declare node capabilities
 */
lpp2Route.post('/nodes/:id/capabilities', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const CapabilitiesSchema = z.object({
    canConverse: z.boolean().optional(),
    canCurate: z.boolean().optional(),
    canCite: z.boolean().optional(),
    canTransform: z.boolean().optional(),
    tools: z.array(z.string()).optional(),
    contentTypes: z.array(z.string()).optional(),
  });

  const parsed = CapabilitiesSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      error: 'Invalid capabilities',
      code: 'INVALID_INPUT',
      details: parsed.error.issues,
    }, 400);
  }

  const node = await updateCapabilities(c.env, id, parsed.data as any);
  if (!node) {
    return c.json({ error: 'Node not found', code: 'NODE_NOT_FOUND' }, 404);
  }

  return c.json({ status: 'ok', capabilities: node.capabilities });
});

// ============================================================================
// Address Resolution
// ============================================================================

/**
 * GET /lpp/v2/resolve/:address — Resolve LPP2 address to node
 *
 * The address is URL-encoded in the path since it contains special chars.
 */
/**
 * GET /lpp2/resolve — Resolve LPP2 address to node
 *
 * Pass address as query parameter: ?address=LPP::100@abc123/even/post-social.com
 */
lpp2Route.get('/resolve', async (c) => {
  const address = c.req.query('address');
  if (!address) {
    return c.json({ error: 'Missing address query parameter', code: 'INVALID_ADDRESS' }, 400);
  }

  if (!address.startsWith('LPP::')) {
    return c.json({ error: 'Invalid LPP2 address format', code: 'INVALID_ADDRESS' }, 400);
  }

  const node = await resolveAddress(c.env, address);
  if (!node) {
    return c.json({ error: 'Address not found', code: 'ADDRESS_NOT_FOUND' }, 404);
  }

  return c.json(node);
});
