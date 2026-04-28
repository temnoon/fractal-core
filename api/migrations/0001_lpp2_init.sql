-- LPP2 Protocol Server Schema
-- Database: fractal-core-lpp2
-- Created: 2026-04-13

-- Node registry (authoritative, KV is cache)
CREATE TABLE lpp2_nodes (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT UNIQUE NOT NULL,
  endpoint TEXT NOT NULL,
  node_type TEXT NOT NULL DEFAULT 'custom',
  identity_json TEXT,
  world_model_json TEXT,
  capabilities_json TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_heartbeat TEXT,
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Network definitions
CREATE TABLE lpp2_networks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  rules_json TEXT NOT NULL,
  federated_with_json TEXT,
  gateway_nodes_json TEXT,
  member_count INTEGER DEFAULT 0,
  last_activity TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL
);

-- Network membership (many-to-many)
CREATE TABLE lpp2_network_members (
  network_id TEXT NOT NULL REFERENCES lpp2_networks(id),
  node_id TEXT NOT NULL REFERENCES lpp2_nodes(id),
  role TEXT DEFAULT 'member',
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (network_id, node_id)
);

-- Conversations (orchestrated dialogues between nodes)
CREATE TABLE lpp2_conversations (
  id TEXT PRIMARY KEY,
  network_id TEXT REFERENCES lpp2_networks(id),
  node_a TEXT NOT NULL REFERENCES lpp2_nodes(id),
  node_b TEXT NOT NULL REFERENCES lpp2_nodes(id),
  channel TEXT NOT NULL,
  pulse_index TEXT NOT NULL,
  prime_anchor TEXT NOT NULL,
  residue INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  topic TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

-- Exchanges (individual turns within a conversation)
CREATE TABLE lpp2_exchanges (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES lpp2_conversations(id),
  speaker_node_id TEXT NOT NULL REFERENCES lpp2_nodes(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pulse history — the immutable ledger
CREATE TABLE lpp2_pulse_log (
  pulse_index TEXT PRIMARY KEY,
  prime TEXT NOT NULL,
  residue INTEGER NOT NULL,
  catuskoti TEXT NOT NULL,
  channel TEXT NOT NULL,
  conversations_triggered INTEGER DEFAULT 0,
  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Topology edges (derived from conversations + federation)
CREATE TABLE lpp2_edges (
  id TEXT PRIMARY KEY,
  source_node TEXT NOT NULL REFERENCES lpp2_nodes(id),
  target_node TEXT NOT NULL REFERENCES lpp2_nodes(id),
  edge_type TEXT NOT NULL,
  weight REAL DEFAULT 1.0,
  conversation_count INTEGER DEFAULT 0,
  last_interaction TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indices
CREATE INDEX idx_nodes_client ON lpp2_nodes(client_id);
CREATE INDEX idx_nodes_status ON lpp2_nodes(status);
CREATE INDEX idx_nodes_type ON lpp2_nodes(node_type);
CREATE INDEX idx_members_node ON lpp2_network_members(node_id);
CREATE INDEX idx_conv_network ON lpp2_conversations(network_id);
CREATE INDEX idx_conv_status ON lpp2_conversations(status);
CREATE INDEX idx_conv_nodes ON lpp2_conversations(node_a, node_b);
CREATE INDEX idx_exchanges_conv ON lpp2_exchanges(conversation_id);
CREATE INDEX idx_edges_source ON lpp2_edges(source_node);
CREATE INDEX idx_edges_target ON lpp2_edges(target_node);
