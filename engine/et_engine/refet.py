"""Reference ET via pyfao56 — the ONLY departure from the Excel.

Wraps pyfao56.refet.ascedaily (ASCE-2005 standardized PM). Tall alfalfa
reference by default (ETrefType=1 -> 'T'). `ea` is supplied via whichever
humidity input is available; vapor pressure (vapr) is the workbook's current
pathway, but tdew / rhmax+rhmin are supported for the standardized fix.
"""
from pyfao56 import refet


def etr_daily(doy, tmax, tmin, israd, z, lat, wndsp, wndht=2.0,
              tall=True, vapr=float("nan"), tdew=float("nan"),
              rhmax=float("nan"), rhmin=float("nan")):
    return refet.ascedaily(
        rfcrp="T" if tall else "S",
        z=z, lat=lat, doy=doy, israd=israd, tmax=tmax, tmin=tmin,
        vapr=vapr, tdew=tdew, rhmax=rhmax, rhmin=rhmin,
        wndsp=wndsp, wndht=wndht,
    )
