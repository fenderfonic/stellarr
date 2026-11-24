# Delivery sequence

1. **Faithful extraction** — Port the pinned Three.js scene, entity navigation and reveal animation. Use a synthetic movie, TV and music graph. Verify standalone build and run, visual parity, search, selection, focus, Back and Home. Capture screenshots and a short recording where practical. Commit and stop.
2. **Real media** — Verify native API contracts, implement read-only Radarr and Sonarr adapters and optional Lidarr, and normalise and refresh SQLite data idempotently. Verify full catalogue search, filters, metadata and artwork, and disconnected sources. Use representative API fixtures if credentials are unavailable and record live validation as outstanding.
3. **Rich exploration** — Use actual catalogue characteristics to refine deterministic filters, contextual artwork, ephemeral illumination, cross-galaxy navigation and supported native lookups. Validate roughly 60,000 entities and 150,000 relationships with bounded drawing.
4. **Packaging and polish** — Ship one Docker container with persistent data and local configuration. Validate touch and performance, and prepare the project for eventual open-source release.
