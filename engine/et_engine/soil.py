"""Allowable depletion from the layered AWC profile (Section G) —
the meaning of the Excel SUMPRODUCT(...ABS...) array formula."""


def layer_overlap(zr, top, bottom):
    """Thickness of a soil layer [top, bottom] within the root zone [0, zr]."""
    return max(min(zr, bottom) - top, 0.0)


def allowable_depletion(zr, mad, layers):
    """AD (mm) = MAD * sum(AWC_layer * overlap). None when zr/mad undefined
    (mirrors the Excel NA() for early stages -> no irrigation trigger)."""
    if zr is None or mad is None:
        return None
    total = sum(awc * layer_overlap(zr, top, bottom) for (top, bottom, awc) in layers)
    return mad * total
