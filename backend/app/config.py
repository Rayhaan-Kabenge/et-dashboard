"""Environment-driven configuration for the ET dashboard backend.

All knobs are env vars (a local `.env` is loaded automatically). Nothing here
touches the science engine; this only controls I/O, caching, and the data source.
"""
from functools import lru_cache
from typing import Optional

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# The build's target sheet (shared "Anyone with link → Viewer"). Overridable via
# the SHEET_ID env var; set SHEET_ID=demo to use the bundled sample season.
DEFAULT_SHEET_ID = "1USpOtSe83zCZdXUz19MnhOvIxZDpZI-8ak20AIEX320"
_DEMO_TOKENS = {"", "demo", "none", "sample", "off"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # ---- Google Sheet source -------------------------------------------------
    sheet_id: Optional[str] = DEFAULT_SHEET_ID
    # Optional explicit override of the per-tab CSV base; must contain "{sheet}".
    sheet_csv_base: Optional[str] = None

    # ---- Site location for Open-Meteo forecast -------------------------------
    # Latitude is read from the sheet (engine input). Longitude is not in the
    # sheet, so set it here for the forecast. LAT_OVERRIDE/LAT forces a forecast
    # latitude independent of the sheet (rarely needed).
    lon: Optional[float] = Field(default=None, validation_alias=AliasChoices("LON", "lon"))
    lat_override: Optional[float] = Field(
        default=None, validation_alias=AliasChoices("LAT_OVERRIDE", "LAT", "lat_override"))

    # ---- Forecast / weather --------------------------------------------------
    # Forecast tail length: long enough to reach provisional stage dates and to
    # project the trigger forward (Open-Meteo gives ~16 real days; the rest is
    # 3-day-average persistence).
    forecast_horizon_days: int = 21
    open_meteo_url: str = "https://api.open-meteo.com/v1/forecast"
    open_meteo_timeout: float = 10.0

    # ---- Caching -------------------------------------------------------------
    cache_ttl_seconds: int = 600  # 10 min; sheet read + engine run cached per id

    # ---- Decision knobs ------------------------------------------------------
    recent_etc_window: int = 5     # N days for recent_avg_etc
    stale_after_days: int = 2      # freshness amber/red threshold

    # ---- CORS ----------------------------------------------------------------
    frontend_origin: str = "http://localhost:3000"

    @property
    def _is_demo_token(self) -> bool:
        return self.sheet_id is None or self.sheet_id.strip().lower() in _DEMO_TOKENS

    @property
    def csv_base(self) -> Optional[str]:
        """Per-tab CSV URL template (contains '{sheet}'), or None in demo mode."""
        if self.sheet_csv_base:
            return self.sheet_csv_base
        if not self._is_demo_token:
            return (
                f"https://docs.google.com/spreadsheets/d/{self.sheet_id}"
                "/gviz/tq?tqx=out:csv&sheet={sheet}"
            )
        return None

    @property
    def sheet_edit_url(self) -> Optional[str]:
        if not self._is_demo_token:
            return f"https://docs.google.com/spreadsheets/d/{self.sheet_id}/edit"
        return None

    @property
    def demo_mode(self) -> bool:
        return self.csv_base is None


@lru_cache
def get_settings() -> Settings:
    return Settings()
