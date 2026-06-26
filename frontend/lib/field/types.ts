// Field Health types (mirror backend/app/field/schemas.py). Isolated from the
// irrigation types.

export interface GeoPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface Field {
  id: string;
  name: string;
  geometry: GeoPolygon;
  centroid: [number, number]; // [lon, lat]
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  area_acres: number;
  crop?: string | null;
  created_at: string;
}

export interface IndexPoint {
  date: string;
  mean: number;
  stdev: number;
  valid_fraction: number;
}

export interface IndexSeries {
  field_id: string;
  index: string; // "NDRE" | "NDVI"
  start: string;
  end: string;
  points: IndexPoint[];
  last_observation: string | null;
  note?: string | null;
}

export interface ETPoint {
  date: string;
  mm: number;
}

export interface ETResponse {
  et_actual: ETPoint[];
  etr_gridmet: ETPoint[];
  provisional_from: string | null;
  coverage: "ok" | "out_of_area";
  note?: string | null;
}

export interface FieldImage {
  field_id: string;
  index: string;
  date: string | null;
  png_base64: string | null;
  bbox: number[] | null;
  note?: string | null;
}
