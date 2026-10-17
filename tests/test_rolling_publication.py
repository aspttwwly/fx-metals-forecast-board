import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('rolling_publication_test',ROOT/'scripts/rolling-publication.py')
publication=importlib.util.module_from_spec(spec);spec.loader.exec_module(publication)


def fixture():
    import calendar
    from datetime import date
    path=[]
    for h in range(13):
        index=2026*12+9+h
        year,month=divmod(index,12);target=date(year,month+1,calendar.monthrange(year,month+1)[1])
        path.append({'origin':'2026-10-31','target':str(target),'horizon':h,'forecast':1.+h*.01,'anchor':1.})
    item={'data':{'status':'READY','missingSessions':[],'originDate':'2026-10-31','scheduledOrigin':'2026-10-31',
            'rawDataCutoff':'2026-10-30','expectedLastSession':'2026-10-30','calendarVersion':'test',
            'calendarSha256':'a'*64,'rawSha256':'b'*64},'path':path,'chainVersion':'rolling_full_price_chain_v1_20261018',
            'selection':{'decision':'KEEP_OLD'},'parameters':{'window':120}}
    batch={'frequency':'monthly','status':'ISSUED_REFERENCE','runId':'monthly-test','modelVersion':'V0.1.2',
           'policyVersion':'rolling_reference_mae3_v1_20261018','issuedAt':'2026-10-31T12:00:00+08:00',
           'referenceOnly':True,'eligibleForExecution':False,'pairs':{'AUDUSD':item}}
    return batch,item


class RollingPublicationTests(unittest.TestCase):
    def test_contract_keeps_raw_date_independent_of_month_label(self):
        batch,item=fixture();doc=publication.consumer_document(batch,item,'AUDUSD')
        self.assertEqual(doc['sourceDataCutoff'],'2026-10-30')
        self.assertEqual(doc['latestActual']['date'],'2026-10-31')
        self.assertEqual(len(doc['forecasts']),12)
        self.assertEqual(doc['quality']['sampleCount'],0)
        self.assertFalse(doc['eligibleForExecution'])

    def test_incomplete_data_wrong_targets_and_nonfinite_values_cannot_publish(self):
        changes=[lambda b,i:i['data'].update(status='RESEARCH_ONLY'),lambda b,i:i['data'].update(missingSessions=['2026-10-30']),
                 lambda b,i:i['path'][1].update(target='2026-11-29'),lambda b,i:i['path'][2].update(forecast=float('nan')),
                 lambda b,i:b.update(issuedAt='2026-10-31T12:00:00'),lambda b,i:b.update(eligibleForExecution=True)]
        for change in changes:
            batch,item=fixture();change(batch,item)
            with self.assertRaises(ValueError):publication.consumer_document(batch,item,'AUDUSD')

    def test_daily_compose_preserves_api_and_forecast_bytes_semantics(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/'public/data';api=source/'api-v1/data';api.mkdir(parents=True)
            old={'symbol':'AUDUSD','frequency':'weekly','modelVersion':'V0.1.1','forecastScope':'PUBLISHED_FORECAST',
                 'generationId':'old-generation','generatedAt':'2026-10-01T04:00:00Z','forecasts':[{'forecast':1.2}]}
            body=publication.encode(old);sha=hashlib.sha256(body).hexdigest();(api/f'{sha}.json').write_bytes(body)
            manifest={'generationId':'old-generation','catalog':[{**{k:old[k] for k in ('symbol','frequency','modelVersion','forecastScope')},
                      'dataPath':f'/api/v1/data/{sha}.json','sha256':sha}]}
            (source/'api-v1/manifest.json').write_bytes(publication.encode(manifest))
            (source/'manifest.json').write_bytes(publication.encode({'symbols':[{'symbol':'AUDUSD'}],'updatedAt':'old'}))
            current={'symbol':'AUDUSD','series':[{'date':'2026-10-09','forecast':1.2}],'sourceUpdatedAt':'old','latestActual':{'date':'2026-10-02','value':1.}}
            (source/'AUDUSD.json').write_bytes(publication.encode(current))
            converter=SimpleNamespace(FORECAST_PROJECT_DIR=root/'backend',read_daily_actuals=lambda *a,**k:{'rows':[{'date':'2026-10-15','value':1.1}]})
            publication.compose(root,root/'stage',converter)
            new=publication.read(root/'stage/AUDUSD.json')
            for key,value in current.items():self.assertEqual(new[key],value)
            self.assertEqual((root/'stage/api-v1/manifest.json').read_bytes(),(source/'api-v1/manifest.json').read_bytes())
            self.assertEqual((root/'stage/api-v1/data'/f'{sha}.json').read_bytes(),body)
            self.assertEqual(publication.read(source/'AUDUSD.json'),current)


if __name__=='__main__':unittest.main()
