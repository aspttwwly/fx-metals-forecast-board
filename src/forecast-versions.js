import { selectForecast, validateHorizon } from './forecast-frequency.js?v=20261015-versions-v1';

export const VERSION_NOTES = {
  'V0.1.2': '统一滚动增量：周/月分别寻优、分别发行；日常只更新实际行情。候选 MAE 至少改善 3%，RMSE 和方向表现不恶化，且独立样本与稳定性合格后才替换参考参数。尚未验证的残差和周期候选不进入正式路径。',
  'V0.1.0': '修复前原版：从 2024 年起展示。原始留存保持原值，含旧版未完周标签和混合期限；历史重算使用冻结旧版核心，单独标注，不冒充当年发布。保留旧版算法缺陷；没有月频或 14–52 周预测。',
  'V0.1.1': '较 V0.1.0 修正：排除未完成周/月；训练与特征严格按历史时点截断；统一预测起点；误差修正、集成权重只用已知结果；历史回测与真实发布分开。新增独立月频、长周频和逐期寻优回放。',
};

export function versionedView(current, legacy, version, frequency, horizon, source='backtest', historyHorizon=frequency==='monthly'?3:13) {
  if (!VERSION_NOTES[version]) throw new Error('未知版本');
  const comparisonHorizon=validateHorizon(frequency,historyHorizon);
  if (version === 'V0.1.2') {
    const batch=current.rollingReference?.[frequency];
    if (!batch) throw new Error(`V0.1.2 ${frequency==='weekly'?'周频':'月频'}正式批次尚未发行；现有预测仍可在 V0.1.1 查看`);
    const selected=validateHorizon(frequency,horizon);
    const future=batch.series.filter(row=>row.horizon>0).slice(0,selected).map(row=>({...row}));
    if (future.length!==selected) throw new Error('独立滚动批次的预测期限不完整');
    const history=new Map(((frequency==='monthly'?current.longHorizon?.monthly?.series:current.series)||[]).map(row=>[row.date,row]));
    for(const row of batch.issuedActuals||[]) history.set(row.date,row);
    const series=[...history.values()].filter(row=>row.date>='2025-01-01' && row.date<batch.latestActual.date && Number.isFinite(row.actual))
      .map(row=>({...row,forecast:null,historicalForecast:null,future:false,lower:null,upper:null}));
    series.push({...batch.series[0],historicalForecast:null},...future);
    const byDate=new Map(series.map(row=>[row.date,row]));
    const comparisons=(batch.issuedComparisons||[]).filter(row=>row.horizon===comparisonHorizon && row.target<=batch.latestActual.date);
    for(const row of comparisons) {
      const point=byDate.get(row.target)||{date:row.target,forecast:null,future:false,lower:null,upper:null};
      byDate.set(row.target,{...point,actual:row.actual,historicalForecast:row.forecast,
        predictionOrigin:row.origin,comparisonHorizon,comparisonScope:'AS_ISSUED'});
    }
    const quality=batch.qualityByHorizon?.find(row=>row.horizon===comparisonHorizon);
    const deviation=future[0].forecast-batch.latestActual.value;
    return {...current, ...batch, appVersion:version, frequencyKey:frequency,
      frequency:frequency==='monthly'?'月频':'周频', selectedHorizon:selected, comparisonHorizon,
      latestActual:{...batch.latestActual}, series:[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)), nextForecast:{date:future[0].date,value:future[0].forecast},
      selectedEnd:{date:future.at(-1).date,value:future.at(-1).forecast}, deviation,
      direction:deviation>0?'上行':deviation<0?'下行':'持平',
      sourceUpdatedAt:batch.issuedAt, generatedAt:batch.issuedAt.slice(0,10),
      trainEnd:batch.latestActual.date,
      displaySourceCutoff:batch.sourceDataCutoff, forecastScope:'ROLLING_REFERENCE_AS_ISSUED',
      evidenceMode:'issued', qualityLabel:'真实发布 · 证据积累中', qualityMetrics:quality?{...quality,n:quality.sampleCount}: {},
      historyStart:'2025-01-01', firstTarget:null, replayProgress:null, replayRunId:null,
      modelMonitor:null, modelAdmission:null, parameterLifecycle:null, forecastEvidence:null,
      replayEvidence:null, terrain:null, tradeSignal:null, files:{},
      researchNote:VERSION_NOTES[version],
      comparisonNote:`本期参数：${batch.selection.decision==='PROMOTE_REFERENCE_ONLY'?'新参数通过验证':'继续使用旧参数'}。${batch.selection.selectedBaselineLabel||batch.selection.baselineLabel||'独立样本不足，尚不能判定是否优于简单基准'}（历史留出区间比较）。正式路径保持原发行值；历史回测不计入本版本真实发布成绩。`};
  }
  if (version === 'V0.1.0') {
    if (!legacy) throw new Error('原版快照不可用，未使用新版数据替代');
    if (frequency !== 'weekly' || horizon > 13 || comparisonHorizon > 13) throw new Error('V0.1.0 的未来显示和历史对照仅支持周频 1–13 周；请选择 V0.1.1 查看月频或长周频');
    const data = selectForecast(legacy,'weekly',horizon);
    data.comparisonHorizon=comparisonHorizon;
    data.appVersion=version; data.evidenceMode='legacy'; data.files={};
    data.forecastScope='LEGACY_SNAPSHOT';
    data.series=data.series.map(row=>({...row,historicalForecast:!row.future?row.forecast:null,
      forecast:row.future || row.date===data.latestActual.date?row.forecast:null}));
    data.qualityMetrics={}; data.qualityLabel='旧版留存';
    data.historyStart='2024-01-01';
    data.comparisonNote='原版留存从 2024-01-01 起显示；缺测处仅显示真实留存点，不插值补线。混合预测期限，不作为同期限回测评分。';
    const backfill=current.legacyBackfill, replay=backfill?.frequencies?.weekly;
    if(source==='backtest' && backfill) {
      data.evidenceMode='backtest'; data.replayProgress=replay || {status:'QUEUED'};
      data.replayRunId=backfill.runId; data.qualityLabel='旧版历史重算';
      data.qualityMetrics=replay?.metrics?.find(r=>r.horizon===comparisonHorizon)||{};
      const rows=(replay?.rows||[]).filter(r=>r.horizon===comparisonHorizon && Number.isFinite(r.actual));
      data.firstTarget=rows.map(row=>row.target).sort()[0] || null;
      if(rows.some(r=>r.version!=='V0.1.0'||r.backfill!=='V0')) throw new Error('旧版重算来源不符');
      const byDate=new Map(data.series.map(row=>[row.date,{...row,historicalForecast:null}]));
      for(const row of rows) byDate.set(row.target,{...(byDate.get(row.target)||{date:row.target,forecast:null,lower:null,upper:null,future:false}),
        actual:row.actual,historicalForecast:row.forecast,predictionOrigin:row.origin,
        comparisonHorizon,comparisonScope:'LEGACY_WALKFORWARD_BACKFILL',backfill:'V0'});
      data.series=[...byDate.values()];
      const status={COMPLETE:'已完成',RUNNING:'运行中',FAILED:'失败',QUEUED:'排队中'}[replay?.status]||'等待生成';
      data.comparisonNote=`V0.1.0 旧版历史重算${status} ${replay?.completed||0}/${replay?.total||'--'} 个起点；目标窗口自 2024-01-01，首个成熟目标 ${data.firstTarget||'暂无'}，数据截至 ${backfill.cutoff}，按 ${comparisonHorizon} 周期限对齐。每周重选参数，保留旧版数值核心，不是当年发布记录。未来段仍为原版发布留存。${rows.length?'':'所选期限尚无已完成历史目标；可切换“原始发布留存”查看已有预测点。'}`;
    }
    data.series=data.series.filter(r=>r.date>=data.historyStart).sort((a,b)=>a.date.localeCompare(b.date));
    data.researchNote=VERSION_NOTES[version];
    return data;
  }
  let data=selectForecast(current,frequency,horizon);
  data.comparisonHorizon=comparisonHorizon;
  data.displaySourceCutoff=current.longHorizon?.sourceDataCutoff || current.modelMonitor?.sourceDataCutoff || null;
  data.appVersion=version; data.evidenceMode=source;
  data.historyStart='2025-01-01';
  data.series=data.series.map(row=>({...row,historicalForecast:null}));
  const replay=current.walkforward?.frequencies?.[frequency];
  data.replayProgress=replay || {status:'QUEUED',completed:0};
  data.replayRunId=current.walkforward?.runId;
  if(source==='backtest') {
    data.qualityLabel={COMPLETE:'历史回测',RUNNING:'回测运行中',FAILED:'回测失败',QUEUED:'回测排队中'}[replay?.status]||'等待回测';
    data.qualityMetrics=replay?.metrics?.find(row=>row.horizon===comparisonHorizon) || {};
    const rows=(replay?.rows || []).filter(row=>row.horizon===comparisonHorizon && Number.isFinite(row.actual));
    data.firstTarget=rows.map(row=>row.target).sort()[0] || null;
    const byDate=new Map(data.series.map(row=>[row.date,row]));
    for(const row of rows) {
      const point=byDate.get(row.target) || {date:row.target,forecast:null,lower:null,upper:null,future:false};
      byDate.set(row.target,{...point,actual:row.actual,historicalForecast:row.forecast,
        predictionOrigin:row.origin,comparisonHorizon,comparisonScope:'WALKFORWARD_RESEARCH'});
    }
    data.series=[...byDate.values()];
    const currentReplay=replay?.status==='COMPLETE'&&replay.latest?.origin===data.latestActual.date;
    if(currentReplay) {
      // The research current forecast uses the SAME reselect-and-activate rule as
      // its historical comparison; production's preserved path remains in Issued.
      const latest=replay.latest;
      data.latestActual={date:latest.origin,value:latest.anchor};
      const future=latest.forecast.filter(row=>row.horizon>0 && row.horizon<=horizon);
      data.series=data.series.filter(row=>row.date<=latest.origin).map(row=>({...row,forecast:null,lower:null,upper:null,future:false}));
      const anchor=data.series.find(row=>row.date===latest.origin);
      if(anchor) anchor.forecast=latest.anchor;
      data.series.push(...future.map(row=>({...row,actual:null,lower:null,upper:null,future:true})));
      data.nextForecast={date:future[0].date,value:future[0].forecast};
      data.selectedEnd={date:future.at(-1).date,value:future.at(-1).forecast};
      data.deviation=data.nextForecast.value-latest.anchor;
      data.direction=data.deviation>0?'上行':data.deviation<0?'下行':'持平';
      data.modelVersion=`${version} ${frequency==='weekly'?'周频':'月频'} · 逐期寻优研究`;
      data.forecastScope='WALKFORWARD_RESEARCH_CURRENT';
      data.displaySourceCutoff=current.walkforward.cutoff;
      data.sourceUpdatedAt=current.walkforward.updatedAt;
      data.generatedAt=current.walkforward.updatedAt.slice(0,10);
      data.modelMonitor=null; data.modelAdmission=null; data.parameterLifecycle=null;
      data.forecastEvidence=null; data.replayEvidence=null; data.terrain=null; data.tradeSignal=null; data.files={};
      data.trainingMonths=latest.parameters.window || latest.parameters.WindowMonths;
      data.trainEnd=latest.origin;
      if(frequency==='monthly') {
        const end=new Date(`${latest.origin}T00:00:00Z`);
        data.trainStart=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()-data.trainingMonths+2,0)).toISOString().slice(0,10);
      }
      data.policyVersion=replay.protocol;
      data.researchNote='本期研究预测与历史回测使用相同的逐期寻优、即时启用规则；不覆盖原始发布预测，不产生交易准入。';
    }
    const status={COMPLETE:'已完成',RUNNING:'运行中',QUEUED:'排队中',FAILED:'失败'}[replay?.status] || '等待生成';
    data.comparisonNote=`${version} ${frequency==='weekly'?'周频':'月频'} · 回测${status} ${replay?.completed||0}/${replay?.total||'--'} 个起点；目标窗口自 ${current.walkforward?.targetStart||'2025-01-01'}，首个成熟目标 ${data.firstTarget||'暂无'}，数据截至 ${current.walkforward?.cutoff||'--'}，按 ${comparisonHorizon} ${frequency==='weekly'?'周':'个月'}期限对照。${currentReplay?'右侧未来段为同规则最新研究预测。':replay?.status==='COMPLETE'?'回测起点已落后于当前行情；未来段保留最新原始发布预测。':'结果尚不完整；未来段暂保留原已发布预测。'}`;
    if(!rows.length) data.comparisonNote+=' 当前所选期限尚未生成历史预测目标，因此暂无历史预测线；不是实际值或原版预测被删除。原版留存在 V0.1.0 中。';
  } else {
    const rows=(current.issuedComparisons?.[frequency] || []).filter(row=>row.horizon===comparisonHorizon);
    const byDate=new Map(rows.map(row=>[row.target,row]));
    data.series=data.series.map(point=>{
      const row=byDate.get(point.date);
      return row?{...point,historicalForecast:row.forecast,predictionOrigin:row.origin,comparisonHorizon,
                  comparisonScope:'AS_ISSUED'}:point;
    });
    const row=frequency==='weekly'?current.forecastEvidence?.current?.horizons?.find(row=>row.horizonWeeks===comparisonHorizon):
      current.longHorizon?.monthly?.evidence?.horizons?.find(row=>row.horizonMonths===comparisonHorizon);
    const mature=rows.filter(r=>Number.isFinite(r.actual)&&Number.isFinite(r.forecast));
    data.firstTarget=mature.map(row=>row.target).sort()[0] || null;
    data.qualityMetrics=mature.length?{
      n:mature.length,mae:mature.reduce((s,r)=>s+Math.abs(r.forecast-r.actual),0)/mature.length,
      rmse:Math.sqrt(mature.reduce((s,r)=>s+(r.forecast-r.actual)**2,0)/mature.length),
      mape:mature.reduce((s,r)=>s+Math.abs((r.forecast-r.actual)/r.actual),0)/mature.length,
    }:row?{...row,n:row.observations}:{}; data.qualityLabel='真实发布';
    data.comparisonNote=`仅显示真正发布后已兑现的 ${comparisonHorizon} ${frequency==='weekly'?'周':'个月'}期限预测；尚无成熟目标时不伪造历史预测线。回测记录不计入此处。`;
  }
  data.series=data.series.filter(r=>r.date>=data.historyStart).sort((a,b)=>a.date.localeCompare(b.date));
  return data;
}

export function recentComparison(rows,horizon,frequency) {
  const width=frequency==='monthly'?6:13;
  const valid=rows.filter(r=>r.horizon===horizon&&Number.isFinite(r.actual)).sort((a,b)=>a.target.localeCompare(b.target));
  if(valid.length<2*width) return `待满 ${2*width} 期（当前 ${valid.length}）`;
  const stats=part=>{
    const rmse=Math.sqrt(part.reduce((s,r)=>s+(r.forecast-r.actual)**2,0)/part.length);
    const baseline=Math.sqrt(part.reduce((s,r)=>s+(r.anchor-r.actual)**2,0)/part.length);
    return {skill:baseline?1-rmse/baseline:null,direction:part.filter(r=>Math.sign(r.forecast-r.anchor)===Math.sign(r.actual-r.anchor)).length/part.length};
  };
  const before=stats(valid.slice(-2*width,-width)),after=stats(valid.slice(-width));
  const deterioration=after.direction-before.direction<=-.1 || (before.skill!==null&&after.skill!==null&&after.skill-before.skill<=-.1);
  return `${deterioration?'提示观察':'未触发观察'} · 最近 ${width} 期 / 前 ${width} 期（非显著性检验）`;
}

export function comparisonCsv(data) {
  const quote=value=>`"${String(value??'').replaceAll('"','""')}"`;
  const header=['version','symbol','frequency','source','target_date','origin_date','horizon','actual','forecast','error_forecast_minus_actual','scope','backfill','replay_run_id'];
  const rows=data.series.filter(row=>Number.isFinite(row.actual)&&Number.isFinite(row.historicalForecast));
  return '\ufeff'+[header,...rows.map(row=>[data.appVersion,data.symbol,data.frequencyKey,data.evidenceMode,row.date,
    row.predictionOrigin,row.comparisonHorizon,row.actual,row.historicalForecast,row.historicalForecast-row.actual,
    row.comparisonScope||'LEGACY_ARCHIVE_MIXED_HORIZON',row.backfill||'',data.evidenceMode==='backtest'?data.replayRunId:''])]
    .map(row=>row.map(quote).join(',')).join('\r\n');
}
