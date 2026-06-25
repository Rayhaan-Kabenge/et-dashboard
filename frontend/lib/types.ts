// Mirrors backend/app/schemas.py (StateResponse). All depths are millimetres.

export interface Site {
  name: string;
  season: number;
  latitude: number;
  longitude: number | null;
  elevation: number;
  planting_date: string;
  reference_crop: string;
  units_default: string;
  sheet_edit_url: string | null;
  demo_mode: boolean;
}

export interface DayWeather {
  tmax: number | null;
  tmin: number | null;
  rhmax: number | null;
  rhmin: number | null;
  u2: number | null;
  rs: number | null;
  precip: number | null;
}

export interface Freshness {
  last_actual_date: string | null;
  days_since: number | null;
  stale: boolean;
  forecast_through: string | null;
  forecast_source: string;
}

export interface TodayState {
  date: string;
  dap: number;
  stage: string;
  cumgdd: number | null;
  kcr: number | null;
  etr: number | null;
  etc: number | null;
  depletion: number | null;
  ad: number | null;
  should_irrigate: boolean;
  estimated: boolean;
  weather: DayWeather;
}

export interface Decision {
  should_irrigate_now: boolean;
  days_to_trigger: number | null;
  projected_trigger_date: string | null;
  recent_avg_etc: number | null;
  depletion: number | null;
  ad: number | null;
  headroom: number | null;
  estimated: boolean;
  recommendation: string;
}

export interface SeriesPoint {
  date: string;
  dap: number;
  stage: string;
  depletion: number | null;
  ad: number | null;
  etc: number | null;
  etr: number | null;
  kcr: number | null;
  applied: number;
  precip: number | null;
  tmax: number | null;
  tmin: number | null;
  kind: "observed" | "provisional" | "forecast";
  is_forecast: boolean;
}

export interface GrowthStage {
  stage: string;
  interval: number;
  dap: number;
  cumgdd: number | null;
  kcr: number | null;
  progress: number;
  season_progress: number;
  estimated: boolean;
}

export interface ScheduleEntry {
  date: string;
  type: string;
  applied: number;
  triggered: boolean;
  is_forecast: boolean;
}

export interface SeasonSummary {
  total_etc: number;
  total_applied_irrig: number;
  total_applied_fert: number;
  total_rainfall: number;
  effective_rainfall: number;
  irrigation_events: number;
  fertigation_events: number;
}

export interface Alert {
  level: "info" | "warning" | "critical";
  code: string;
  message: string;
}

export interface StateResponse {
  site: Site;
  freshness: Freshness;
  today: TodayState | null;
  decision: Decision | null;
  series: SeriesPoint[];
  growth_stage: GrowthStage | null;
  season_summary: SeasonSummary;
  schedule: ScheduleEntry[];
  alerts: Alert[];
  generated_at: string;
}
