import subprocess
import sys
from pathlib import Path


def test_local_floorplan_recon_script_runs_against_sample_data() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    script_path = repo_root / "scripts" / "run_floorplan_recon.py"
    boa_file = repo_root / "sample-data" / "boa_floorplan_sample.csv"
    dealertrack_file = repo_root / "sample-data" / "dealertrack_floorplan_sample.csv"

    result = subprocess.run(
        [
            sys.executable,
            str(script_path),
            "--boa-file",
            str(boa_file),
            "--dealertrack-file",
            str(dealertrack_file),
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert "matched count: 3" in result.stdout
    assert "exceptions count: 3" in result.stdout
    assert "duplicates count: 1" in result.stdout
    assert "BOA-only rows: 1" in result.stdout
    assert "Dealertrack-only rows: 1" in result.stdout
    assert "duplicate Dealertrack rows: 1" in result.stdout
    assert "reason=stock_number_amount | confidence=0.92" in result.stdout
    assert "stock=M20657" in result.stdout
    assert "stock=M20450" in result.stdout
