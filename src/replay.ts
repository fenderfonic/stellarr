// SPDX-License-Identifier: AGPL-3.0-only
// Adapted for Stellarr on 2026-11-24 from Fungai Exposure. See PROVENANCE.md.
import type { Filament } from "./graph";

function stableKey(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

// One synthetic catalogue snapshot, revealed in stable order.
export function replayOrder(filaments: Filament[]): Filament[] {
  return filaments.map((edge) => ({ edge, key: stableKey(edge.id) }))
    .sort((a, b) => a.key - b.key || a.edge.id.localeCompare(b.edge.id))
    .map(({ edge }) => edge);
}

export function replayCount(total: number, elapsed: number, reducedMotion: boolean): number {
  const t = Math.min(1, Math.max(0, elapsed / (reducedMotion ? 4000 : 14000)));
  const progress = reducedMotion ? Math.floor(t * 4) / 4 : t * t * (3 - 2 * t);
  return Math.floor(total * progress);
}
