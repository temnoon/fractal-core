/**
 * Lamish Pulse Protocol (LPP) Routes
 *
 * Endpoints for pulse synchronization, node registration, routing,
 * and WebSocket pulse streaming.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import {
  getCurrentPulse,
  getPulseAtIndex,
  getEpochInfo,
  timeToNextPulse,
  computeFingerprint,
  initializeEpoch,
} from '../services/lpp-pulse.js';

import {
  matchD2Sequence,
  getSequenceAtPrime,
  fingerprintHash,
} from '../services/lpp-sync.js';

import {
  registerRepeater,
  listRepeaters,
  getRepeater,
  repeaterHeartbeat,
  registerNode,
  listNodes,
  getNode,
  nodeHeartbeat,
  computeRoute,
  getTopology,
  formatLPPAddress,
} from '../services/lpp-nodes.js';

import { setLppKv, getStorageStats } from '../services/lpp-storage.js';
import type { Env } from '../types/env.js';
import type { PulseEvent } from '../types/lpp.js';

export const lppRoute = new Hono<{ Bindings: Env }>();

// Middleware: set KV binding for LPP storage on each request
lppRoute.use('*', async (c, next) => {
  setLppKv(c.env?.LPP_KV);
  await next();
});

// ============================================================================
// Pulse Endpoints
// ============================================================================

/**
 * GET /lpp/pulse - Get current pulse state
 */
lppRoute.get('/pulse', async (c) => {
  await initializeEpoch();
  const pulse = getCurrentPulse();
  const nextIn = timeToNextPulse();

  return c.json({
    ...pulse,
    next_pulse_in_ms: nextIn,
  });
});

/**
 * GET /lpp/pulse/:index - Get pulse at specific index
 */
lppRoute.get('/pulse/:index', async (c) => {
  const index = parseInt(c.req.param('index'), 10);

  if (isNaN(index) || index < 1) {
    return c.json({ error: 'Invalid index' }, 400);
  }

  await initializeEpoch();
  const pulse = getPulseAtIndex(index);
  return c.json(pulse);
});

/**
 * GET /lpp/epoch - Get epoch information
 */
lppRoute.get('/epoch', async (c) => {
  await initializeEpoch();
  const epoch = getEpochInfo();
  return c.json(epoch);
});

// ============================================================================
// WebSocket Pulse Stream
// ============================================================================

// Connected WebSocket clients
const wsClients: Set<WebSocket> = new Set();

// Pulse broadcast interval handle
let pulseIntervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the pulse broadcast loop (idempotent)
 */
function ensurePulseBroadcast(): void {
  if (pulseIntervalHandle) return;

  pulseIntervalHandle = setInterval(() => {
    if (wsClients.size === 0) return;

    const pulse = getCurrentPulse();
    const message = JSON.stringify({ type: 'pulse', data: pulse });

    for (const ws of wsClients) {
      try {
        ws.send(message);
      } catch {
        wsClients.delete(ws);
      }
    }
  }, 1000); // 1-second pulse interval
}

/**
 * GET /lpp/stream - WebSocket upgrade for live pulse stream
 *
 * Cloudflare Workers WebSocket pattern:
 * The client sends an Upgrade: websocket request, and the worker
 * creates a WebSocket pair, returns the client end, and uses the
 * server end.
 */
lppRoute.get('/stream', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');

  if (upgradeHeader !== 'websocket') {
    return c.json({
      error: 'Expected WebSocket upgrade',
      hint: 'Connect with WebSocket client to wss://fractal-core.com/api/v1/lpp/stream',
    }, 426);
  }

  // Create WebSocket pair (Cloudflare Workers API)
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  // Accept the WebSocket connection
  server.accept();

  // Track this connection
  wsClients.add(server);

  // Initialize epoch before streaming
  await initializeEpoch();

  // Send initial pulse immediately
  const initialPulse = getCurrentPulse();
  server.send(JSON.stringify({
    type: 'pulse',
    data: initialPulse,
    message: 'Connected to LPP pulse stream',
  }));

  // Start broadcast loop
  ensurePulseBroadcast();

  // Handle close
  server.addEventListener('close', () => {
    wsClients.delete(server);
  });

  // Handle incoming messages (subscribe/unsubscribe/ping)
  server.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data as string);

      switch (msg.type) {
        case 'ping':
          server.send(JSON.stringify({
            type: 'pong',
            timestamp: new Date().toISOString(),
          }));
          break;

        case 'get_pulse':
          server.send(JSON.stringify({
            type: 'pulse',
            data: getCurrentPulse(),
          }));
          break;

        default:
          server.send(JSON.stringify({
            type: 'error',
            error: `Unknown message type: ${msg.type}`,
          }));
      }
    } catch {
      server.send(JSON.stringify({
        type: 'error',
        error: 'Invalid JSON',
      }));
    }
  });

  // Return the client end of the WebSocket pair
  return new Response(null, {
    status: 101,
    webSocket: client,
  });
});

/**
 * GET /lpp/stream/status - Check WebSocket stream status (REST)
 */
lppRoute.get('/stream/status', (c) => {
  return c.json({
    connected_clients: wsClients.size,
    broadcasting: pulseIntervalHandle !== null,
    interval_ms: 1000,
  });
});

// ============================================================================
// Synchronization Endpoints
// ============================================================================

/**
 * GET /lpp/sync - Match Δ² sequence to find position
 */
lppRoute.get('/sync', (c) => {
  const sequenceStr = c.req.query('sequence');
  const toleranceStr = c.req.query('tolerance');

  if (!sequenceStr) {
    return c.json({ error: 'Missing required parameter: sequence' }, 400);
  }

  const sequence = sequenceStr.split(',').map(s => parseInt(s.trim(), 10));
  if (sequence.some(isNaN)) {
    return c.json({ error: 'Invalid sequence values' }, 400);
  }

  if (sequence.length < 3) {
    return c.json({ error: 'Sequence must have at least 3 values' }, 400);
  }

  if (sequence.length > 20) {
    return c.json({ error: 'Sequence must have at most 20 values' }, 400);
  }

  const tolerance = toleranceStr ? parseInt(toleranceStr, 10) : 0;
  if (isNaN(tolerance) || tolerance < 0) {
    return c.json({ error: 'Invalid tolerance' }, 400);
  }

  const result = matchD2Sequence(sequence, tolerance);
  return c.json(result);
});

/**
 * GET /lpp/fingerprint - Get fingerprint at prime index
 */
lppRoute.get('/fingerprint', (c) => {
  const indexStr = c.req.query('prime_index');
  const lengthStr = c.req.query('length');

  if (!indexStr) {
    return c.json({ error: 'Missing required parameter: prime_index' }, 400);
  }

  const index = parseInt(indexStr, 10);
  if (isNaN(index) || index < 2) {
    return c.json({ error: 'Invalid prime_index (must be >= 2)' }, 400);
  }

  const length = lengthStr ? parseInt(lengthStr, 10) : 4;
  if (isNaN(length) || length < 1 || length > 10) {
    return c.json({ error: 'Invalid length (must be 1-10)' }, 400);
  }

  const result = getSequenceAtPrime(index, length);
  return c.json({
    ...result,
    fingerprint_hash: fingerprintHash(result.fingerprint),
  });
});

// ============================================================================
// Repeater Endpoints
// ============================================================================

const RepeaterSchema = z.object({
  domain: z.string().min(1),
  endpoint: z.string().url(),
  class: z.enum(['even', 'odd']),
  upstream: z.string().optional(),
  location: z.object({
    label: z.string(),
    coordinates: z.tuple([z.number(), z.number()]).optional(),
  }).optional(),
});

/**
 * POST /lpp/repeaters - Register a repeater
 */
lppRoute.post('/repeaters', async (c) => {
  const body = await c.req.json();
  const parsed = RepeaterSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({
      error: 'Invalid request body',
      details: parsed.error.issues,
    }, 400);
  }

  const { domain, endpoint, class: repeaterClass, upstream, location } = parsed.data;
  const repeater = await registerRepeater(domain, endpoint, repeaterClass, upstream, location);
  return c.json(repeater, 201);
});

/**
 * GET /lpp/repeaters - List all repeaters
 */
lppRoute.get('/repeaters', async (c) => {
  const repeaters = await listRepeaters();
  return c.json({ repeaters, count: repeaters.length });
});

/**
 * GET /lpp/repeaters/:domain - Get repeater by domain
 */
lppRoute.get('/repeaters/:domain', async (c) => {
  const domain = c.req.param('domain');
  const repeater = await getRepeater(domain);

  if (!repeater) {
    return c.json({ error: 'Repeater not found' }, 404);
  }

  return c.json(repeater);
});

/**
 * POST /lpp/repeaters/:domain/heartbeat - Update repeater heartbeat
 */
lppRoute.post('/repeaters/:domain/heartbeat', async (c) => {
  const domain = c.req.param('domain');
  const success = await repeaterHeartbeat(domain);

  if (!success) {
    return c.json({ error: 'Repeater not found' }, 404);
  }

  return c.json({ status: 'ok', domain });
});

// ============================================================================
// Node Endpoints
// ============================================================================

const NodeSchema = z.object({
  node_id: z.string().min(1),
  title: z.string().min(1),
  origin: z.enum(['gutenberg', 'arxiv', 'original']),
  sync_state: z.object({
    origin_index: z.number().int().min(1),
    fingerprint: z.array(z.number()).min(1).max(10),
    repeater: z.string().min(1),
    latency_to_origin_ms: z.number().optional(),
  }),
  topics: z.array(z.string()).optional(),
  source_url: z.string().url().optional(),
  dns_domain: z.string().optional(),
});

/**
 * POST /lpp/nodes - Register a Post-Social node
 */
lppRoute.post('/nodes', async (c) => {
  const body = await c.req.json();
  const parsed = NodeSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({
      error: 'Invalid request body',
      details: parsed.error.issues,
    }, 400);
  }

  const { node_id, title, origin, sync_state, topics, source_url, dns_domain } = parsed.data;
  const node = await registerNode(node_id, title, origin, sync_state, {
    topics,
    source_url,
    dns_domain,
  });

  return c.json(node, 201);
});

/**
 * GET /lpp/nodes - List nodes with optional filtering
 */
lppRoute.get('/nodes', async (c) => {
  const origin = c.req.query('origin') as 'gutenberg' | 'arxiv' | 'original' | undefined;
  const repeater = c.req.query('repeater');
  const status = c.req.query('status') as 'active' | 'inactive' | undefined;

  const nodes = await listNodes({ origin, repeater, status });
  return c.json({ nodes, count: nodes.length });
});

/**
 * GET /lpp/nodes/:id - Get node by ID
 */
lppRoute.get('/nodes/:id', async (c) => {
  const id = c.req.param('id');
  const node = await getNode(id);

  if (!node) {
    return c.json({ error: 'Node not found' }, 404);
  }

  return c.json(node);
});

/**
 * POST /lpp/nodes/:id/heartbeat - Update node heartbeat
 */
lppRoute.post('/nodes/:id/heartbeat', async (c) => {
  const id = c.req.param('id');
  const success = await nodeHeartbeat(id);

  if (!success) {
    return c.json({ error: 'Node not found' }, 404);
  }

  return c.json({ status: 'ok', node_id: id });
});

// ============================================================================
// Routing Endpoints
// ============================================================================

/**
 * GET /lpp/route - Compute route between two nodes
 */
lppRoute.get('/route', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');

  if (!from || !to) {
    return c.json({ error: 'Missing required parameters: from, to' }, 400);
  }

  const route = await computeRoute(from, to);

  if (!route) {
    return c.json({ error: 'Could not compute route (nodes not found)' }, 404);
  }

  return c.json(route);
});

/**
 * GET /lpp/topology - Get network topology summary
 */
lppRoute.get('/topology', async (c) => {
  const topology = await getTopology();
  return c.json(topology);
});

// ============================================================================
// Address Generation
// ============================================================================

/**
 * GET /lpp/address - Generate LPP address from parameters
 */
lppRoute.get('/address', (c) => {
  const indexStr = c.req.query('prime_index');
  const repeater = c.req.query('repeater') || 'fractal-core.com';

  if (!indexStr) {
    return c.json({ error: 'Missing required parameter: prime_index' }, 400);
  }

  const index = parseInt(indexStr, 10);
  if (isNaN(index) || index < 1) {
    return c.json({ error: 'Invalid prime_index' }, 400);
  }

  const fingerprint = computeFingerprint(index);
  const repeaterClass: 'even' | 'odd' = index % 2 === 0 ? 'even' : 'odd';

  const path = repeater === 'fractal-core.com'
    ? ['fractal-core.com']
    : [repeater, 'fractal-core.com'];

  const address = formatLPPAddress({
    origin_index: index,
    fingerprint,
    repeater_class: repeaterClass,
    repeater_path: path,
    timestamp_corrected: index,
  });

  return c.json({
    lpp_address: address,
    components: {
      origin_index: index,
      fingerprint,
      fingerprint_hash: fingerprintHash(fingerprint),
      repeater_class: repeaterClass,
      repeater_path: path,
    },
  });
});

// ============================================================================
// Storage Status
// ============================================================================

/**
 * GET /lpp/storage - Get storage stats (debug)
 */
lppRoute.get('/storage', async (c) => {
  const stats = await getStorageStats();
  return c.json(stats);
});
