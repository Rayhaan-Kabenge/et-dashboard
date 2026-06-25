# ET Irrigation Scheduler — Calculation Spec

This is the authoritative math for the Python engine (`et_engine`). Every
equation is taken **verbatim from the Excel scheduler** (`2017_2023_ETschudelr_Code.xlsm`),
**except reference ET (Section A), which is computed by pyfao56** to replace the
Excel `ETrefDayASCE` VBA function.

The model is a daily, sequential root-zone water-balance. Days are processed in
order (day *d* depends on day *d−1*); this recursion must not be vectorized if
bit-for-bit agreement with Excel is required.

Notation: subscript *d* = current day, *d−1* = previous day, *m* = current crop
interval index.

---

## 0. Inputs

**Daily weather (per day) — from the Google Sheet / station:**

| Symbol | Meaning | Units |
|---|---|---|
| `Tmax` | max air temperature | °C |
| `Tmin` | min air temperature | °C |
| humidity | dewpoint `Tdew`, or `RHmax`+`RHmin`, or vapor pressure `ea` (see A.4) | °C / % / kPa |
| `Rs` | incoming solar radiation | MJ m⁻² d⁻¹ |
| `u` | wind speed at height `zw` | m s⁻¹ |
| `P` | precipitation | mm |

**Site / config (constant for a season):**

| Symbol | Meaning |
|---|---|
| `φ` | latitude (decimal degrees) |
| `z` | elevation (m) |
| `zw` | wind measurement height (m); this workbook = 3 m |
| reference | tall alfalfa reference (`ETrefType = 1` → pyfao `rfcrp='T'`) |
| plant_date | planting date |
| `CN` | runoff curve number |
| `Iₐₚₚ` | irrigation application depth (mm) |
| `Fₐₚₚ` | fertigation application depth (mm) |
| `Dr₀` | initial depletion (mm) |

**Soil profile** — 10 layers, each: top depth, bottom depth (mm), `AWC` (mm/mm).

**Crop calibration table** — one row per growth stage, giving: stage label,
observed stage-start date, interval GDD span, Kcr slope `a_m`, Kcr intercept
`b_m`, managed root depth `Zr_m` (mm), and MAD fraction `f_m`.

**Irrigation schedule** — list of available (type ∈ {Irrig, Fert}, date) entries.

---

## A. Reference ET — `ETr` (pyfao56, replaces Excel)

Computed by `pyfao56.refet.ascedaily(rfcrp='T', ...)`, the ASCE-2005
Standardized Reference ET equation (tall/alfalfa reference). This is the **only**
departure from the Excel. The equation family is identical to the Excel's; the
substantive choice is the `ea` input (A.4).

**A.1 Mean temperature, pressure, psychrometric constant, slope**
```
Tavg = (Tmax + Tmin) / 2
Patm = 101.3 · ((293 − 0.0065·z) / 293)^5.26
γ    = 0.000665 · Patm
Δ    = 2503 · exp(17.27·Tavg / (Tavg + 237.3)) / (Tavg + 237.3)²
```

**A.2 Saturation vapor pressure**
```
e(T) = 0.6108 · exp(17.27·T / (T + 237.3))
es   = ( e(Tmax) + e(Tmin) ) / 2
```

**A.3 Net radiation**
```
Rns  = (1 − 0.23) · Rs                          (albedo 0.23)
latrad = φ · π/180
dr   = 1 + 0.033 · cos(2π·doy/365)
δ    = 0.409 · sin(2π·doy/365 − 1.39)
ωs   = arccos( −tan(latrad)·tan(δ) )
Ra   = (24/π) · 4.92 · dr · ( ωs·sin(latrad)·sin(δ) + cos(latrad)·cos(δ)·sin(ωs) )
Rso  = (0.75 + 2e-5·z) · Ra
ratio = clamp(Rs/Rso, 0.3, 1.0)
fcd  = clamp(1.35·ratio − 0.35, 0.05, 1.0)
Rnl  = 4.901e-9 · fcd · (0.34 − 0.14·√ea) · ((Tmax+273.16)⁴ + (Tmin+273.16)⁴)/2
Rn   = Rns − Rnl
G    = 0
```

**A.4 Actual vapor pressure `ea`** — pyfao chooses by what is supplied
(use the rawest available; **this is the input to standardize**):
```
if vapr given:      ea = vapr
elif Tdew given:    ea = e(Tdew)
elif RHmax & RHmin: ea = ( e(Tmin)·RHmax/100 + e(Tmax)·RHmin/100 ) / 2
elif RHmax:         ea = e(Tmin)·RHmax/100
elif RHmin:         ea = e(Tmax)·RHmin/100
else:               ea = e(Tmin − 2)
```

**A.5 Wind adjustment to 2 m**  *(pyfao standard form; Excel used a 0.5-m-veg variant)*
```
u2 = u · 4.87 / ln(67.8·zw − 5.42)
```

**A.6 Standardized reference ET** (tall reference: `Cn = 1600`, `Cd = 0.38`)
```
        0.408·Δ·(Rn − G) + γ·(Cn/(Tavg+273))·u2·(es − ea)
ETr = ──────────────────────────────────────────────────────
                 Δ + γ·(1 + Cd·u2)
```

> Validate `ETr` against pyfao directly (with the chosen `ea` input), **not**
> against the Excel's stored ETr column.

---

## B. Growing degree days — `GDD` (Excel `GDDStress`, exact)

Double-threshold heat-stress degree-day method. Lower threshold `L = 10` °C,
upper threshold `U = 28` °C. Inputs: `n = Tmin`, `x = Tmax`. Returns the day's
GDD contribution. (Reproduces the `GDDStress` VBA byte-for-byte.)

```
Case n < L:
    if x ≤ L:                 GDD = 0
    elif x ≤ U:
        i1 = (L−n)/(x−n)
        GDD = (1 − i1)·(x − L)/2
    else:  # x > U
        i1 = (L−n)/(x−n);  i2 = (U−n)/(x−n)
        if x − U ≤ U − L:
            GDD = ( (i2−i1)·(U−L) + (1−i2)·((U−L) + ((U−L) − (x−U))) ) / 2
        else:
            i3 = (2U − L − n)/(x−n)
            GDD = ( (i2−i1)·(U−L) + (i3−i2)·(U−L) ) / 2

Case L ≤ n < U:
    if x ≤ U:                 GDD = ( (n−L) + (x−L) ) / 2
    else:
        i1 = (U−n)/(x−n)
        if x − U ≤ U − L:
            GDD = ( i1·((n−L)+(U−L)) + (1−i1)·((U−L) + ((U−L) − (x−U))) ) / 2
        else:
            i2 = (2U − L − n)/(x−n)
            GDD = ( i1·((n−L)+(U−L)) + (i2−i1)·(U−L) ) / 2

Case U ≤ n < 2U − L:          # i.e. n − U < U − L
    if x − U ≤ U − L:         GDD = ( ((U−L) − (n−U)) + ((U−L) − (x−U)) ) / 2
    else:
        i1 = (2U − L − n)/(x−n)
        GDD = i1·((U−L) − (n−U)) / 2

Else (n ≥ 2U − L):           GDD = 0
```

---

## C. Cumulative GDD, stage, interval

**C.1 Cumulative GDD** (Excel: `∑GDD` accumulates the *previous* day's GDD)
```
∑GDD_d = ∑GDD_{d−1} + GDD_{d−1},   with ∑GDD on planting day = 0
```

**C.2 Stage** — exact-match lookup of date `d` in the (date → stage) phenology
table; blank on non-stage-start days.
```
stage_d = phenology[date_d]  if date_d is a stage-start date, else ""
```

**C.3 Interval index** — increments by 1 on each stage-start date, constant between:
```
m_d = m_{d−1} + 1   if stage_d ≠ "" ,  else  m_{d−1}
```

---

## D. Crop coefficient — `Kcr` (per-interval linear in GDD)

For the active interval `m`, let `G0_m` = cumulative GDD at the interval's start
and `ΔG_m` = the interval's GDD span (both from the calibration table):
```
fracInt_d = (∑GDD_d − G0_m) / ΔG_m            (position 0..1 through the interval)
Kcr_d     = a_m · fracInt_d + b_m             (a_m = slope, b_m = intercept)
```

---

## E. Crop ET
```
ETc_d = Kcr_d · ETr_d
```

---

## F. Runoff — SCS curve number (Excel `RO_CN`, exact)
```
S  = (1000/CN − 10) · 25.4          (mm)
Ia = 0.2 · S
RO_d = (P_d − Ia)² / (P_d − Ia + S)   if P_d > Ia,  else 0
```

---

## G. Allowable depletion — `AD` (layered AWC × MAD)

For interval `m` with managed root depth `Zr_m` and MAD `f_m`, sum each soil
layer's water-holding capacity over its overlap with the root zone `[0, Zr_m]`:
```
overlap_layer = max( min(Zr_m, bottom_layer) − top_layer , 0 )
AD_m = f_m · Σ_layers ( AWC_layer · overlap_layer )      (mm)
```
(This is the exact meaning of the Excel `SUMPRODUCT(... ABS ...)` formula.)

---

## H. Water balance — sequential recursion (Excel, exact)

Let `I_d` = water applied (Section I), `Dr_d` = root-zone depletion (mm, ≥0 = dry),
`DP_d` = deep percolation (mm).

```
Dr_d = Dr_{d−1} − I_{d−1} + ETc_{d−1} − P_{d−1} + RO_{d−1} + DP_{d−1}
DP_d = max( −Dr_d − ETc_d , 0 )
```

The `DP` form above is the algebraic simplification of the Excel cell (verified
identical): drainage occurs when the soil would sit above field capacity even
after today's ET.

**Initial conditions (day 0):** in this workbook both start at 0 (`Dr₀ = 0`,
`DP₀ = 0`). Note: the Excel wires the "Initial Depletion" input into the `DP₀`
cell rather than `Dr₀`. Since it is 0 in practice this is moot, but for the engine
the intended semantics are `Dr₀ = initial_depletion`, `DP₀ = 0`. **Confirm with
the user before relying on a nonzero initial depletion.**

---

## I. Irrigation trigger and application

```
AD_d        = AD_m                       (allowable depletion for current interval)
should_irr  = ( Dr_d > AD_d )            (TRUE/FALSE)
```
Water actually applied on day `d`:
```
I_d = 0                                              if date_d not in schedule
    = 0                                              if not should_irr
    = Iₐₚₚ   (irrigation depth)                       if scheduled type = "Irrig"
    = Fₐₚₚ   (fertigation depth)                      if scheduled type = "Fert"
```

---

## Differences from the Excel (summary)

1. **ETr** is from pyfao56 (Section A) instead of the Excel `ETrefDayASCE`. Same
   ASCE-2005 equation; differences are the wind form (A.5) and a cloudiness-factor
   floor (A.3) — both ≈1%. The material choice is the `ea` input (A.4).
2. With identical `ea`, pyfao and the Excel agree to ~1%. The ETr difference the
   team observed is driven by the `ea` pathway, which must be standardized.
3. Everything else (B–I) reproduces the Excel exactly and is validated against the
   2017–2023 daily sheets.
