export type Galaxy = "Movies" | "Television" | "Music";
export type Availability = "Owned" | "Monitored" | "Unmonitored" | "External discovery";
export type MediaNode = {
  id: string;
  name: string;
  kind: "Movie" | "Series" | "Episode" | "Person" | "MusicAlbum" | "Audio" | "MusicArtist" | "Collection";
  galaxy?: Galaxy;
  availability?: Availability;
  year?: number;
  summary?: string;
  date?: string;
  genres?: string[];
  artwork?: string;
  externalIds?: Record<string, string | number>;
  seriesTitle?: string;
  season?: number;
  episode?: number;
};

export type Filament = { id: string; from: MediaNode; to: MediaNode; label: string; details?: string[] };
export type MediaGraph = {
  mode: "demo" | "catalogue";
  sources?: string[];
  nodes: MediaNode[];
  links: { id: string; from: string; to: string; label: string; details?: string[] }[];
};
