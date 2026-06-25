"""Sheet loading: read the Google Sheet (published-CSV) and produce engine inputs.

Design: a `SheetFetcher` returns raw CSV text for a tab; a `SheetSource` turns the
tabs into an `EngineInputs`. The CSV-over-HTTP path (gviz) and the bundled
local-sample path share ONE parser, so swapping to gspread later only means a new
fetcher/source — callers (compute.py) never change.

Parsing strategy — robust to messy real-world sheets. The target Google Sheet has
per-tab title/description rows above the headers, and gviz's CSV export merges
those into the header row (it even folds Site_Config's first value into the
header). So we DON'T trust the header row: we identify *data* rows by content (a
parseable date, a numeric Top, an Irrig/Fert type, a known config key) and read
columns by the template's fixed position. This works identically for the live
gviz sheet and the bundled demo CSVs.

This module does NO science. Humidity is passed through as raw RHmax/RHmin (or
dewpoint / vapor pressure); compute.py turns it into ETr via the engine's own
pyfao wrapper.
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Callable, Optional, Protocol

import httpx

from et_engine import Config, Stage

# --- tab names, exactly as in the template (the Read_Me tab is ignored) ------
TAB_SITE = "Site_Config"
TAB_SOIL = "Soil_AWC"
TAB_STAGES = "Crop_Stages"
TAB_WEATHER = "Weather_Daily"
TAB_SCHEDULE = "Irrigation_Schedule"
ALL_TABS = [TAB_SITE, TAB_SOIL, TAB_STAGES, TAB_WEATHER, TAB_SCHEDULE]


@dataclass
class LoadError(Exception):
    tab: str
    field: str
    message: str

    def __str__(self) -> str:  # pragma: no cover - cosmetic
        return f"[{self.tab}:{self.field}] {self.message}"


class SheetValidationError(Exception):
    """Raised when the sheet cannot be turned into valid engine inputs."""

    def __init__(self, errors: list[LoadError]):
        self.errors = errors
        super().__init__("; ".join(str(e) for e in errors) or "sheet validation failed")


class SheetAccessError(Exception):
    """Raised when the sheet can't be read at all (not public / network)."""


@dataclass
class StageRow:
    """One Crop_Stages row. `date` is None for undated (future) stages, which the
    live open-interval estimator places provisionally. `avg_days_to_next` is the
    mean duration to the next stage (used for that estimation; never passed to the
    engine)."""

    label: str
    date: Optional[date]
    slope: float
    intercept: float
    managed_depth: Optional[float]
    mad: Optional[float]
    avg_days_to_next: Optional[float]

    def to_stage(self, d: Optional[date] = None) -> Stage:
        return Stage(date=d or self.date, label=self.label, slope=self.slope,
                     intercept=self.intercept, managed_depth=self.managed_depth, mad=self.mad)


@dataclass
class SiteMeta:
    name: str
    season: int
    latitude: float
    longitude: Optional[float]
    elevation: float
    planting_date: Optional[date]
    reference_crop: str
    humidity_input: str
    units_default: str = "mm"
    sheet_edit_url: Optional[str] = None
    demo_mode: bool = False


@dataclass
class EngineInputs:
    site: SiteMeta
    config: Config
    soil_layers: list[tuple]
    stages: list[Stage]              # OBSERVED stages (dated), sorted chronologically
    stage_rows: list[StageRow]       # ALL rows (observed + undated future), sheet order
    schedule: dict
    weather: list[dict]              # actuals only, sorted by date
    warnings: list[str] = field(default_factory=list)


# ============================ source interface ==============================


class SheetSource(Protocol):
    """The stable seam between the app and wherever the sheet lives.

    v1 ships `CsvSheetSource` (published-CSV / bundled sample). A future gspread
    source implements the SAME `load()` so compute.py never changes.
    """

    def load(self) -> "EngineInputs": ...


class GspreadSheetSource:
    """v1.x placeholder: read a PRIVATE sheet via a Google service account.

    Implement `load()` by reading each tab's rows with gspread and feeding them
    through the same parser helpers `CsvSheetSource` uses. Kept as a stub so the
    interface is explicit in v1."""

    def __init__(self, sheet_id: str, credentials_json: str):
        self._sheet_id = sheet_id
        self._creds = credentials_json

    def load(self) -> "EngineInputs":  # pragma: no cover - v1.x
        raise NotImplementedError(
            "GspreadSheetSource is a v1.x upgrade. Install gspread + google-auth, "
            "open the sheet by id with a service account, and reuse the row parsing "
            "below to return EngineInputs."
        )


# ============================ fetchers ======================================


class SheetFetcher(Protocol):
    def fetch(self, tab: str) -> str: ...


class GvizFetcher:
    """Fetch a tab's CSV from a Google Sheet published/shared gviz endpoint."""

    def __init__(self, csv_base: str, timeout: float = 20.0):
        self._csv_base = csv_base  # contains "{sheet}"
        self._timeout = timeout

    def fetch(self, tab: str) -> str:
        from urllib.parse import quote
        url = self._csv_base.format(sheet=quote(tab))
        try:
            resp = httpx.get(url, timeout=self._timeout, follow_redirects=True)
        except httpx.HTTPError as exc:
            raise SheetAccessError(f"could not reach the sheet ({type(exc).__name__}: {exc})")
        if resp.status_code in (401, 403):
            raise SheetAccessError(
                "the sheet is not publicly readable (HTTP %d). Publish it to the web or "
                "share it 'Anyone with the link → Viewer'." % resp.status_code)
        if resp.status_code >= 400:
            raise SheetAccessError(f"sheet read failed (HTTP {resp.status_code}) for tab '{tab}'.")
        text = resp.text
        # A login/redirect page comes back as HTML, not CSV.
        if text.lstrip()[:1] == "<" or "<!DOCTYPE html" in text[:200] or "<html" in text[:200].lower():
            raise SheetAccessError(
                "the sheet is not publicly readable (got an HTML page, not CSV). Publish it "
                "to the web or share it 'Anyone with the link → Viewer'.")
        return text


class LocalFetcher:
    """Read a tab from a local directory of `<Tab>.csv` files (demo / tests)."""

    def __init__(self, directory: Path):
        self._dir = Path(directory)

    def fetch(self, tab: str) -> str:
        path = self._dir / f"{tab}.csv"
        if not path.exists():
            raise LoadError(tab, "_tab", f"missing sample file {path.name}")
        return path.read_text(encoding="utf-8")


# ============================ parsing helpers ===============================


def _norm(s) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def _rows(csv_text: str) -> list[list[str]]:
    reader = csv.reader(io.StringIO(csv_text))
    return [[c.strip() for c in row] for row in reader]


def _cell(row: list[str], i: int) -> str:
    return row[i].strip() if i < len(row) else ""


def _to_float(s):
    s = str(s or "").replace(",", "").strip()
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


_DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d", "%d-%b-%Y", "%b %d, %Y")
_GVIZ_DATE = re.compile(r"Date\((\d+),(\d+),(\d+)")


def _to_date(value) -> Optional[date]:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    m = _GVIZ_DATE.match(s)
    if m:  # gviz JS Date(year, month0, day) — month is 0-based
        return date(int(m.group(1)), int(m.group(2)) + 1, int(m.group(3)))
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    iso = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if iso:
        return date(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
    return None


# ============================ the parser ====================================


class CsvSheetSource:
    """Turns the 5 tabs (via any fetcher) into validated EngineInputs."""

    def __init__(
        self,
        fetcher: SheetFetcher,
        *,
        longitude: Optional[float] = None,
        latitude_override: Optional[float] = None,
        sheet_edit_url: Optional[str] = None,
        demo_mode: bool = False,
    ):
        self._fetcher = fetcher
        self._lon = longitude
        self._lat_override = latitude_override
        self._edit_url = sheet_edit_url
        self._demo = demo_mode

    # -- public -------------------------------------------------------------
    def load(self) -> EngineInputs:
        errors: list[LoadError] = []
        warnings: list[str] = []

        site_cfg = self._read_site_config(errors)
        soil_layers = self._read_soil(errors)
        stage_rows = self._read_stages(errors)
        schedule = self._read_schedule(errors)
        weather = self._read_weather(errors, warnings)

        if errors:
            raise SheetValidationError(errors)

        observed = sorted([sr for sr in stage_rows if sr.date is not None], key=lambda s: s.date)
        stages = [sr.to_stage() for sr in observed]
        planting = observed[0].date if observed else None

        cfg_plant = site_cfg.get("planting_date")
        if planting and cfg_plant and planting != cfg_plant:
            warnings.append(
                f"Site_Config planting date {cfg_plant} differs from earliest stage "
                f"{planting}; using the earliest observed stage date as planting.")

        # The engine's daily balance begins at planting (stage 0 == weather day 0).
        # Drop any weather rows dated before planting (e.g. stray prior-season rows);
        # otherwise the engine's stage index would over-increment and overflow.
        if planting:
            pre = [w for w in weather if w["date"] < planting]
            if pre:
                warnings.append(
                    f"dropped {len(pre)} weather row(s) dated before planting {planting} "
                    f"(first was {pre[0]['date']}); the season starts at planting.")
                weather = [w for w in weather if w["date"] >= planting]
            if not weather:
                raise SheetValidationError([LoadError(
                    TAB_WEATHER, "_rows",
                    f"no weather rows on/after the planting date {planting}.")])

        self._check_weather_contiguous(weather, warnings)
        if weather and observed and observed[-1].date > weather[-1]["date"]:
            warnings.append(
                f"latest observed stage {observed[-1].date} is after the last weather day "
                f"{weather[-1]['date']}; fill Weather_Daily up to the current date.")

        cfg = Config(
            lat=site_cfg["latitude"], elev=site_cfg["elevation"],
            wndht=site_cfg.get("wind_height") or 2.0, cn=site_cfg["cn"],
            irrig_depth=site_cfg["irrig_depth"], fert_depth=site_cfg["fert_depth"],
            tall=site_cfg["tall"], dr0=site_cfg.get("initial_depletion") or 0.0, dp0=0.0,
        )
        site = SiteMeta(
            name=site_cfg.get("site_name") or "Field",
            season=site_cfg.get("season_year") or (planting.year if planting else date.today().year),
            latitude=site_cfg["latitude"], longitude=self._lon, elevation=site_cfg["elevation"],
            planting_date=planting, reference_crop="Tall" if site_cfg["tall"] else "Short",
            humidity_input=site_cfg.get("humidity_input") or "RHmax_RHmin",
            units_default="mm", sheet_edit_url=self._edit_url, demo_mode=self._demo,
        )
        return EngineInputs(
            site=site, config=cfg, soil_layers=soil_layers, stages=stages,
            stage_rows=stage_rows, schedule=schedule, weather=weather, warnings=warnings)

    # -- per-tab readers ----------------------------------------------------
    def _read_site_config(self, errors: list[LoadError]) -> dict:
        rows = _rows(self._fetcher.fetch(TAB_SITE))
        if not rows:
            errors.append(LoadError(TAB_SITE, "_tab", "empty or unreadable"))
            return {}

        kv: dict[str, str] = {}
        site_name = ""
        for r in rows:
            if not r:
                continue
            key = _cell(r, 0)
            val = _cell(r, 1)
            if key:
                kv[_norm(key)] = val
            # recover the site name even when gviz folds the first value into the
            # header row (col0 ".. Site name", col1 "Value <name>").
            nk = _norm(key)
            if nk.endswith("sitename"):
                site_name = val[6:].strip() if val[:6].lower() == "value " else val

        def get(*cands):
            for c in cands:
                nc = _norm(c)
                if nc in kv:
                    return kv[nc]
                for k, v in kv.items():
                    if k == nc or k.startswith(nc) or nc.startswith(k) and len(k) >= 4:
                        return v
            return None

        out: dict = {}
        out["site_name"] = site_name or get("Site name") or None
        season = _to_float(get("Season (year)", "Season"))
        out["season_year"] = int(season) if season else None
        lat = _to_float(get("Latitude"))
        if lat is None:
            errors.append(LoadError(TAB_SITE, "Latitude", "missing or non-numeric"))
        out["latitude"] = self._lat_override if self._lat_override is not None else lat
        out["elevation"] = _to_float(get("Elevation"))
        if out["elevation"] is None:
            errors.append(LoadError(TAB_SITE, "Elevation", "missing or non-numeric"))
        crop = (get("Reference crop") or "Tall").strip()
        out["tall"] = _norm(crop).startswith("tall") or crop == ""
        out["wind_height"] = _to_float(get("Wind height"))
        out["planting_date"] = _to_date(get("Planting date"))
        out["cn"] = _to_float(get("Curve Number (CN)", "Curve Number"))
        if out["cn"] is None:
            errors.append(LoadError(TAB_SITE, "Curve Number (CN)", "missing or non-numeric"))
        out["initial_depletion"] = _to_float(get("Initial depletion"))
        out["irrig_depth"] = _to_float(get("Irrigation depth"))
        if out["irrig_depth"] is None:
            errors.append(LoadError(TAB_SITE, "Irrigation depth", "missing or non-numeric"))
        out["fert_depth"] = _to_float(get("Fertigation depth"))
        if out["fert_depth"] is None:
            out["fert_depth"] = 0.0
        hum = get("Humidity input type")
        out["humidity_input"] = (hum or "RHmax_RHmin").strip() or "RHmax_RHmin"
        return out

    def _read_soil(self, errors: list[LoadError]) -> list[tuple]:
        rows = _rows(self._fetcher.fetch(TAB_SOIL))
        layers = []
        for r in rows:
            top = _to_float(_cell(r, 1))   # data rows have a numeric Top (mm)
            if top is None:
                continue                    # skip title/description/header rows
            bottom = _to_float(_cell(r, 2))
            awc = _to_float(_cell(r, 3))
            if bottom is None or awc is None:
                errors.append(LoadError(TAB_SOIL, "row", f"layer top={top} has non-numeric bottom/AWC"))
                continue
            layers.append((top, bottom, awc))
        if not layers:
            errors.append(LoadError(TAB_SOIL, "_rows", "no soil layers with a numeric Top (mm)"))
        return layers

    def _read_stages(self, errors: list[LoadError]) -> list[StageRow]:
        rows = _rows(self._fetcher.fetch(TAB_STAGES))
        stage_rows: list[StageRow] = []
        for r in rows:
            label = _cell(r, 0)
            if not label:
                continue
            d = _to_date(_cell(r, 1))
            slope = _to_float(_cell(r, 2))
            intercept = _to_float(_cell(r, 3))
            # a real stage row has either an observed date or numeric calibration;
            # this skips the title / description / 'Stage' header rows.
            if d is None and slope is None and intercept is None:
                continue
            zr = _to_float(_cell(r, 4))
            mad = _to_float(_cell(r, 5))
            avg = _to_float(_cell(r, 6))
            stage_rows.append(StageRow(
                label=label, date=d, slope=slope or 0.0, intercept=intercept or 0.0,
                managed_depth=zr, mad=mad, avg_days_to_next=avg))
        observed = [s for s in stage_rows if s.date is not None]
        if not observed:
            errors.append(LoadError(TAB_STAGES, "_rows", "no stage rows with a Date observed"))
        return stage_rows

    def _read_schedule(self, errors: list[LoadError]) -> dict:
        rows = _rows(self._fetcher.fetch(TAB_SCHEDULE))
        schedule: dict = {}
        for r in rows:
            typ_raw = _cell(r, 0)
            ntyp = _norm(typ_raw)
            if ntyp not in ("irrig", "fert"):
                continue                    # skip title/header/blank rows
            d = _to_date(_cell(r, 1))
            if d is None:
                errors.append(LoadError(TAB_SCHEDULE, "Date", f"unparseable date for {typ_raw!r} row"))
                continue
            schedule[d] = "Irrig" if ntyp == "irrig" else "Fert"
        return schedule

    def _read_weather(self, errors: list[LoadError], warnings: list[str]) -> list[dict]:
        rows = _rows(self._fetcher.fetch(TAB_WEATHER))
        weather: list[dict] = []
        for r in rows:
            d = _to_date(_cell(r, 0))       # data rows start with a parseable date
            if d is None:
                continue                    # skip title/description/header rows
            yr = d.year
            weather.append(dict(
                date=d, doy=(d - date(yr - 1, 12, 31)).days,
                tmin=_to_float(_cell(r, 1)), tmax=_to_float(_cell(r, 2)),
                rhmin=_to_float(_cell(r, 3)), rhmax=_to_float(_cell(r, 4)),
                u=_to_float(_cell(r, 5)), rs=_to_float(_cell(r, 6)),
                precip=_to_float(_cell(r, 7)) or 0.0))
        weather.sort(key=lambda w: w["date"])
        # required numeric fields for the engine / ETr
        for w in weather:
            for key in ("tmax", "tmin", "rs", "u"):
                if w[key] is None:
                    errors.append(LoadError(TAB_WEATHER, key, f"missing on {w['date']}"))
        if not weather:
            errors.append(LoadError(TAB_WEATHER, "_rows", "no weather rows with a parseable Date"))
        return weather

    @staticmethod
    def _check_weather_contiguous(weather: list[dict], warnings: list[str]) -> None:
        seen = set()
        for i, w in enumerate(weather):
            if w["date"] in seen:
                warnings.append(f"duplicate weather date {w['date']}")
            seen.add(w["date"])
            if i > 0:
                gap = (w["date"] - weather[i - 1]["date"]).days
                if gap > 1:
                    warnings.append(
                        f"weather gap: {gap - 1} day(s) missing between "
                        f"{weather[i-1]['date']} and {w['date']}")


# ============================ factory =======================================


def make_source(settings, sample_dir: Optional[Path] = None) -> CsvSheetSource:
    """Build the active SheetSource from settings (gviz CSV, or bundled sample)."""
    if settings.demo_mode:
        directory = sample_dir or (Path(__file__).parent / "sample_sheet")
        return CsvSheetSource(
            LocalFetcher(directory),
            longitude=settings.lon if settings.lon is not None else -100.0,
            latitude_override=settings.lat_override, sheet_edit_url=None, demo_mode=True)
    return CsvSheetSource(
        GvizFetcher(settings.csv_base, timeout=settings.open_meteo_timeout + 10),
        longitude=settings.lon, latitude_override=settings.lat_override,
        sheet_edit_url=settings.sheet_edit_url, demo_mode=False)
