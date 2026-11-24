import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { entityKind, indexGraph, otherEnd, prepareSearch, searchEntities } from "./exploration";
import { FilamentScene, type CameraPose, type SceneView } from "./filament-scene";
import type { Filament, Galaxy, MediaGraph, MediaNode } from "./graph";
import { replayOrder } from "./replay";
import "./style.css";

const galaxies: Galaxy[] = ["Movies", "Television", "Music"];
const overviewLimit = 14_000;
const focusLimit = 12;

type View = { entity?: string; edge?: string; query: string; galaxy: string; status: string; genre: string; match: number };
const homeView: View = { query: "", galaxy: "", status: "", genre: "", match: 0 };

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
    const availableGalaxies = new Set(graph.nodes.map((node) => node.galaxy));
    const genres = [...new Set(graph.nodes.flatMap((node) => node.genres ?? []))].sort();
    const starts = graph.mode === "demo" ? ["film-0", "series-0", "album-0"].map((id) => nodes.get(id)!)
      : galaxies.flatMap((galaxy) => {
        const candidate = graph.nodes.find((node) => node.galaxy === galaxy &&
          ["Movie", "Series", "MusicAlbum"].includes(node.kind) && index.neighbors.has(node.id))
          ?? graph.nodes.find((node) => node.galaxy === galaxy);
        return candidate ? [candidate] : [];
      });
    return { index, filaments, isolated, availableGalaxies, genres, starts,
      ordered: replayOrder(filaments), search: prepareSearch(index.entities.values()) };
  }, [graph]);

  const [view, setView] = useState<View>(homeView);
  const [history, setHistory] = useState<{ view: View; pose?: CameraPose }[]>([]);
  const [camera, setCamera] = useState<{ revision: number; pose?: CameraPose }>({ revision: 0 });
  const [revealed, setRevealed] = useState<number | null>(null);
  const sceneView = useRef<SceneView>(null);

  const entity = model.index.entities.get(view.entity ?? "");
  const focus = useMemo(() => {
    if (!entity) return undefined;
    const edges = (model.index.neighbors.get(entity.id) ?? []).slice(0, focusLimit);
    const selected = model.index.edges.get(view.edge ?? "");
    if (selected && !edges.includes(selected)) edges.unshift(selected);
    return { entity, edges };
  }, [model, entity, view.edge]);

  const filtering = Boolean(view.query.trim() || view.galaxy || view.status || view.genre);
  const results = useMemo(() => filtering
    ? searchEntities(model.search, view.query, view.galaxy, view.status, view.genre) : [],
  [model, filtering, view.query, view.galaxy, view.status, view.genre]);
  const matches = useMemo(() => filtering ? new Set(results.map((node) => node.id)) : null, [filtering, results]);
  const result = results[view.match];

  const visit = useCallback((next: MediaNode, edge?: Filament, match?: number) => {
    const pose = sceneView.current?.pose();
    setHistory((previous) => [...previous, { view, pose }]);
    setView({ ...view, entity: next.id, edge: edge?.id, match: match ?? view.match });
    setCamera(({ revision }) => ({ revision: revision + 1 }));
  }, [view]);
  // Pointer selection must remain stable across view changes to keep the WebGL scene mounted.
  const visitRef = useRef(visit);
  useEffect(() => { visitRef.current = visit; }, [visit]);
  const selectEdge = useCallback((id: string) => {
    const edge = model.index.edges.get(id);
    if (edge) visitRef.current(edge.from.kind === "Person" ? edge.to : edge.from, edge);
  }, [model]);

  const selectNode = useCallback((node: MediaNode) => visitRef.current(node), []);

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
    setView((current) => ({ ...current, ...patch, match: 0 }));
  }

  return (
    <main className="shell">
      <header className="masthead">
        <h1>Stellarr</h1>
        <p>{graph.mode === "demo" ? "Synthetic catalogue" :
          (graph.sources ?? []).map((source) => source === "radarr" ? "Radarr" : "Sonarr").join(" + ") || "Catalogue"} <span>·</span> {graph.nodes.length.toLocaleString()} entities <span>·</span> {graph.links.length.toLocaleString()} filaments</p>
      </header>

      <div className="toolbar">
        <nav aria-label="Exploration history">
          <button onClick={back} disabled={!history.length}>← Back</button>
          <button onClick={home}>Home</button>
          {graph.mode === "catalogue" && <a className="mode-link" href="?demo=1">Demo</a>}
          {graph.mode === "demo" && new URLSearchParams(location.search).has("demo") &&
            <a className="mode-link" href="./">Catalogue</a>}
        </nav>
        <nav aria-label="Galaxies" className="galaxies">
          {["All galaxies", ...galaxies.filter((galaxy) => model.availableGalaxies.has(galaxy))].map((label, i) => {
            const galaxy = i ? label : "";
            return <button key={label} aria-pressed={view.galaxy === galaxy} onClick={() => filter({ galaxy })}>{label}</button>;
          })}
        </nav>
      </div>

      <div className="cockpit">
        <section className="universe" aria-label="Media universe">
          {graph.nodes.length > 0 ? <FilamentScene filaments={model.filaments} ordered={model.ordered} selected={view.edge}
            entityFocus={focus} cameraRequest={camera.revision} restoredPose={camera.pose} sceneView={sceneView}
            matches={matches} onSelect={selectEdge} onReveal={setRevealed}
            isolated={model.isolated} onSelectNode={selectNode} /> :
            <p className="empty-scene">No media in the local catalogue. Test and synchronise a source, or open Demo.</p>}
          <div className="map-caption">
            <span>{revealed === null ? model.filaments.length.toLocaleString() : revealed.toLocaleString()} visible overview filaments</span>
            <span>{entity ? entity.name : "Universe overview"}</span>
          </div>
        </section>

        <aside className="panel" aria-label="Catalogue and selection">
          <form onSubmit={(event) => { event.preventDefault(); if (result) visit(result); }}>
            <label htmlFor="search">Find media</label>
            <input id="search" type="search" placeholder="Title, person or media type" value={view.query}
              onChange={(event) => filter({ query: event.target.value })} />
            <label htmlFor="availability">Availability</label>
            <select id="availability" value={view.status} onChange={(event) => filter({ status: event.target.value })}>
              <option value="">Any availability</option>
              <option>Owned</option><option>Monitored</option><option>Unmonitored</option><option>External discovery</option>
            </select>
            {model.genres.length > 0 && <div className="genre-filter">
              <label htmlFor="genre">Genre</label>
              <select id="genre" value={view.genre} onChange={(event) => filter({ genre: event.target.value })}>
                <option value="">Any genre</option>
                {model.genres.map((genre) => <option key={genre}>{genre}</option>)}
              </select>
            </div>}
            {filtering && <div className="matches">
              <p role="status">{results.length ? `${view.match + 1} of ${results.length.toLocaleString()} matches` : "No matches"}</p>
              {result && <div className="match-controls">
                <button type="button" aria-label="Previous match" disabled={view.match === 0}
                  onClick={() => visit(results[view.match - 1], undefined, view.match - 1)}>‹</button>
                <button type="submit" className="match-title">{result.name}</button>
                <button type="button" aria-label="Next match" disabled={view.match + 1 === results.length}
                  onClick={() => visit(results[view.match + 1], undefined, view.match + 1)}>›</button>
              </div>}
            </div>}
          </form>

          {focus ? <section className="selection" aria-label="Selected media">
            <p className="meta">{[entityKind(focus.entity), focus.entity.galaxy, focus.entity.year].filter(Boolean).join(" · ")}</p>
            <h2>{focus.entity.name}</h2>
            {focus.entity.artwork && <img className="media-artwork" key={focus.entity.artwork}
              src={focus.entity.artwork} alt={`Artwork for ${focus.entity.name}`}
              referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; }} />}
            {focus.entity.seriesTitle && <p className="meta">{focus.entity.seriesTitle} · S{focus.entity.season} E{focus.entity.episode}</p>}
            {focus.entity.date && <p className="meta"><time>{focus.entity.date.slice(0, 10)}</time></p>}
            {Boolean(focus.entity.genres?.length) && <p className="meta">{focus.entity.genres?.join(" · ")}</p>}
            {focus.entity.externalIds && <p className="meta">{Object.entries(focus.entity.externalIds)
              .map(([provider, id]) => `${provider} ${id}`).join(" · ")}</p>}
            {focus.entity.availability && <p className="availability">{focus.entity.availability}</p>}
            {focus.entity.summary && <p className="summary">{focus.entity.summary}</p>}
            <h3>Connections</h3>
            {focus.edges.length ? <ul>{focus.edges.map((edge) => {
              const next = otherEnd(edge, focus.entity.id);
              return <li key={edge.id}>
                <button aria-current={view.edge === edge.id ? "true" : undefined} onClick={() => visit(next, edge)}>
                  <span>{next.name}</span><small>{edge.label} · {entityKind(next)}{edge.details?.length ? ` · ${edge.details.join(", ")}` : ""}</small>
                </button>
              </li>;
            })}</ul> : <p className="meta">No catalogue connections</p>}
          </section> : model.starts.length > 0 && <section className="selection">
            <h2>Starting points</h2>
            <ul>{model.starts.map((start) => {
              return <li key={start.id}><button onClick={() => visit(start)}>
                <span>{start.name}</span><small>{start.galaxy}</small>
              </button></li>;
            })}</ul>
          </section>}
        </aside>
      </div>
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
