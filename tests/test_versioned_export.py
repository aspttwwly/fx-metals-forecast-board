import importlib.util
import json
from pathlib import Path
from unittest.mock import patch
import pytest

spec=importlib.util.spec_from_file_location('versioned_export',Path(__file__).resolve().parents[1]/'scripts/convert-data.py')
convert=importlib.util.module_from_spec(spec);spec.loader.exec_module(convert)


def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value),encoding='utf-8')


def test_issued_comparisons_only_use_eligible_first_vintages_and_realized_targets(tmp_path):
    from forecast_protocol import MODEL_VERSION,POLICY_VERSION
    base={'run_id':'20261003_010000','origin_date':'2026-10-02','recorded_at_utc':'2026-10-03T01:00:00Z',
        'source_data_cutoff':'2026-10-02','decision_policy_version':POLICY_VERSION,'model_version':MODEL_VERSION,
        'spot_at_origin':7,'forecasts':[{'target_date':'2026-10-09','horizon_weeks':1,'decision_forecast':7.1},
                                     {'target_date':'2026-10-16','horizon_weeks':2,'decision_forecast':7.2}]}
    save(tmp_path/'prophet output/snapshots/vintages/a/TEST.json',base)
    wrong={**base,'run_id':'20261003_000000','decision_policy_version':'old'}
    save(tmp_path/'prophet output/snapshots/vintages/b/TEST.json',wrong)
    duplicate={**base,'run_id':'20261004_010000','recorded_at_utc':'2026-10-04T01:00:00Z',
               'forecasts':[{'target_date':'2026-10-09','horizon_weeks':1,'decision_forecast':99}]}
    save(tmp_path/'prophet output/snapshots/vintages/c/TEST.json',duplicate)
    month={'originDate':'2026-09-30','policyVersion':'monthly-test','series':[
        {'date':'2026-10-31','horizon':1,'forecast':6.5},{'date':'2026-11-30','horizon':2,'forecast':6.4}]}
    save(tmp_path/'prophet output/long_horizon/vintages/a.json',{'issuedAt':'2026-10-01T01:00:00Z','pairs':{'TEST':{'monthly':month}}})
    save(tmp_path/'prophet output/long_horizon/vintages/b.json',{'issuedAt':'2026-10-02T01:00:00Z','pairs':{'TEST':{'monthly':{**month,'series':[{'date':'2026-10-31','horizon':1,'forecast':99}]}}}})
    data={'series':[{'date':'2026-10-02','actual':7},{'date':'2026-10-09','actual':7.05}],
          'longHorizon':{'monthly':{'policyVersion':'monthly-test','series':[{'date':'2026-09-30','actual':6.6},{'date':'2026-10-31','actual':6.55}]}}}
    with patch.object(convert,'FORECAST_PROJECT_DIR',tmp_path):
        result=convert.read_issued_comparisons('TEST',data)
    assert len(result['weekly'])==1 and result['weekly'][0]['forecast']==7.1
    assert len(result['monthly'])==1 and result['monthly'][0]['forecast']==6.5


def test_replay_sources_are_hashed_and_smoke_runs_refused(tmp_path):
    root=tmp_path/'prophet output/walkforward_v011';run=root/'run'
    pointer=root/'latest_run.json'
    save(pointer,{'runDir':str(run)})
    save(run/'protocol.json',{'version':'V0.1.1','smoke':1})
    save(run/'results/monthly/TEST.json',{})
    save(run/'progress/monthly_TEST.json',{})
    with patch.object(convert,'FORECAST_PROJECT_DIR',tmp_path),patch.object(convert,'WALKFORWARD_POINTER_PATH',pointer):
        paths=convert.extra_source_paths()
        assert run/'results/monthly/TEST.json' in paths
        assert run/'progress/monthly_TEST.json' in paths
        assert run/'status.json' in paths
        with pytest.raises(ValueError,match='smoke'):
            convert.read_versioned_replay('TEST')


def test_replay_pointer_cannot_escape_expected_directory(tmp_path):
    pointer=tmp_path/'prophet output/walkforward_v011/latest_run.json'
    save(pointer,{'runDir':str(tmp_path/'other')})
    with patch.object(convert,'FORECAST_PROJECT_DIR',tmp_path),patch.object(convert,'WALKFORWARD_POINTER_PATH',pointer):
        with pytest.raises(ValueError,match='directory'):
            convert.extra_source_paths()
        with pytest.raises(ValueError,match='directory'):
            convert.read_versioned_replay('TEST')


def test_v0_backfill_provenance_and_benchmark_rejection(tmp_path):
    root=tmp_path/'walkforward_v010';run=root/'run';pointer=root/'latest_run.json'
    save(pointer,{'runDir':str(run)})
    protocol={'version':'V0.1.0','benchmark':False,'purpose':'V010_BACKFILL','targetStart':'2024-01-01',
              'data_cutoff':'2026-10-14','limitations':[],'origins':['2023-12-29']}
    save(run/'protocol.json',protocol);save(run/'status.json',{'status':'RUNNING','updatedAt':'2026-10-15'})
    row={'version':'V0.1.0','backfill':'V0','target':'2024-01-05','origin':'2023-12-29','selectionCutoff':'2023-12-29'}
    result={'version':'V0.1.0','runId':'run','symbol':'TEST','backfill':'V0','rows':[row]}
    save(run/'results/weekly/TEST.json',result)
    with patch.object(convert,'LEGACY_BACKFILL_POINTER_PATH',pointer):
        data=convert.read_legacy_backfill('TEST')
        assert data['targetStart']=='2024-01-01'
        assert data['frequencies']['weekly']['rows'][0]['backfill']=='V0'
        row['selectionCutoff']='2024-01-01';save(run/'results/weekly/TEST.json',result)
        with pytest.raises(ValueError,match='provenance'):
            convert.read_legacy_backfill('TEST')
        save(run/'protocol.json',{**protocol,'benchmark':True})
        with pytest.raises(ValueError,match='benchmark'):
            convert.read_legacy_backfill('TEST')
