# FX → LFE read-only contract v1

Existing origin: `https://fx-metals-forecast-board.aspttwwly888.workers.dev`.
The API is not live until this release is deployed and read back successfully.

1. GET `/api/v1/manifest.json` (HEAD also supported). Capture `generationId` once.
2. Select a catalog item by exact `(symbol, frequency, modelVersion, forecastScope)`.
3. GET its same-origin `dataPath`; only `/api/v1/data/<64 lowercase hex>.json` is valid.
4. Verify SHA-256 over the HTTP-decoded original UTF-8 response bytes **before JSON parsing**, not reserialized JSON. Compare `generationId` and all four dimensions with the manifest. On mismatch/missing objects, reject the entire read and re-fetch a new manifest; never combine generations.

The manifest has `schemaVersion: 1`, `generationId`, `publishedAt` (UTC artifact-publication-batch timestamp), and `catalog`. Each item has `symbol`, `frequency`, `modelVersion`, `forecastScope`, `dataPath`, `sha256`. Publication is atomic at the manifest switch; immutable content objects are written first. Manifest timestamps are not forecast freshness. `publishedAt` records packaging, not confirmation that a remote deployment succeeded.

Each forecast body repeats schema/generation/dimensions and includes:

- `modelVersion: V0.1.1`; `frequency: weekly | monthly`; `forecastScope: PUBLISHED_FORECAST`. This means actually generated as an issued vintage, **not trading admission**. Historical research replay and V0 backfills are excluded from this business catalog.
- `runId`: the actual issued long-horizon vintage, never the replay run ID. Weekly also has `productionRunId` for its preserved first 13 points. `engineVersion`, `policyVersion`, and weekly `extensionPolicyVersion` distinguish algorithms from the dashboard release.
- `generatedAt`: UTC timestamp at which the complete weekly/monthly bundle was generated, read from the immutable issued sidecar. It is never derived from file modification time. Each point also has `generatedAt`; weekly 1–13 keep their original production generation timestamp.
- `sourceDataCutoff`: last underlying market-data date. `latestActual: {date, value}` is the latest complete Friday/month-end sample used as forecast origin. Month-end lag is normal: do not apply a seven-day weekly age rule to monthly `latestActual`.
- `forecasts`: ordered complete horizons (weekly 1–52, monthly 1–12). Each point has `targetDate`, `horizon`, `forecast`, `actual: null`, `lower: null`, `upper: null`, and `referenceOnly`. Natural month-end dates use the last available trading close; monthly forecasts are trained independently, never resampled weekly forecasts. Weekly first 13 values preserve the dashboard's existing precision and values. No calibrated confidence interval is claimed.
- `defaultHorizon`: 13 weekly / 3 monthly. Shortening the display only slices the same array. `maximumHorizon`: 52 / 12.
- `quality`: default-horizon as-issued evidence; `qualityByHorizon`: one record for each exact horizon. Always use the record matching the selected horizon. Fields: `scope: AS_ISSUED`, `frequency`, `horizon`, `sampleCount`, `evaluationCutoff`, `mape`, `rmse`, `mae`, `directionAccuracy`, `eligibleForExecution: false`. MAPE and direction accuracy are fractions, not percentages. MAE/RMSE use quote units. Empty evidence yields zero samples and null scores, never replay fallback. Flat direction counts as a third sign class.
- `eligibleForExecution: false` always at body and quality-record level; `referenceOnly: true` always at body and forecast-point level. The entire first API release is read-only/reference-only, including weekly horizons 1–13. Forecast publication does not authorize orders, hedges, transactions, or promotion of production parameters.
- `businessTimezone: Asia/Shanghai`: underlying source cutoff must precede the local issued business day. A forecast may be issued on its labelled target day; target dates label the complete weekly/monthly period, not an intraday close timestamp. Consumers must not mistake a same-day labelled target for an already realized close. All `actual` values in future forecast objects stay null.

The API accepts GET/HEAD only, rejects arbitrary filenames and query-based file resolution, and exposes no LFE client/position data or write-back route. Existing advanced-view Basic authentication is unchanged. It is intended for LFE's server-side fetch/proxy; no permissive credentialed CORS is added. Consumers should preserve their existing client/session boundary and keep received FX data as a bounded read-only snapshot.

Contract fixtures (synthetic, `fixture: true`; never business data):

- `tests/fixtures/consumer-api/manifest.json`
- `tests/fixtures/consumer-api/data/0dddda59c9fbf18740aff42b65c9c08c531c8ca2b16cca4aa92f2973f360695e.json` (weekly)
- `tests/fixtures/consumer-api/data/2425d38f8c693361fb90684061941cba6e18e71da8eab274b1c6a5de52e8a108.json` (monthly)

Serve the fixture folder at `/api/v1/` for consumer tests; their manifest SHA-256 includes the files' terminal newline. Production JSON is compact UTF-8 without a terminal newline, and always hashed from its exact emitted bytes.
