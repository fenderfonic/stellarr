// SPDX-License-Identifier: AGPL-3.0-only
// Adapted for Stellarr on 2026-11-24 from Fungai Exposure. See PROVENANCE.md.
import type { MediaNode, Filament } from "./graph";

const labels: Record<string, string> = {
  Movie: "Film", Series: "TV series", Episode: "Episode", Person: "Person",
  MusicAlbum: "Album", Audio: "Track", MusicArtist: "Artist", Collection: "Collection", Composer: "Composer",
};

export function entityKind(entity: MediaNode) {
  return kindLabel(entity.kind);
}

export function kindLabel(kind: string) {
  return labels[kind] ?? readableLabel(kind);
}

function readableLabel(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
}

export function indexGraph(filaments: Filament[], observed: MediaNode[]) {
  const entities = new Map(observed.map((entity) => [entity.id, entity]));
  const neighbors = new Map<string, Filament[]>();
  const edges = new Map<string, Filament>();
  for (const edge of filaments) {
    edges.set(edge.id, edge);
    for (const entity of [edge.from, ...(edge.from.id === edge.to.id ? [] : [edge.to])]) {
      if (!entities.has(entity.id)) entities.set(entity.id, entity);
      const current = neighbors.get(entity.id);
      if (current) current.push(edge);
      else neighbors.set(entity.id, [edge]);
    }
  }
  const categories = new Map<string, number>();
  const candidates: { entity: MediaNode; targets: number; kinds: number }[] = [];
  for (const entity of entities.values()) {
    categories.set(entity.kind, (categories.get(entity.kind) ?? 0) + 1);
    const links = neighbors.get(entity.id) ?? [];
    const connected = new Map(links.map((edge) => {
      const other = otherEnd(edge, entity.id);
      return [other.id, other.kind] as const;
    }));
    if (connected.size) candidates.push({ entity, targets: connected.size, kinds: new Set(connected.values()).size });
  }
  const byKind = (a: typeof candidates[number], b: typeof candidates[number]) =>
    (categories.get(a.entity.kind) ?? 0) - (categories.get(b.entity.kind) ?? 0);
  const byName = (a: typeof candidates[number], b: typeof candidates[number]) =>
    a.entity.name.localeCompare(b.entity.name) || a.entity.id.localeCompare(b.entity.id);
  const moderate = (a: typeof candidates[number], b: typeof candidates[number]) =>
    Math.abs(a.targets - 5) - Math.abs(b.targets - 5);
  const starters: typeof candidates = [];
  const choose = (options: typeof candidates) => {
    const pick = options.find(({ entity }) => starters.every((entry) => entry.entity.kind !== entity.kind));
    if (pick) starters.push(pick);
  };
  choose(candidates.filter((item) => item.kinds > 1)
    .sort((a, b) => b.kinds - a.kinds || moderate(a, b) || byName(a, b)));
  choose([...candidates].sort((a, b) => byKind(a, b) || moderate(a, b) || byName(a, b)));
  choose([...candidates].sort((a, b) => moderate(a, b) || b.kinds - a.kinds || byName(a, b)));
  return { entities, neighbors, edges, starters };
}

export function otherEnd(edge: Filament, id: string) {
  return edge.from.id === id ? edge.to : edge.from;
}

function nameKey(name: string) {
  return name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ");
}

export function prepareSearch(entities: Iterable<MediaNode>) {
  const types = new Map<string, string>();
  return [...entities].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map((entity) => {
    let type = types.get(entity.kind);
    if (!type) {
      type = nameKey(`${entity.kind} ${kindLabel(entity.kind)}`);
      types.set(entity.kind, type);
    }
    const metadata = nameKey([
      entity.seriesTitle, ...(entity.genres ?? []), entity.year, ...Object.values(entity.externalIds ?? {}),
    ].filter(Boolean).join(" "));
    return { entity, name: nameKey(entity.name), type, metadata };
  });
}

export function searchEntities(entries: ReturnType<typeof prepareSearch>, query: string, kind: string,
  availability: string, genre: string) {
  const term = nameKey(query.trim());
  const words = term ? term.split(" ") : [];
  const results: MediaNode[][] = [[], [], [], []];
  for (const { entity, name, type, metadata } of entries) {
    if (kind && entity.galaxy !== kind) continue;
    if (availability && entity.availability !== availability) continue;
    if (genre && !entity.genres?.includes(genre)) continue;
    if (!words.every((word) => name.includes(word) || type.includes(word) || metadata.includes(word))) continue;
    const rank = name === term ? 0 : name.startsWith(term) ? 1 : name.includes(term) ? 2 : 3;
    results[rank].push(entity);
  }
  return results.flat();
}
