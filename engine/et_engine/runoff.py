"""SCS curve-number runoff — exact port of the Excel `RO_CN` UDF,
plus the S and Ia derivation from the curve number (Section F)."""


def cn_storage(cn: float) -> float:
    """Potential maximum retention S (mm) from curve number. Excel C21."""
    return ((1000.0 / cn) - 10.0) * 25.4


def initial_abstraction(s: float) -> float:
    """Initial abstraction Ia (mm). Excel C22 = 0.2 * S."""
    return 0.2 * s


def ro_cn(p: float, s: float, ia: float) -> float:
    """Daily runoff (mm). p=precip, s=storage, ia=initial abstraction."""
    if p > ia:
        return (p - ia) ** 2 / (p - ia + s)
    return 0.0
