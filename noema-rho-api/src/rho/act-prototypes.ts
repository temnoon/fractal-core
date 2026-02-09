/**
 * Prototype definitions for embedding-based act classification.
 * Each act type has 4-6 prototype sentences. At startup, all prototypes
 * are embedded and cached. Classification compares a sentence embedding
 * against all prototypes and fires acts above per-type thresholds.
 */

import type { IntentionalActType } from '../types.js';
import { embedBatch, cosineSimilarity } from './embeddings.js';

// ── Types ────────────────────────────────────────────────────────

export interface ActClassification {
  type: IntentionalActType;
  confidence: number;
  reason: string;
  payload?: Record<string, unknown>;
}

interface PrototypeGroup {
  type: IntentionalActType;
  threshold: number;
  sentences: string[];
  embeddings: Float32Array[];
  /** Sub-clusters for types that need sub-classification (Affect, Relate). */
  subclusters?: SubCluster[];
}

interface SubCluster {
  label: string;
  indices: number[];   // indices into the parent sentences array
}

// ── Prototype definitions ────────────────────────────────────────

const PROTOTYPE_DEFS: Array<{
  type: IntentionalActType;
  threshold: number;
  sentences: string[];
  subclusters?: Array<{ label: string; indices: number[] }>;
}> = [
  {
    type: 'Question',
    threshold: 0.40,
    sentences: [
      'What is this?',
      'Who did that?',
      'Why did this happen?',
      'Is this true?',
      'How does this work?',
      'She asked whether it was really the case.',
      'He wondered why they had left so suddenly.',
    ],
  },
  {
    type: 'Reject',
    threshold: 0.30,
    sentences: [
      'That is not true.',
      'I disagree with this.',
      'No, that is incorrect.',
      'He never accepted the story.',
      'She refused to believe the explanation.',
      'They denied everything that was said.',
      'He did not agree with the decision at all.',
    ],
  },
  {
    type: 'Assert',
    threshold: 0.35,
    sentences: [
      'This is a fact.',
      'It is certainly true.',
      'The evidence shows this clearly.',
      'He stated firmly that it was the case.',
      'She declared that the plan would work.',
      'They confirmed the findings were accurate.',
    ],
  },
  {
    type: 'Ascribe',
    threshold: 0.35,
    sentences: [
      'He is talented.',
      'She has the property of being kind.',
      'They are known for their wisdom.',
      'She is incredibly brave and determined.',
      'He was considered generous by everyone.',
      'The city is beautiful and historic.',
    ],
  },
  {
    type: 'Relate',
    threshold: 0.30,
    sentences: [
      // caused_by: 0, 1, 2, 3
      'This was caused by that event.',
      'Because of this, that happened.',
      'He moved there because he loved the place.',
      'She left since the situation had changed.',
      // supports: 4, 5
      'This supports the claim that was made.',
      'The evidence lends support to this view.',
      // contradicts: 6, 7
      'This contradicts what was said before.',
      'The new facts go against the previous account.',
    ],
    subclusters: [
      { label: 'caused_by', indices: [0, 1, 2, 3] },
      { label: 'supports', indices: [4, 5] },
      { label: 'contradicts', indices: [6, 7] },
    ],
  },
  {
    type: 'Metaphorize',
    threshold: 0.35,
    sentences: [
      'Life is like a river.',
      'As if dancing in the wind.',
      'This resembles a familiar pattern.',
      'It is a metaphor for something deeper.',
      'Her voice was music to his ears.',
      'The city was a jungle of concrete and steel.',
    ],
  },
  {
    type: 'Differentiate',
    threshold: 0.30,
    sentences: [
      'But this is different from that.',
      'However, on the other hand, consider this.',
      'In contrast to what was said previously.',
      'Despite the similarities, they are not the same.',
      'However, he never actually enjoyed it.',
      'But she had a completely different experience.',
      'Yet the outcome was nothing like they expected.',
    ],
  },
  {
    type: 'Endorse',
    threshold: 0.30,
    sentences: [
      'I agree with this view.',
      'This confirms the claim that was made.',
      'I support this position entirely.',
      'Everyone agrees that this is correct.',
      'He endorsed the proposal wholeheartedly.',
      'They all accepted the conclusion.',
    ],
  },
  {
    type: 'Affect',
    threshold: 0.25,
    sentences: [
      // positive: 0, 1, 2, 3, 4
      'I love this very much.',
      'This brings great joy and happiness.',
      'How wonderful and beautiful this is.',
      'He loved the city and enjoyed living there.',
      'She was delighted and grateful for the opportunity.',
      // negative: 5, 6, 7, 8
      'I fear this greatly.',
      'This is terrible and dreadful.',
      'I hate this situation intensely.',
      'He dreaded the outcome and was anxious about it.',
    ],
    subclusters: [
      { label: 'positive', indices: [0, 1, 2, 3, 4] },
      { label: 'negative', indices: [5, 6, 7, 8] },
    ],
  },
  {
    type: 'Generalize',
    threshold: 0.30,
    sentences: [
      'All people tend to do this.',
      'This is always the case.',
      'Everyone knows that by now.',
      'In general, this holds true.',
      'Everyone agrees that he truly loves it.',
      'People always say the same thing about this.',
    ],
  },
  {
    type: 'Particularize',
    threshold: 0.35,
    sentences: [
      'Specifically, this one case stands out.',
      'For example, consider this instance.',
      'In this particular situation only.',
      'Namely, the following detail matters.',
    ],
  },
  {
    type: 'Doubt',
    threshold: 0.35,
    sentences: [
      'Maybe this is true.',
      'I am not sure about this.',
      'Perhaps it could be otherwise.',
      'It remains uncertain and unclear.',
      'He was uncertain about the whole thing.',
      'She doubted whether it would really work.',
    ],
  },
  {
    type: 'Suspend',
    threshold: 0.35,
    sentences: [
      'Setting this question aside for now.',
      'Withholding judgment on this matter.',
      'Not taking a position at this time.',
      'Let us leave this open for later.',
    ],
  },
  {
    type: 'Revise',
    threshold: 0.35,
    sentences: [
      'Actually, I was wrong about that.',
      'Let me correct that earlier claim.',
      'On second thought, it is different.',
      'I need to revise my previous statement.',
    ],
  },
];

// ── Runtime state ────────────────────────────────────────────────

let groups: PrototypeGroup[] = [];
let initialized = false;
let initializing: Promise<void> | null = null;

/** Compute and cache all prototype embeddings. Idempotent. */
export async function initPrototypes(): Promise<void> {
  if (initialized) return;
  if (initializing) return initializing;

  initializing = (async () => {
    // Flatten all sentences for a single batch embed call
    const allSentences: string[] = [];
    const offsets: Array<{ defIdx: number; start: number; count: number }> = [];

    for (let i = 0; i < PROTOTYPE_DEFS.length; i++) {
      offsets.push({ defIdx: i, start: allSentences.length, count: PROTOTYPE_DEFS[i].sentences.length });
      allSentences.push(...PROTOTYPE_DEFS[i].sentences);
    }

    const allEmbeddings = await embedBatch(allSentences);

    groups = offsets.map(({ defIdx, start, count }) => {
      const def = PROTOTYPE_DEFS[defIdx];
      return {
        type: def.type,
        threshold: def.threshold,
        sentences: def.sentences,
        embeddings: allEmbeddings.slice(start, start + count),
        subclusters: def.subclusters,
      };
    });

    initialized = true;
  })();

  return initializing;
}

/** Check if prototypes have been initialized. */
export function isPrototypesReady(): boolean {
  return initialized;
}

/**
 * Relative cutoff: only keep acts scoring at least this fraction of the
 * top-scoring act. Prevents low-confidence noise from firing alongside
 * a dominant act (e.g., Doubt 0.91 vs Reject 0.40).
 */
const RELATIVE_CUTOFF = 0.65;

/** Classify a sentence embedding against all prototype groups. */
export function classifyActs(sentenceEmbedding: Float32Array): ActClassification[] {
  // First pass: compute best similarity for every group
  const candidates: Array<{
    group: PrototypeGroup;
    maxSim: number;
    bestIdx: number;
  }> = [];

  for (const group of groups) {
    let maxSim = -1;
    let bestIdx = 0;
    for (let i = 0; i < group.embeddings.length; i++) {
      const sim = cosineSimilarity(sentenceEmbedding, group.embeddings[i]);
      if (sim > maxSim) {
        maxSim = sim;
        bestIdx = i;
      }
    }

    // Absolute threshold gate
    if (maxSim >= group.threshold) {
      candidates.push({ group, maxSim, bestIdx });
    }
  }

  if (candidates.length === 0) return [];

  // Relative filter: only keep acts within RELATIVE_CUTOFF of the best
  const peakSim = Math.max(...candidates.map((c) => c.maxSim));
  const relativeFloor = peakSim * RELATIVE_CUTOFF;

  const results: ActClassification[] = [];

  for (const { group, maxSim, bestIdx } of candidates) {
    if (maxSim < relativeFloor) continue;

    const act: ActClassification = {
      type: group.type,
      confidence: maxSim,
      reason: `embedding similarity ${maxSim.toFixed(3)} to "${group.sentences[bestIdx]}"`,
    };

    // Sub-classification for Affect (valence)
    if (group.type === 'Affect' && group.subclusters) {
      const posSub = group.subclusters.find((s) => s.label === 'positive')!;
      const negSub = group.subclusters.find((s) => s.label === 'negative')!;

      const posSim = maxClusterSim(sentenceEmbedding, group.embeddings, posSub.indices);
      const negSim = maxClusterSim(sentenceEmbedding, group.embeddings, negSub.indices);
      const valence = Math.max(-1, Math.min(1, posSim - negSim));

      act.payload = { valence };
    }

    // Sub-classification for Relate (relation type)
    if (group.type === 'Relate' && group.subclusters) {
      let bestLabel = 'caused_by';
      let bestClusterSim = -1;

      for (const sub of group.subclusters) {
        const sim = maxClusterSim(sentenceEmbedding, group.embeddings, sub.indices);
        if (sim > bestClusterSim) {
          bestClusterSim = sim;
          bestLabel = sub.label;
        }
      }

      act.payload = { relation: bestLabel };
    }

    results.push(act);
  }

  return results;
}

function maxClusterSim(
  embedding: Float32Array,
  groupEmbeddings: Float32Array[],
  indices: number[],
): number {
  let max = -1;
  for (const idx of indices) {
    const sim = cosineSimilarity(embedding, groupEmbeddings[idx]);
    if (sim > max) max = sim;
  }
  return max;
}
