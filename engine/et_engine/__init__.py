"""et_engine — validated ET irrigation-scheduler engine (vendored, DO NOT MODIFY).

Public API:

    from et_engine import Config, Stage, run

See VALIDATION.md and ET_Scheduler_Equation_Spec.md for the science. This package
reproduces a trusted Excel model to floating-point precision and must not be
changed; all orchestration happens in the surrounding application.
"""
from .model import Config, Stage, run

__all__ = ["Config", "Stage", "run"]
