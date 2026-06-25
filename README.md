# ET Irrigation-Decision Dashboard

A clean, decision-first web dashboard for **one field, one growing season**. It
tells a grower/agronomist how depleted the root zone is right now, **whether to
irrigate**, and if not, **how many days until they should** — projected forward
with a weather forecast and re-anchored daily as real weather lands in a Google
Sheet.

The science is done by a pre-validated engine. This app is the **I/O,
orchestration, API, forecast, and UI** around it.

> Top bar (site, weather + 3-day forecast, freshness, mm⇄inch) → hero decision
> card with a depletion-vs-AD gauge → depletion-forecast chart (actual vs forecast,
> AD threshold, projected trigger) → growth-stage card → records + CSV export.

---

## Golden rule: the engine is a fixed dependency

[`engine/et_engine/`](engine/et_engine) is validated to floating-point precision
(7e-15) against seven years of a trusted Excel model, and its reference ET matches
a trusted ASCE calculator to 0.008 mm/day. It is **vendored and never modified**.

- No file under `et_engine/` is changed.
- GDD, Kcr, ETc, runoff, depletion, ETr, and the irrigation trigger are **never
  recomputed** in the app — everything comes from `et_engine.run(...)`.
- Reference ET is always pyfao56 (ASCE-2005). The app routes the sheet's humidity
  (RHmax/RHmin) into ETr by calling the engine's own pyfao wrapper
  (`et_engine.refet.etr_daily`) and feeding it through the engine's validated
  `etr_override` path — it does not implement any physics.

See [`engine/VALIDATION.md`](engine/VALIDATION.md) and
[`engine/ET_Scheduler_Equation_Spec.md`](engine/ET_Scheduler_Equation_Spec.md).

---

## Architecture

```
Google Sheet (5 tabs, published CSV)
        │  sheets.py  (SheetSource.load -> EngineInputs)
        ▼
   actuals weather ──┐
                     ├─ weather.py: + Open-Meteo horizon forecast (persistence fallback)
   forecast weather ─┘
        ▼
   compute.py: provisional open-interval stages + ETr via engine's pyfao wrapper
              -> et_engine.run() -> derive metrics
        ▼
   FastAPI /api/state  (cached, JSON)
        ▼
   Next.js dashboard (decision card, depletion chart, growth card, records, alerts)
```

### Repo layout

```
engine/                 # vendored, validated science package (DO NOT MODIFY)
  et_engine/            #   Config, Stage, run, gdd, refet, runoff, soil
  pyproject.toml        #   installable: pip install ./engine
reference/              # regression harness (validate.py, validate_summary.py)
                        #   + 2017_2023_ETschudelr_Code.xlsm (provide separately)
backend/
  app/
    main.py             # FastAPI app, CORS, routes, TTL cache
    sheets.py           # SheetSource: CSV now (gspread later) -> EngineInputs
    weather.py          # Open-Meteo client + forecast fabrication
    compute.py          # load -> forecast -> engine -> derived payload
    schemas.py          # pydantic response models
    config.py           # env settings
    sample_sheet/       # bundled demo season (5 CSVs) for DEMO mode
  tests/                # regression + loader + compute + API-shape
frontend/               # Next.js (App Router) + TypeScript + Tailwind + Recharts
Dockerfile, render.yaml # backend deploy
.github/workflows/ci.yml
```

---

## Quick start (local)

Requires Python 3.11+ and Node 18+.

### 1. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pip install ../engine            # vendored engine, installed unchanged
cp .env.example .env             # optional; defaults run in DEMO mode
uvicorn app.main:app --reload --port 8000
```

- `http://localhost:8000/api/health` → `{"status":"ok","demo_mode":true,...}`
- `http://localhost:8000/api/state` → full dashboard payload
- Interactive docs: `http://localhost:8000/docs`

By default the backend reads the build's **target Google Sheet** (`SHEET_ID`
defaults to the shared `Colby_2026` sheet). Set **`SHEET_ID=demo`** to serve the
**bundled sample season** (`backend/app/sample_sheet/`) — a realistic 2026 corn
field that exercises every feature (including the live open-interval estimation)
fully offline. Both pull a live Open-Meteo forecast, falling back to 3-day
persistence when offline.

### 2. Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local   # NEXT_PUBLIC_API_BASE=http://localhost:8000
npm run dev
```

Open `http://localhost:3000`.

> The growth-stage card shows a **real corn photo per stage** from
> `frontend/public/stages/` (web-safe slugs: lowercase, `/`·`:`·`.` → `_`, e.g.
> `vt_r1.png`, `r4_7.png`). Missing stages fall back to the most recent available
> photo, then to a generated illustration — it never crashes. Drop more photos in
> that folder (and add the slug to `lib/stageImage.ts`) to extend coverage.

---

## Going live: your Google Sheet

1. Build the sheet from the 5-tab template (column names must match exactly — see
   **Sheet contract** below; the bundled `backend/app/sample_sheet/*.csv` are the
   canonical example).
2. **File → Share → Publish to web** (the whole document).
3. Copy the sheet id from its URL:
   `https://docs.google.com/spreadsheets/d/`**`<SHEET_ID>`**`/edit`.
4. Set backend env:
   ```
   SHEET_ID=<your id>
   LON=-96.57          # site longitude for Open-Meteo (latitude comes from the sheet)
   ```
5. Restart the backend. The dashboard now reads your sheet, shows an **Edit sheet**
   link, and re-anchors the forecast on every refresh.

Private sheets / write-back are a v1.x upgrade via a Google service account — the
read sits behind `SheetSource.load()` (see `GspreadSheetSource` stub in
`sheets.py`), so swapping CSV→gspread doesn't touch callers.

### Sheet contract (5 tabs)

| Tab | Columns | Notes |
|---|---|---|
| **Site_Config** | `Field`, `Value`, `Notes` | key/value: `Site name`, `Season (year)`, `Latitude`, `Elevation`, `Reference crop` (Tall\|Short), `Wind height` (m, =2), `Planting date`, `Curve Number (CN)`, `Initial depletion` (mm), `Irrigation depth` (mm), `Fertigation depth` (mm), `Humidity input type` |
| **Soil_AWC** | `Layer`, `Top (mm)`, `Bottom (mm)`, `AWC (mm/mm)` | ≤10 rows; rows with a Top value |
| **Crop_Stages** | `Stage`, `Date observed`, `Kcr slope`, `Kcr intercept`, `Managed depth Zr (mm)`, `MAD (fraction)`, `Avg days to next` | Observed stages have a `Date observed`; later stages stay **undated** until reached. Calibration is filled for all rows. Earliest dated = planting. Blank Zr/MAD = no trigger. `Avg days to next` = mean days to the next stage, used to estimate the open interval (below). |
| **Weather_Daily** | `Date`, `Tmin (°C)`, `Tmax (°C)`, `RHmin (%)`, `RHmax (%)`, `U2 (m/s)`, `Rs (MJ/m²/d)`, `Precip (mm)` | one row/day, contiguous |
| **Irrigation_Schedule** | `Type` (Irrig\|Fert), `Date` | candidate application days |

The loader validates required fields, numeric types, date parsing, planting =
earliest stage, and weather contiguity, returning **field-level errors**
(surfaced by `POST /api/validate-sheet`).

> **Units:** the engine is always metric (mm, °C, MJ/m²/d). The UI offers a
> **mm ⇄ inch** display toggle that never changes what is sent to the engine.

---

## Environment variables (backend)

| Var | Default | Meaning |
|---|---|---|
| `SHEET_ID` | `1USpOt…EX320` | Google Sheet id (shared "Anyone with link → Viewer"). **Set `SHEET_ID=demo`** for the bundled sample season. |
| `SHEET_CSV_BASE` | derived | override per-tab CSV template (must contain `{sheet}`) |
| `LON` | _(unset)_ | site longitude for Open-Meteo (latitude from sheet); without it the forecast is 3-day persistence |
| `LAT` / `LAT_OVERRIDE` | _(unset)_ | force a forecast latitude independent of the sheet |
| `FORECAST_HORIZON_DAYS` | `21` | forecast tail length (reaches provisional stage dates; ~16 real days + persistence) |
| `RECENT_ETC_WINDOW` | `5` | N days for `recent_avg_etc` |
| `STALE_AFTER_DAYS` | `2` | freshness amber/red threshold |
| `CACHE_TTL_SECONDS` | `600` | per-sheet cache for `/api/state` |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | CORS origin(s), comma-separated |
| `OPEN_METEO_URL` | open-meteo.com | forecast endpoint |

**Frontend:** `NEXT_PUBLIC_API_BASE` (default `http://localhost:8000`).

---

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | liveness + demo flag |
| `GET /api/state[?refresh=1]` | full dashboard payload (cached; `refresh=1` bypasses) |
| `POST /api/validate-sheet` | structural validation → `{ok, errors[], warnings[]}` |

`/api/state` returns `site`, `freshness`, `today`, `decision`
(`should_irrigate_now`, `days_to_trigger`, `projected_trigger_date`,
`recommendation`, `estimated`), `series` (daily rows, each flagged
`kind` = `observed`/`provisional`/`forecast`), `growth_stage`, `season_summary`,
`schedule` (ET-Model `applied` readback), and `alerts`. Everything is derived from
engine output — no science is recomputed.

### Forecast behavior

- **Actuals** (the Weather_Daily rows) drive the authoritative balance.
- **Forecast** = up to `FORECAST_DAYS` fabricated days appended after the last
  actual, used only for projection and re-derived on every load.
- Open-Meteo supplies tmax/tmin/Rs/RH/wind/precip; any missing field (or no
  network) **persists the mean of the last 3 actual days**; precip = 0 unless the
  API reports rain. Forecast rows are flagged so the UI styles them distinctly.

### Live open-interval estimation

In-season the grower has logged the current stage but not the next, so the current
("open") interval has no end and the engine returns `None` for Kcr/ETc on the most
recent days. Before calling `run`, `compute.py` **provisionally places the upcoming
stage date(s)** from each stage's `Avg days to next` (walked cumulatively from the
latest observed stage), within `FORECAST_HORIZON_DAYS`, using the calibration
already in the sheet. That gives the open interval a defined ΔG, so today's Kcr/ETc
and the forward projection exist. The engine is unchanged — this is pure input-prep.

Every stage and daily row is flagged **`observed` / `provisional` / `forecast`**;
the UI labels provisional values "estimated." When the grower enters the real
next-stage date, that stage becomes observed and the estimate is replaced
automatically on the next load — no special handling.

---

## Testing

```bash
cd backend && source .venv/bin/activate
python -m pytest -q
```

Covers the four acceptance criteria:

1. **Engine regression** — with the Excel's own ETr injected, every Sections B–I
   column matches the historical workbook to ≤ 3e-3 (six years at 7e-15). Runs
   against `reference/2017_2023_ETschudelr_Code.xlsm`. **The workbook is not
   committed** (it's large); the regression tests **skip** without it. Provide it
   (e.g. via Git LFS) to run them locally and in CI.
2. **Loader fidelity** — the sample sheet → engine inputs → `run` reproduces a
   pinned depletion / `should_irrigate` for chosen days.
3. **ETr sanity** — the engine's `etr` matches a direct ASCE-2005 call < 0.01 mm/d.
4. **API shape** — `/api/state` validates against the schema; forecast rows are
   flagged; `days_to_trigger` / `projected_trigger_date` are consistent with the
   series. (This test forces the offline persistence forecast — no network.)

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) installs the engine,
runs the backend tests (incl. regression when the workbook is present), and builds
the frontend.

### Regenerate the demo season

```bash
cd backend && python scripts/make_sample.py
```

---

## Deployment

### Backend → Render (Docker)

The repo root [`Dockerfile`](Dockerfile) builds an image with the vendored engine
+ FastAPI app. [`render.yaml`](render.yaml) is a one-click blueprint:

1. Render → **New → Blueprint**, select this repo.
2. Set `FRONTEND_ORIGIN` to your Vercel URL; optionally `SHEET_ID` + `LON` for
   live data (omit for the demo season).
3. Health check: `/api/health`.

Works equally on Fly.io / Railway (same Dockerfile; `backend/Procfile` for native
buildpacks).

### Frontend → Vercel

1. Vercel → **New Project**, root directory `frontend`.
2. Env: `NEXT_PUBLIC_API_BASE=https://<your-backend-host>`.
3. Deploy (Next.js auto-detected). Ensure the backend's `FRONTEND_ORIGIN`
   includes the Vercel domain for CORS.

---

## Roadmap

- **v1 (this):** single field; published-CSV sheet; Open-Meteo forecast +
  3-day-average fallback; decision card, depletion chart, growth-stage card,
  records/CSV export, freshness/alerts, mm⇄inch toggle.
- **v1.5:** downloadable template + "upload your own sheet" validation;
  multi-location selector; gspread write-back.
- **Later:** Sentek sensor pane (measured vs modeled depletion); PDF export.
