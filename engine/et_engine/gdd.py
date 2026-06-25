"""Growing degree days — exact port of the Excel `GDDStress` VBA UDF.

Double-threshold heat-stress degree-day integration. Corn defaults:
lower threshold TL=10 C, upper threshold TU=28 C.
Ported line-for-line from GDDStress(TX, TN, TULim, TLLim).
"""


def gdd_stress(tx: float, tn: float, tu: float = 28.0, tl: float = 10.0) -> float:
    """Daily GDD contribution. tx=Tmax, tn=Tmin, tu=upper lim, tl=lower lim."""
    if tn < tl:
        if tx <= tl:
            return 0.0
        i1 = (tl - tn) / (tx - tn)
        if tx <= tu:
            return (1 - i1) * (tx - tl) / 2
        i2 = (tu - tn) / (tx - tn)
        if tx - tu <= tu - tl:
            return ((i2 - i1) * (tu - tl)
                    + (1 - i2) * ((tu - tl) + ((tu - tl) - (tx - tu)))) / 2
        i3 = ((tu + (tu - tl)) - tn) / (tx - tn)
        return ((i2 - i1) * (tu - tl) + (i3 - i2) * (tu - tl)) / 2
    elif tn < tu:
        if tx <= tu:
            return ((tn - tl) + (tx - tl)) / 2
        i1 = (tu - tn) / (tx - tn)
        if tx - tu <= tu - tl:
            return (i1 * ((tn - tl) + (tu - tl))
                    + (1 - i1) * ((tu - tl) + ((tu - tl) - (tx - tu)))) / 2
        i2 = ((tu + (tu - tl)) - tn) / (tx - tn)
        return (i1 * ((tn - tl) + (tu - tl)) + (i2 - i1) * (tu - tl)) / 2
    elif tn - tu < tu - tl:
        if tx - tu <= tu - tl:
            return (((tu - tl) - (tn - tu)) + ((tu - tl) - (tx - tu))) / 2
        i1 = ((tu + (tu - tl)) - tn) / (tx - tn)
        return i1 * ((tu - tl) - (tn - tu)) / 2
    else:
        return 0.0
