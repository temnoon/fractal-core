/**
 * Singleton embedding service using @huggingface/transformers.
 * Lazy-loads Xenova/all-MiniLM-L6-v2 (q8, 384-dim) on first call.
 * ~23 MB download, ~90 MB RAM, ~30ms/sentence after warmup.
 */

import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';

// Configure model cache directory
env.cacheDir = process.env.EMBEDDINGS_CACHE_DIR ?? '.cache/models';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const MODEL_OPTS = { dtype: 'q8' as const };

let extractor: FeatureExtractionPipeline | null = null;
let loading: Promise<FeatureExtractionPipeline> | null = null;
let ready = false;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;
  if (loading) return loading;

  loading = pipeline('feature-extraction', MODEL_ID, MODEL_OPTS)
    .then((pipe) => {
      extractor = pipe;
      ready = true;
      return pipe;
    })
    .catch((err) => {
      loading = null;
      throw err;
    });

  return loading;
}

/** Embed a single text string. Returns 384-dim Float32Array. */
export async function embedText(text: string): Promise<Float32Array> {
  const pipe = await getExtractor();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return output.data as Float32Array;
}

/** Embed multiple texts. Returns one Float32Array per input. */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const pipe = await getExtractor();
  const output = await pipe(texts, { pooling: 'mean', normalize: true });
  const dim = 384;
  const results: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    results.push(new Float32Array(output.data.slice(i * dim, (i + 1) * dim)));
  }
  return results;
}

/** Cosine similarity between two vectors. Assumes normalized inputs → dot product. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/** Check if the embedding model has been loaded. */
export function isEmbeddingsReady(): boolean {
  return ready;
}
