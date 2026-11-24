import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { entityKind, indexGraph, otherEnd, prepareSearch, searchEntities } from "./exploration";
import { FilamentScene, type CameraPose, type SceneView } from "./filament-scene";
import type { Filament, MediaGraph, MediaNode } from "./graph";
import { replayOrder } from "./replay";
import "./style.css";

const galaxies = ["Movies", "Television", "Music"];
const overviewLimit = 14_000;
const focusLimit = 12;

type View = { entity?: string; edge?: string; query: string; galaxy: string; status: string; match: number };
const homeView: View = { query: "", galaxy: "", status: "", match: 0 };

function Explorer({ graph }: { graph: MediaGraph }) {
  const model = useMemo(() => {
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const edges = graph.links.map((edge) => ({
      ...edge, from: nodes.get(edge.from)!, to: nodes.get(edge.to)!,
    }));
    const index = indexGraph(edges, graph.nodes);
    const filaments = edges.slice(0, overviewLimit);
    return { index, filaments, ordered: replayOrder(filaments), search: prepareSearch(index.entities.values()) };
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

  const filtering = Boolean(view.query.trim() || view.galaxy || view.status);
  const results = useMemo(() => filtering
    ? searchEntities(model.search, view.query, view.galaxy, view.status) : [],
  [model, filtering, view.query, view.galaxy, view.status]);
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
        <p>Synthetic catalogue <span>·</span> {graph.nodes.length.toLocaleString()} entities <span>·</span> {graph.links.length.toLocaleString()} filaments</p>
      </header>

      <div className="toolbar">
        <nav aria-label="Exploration history">
          <button onClick={back} disabled={!history.length}>← Back</button>
          <button onClick={home}>Home</button>
        </nav>
        <nav aria-label="Galaxies" className="galaxies">
          {["All galaxies", ...galaxies].map((label, i) => {
            const galaxy = i ? label : "";
            return <button key={label} aria-pressed={view.galaxy === galaxy} onClick={() => filter({ galaxy })}>{label}</button>;
          })}
        </nav>
      </div>

      <div className="cockpit">
        <section className="universe" aria-label="Media universe">
          <FilamentScene filaments={model.filaments} ordered={model.ordered} selected={view.edge}
            entityFocus={focus} cameraRequest={camera.revision} restoredPose={camera.pose} sceneView={sceneView}
            matches={matches} onSelect={selectEdge} onReveal={setRevealed} />
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
              <option>Owned</option><option>Monitored</option><option>External discovery</option>
            </select>
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
            {focus.entity.availability && <p className="availability">{focus.entity.availability}</p>}
            {focus.entity.summary && <p className="summary">{focus.entity.summary}</p>}
            <h3>Connections</h3>
            {focus.edges.length ? <ul>{focus.edges.map((edge) => {
              const next = otherEnd(edge, focus.entity.id);
              return <li key={edge.id}>
                <button aria-current={view.edge === edge.id ? "true" : undefined} onClick={() => visit(next, edge)}>
                  <span>{next.name}</span><small>{edge.label} · {entityKind(next)}</small>
                </button>
              </li>;
            })}</ul> : <p className="meta">No catalogue connections</p>}
          </section> : <section className="selection">
            <h2>Starting points</h2>
            <ul>{["film-0", "series-0", "album-0"].map((id) => {
              const start = model.index.entities.get(id);
              return start && <li key={id}><button onClick={() => visit(start)}>
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
    fetch("/api/graph", { signal: controller.signal })
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
