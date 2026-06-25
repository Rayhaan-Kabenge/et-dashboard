"""Shared test fixtures / path setup."""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent

# make `import app...` work regardless of where pytest is invoked from
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

SAMPLE_DIR = BACKEND / "app" / "sample_sheet"
REFERENCE_DIR = ROOT / "reference"
WORKBOOK = REFERENCE_DIR / "2017_2023_ETschudelr_Code.xlsm"
