export type Galaxy = "Movies" | "Television" | "Music";
export type Availability = "Owned" | "Monitored" | "External discovery";
export type MediaNode = {
  id: string;
  name: string;
  kind: "Movie" | "Series" | "Episode" | "Person" | "MusicAlbum" | "Audio" | "MusicArtist";
  galaxy?: Galaxy;
  availability?: Availability;
  year?: number;
  summary?: string;
};

export type Filament = { id: string; from: MediaNode; to: MediaNode; label: string };
export type MediaGraph = {
  nodes: MediaNode[];
  links: { id: string; from: string; to: string; label: string }[];
};
