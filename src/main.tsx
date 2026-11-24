import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { entityKind, indexGraph, otherEnd, prepareSearch, searchEntities } from "./exploration";
import { FilamentScene, layout, type CameraPose, type EntityFocus, type Landmark, type SceneView } from "./filament-scene";
import type { Filament, Galaxy, MediaGraph, MediaNode } from "./graph";
import { replayOrder } from "./replay";
import "./style.css";

const galaxies: Galaxy[] = ["Movies", "Television", "Music"];
const overviewLimit = 14_000;
const focusLimit = 12;
const titleKinds = new Set(["Movie", "Series", "MusicAlbum"]);
type Route = { node: MediaNode; edge?: Filament };
type Browse = "nearby" | "connections";

type View = {
  entity?: string;
  edge?: string;
  region?: Galaxy;
  query: string;
  status: string;
  genre: string;
  cursor: number;
  browse: Browse;
  season: string;
  details: boolean;
};
const homeView: View = { query: "", status: "", genre: "", cursor: 0, browse: "nearby", season: "", details: false };

function Artwork({ node }: { node: MediaNode }) {
  return <div className="artwork">
    {node.artwork && <img key={node.artwork} src={node.artwork} alt="" draggable={false}
      referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; }} />}
  </div>;
}

function Orbit({ routes, cursor, browse, change, visit }: {
  routes: Route[];
  cursor: number;
  browse: Browse | "matches";
  change: (cursor: number) => void;
  visit: (route: Route) => void;
}) {
  const touchOrigin = useRef<{ x: number; y: number } | null>(null);
  const index = Math.min(cursor, Math.max(0, routes.length - 1));
  const step = (direction: number) => change(Math.min(routes.length - 1, Math.max(0, index + direction)));
  if (!routes.length) return null;
  return <section className="orbit" aria-label="Artwork orbit" tabIndex={0}
    onKeyDown={(event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        step(event.key === "ArrowLeft" ? -1 : 1);
      } else if (event.key === "Enter" && event.target === event.currentTarget) {
        visit(routes[index]);
      }
    }}
    onTouchStart={(event) => {
      const touch = event.touches[0];
      touchOrigin.current = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
    }}
    onTouchCancel={() => { touchOrigin.current = null; }}
    onTouchEnd={(event) => {
      const origin = touchOrigin.current;
      touchOrigin.current = null;
      if (!origin) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - origin.x;
      const dy = touch.clientY - origin.y;
      if (Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy)) {
        event.preventDefault();
        step(dx > 0 ? -1 : 1);
      } else if (Math.hypot(dx, dy) < 10 && event.target instanceof Element) {
        const button = event.target.closest("button");
        if (button) {
          event.preventDefault();
          button.click();
        }
      }
    }}>
    <div className="orbit-track">
      <button type="button" className="orbit-arrow" aria-label="Previous in orbit" disabled={index === 0} onClick={() => step(-1)}>‹</button>
      <div className="orbit-cards">
        {[-1, 0, 1].map((offset) => {
          const route = routes[index + offset];
          if (!route) return <div className="orbit-slot" key={offset} />;
          const { node, edge } = route;
          return <div className="orbit-slot" key={offset}>
            <button type="button" className="orbit-card" data-offset={offset} onClick={() => visit(route)}>
              <Artwork node={node} />
              <span className="orbit-title">{node.name}</span>
              <small>{edge ? edge.label : [entityKind(node), node.year].filter(Boolean).join(" · ")}</small>
            </button>
          </div>;
        })}
      </div>
      <button type="button" className="orbit-arrow" aria-label="Next in orbit" disabled={index + 1 >= routes.length} onClick={() => step(1)}>›</button>
    </div>
    <p className="orbit-status" aria-live="polite">
      {browse === "matches" ? "Search matches" : browse === "connections" ? "Catalogue relationships" : "Nearby in the map"}
      <span> · </span>{(index + 1).toLocaleString()} of {routes.length.toLocaleString()}
    </p>
  </section>;
}

function Explorer({ graph }: { graph: MediaGraph }) {
  const model = useMemo(() => {
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const edges = graph.links.map((edge) => ({
      ...edge, from: nodes.get(edge.from)!, to: nodes.get(edge.to)!,
    }));
    const index = indexGraph(edges, graph.nodes);
    // Keep each populated galaxy represented when a large library exceeds the draw budget.
    const filaments: Filament[] = edges.length <= overviewLimit ? edges : [];
    if (edges.length > overviewLimit) {
      const groups = new Map<string, Filament[]>();
      for (const edge of edges) {
        const galaxy = edge.from.galaxy ?? edge.to.galaxy ?? "";
        const group = groups.get(galaxy);
        if (group) group.push(edge);
        else groups.set(galaxy, [edge]);
      }
      for (let i = 0; filaments.length < overviewLimit; i++) {
        for (const group of groups.values()) {
          if (group[i] && filaments.length < overviewLimit) filaments.push(group[i]);
        }
      }
    }
    const isolated = graph.nodes.filter((node) => !index.neighbors.has(node.id)).slice(0, 2000);
    const geometryLayout = layout(edges);
    const position = (node: MediaNode) => geometryLayout.positions.get(node.id) ?? geometryLayout.place(node);
    const titles = graph.nodes.filter((node) => titleKinds.has(node.kind));
    const regions = galaxies.flatMap((galaxy) => {
      const members = titles.filter((node) => node.galaxy === galaxy);
      if (!members.length) return [];
      const center = position(members[0]).clone().setScalar(0);
      for (const member of members) center.add(position(member));
      center.divideScalar(members.length);
      const byDistance = members.map((node) => ({ node, distance: center.distanceToSquared(position(node)) }))
        .sort((a, b) => a.distance - b.distance);
      return [{ galaxy, center, distance: Math.max(30, Math.sqrt(byDistance.at(-1)!.distance) * 2.7),
        members: byDistance.map(({ node }) => node) }];
    });
    const genres = [...new Set(graph.nodes.flatMap((node) => node.genres ?? []))].sort();
    return { index, filaments, isolated, geometryLayout, position, titles, regions, genres,
      ordered: replayOrder(filaments), search: prepareSearch(index.entities.values()) };
  }, [graph]);

  const [view, setView] = useState<View>(homeView);
  const [history, setHistory] = useState<{ view: View; pose?: CameraPose }[]>([]);
  const [camera, setCamera] = useState<{ revision: number; pose?: CameraPose }>({ revision: 0 });
  const [revealed, setRevealed] = useState<number | null>(null);
  const sceneView = useRef<SceneView>(null);
  const search = useRef<HTMLInputElement>(null);
  const entity = model.index.entities.get(view.entity ?? "");
  const region = model.regions.find((entry) => entry.galaxy === view.region);
  const filtering = Boolean(view.query.trim() || view.status || view.genre);
  const results = useMemo(() => filtering
    ? searchEntities(model.search, view.query, view.region ?? "", view.status, view.genre) : [],
  [model, filtering, view.query, view.region, view.status, view.genre]);
  const matches = useMemo(() => filtering ? new Set(results.map((node) => node.id)) : null, [filtering, results]);

  const connections = useMemo(() => {
    if (!entity) return [];
    return (model.index.neighbors.get(entity.id) ?? []).map((edge) => ({ edge, node: otherEnd(edge, entity.id) }))
      .sort((a, b) => Number(b.node.kind === "Collection") - Number(a.node.kind === "Collection") ||
        Number(titleKinds.has(b.node.kind)) - Number(titleKinds.has(a.node.kind)) ||
        (a.node.season ?? 0) - (b.node.season ?? 0) || (a.node.episode ?? 0) - (b.node.episode ?? 0));
  }, [entity, model]);
  const seasons = useMemo(() => [...new Set(connections.flatMap(({ node }) =>
    node.season === undefined ? [] : [node.season]))], [connections]);
  const related = useMemo(() => view.season === "" ? connections
    : connections.filter(({ node }) => String(node.season) === view.season), [connections, view.season]);
  const nearby = useMemo(() => {
    if (!entity) return [];
    const center = model.position(entity);
    const linked = new Set(connections.map(({ node }) => node.id));
    return model.titles.filter((node) => node.galaxy === entity.galaxy && node.id !== entity.id && !linked.has(node.id))
      .map((node) => ({ node, distance: center.distanceToSquared(model.position(node)) }))
      .sort((a, b) => a.distance - b.distance).slice(0, 24);
  }, [entity, connections, model]);

  const focus = useMemo<EntityFocus | undefined>(() => {
    if (!entity) return region && { center: region.center, distance: region.distance, edges: [] };
    const edges = connections.slice(0, focusLimit).map(({ edge }) => edge);
    const selected = model.index.edges.get(view.edge ?? "");
    if (selected && !edges.includes(selected)) edges.unshift(selected);
    return { entity, center: model.position(entity), edges };
  }, [entity, region, model, connections, view.edge]);

  const searchRoutes = useMemo(() => results.map((node) => ({ node })), [results]);
  const regionRoutes = useMemo(() => region?.members.slice(0, 32).map((node) => ({ node })) ?? [], [region]);
  const browsingMatches = filtering && !entity;
  const routes = browsingMatches ? searchRoutes : entity
    ? (view.browse === "connections" ? related : nearby) : regionRoutes;

  function navigate(next: View) {
    const pose = sceneView.current?.pose();
    setHistory((previous) => [...previous, { view, pose }]);
    setView(next);
    setCamera(({ revision }) => ({ revision: revision + 1 }));
  }

  const visitRef = useRef<(node: MediaNode, edge?: Filament) => void>(() => {});
  visitRef.current = (node, edge) => {
    if (node.id === view.entity && !edge) return;
    const browse = model.index.neighbors.has(node.id) ? "connections" : "nearby";
    navigate({ ...view, entity: node.id, edge: edge?.id, browse, cursor: 0, season: "", details: false });
  };
  const selectEdge = useCallback((id: string) => {
    const edge = model.index.edges.get(id);
    if (!edge) return;
    const current = visitOrigin.current;
    const next = current === edge.from.id || current === edge.to.id ? otherEnd(edge, current)
      : edge.from.kind === "Person" ? edge.to : edge.from;
    visitRef.current(next, edge);
  }, [model]);
  const visitOrigin = useRef(view.entity);
  visitOrigin.current = view.entity;
  const selectNode = useCallback((node: MediaNode) => visitRef.current(node), []);

  function enter(galaxy: Galaxy) {
    navigate({ ...view, region: galaxy, entity: undefined, edge: undefined, cursor: 0, season: "", details: false });
  }

  function back() {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory(history.slice(0, -1));
    setView(previous.view);
    setCamera(({ revision }) => ({ revision: revision + 1, pose: previous.pose }));
  }

  function home() {
    setView(homeView);
    setHistory([]);
    setCamera(({ revision }) => ({ revision: revision + 1 }));
  }

  function filter(patch: Partial<View>) {
    setView((current) => ({ ...current, ...patch, entity: undefined, edge: undefined,
      cursor: 0, season: "", details: false }));
    setCamera(({ revision }) => ({ revision: revision + 1 }));
  }

  useEffect(() => {
    const find = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.altKey || event.metaKey ||
        (event.target instanceof HTMLElement && event.target.closest("input, select, textarea, [contenteditable]"))) return;
      event.preventDefault();
      search.current?.focus();
    };
    window.addEventListener("keydown", find);
    return () => window.removeEventListener("keydown", find);
  }, []);

  const landmarks: Landmark[] = [];
  const addPins = (entries: Route[], limit: number, range?: number) => {
    for (const { node, edge } of entries.slice(Math.max(0, view.cursor - 1), Math.max(0, view.cursor - 1) + limit)) {
      landmarks.push({ id: edge?.id ?? node.id, name: node.name, caption: edge?.label, range,
        position: model.position(node), kind: "title", select: () => visitRef.current(node, edge) });
    }
  };
  if (entity) {
    landmarks.push({ id: entity.id, position: model.position(entity), name: entity.name, kind: "focus" });
    addPins(routes, 6, 42);
  } else {
    if (!region) {
      for (const entry of model.regions) {
        const count = matches ? entry.members.filter((node) => matches.has(node.id)).length : entry.members.length;
        landmarks.push({ id: entry.galaxy, position: entry.center, name: entry.galaxy, kind: "galaxy",
          caption: matches ? `${count} matching titles` : `${count} titles`, select: () => enter(entry.galaxy) });
      }
    }
    if (region || browsingMatches) addPins(routes, 9, region && !browsingMatches ? 52 : undefined);
    else addPins(model.regions.flatMap((entry) => entry.members.slice(0, 5).map((node) => ({ node }))), 15, 44);
  }

  return (
    <main className="shell">
      <section className="universe" aria-label="Media universe">
        {graph.nodes.length > 0 ? <FilamentScene filaments={model.filaments} ordered={model.ordered} selected={view.edge}
          geometryLayout={model.geometryLayout} landmarks={landmarks} entityFocus={focus}
          cameraRequest={camera.revision} restoredPose={camera.pose} sceneView={sceneView}
          matches={entity ? null : matches} onSelect={selectEdge} onReveal={setRevealed}
          isolated={model.isolated} onSelectNode={selectNode} /> :
          <p className="scene-message">No media in the local catalogue. Synchronise a source or open Demo.</p>}

        <header className="flight-header">
          <div className="masthead">
            <h1>Stellarr</h1>
            <p>{graph.mode === "demo" ? "Demo universe" : (graph.sources ?? []).map((source) =>
              source === "radarr" ? "Radarr" : "Sonarr").join(" + ") || "Catalogue"}</p>
          </div>
          <nav aria-label="Exploration history">
            <button type="button" onClick={back} disabled={!history.length}>← Back</button>
            <button type="button" onClick={home}>Home</button>
          </nav>
        </header>

        <div className="search-dock">
          <form role="search" onSubmit={(event) => {
            event.preventDefault();
            const match = results[view.cursor] ?? results[0];
            if (match) { visitRef.current(match); search.current?.blur(); }
          }}>
            <span className="search-icon" aria-hidden="true">⌕</span>
            <input ref={search} type="search" aria-label="Search the universe" placeholder="Search the universe"
              value={view.query} onChange={(event) => filter({ query: event.target.value })} />
            <kbd aria-hidden="true">/</kbd>
          </form>
          <details className="filter-menu">
            <summary>Filters{view.genre || view.status ? " •" : ""}</summary>
            <div className="filters">
              <label>Availability<select value={view.status} onChange={(event) => filter({ status: event.target.value })}>
                <option value="">Any availability</option>
                <option>Owned</option><option>Monitored</option><option>Unmonitored</option><option>External discovery</option>
              </select></label>
              <label>Genre<select value={view.genre} onChange={(event) => filter({ genre: event.target.value })}>
                <option value="">Any genre</option>
                {model.genres.map((genre) => <option key={genre}>{genre}</option>)}
              </select></label>
            </div>
          </details>
        </div>

        <div className="flight-deck">
          {entity ? <section className="focus-card" aria-label="Selected media">
            <header>
              <div className="focus-title">
                <Artwork node={entity} />
                <div>
                  <small>{[entityKind(entity), entity.year, entity.availability].filter(Boolean).join(" · ")}</small>
                  <h2>{entity.name}</h2>
                  <button type="button" className="detail-toggle" aria-expanded={view.details}
                    onClick={() => setView({ ...view, details: !view.details })}>{view.details ? "Hide details −" : "Details +"}</button>
                </div>
              </div>
              <div className="browse-switch" role="group" aria-label="Browse around selection">
                <button type="button" aria-pressed={view.browse === "connections"} disabled={!connections.length}
                  onClick={() => setView({ ...view, browse: "connections", cursor: 0 })}>Connections</button>
                <button type="button" aria-pressed={view.browse === "nearby"} disabled={!nearby.length}
                  onClick={() => setView({ ...view, browse: "nearby", cursor: 0 })}>Nearby</button>
              </div>
            </header>
            {view.details && <div className="focus-details">
              {entity.seriesTitle && <p>{entity.seriesTitle} · S{entity.season} E{entity.episode}</p>}
              {entity.date && <p><time>{entity.date.slice(0, 10)}</time></p>}
              {entity.genres?.length ? <p>{entity.genres.join(" · ")}</p> : null}
              {entity.summary && <p>{entity.summary}</p>}
              {entity.externalIds && <small>{Object.entries(entity.externalIds).map(([provider, id]) => `${provider} ${id}`).join(" · ")}</small>}
            </div>}
            {view.browse === "connections" && seasons.length > 0 && <label className="season">Season
              <select value={view.season} onChange={(event) => setView({ ...view, season: event.target.value, cursor: 0 })}>
                <option value="">All seasons</option>
                {seasons.map((season) => <option key={season} value={season}>{season || "Specials"}</option>)}
              </select>
            </label>}
          </section> : region && <p className="region-name">{region.galaxy}</p>}

          {browsingMatches && !routes.length && <p className="region-name" role="status">No matches{region ? " in this galaxy" : ""}</p>}
          <Orbit routes={routes} cursor={view.cursor} browse={browsingMatches ? "matches" : entity ? view.browse : "nearby"}
            change={(cursor) => setView({ ...view, cursor })}
            visit={({ node, edge }) => visitRef.current(node, edge)} />
        </div>

        <footer className="flight-footer">
          <span>{revealed === null ? `${graph.nodes.length.toLocaleString()} entities · ${model.filaments.length.toLocaleString()} visible filaments`
            : `${revealed.toLocaleString()} filaments revealed`}</span>
          {!entity && !region && !browsingMatches && <span className="flight-help">Choose a galaxy or search <span>·</span> Drag to orbit</span>}
          {graph.mode === "catalogue" ? <a href="?demo=1">Demo</a> : new URLSearchParams(location.search).has("demo") && <a href="./">Catalogue</a>}
        </footer>
      </section>
    </main>
  );
}

function App() {
  const [graph, setGraph] = useState<MediaGraph>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const demo = new URLSearchParams(location.search).get("demo") === "1";
    fetch(demo ? "/api/graph?demo=true" : "/api/graph", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(setGraph)
      .catch((reason) => {
        if (!controller.signal.aborted) setError(`Could not load the catalogue (${reason.message}).`);
      });
    return () => controller.abort();
  }, []);
  if (!graph) return <main className="shell"><h1>Stellarr</h1><p role="status">{error || "Loading catalogue…"}</p></main>;
  return <Explorer graph={graph} />;
}

createRoot(document.getElementById("root")!).render(<App />);
