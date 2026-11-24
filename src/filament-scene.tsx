// SPDX-License-Identifier: AGPL-3.0-only
// Adapted for Stellarr on 2026-11-24 from Fungai Exposure. See PROVENANCE.md.
import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { MediaNode, Filament } from "./graph";
import { replayCount } from "./replay";

function seed(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0) / 4294967296;
}

function scatter(id: string, radius: number) {
  const y = seed(id + ":height") * 2 - 1;
  const theta = seed(id + ":angle") * Math.PI * 2;
  const ring = Math.sqrt(1 - y * y);
  const depth = radius * (0.35 + 0.65 * Math.cbrt(seed(id + ":depth")));
  return new T.Vector3(Math.cos(theta) * ring, y * 0.65, Math.sin(theta) * ring).multiplyScalar(depth);
}

export function layout(edges: Filament[]) {
  const nodes = new Map<string, MediaNode>();
  const parents = new Map<string, MediaNode>();
  const firstCredit = new Map<string, MediaNode>();
  for (const { from, to, label } of edges) {
    nodes.set(from.id, from);
    nodes.set(to.id, to);
    if (label === "Episode of" || label === "Track on") parents.set(from.id, to);
    if (from.kind === "Person" && !firstCredit.has(from.id)) firstCredit.set(from.id, to);
  }
  const anchors: Record<string, T.Vector3> = {
    Movie: new T.Vector3(-22, 2, 4),
    Series: new T.Vector3(6, 5, -18),
    MusicAlbum: new T.Vector3(22, -4, 12),
    MusicArtist: new T.Vector3(19, 1, 17),
    Composer: new T.Vector3(21, -4, 5),
    Person: new T.Vector3(-8, 0, -3),
    Episode: new T.Vector3(9, 5, -19),
    Audio: new T.Vector3(22, -4, 12),
  };
  const place = (node: MediaNode) => scatter(node.id, node.kind === "Person" ? 24 : 13)
    .add(anchors[node.kind] ?? new T.Vector3());
  const positions = new Map<string, T.Vector3>();
  for (const [id, node] of nodes) {
    const parent = parents.get(id);
    const credit = firstCredit.get(id);
    if (parent) {
      positions.set(id, place(parent).add(scatter(id, 3.4)));
    } else if (credit) {
      const creditParent = parents.get(credit.id);
      const anchor = creditParent ? place(creditParent).add(scatter(credit.id, 3.4)) : place(credit);
      positions.set(id, anchor.add(scatter(id, 6.0)));
    } else {
      positions.set(id, place(node));
    }
  }
  return { positions, place };
}

const segments = 8;
const edgeStride = segments * 6;

function curvePoints(edge: Filament, a: T.Vector3, b: T.Vector3) {
  const mid = a.clone().lerp(b, 0.5);
  mid.y += a.distanceTo(b) * (0.06 + seed(edge.id) * 0.14);
  return new T.CatmullRomCurve3([a, mid, b]).getPoints(segments);
}
const ivory = new T.Color("#ffe8bb");
const gold = new T.Color("#c7a574");
const silver = new T.Color("#b5c8d6");

export type CameraPose = { position: T.Vector3; target: T.Vector3 };
export type SceneView = { pose: () => CameraPose };

export type EntityFocus = { center: T.Vector3; edges: Filament[]; distance?: number; entity?: MediaNode };
export type Landmark = {
  id: string;
  position: T.Vector3;
  name: string;
  caption?: string;
  range?: number;
  kind: "galaxy" | "title" | "focus";
  select?: () => void;
};

export function FilamentScene({ filaments, ordered, selected, geometryLayout, landmarks, entityFocus, cameraRequest, restoredPose, sceneView, matches, onSelect, onReveal, isolated, onSelectNode }: {
  filaments: Filament[];
  ordered: Filament[];
  selected?: string;
  geometryLayout: ReturnType<typeof layout>;
  landmarks: Landmark[];
  entityFocus?: EntityFocus;
  cameraRequest: number;
  restoredPose?: CameraPose;
  sceneView: React.RefObject<SceneView | null>;
  matches: ReadonlySet<string> | null;
  onSelect: (id: string) => void;
  isolated: MediaNode[];
  onSelectNode: (node: MediaNode) => void;
  onReveal: (count: number | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const pins = useRef<HTMLDivElement>(null);
  const updatePins = useRef(() => {});
  const [hovered, setHovered] = useState<{ x: number; y: number; text: string }>();
  useEffect(() => { updatePins.current(); }, [landmarks]);
  const active = useRef<(id?: string) => void>(() => {});
  const selection = useRef(selected);
  const matchRequest = useRef(matches);
  const illuminate = useRef<(ids: ReadonlySet<string> | null) => void>(() => {});
  useEffect(() => {
    matchRequest.current = matches;
    illuminate.current(matches);
  }, [matches]);
  const focusRequest = useRef(entityFocus);
  const moveFocus = useRef<(request?: EntityFocus, pose?: CameraPose) => void>(() => {});
  const playback = useRef<{ replay: () => void; toggle: () => void; now: () => void }>(null);
  const [mode, setMode] = useState<"now" | "playing" | "paused">("now");
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => { selection.current = selected; active.current(selected); }, [selected]);
  useEffect(() => {
    focusRequest.current = entityFocus;
    moveFocus.current(entityFocus, restoredPose);
  }, [entityFocus, cameraRequest, restoredPose]);

  useEffect(() => {
    const mount = host.current;
    if (!mount || !(filaments.length || isolated.length)) return;
    let renderer: T.WebGLRenderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      setUnavailable(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    const canvas = renderer.domElement;
    canvas.setAttribute("aria-label", "3D media filaments");
    canvas.setAttribute("role", "img");
    mount.appendChild(canvas);

    const { positions, place } = geometryLayout;
    // Render unlinked catalogue entries as points with the existing placement and palette.
    const starCoordinates = new Float32Array(isolated.length * 3);
    isolated.forEach((node, index) => {
      const point = place(node);
      point.toArray(starCoordinates, index * 3);
    });
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(42, 1, 0.2, 550);
    const bounds = new T.Box3().setFromPoints([...positions.values(), ...isolated.map(place)]).getBoundingSphere(new T.Sphere());
    const controls = new OrbitControls(camera, canvas);
    controls.target.copy(bounds.center);
    camera.position.copy(bounds.center).add(new T.Vector3(0.22, 0.46, 1).normalize().multiplyScalar(Math.max(bounds.radius, 9) * 2.66));
    controls.minDistance = 4;
    controls.maxDistance = Math.max(bounds.radius, 9) * 9;
    controls.update();
    const pose = () => ({ position: camera.position.clone(), target: controls.target.clone() });
    const home = pose();
    sceneView.current = { pose };

    const coords = new Float32Array(ordered.length * edgeStride);
    const colors = new Float32Array(ordered.length * segments * 8);
    const opacityByEdge = new Float32Array(ordered.length);
    let cursor = 0, colorCursor = 0;
    const edgeOffsets = new Map<string, number>();
    for (const edge of ordered) {
      edgeOffsets.set(edge.id, cursor);
      const a = positions.get(edge.from.id)!;
      const b = positions.get(edge.to.id)!;
      const points = curvePoints(edge, a, b);
      const color = seed(edge.id + ":color") < 0.15 ? silver : seed(edge.id) < 0.43 ? gold : ivory;
      const alpha = filaments.length <= 300 ? 0.48 : edge.from.kind === "Person" ? 0.033 : 0.115;
      opacityByEdge[cursor / edgeStride] = alpha;
      for (let i = 1; i < points.length; i++) {
        points[i - 1].toArray(coords, cursor);
        points[i].toArray(coords, cursor + 3);
        cursor += 6;
        colors.set([color.r, color.g, color.b, alpha, color.r, color.g, color.b, alpha], colorCursor);
        colorCursor += 8;
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(coords, 3));
    geometry.setAttribute("color", new T.BufferAttribute(colors, 4));
    const material = new T.LineBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false,
    });
    const network = new T.LineSegments(geometry, material);
    scene.add(network);
    const starGeometry = new T.BufferGeometry();
    starGeometry.setAttribute("position", new T.BufferAttribute(starCoordinates, 3));
    const starColors = new Float32Array(isolated.length * 3);
    starGeometry.setAttribute("color", new T.BufferAttribute(starColors, 3));
    const starMaterial = new T.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true });
    const stars = new T.Points(starGeometry, starMaterial);
    scene.add(stars);
    const focusGeometry = new T.BufferGeometry();
    const focusPoints = new T.Float32BufferAttribute(new Float32Array(segments * 6), 3);
    focusGeometry.setAttribute("position", focusPoints);
    const focusMaterial = new T.LineBasicMaterial({ color: "#ffecc9", transparent: true, opacity: 0.95 });
    const focus = new T.LineSegments(focusGeometry, focusMaterial);
    focus.frustumCulled = false;
    focus.visible = false;
    focus.renderOrder = 2;
    scene.add(focus);
    let neighborGeometry = new T.BufferGeometry();
    const neighborMaterial = new T.LineBasicMaterial({ color: "#d5be99", transparent: true, opacity: 0.48, depthWrite: false });
    const neighborhood = new T.LineSegments(neighborGeometry, neighborMaterial);
    neighborhood.frustumCulled = false;
    neighborhood.renderOrder = 1;
    neighborhood.visible = false;
    scene.add(neighborhood);

    const markerGeometry = new T.BufferGeometry();
    const markerPoint = new T.BufferAttribute(new Float32Array(3), 3);
    markerGeometry.setAttribute("position", markerPoint);
    const markerMaterial = new T.PointsMaterial({ color: "#fff0ce", size: 7, sizeAttenuation: false, depthTest: false });
    const marker = new T.Points(markerGeometry, markerMaterial);
    marker.frustumCulled = false;
    marker.visible = false;
    marker.renderOrder = 3;
    scene.add(marker);
    let localEdges: Filament[] = [];
    let localCoords = new Float32Array(0);
    let localVisible: Filament[] = [];

    let frame = 0;
    let firstDraw = true;
    let sized = false;
    let visible = ordered.length;
    const projected = new T.Vector3();
    const updateLandmarks = () => {
      const occupied: { x: number; y: number; width: number }[] = [];
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      for (const element of pins.current?.children ?? []) {
        const pin = element as HTMLElement;
        const world = pin.dataset.world!.split(",").map(Number);
        projected.fromArray(world);
        const withinRange = !pin.dataset.range || projected.distanceToSquared(camera.position) <= Number(pin.dataset.range) ** 2;
        projected.project(camera);
        const x = width * (0.5 + projected.x / 2);
        const y = height * (0.5 - projected.y / 2);
        const half = pin.dataset.kind === "galaxy" ? 77 : 73;
        const shown = withinRange && projected.z >= -1 && projected.z <= 1 &&
          x > half && x < width - half && y > (width < 621 ? 140 : 95) && y < height - 54 &&
          !occupied.some((other) => Math.abs(other.y - y) < 38 && Math.abs(other.x - x) < other.width + half);
        pin.style.visibility = shown ? "visible" : "hidden";
        if (!shown) continue;
        occupied.push({ x, y, width: half });
        pin.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      }
    };
    updatePins.current = () => { camera.updateMatrixWorld(); updateLandmarks(); };
    const draw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        renderer.render(scene, camera);
        updateLandmarks();
        if (firstDraw && sized) {
          performance.mark("stellarr:first-scene-frame");
          firstDraw = false;
        }
      });
    };
    const resize = new ResizeObserver(() => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.zoom = Math.min(1, camera.aspect * 1.18);
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      sized = true;
      draw();
    });
    resize.observe(mount);
    illuminate.current = (ids) => {
      ordered.forEach((edge, index) => {
        const relevant = !ids || ids.has(edge.from.id) || ids.has(edge.to.id);
        const alpha = opacityByEdge[index] * (relevant ? (ids ? 1.8 : 1) : 0.12);
        const end = (index + 1) * segments * 8;
        for (let i = index * segments * 8 + 3; i < end; i += 4) colors[i] = alpha;
      });
      isolated.forEach((node, index) => {
        const brightness = ids ? (ids.has(node.id) ? 1 : 0.08) : 0.42;
        starColors.set([ivory.r * brightness, ivory.g * brightness, ivory.b * brightness], index * 3);
      });
      starGeometry.getAttribute("color").needsUpdate = true;
      geometry.getAttribute("color").needsUpdate = true;
      draw();
    };
    illuminate.current(matchRequest.current);
    controls.addEventListener("change", draw);
    active.current = (id) => {
      const offset = id ? edgeOffsets.get(id) : undefined;
      const local = id ? localVisible.findIndex((edge) => edge.id === id) : -1;
      focus.visible = local >= 0 || (offset !== undefined && offset / edgeStride < visible);
      if (focus.visible) {
        const points = local >= 0 ? neighborGeometry.getAttribute("position").array : coords;
        const start = local >= 0 ? local * edgeStride : offset!;
        focusPoints.array.set(points.subarray(start, start + edgeStride));
        focusPoints.needsUpdate = true;
      }
      draw();
    };

    const showNeighbors = () => {
      const attribute = neighborGeometry.getAttribute("position");
      localVisible = [];
      if (attribute) {
        for (const [index, edge] of localEdges.entries()) {
          const offset = edgeOffsets.get(edge.id);
          if (visible < ordered.length && (offset === undefined || offset / edgeStride >= visible)) continue;
          attribute.array.set(localCoords.subarray(index * edgeStride, (index + 1) * edgeStride), localVisible.length * edgeStride);
          localVisible.push(edge);
        }
        attribute.needsUpdate = true;
        neighborGeometry.boundingSphere = null;
        neighborGeometry.setDrawRange(0, localVisible.length * segments * 2);
      }
      neighborhood.visible = localVisible.length > 0;
      marker.visible = Boolean(focusRequest.current?.entity) && visible === ordered.length;
      active.current(selection.current);
    };
    active.current(selection.current);

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let cameraFrame = 0;
    const stopCamera = () => cancelAnimationFrame(cameraFrame);
    controls.addEventListener("start", stopCamera);
    const position = (node: MediaNode) => positions.get(node.id) ?? place(node);
    moveFocus.current = (request, restored) => {
      stopCamera();
      localEdges = request?.edges ?? [];
      localCoords = new Float32Array(localEdges.length * edgeStride);
      neighborGeometry.dispose();
      neighborGeometry = new T.BufferGeometry();
      neighborhood.geometry = neighborGeometry;
      neighborGeometry.setAttribute("position", new T.BufferAttribute(new Float32Array(localCoords.length), 3));
      for (const [index, edge] of localEdges.entries()) {
        const offset = edgeOffsets.get(edge.id);
        if (offset !== undefined) {
          localCoords.set(coords.subarray(offset, offset + edgeStride), index * edgeStride);
          continue;
        }
        const points = curvePoints(edge, position(edge.from), position(edge.to));
        for (let i = 1; i < points.length; i++) {
          const start = index * edgeStride + (i - 1) * 6;
          points[i - 1].toArray(localCoords, start);
          points[i].toArray(localCoords, start + 3);
        }
      }
      const center = request?.center;
      setHovered(undefined);
      if (center) {
        center.toArray(markerPoint.array);
        markerPoint.needsUpdate = true;
      }
      material.opacity = request?.entity ? 0.40 : 1;
      showNeighbors();

      const target = restored?.target ?? center ?? home.target;
      let destination = restored?.position ?? home.position;
      if (!restored && center && request) {
        let radius = 0;
        for (const edge of request.edges) {
          const neighbor = position(edge.from.id === request.entity?.id ? edge.to : edge.from);
          radius = Math.max(radius, center.distanceTo(neighbor));
        }
        const distance = request.distance ?? T.MathUtils.clamp(radius + 8, 12, home.position.distanceTo(home.target) * 0.56);
        destination = camera.position.clone().sub(controls.target).normalize().multiplyScalar(distance).add(center);
      }
      if (motion.matches) {
        camera.position.copy(destination);
        controls.target.copy(target);
        controls.update();
        draw();
        return;
      }
      const start = performance.now();
      const from = camera.position.clone();
      const fromTarget = controls.target.clone();
      const step = (time: number) => {
        const t = Math.min(1, Math.max(0, (time - start) / 520));
        const ease = t * t * (3 - 2 * t);
        camera.position.lerpVectors(from, destination, ease);
        controls.target.lerpVectors(fromTarget, target, ease);
        controls.update();
        draw();
        if (t < 1) cameraFrame = requestAnimationFrame(step);
      };
      cameraFrame = requestAnimationFrame(step);
    };
    if (focusRequest.current) moveFocus.current(focusRequest.current);

    let animation = 0;
    let startedAt = 0;
    let elapsed = 0;
    let lastNotice = 0;
    let state: "now" | "playing" | "paused" = "now";
    const changeMode = (next: typeof state) => {
      state = next;
      setMode(next);
    };
    const reveal = (count: number) => {
      if (count === visible) return;
      visible = count;
      geometry.setDrawRange(0, visible * segments * 2);
      showNeighbors();
    };
    const now = () => {
      cancelAnimationFrame(animation);
      reveal(ordered.length);
      changeMode("now");
      onReveal(null);
    };
    const tick = (time: number) => {
      elapsed = time - startedAt;
      const count = replayCount(ordered.length, elapsed, motion.matches);
      if (count === ordered.length) {
        now();
        return;
      }
      reveal(count);
      // Keep React list updates off the frame-by-frame render path.
      if (time - lastNotice >= 120) {
        onReveal(count);
        lastNotice = time;
      }
      animation = requestAnimationFrame(tick);
    };
    const play = () => {
      startedAt = performance.now() - elapsed;
      changeMode("playing");
      animation = requestAnimationFrame(tick);
    };
    playback.current = {
      replay: () => {
        cancelAnimationFrame(animation);
        elapsed = 0;
        lastNotice = performance.now();
        reveal(0);
        onReveal(0);
        play();
      },
      toggle: () => {
        if (state === "playing") {
          cancelAnimationFrame(animation);
          changeMode("paused");
          onReveal(visible);
        } else if (state === "paused") {
          play();
        }
      },
      now,
    };
    const motionChanged = () => {
      if (state !== "now") now();
    };
    motion.addEventListener("change", motionChanged);

    const ray = new T.Raycaster();
    const pointer = new T.Vector2();
    let down: [number, number] | undefined;
    let moved = false;
    let lastHover = 0;
    let hoveredEdge: string | undefined;
    const clearHover = () => {
      if (!hoveredEdge) return;
      hoveredEdge = undefined;
      setHovered(undefined);
      canvas.style.cursor = "";
      active.current(selection.current);
    };
    const start = (event: PointerEvent) => {
      if (down) moved = true;
      else { down = [event.clientX, event.clientY]; moved = false; }
      clearHover();
    };
    const setRay = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      ray.params.Line!.threshold = Math.max(0.12, camera.position.distanceTo(controls.target) / Math.max(rect.height, 1) * 8);
      ray.setFromCamera(pointer.set(2 * (event.clientX - rect.left) / rect.width - 1,
        1 - 2 * (event.clientY - rect.top) / rect.height), camera);
      return rect;
    };
    const localEdge = () => {
      const hit = neighborhood.visible ? ray.intersectObject(neighborhood)[0] : undefined;
      return hit?.index === undefined ? undefined : localVisible[Math.floor(hit.index / (segments * 2))];
    };
    const move = (event: PointerEvent) => {
      if (down && Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 7) moved = true;
      if (down || event.pointerType !== "mouse" || !localVisible.length || performance.now() - lastHover < 55) return;
      lastHover = performance.now();
      const rect = setRay(event);
      const edge = localEdge();
      if (!edge) { clearHover(); return; }
      const origin = focusRequest.current?.entity?.id;
      const next = edge.from.id === origin ? edge.to : edge.from;
      canvas.style.cursor = "pointer";
      if (hoveredEdge !== edge.id) {
        hoveredEdge = edge.id;
        active.current(edge.id);
      }
      setHovered({ x: Math.min(event.clientX - rect.left + 12, rect.width - 165),
        y: event.clientY - rect.top - 34, text: `${edge.label} · ${next.name}` });
    };
    const cancelPick = () => { down = undefined; clearHover(); };
    const pick = (event: PointerEvent) => {
      const origin = down;
      down = undefined;
      if ((!visible && !isolated.length) || !origin || moved || event.button !== 0 ||
        Math.hypot(event.clientX - origin[0], event.clientY - origin[1]) > 10) return;
      setRay(event);
      const edge = localEdge();
      if (edge) { onSelect(edge.id); return; }
      if (isolated.length) {
        ray.params.Points!.threshold = ray.params.Line!.threshold;
        const star = ray.intersectObject(stars)[0];
        if (star?.index !== undefined) { onSelectNode(isolated[star.index]); return; }
      }
      const hit = ray.intersectObject(network)[0];
      const index = hit?.index === undefined ? -1 : Math.floor(hit.index / (segments * 2));
      if (index >= 0 && index < visible) onSelect(ordered[index].id);
    };
    const lost = () => {
      now();
      setUnavailable(true);
    };
    canvas.addEventListener("pointerdown", start);
    canvas.addEventListener("pointerup", pick);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerleave", clearHover);
    canvas.addEventListener("pointercancel", cancelPick);
    canvas.addEventListener("webglcontextlost", lost);
    return () => {
      sceneView.current = null;
      updatePins.current = () => {};
      active.current = () => {};
      illuminate.current = () => {};
      moveFocus.current = () => {};
      stopCamera();
      controls.removeEventListener("start", stopCamera);
      playback.current = null;
      motion.removeEventListener("change", motionChanged);
      cancelAnimationFrame(animation);
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      canvas.removeEventListener("pointerdown", start);
      canvas.removeEventListener("pointerup", pick);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", clearHover);
      canvas.removeEventListener("pointercancel", cancelPick);
      canvas.removeEventListener("webglcontextlost", lost);
      geometry.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
      material.dispose();
      focusGeometry.dispose();
      focusMaterial.dispose();
      neighborGeometry.dispose();
      neighborMaterial.dispose();
      markerGeometry.dispose();
      markerMaterial.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, [filaments, geometryLayout, ordered, onSelect, onReveal, sceneView, isolated, onSelectNode]);

  return (
    <div className="filament-scene">
      <div ref={host} className="absolute inset-0" />
      {!unavailable && <div ref={pins} className="landmarks">
        {landmarks.map(({ id, position, name, caption, kind, range, select }) => {
          const props = { className: "landmark", "data-world": position.toArray().join(","), "data-kind": kind, "data-range": range };
          return select ? <button key={id} {...props} type="button" onClick={select}>
            <span>{name}</span>{caption && <small>{caption}</small>}
          </button> : <div key={id} {...props}><span>{name}</span>{caption && <small>{caption}</small>}</div>;
        })}
      </div>}
      {hovered && <div className="filament-hint" style={{ left: hovered.x, top: hovered.y }}>{hovered.text}</div>}
      {!unavailable && ordered.length > 0 && <div role="group" aria-label="Filament replay" className="replay">
        <button type="button" onClick={() => playback.current?.replay()}>Replay</button>
        {mode !== "now" && <>
          <button type="button" onClick={() => playback.current?.toggle()}>{mode === "paused" ? "Resume" : "Pause"}</button>
          <button type="button" onClick={() => playback.current?.now()}>Now</button>
        </>}
      </div>}
      {unavailable && <p className="scene-message">3D is unavailable. Search and artwork browsing are still available.</p>}
    </div>
  );
}
