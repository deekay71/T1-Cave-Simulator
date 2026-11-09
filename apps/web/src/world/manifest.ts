/**
 * Typed access to the model manifests written by tools/models/build.ts
 * (apps/web/public/models/manifest.<group>.json, served at <base>models/...).
 */
import type { PoseJoint } from "@te-liet/shared";

export type Vec3 = [number, number, number];

export interface ManifestLight {
  name?: string;
  /** Position in the model's own frame (m). */
  at: Vec3;
  color: string;
  intensity?: number;
  range?: number;
}

export interface ManifestAsset {
  name: string;
  file: string;
  url?: string;
  triangles: number;
  bounds: { min: Vec3; max: Vec3 };
  nodes?: string[];
  anchors?: Record<string, Vec3>;
  lights?: ManifestLight[];
  poses?: Record<string, Record<string, PoseJoint>>;
  meta?: Record<string, unknown>;
}

interface Manifest {
  group: string;
  assets: ManifestAsset[];
}

/** "<group>/<name>" -> manifest entry. */
export type ManifestIndex = Map<string, ManifestAsset>;

/** Served copy of apps/web/public/models (respects Vite's base path). */
const MODELS = `${import.meta.env.BASE_URL}models/`;

/** URL of a model id "<group>/<name>". */
export const modelUrl = (id: string) => `${MODELS}${id}.glb`;

/**
 * Fetch the manifests of the given groups. A missing or broken manifest is reported through
 * `onError` and simply contributes no entries (models still load from their default URL).
 */
export async function loadManifests(
  groups: readonly string[],
  onError: (msg: string) => void,
): Promise<ManifestIndex> {
  const index: ManifestIndex = new Map();
  await Promise.all(
    groups.map(async (group) => {
      try {
        const res = await fetch(`${MODELS}manifest.${group}.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const m = (await res.json()) as Manifest;
        for (const a of m.assets) index.set(`${group}/${a.name}`, a);
      } catch (err) {
        onError(
          `manifest.${group}.json: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
  );
  return index;
}
