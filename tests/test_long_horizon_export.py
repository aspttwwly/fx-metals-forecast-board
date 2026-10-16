import copy
import importlib.util
from pathlib import Path
from unittest.mock import patch
import pytest

spec = importlib.util.spec_from_file_location("frequency_export", Path(__file__).resolve().parents[1] / "scripts/convert-data.py")
convert = importlib.util.module_from_spec(spec)
spec.loader.exec_module(convert)


def sample(tmp_path):
    for name in ["USDCNH_diff_0th_diff.xlsx", "USDCNH_forecast.xlsx"]:
        (tmp_path / name).touch()
    history = [("2026-10-09",7.)]
    forecast = [("2026-10-09",7.), ("2026-10-16",7.1)]
    long = {"issuedAt":"2026-10-15T07:00:00Z", "runId":"test", "pairs":{"USDCNH":{
        "sourceDataCutoff":"2026-10-14", "weekly":{"originDate":"2026-10-09",
            "series":[{"date":date,"forecast":value} for date,value in forecast]},
        "monthly":{"status":"RESEARCH_ONLY"}}}}
    def read(path):
        return history if "diff" in path.name else forecast
    return read, long


def build(tmp_path, read, long):
    with patch.object(convert,"UPLOAD_DIR",tmp_path), patch.object(convert,"read_two_column_xlsx",read), \
         patch.object(convert,"read_versioned_replay",return_value=None), \
         patch.object(convert,"read_issued_comparisons",return_value={"weekly":[],"monthly":[]}):
        return convert.build_symbol("USDCNH", {}, {}, {"USDCNH":{"sourceDataCutoff":"2026-10-14T00:00:00"}}, {}, {}, {}, {}, long)


def test_research_export_uses_calendar_date_and_keeps_original_values(tmp_path):
    read,long=sample(tmp_path)
    result=build(tmp_path,read,long)
    assert result["longHorizon"]["runId"]=="test"
    assert result["nextForecast"]["value"]==7.1


def test_stale_or_changed_prefix_is_rejected(tmp_path):
    read,long=sample(tmp_path)
    wrong=copy.deepcopy(long); wrong["pairs"]["USDCNH"]["sourceDataCutoff"]="2026-10-13"
    with pytest.raises(ValueError,match="dates disagree"):
        build(tmp_path,read,wrong)
    wrong=copy.deepcopy(long); wrong["pairs"]["USDCNH"]["weekly"]["series"][1]["forecast"]=99
    with pytest.raises(ValueError,match="prefix differs"):
        build(tmp_path,read,wrong)
