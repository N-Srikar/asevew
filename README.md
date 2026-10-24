# WindLens — UK Wind Forecast Intelligence

WindLens is a full-stack pilot dashboard for examining GB national wind generation forecasts and their historical accuracy for purchasing decisions made in January 2026.

## What it does

- Reads actual wind generation from Elexon BMRS `FUELHH`, filtered to `fuelType=WIND`.
- Reads forecast versions from `WINDFOR`.
- Selects the latest forecast for each delivery interval that was published on or before the configured decision cutoff.
- Matches forecasts to actual generation using the target `startTime`.
- Calculates MAE, RMSE, forecast bias and coverage.
- Provides overview, forecast explorer and accuracy analysis views.

**Scope limitation:** these datasets do not contain total demand, market prices, thermal plant availability or actual procurement positions. The dashboard quantifies wind forecast error; it does not calculate a complete procurement requirement or financial savings.

## Architecture

- `frontend/`: React + Vite dashboard, Recharts visualizations, responsive styling.
- `backend/app/main.py`: FastAPI endpoints, Elexon API ingestion, forecast cutoff selection and metrics.
- `backend/tests/`: tests for metric calculations and point-in-time forecast selection.
- `docker-compose.yml`: local multi-service setup.
- `backend/Dockerfile`, `frontend/Dockerfile`: container builds.

## Data window and assumptions

- Decision dates: 1–31 January 2026.
- Delivery date: the calendar day after the decision date.
- Default decision cutoff: 12:00 Europe/London, configurable in the UI.
- Actual generation is selected for delivery dates 2 January–1 February 2026.
- Forecast history is retrieved from 25 December 2025 through 31 January 2026, allowing forecasts published before January to be considered when they were still the latest available at a January purchasing decision cutoff.
- Purchasing decision dates are restricted to 1–31 January 2026, and delivery is assumed to occur on the following calendar day.
- Forecasts published after the selected decision cutoff are excluded to prevent look-ahead bias.
- Actual generation is aggregated from two half-hourly observations into an hourly average. Incomplete hourly actual buckets are excluded from accuracy calculations and reduce coverage.
- January in the UK uses GMT (UTC), but timestamps are parsed as timezone-aware UTC and displayed in `Europe/London`.
- Only the latest forecast published on or before the cutoff is eligible for each target interval. Later forecast revisions are excluded to avoid look-ahead bias.
- FUELHH actuals are half-hourly while the observed WINDFOR target timestamps are hourly; actual MW values are averaged into hourly buckets before matching. Coverage is matched hourly intervals divided by 24 expected intervals per delivery day (monthly denominator: 31 × 24).
- Metric definitions: error = forecast − actual; MAE = mean absolute error; RMSE = square root of mean squared error; bias = mean signed error.
- Missing actuals are not imputed; they are excluded from error metrics and reduce coverage. If only one half-hourly actual is present in an hourly bucket, that available value is used and the current pilot does not separately flag partial-hour actual buckets.

These are explicit pilot assumptions, not a claim that 12:00 is the official UK market deadline. The assignment does not specify the precise operational cutoff. Confirm the required trading cutoff with the client if this were moved beyond a pilot.

## Data source APIs

- Actuals: https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream
- Forecasts: https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream
- API base used by the application: `https://data.elexon.co.uk/bmrs/api/v1`

The backend fetches data on first request and caches it for the lifetime of the Python process. Restart the backend to force a refresh. For a production service, replace this simple cache with a scheduled ETL job and persistent storage.

## Run locally with Docker

Prerequisite: Docker Desktop or Docker Engine with Docker Compose.

```bash
docker compose up --build
```

- Frontend: http://localhost:8080
- Backend health: http://localhost:8000/api/health
- API docs: http://localhost:8000/docs

Stop services:

```bash
docker compose down
```

## Run without Docker

Backend:

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Frontend in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. If using a different backend URL, set `VITE_API_BASE_URL` before running/building the frontend. Vite variables are embedded at build time.

## API endpoints

- `GET /api/health` — health check.
- `GET /api/metadata` — loaded record counts, data window and sources.
- `GET /api/overview?cutoff=12:00` — daily forecast/actual averages and summary metrics.
- `GET /api/forecasts?decisionDate=2026-01-15&cutoff=12:00` — interval-level forecast for the next delivery day.
- `GET /api/accuracy?cutoff=12:00` — monthly metrics and daily breakdown.

## Tests

```bash
cd backend
pip install -r requirements.txt
pip install pytest
pytest -q
```

## Deployment

Deploy the frontend as a Vercel project rooted at `frontend/`, with build command `npm run build`, output directory `dist`, and environment variable `VITE_API_BASE_URL` set to the public FastAPI service URL.

Deploy the backend folder as a Python web service with start command `uvicorn app.main:app --host 0.0.0.0 --port $PORT` (some hosts require a platform-specific start command). Set `CORS_ORIGINS` to the deployed frontend origin. Hosting providers and free-tier availability change; verify the current platform constraints before selecting a provider.

**Live application:** add the public deployment URL here after deployment.
**Public repository:** add the anonymous GitHub repository URL here after publishing.
**Demo video:** add the unlisted YouTube URL here after recording.

## AI tool disclosure

AI tools (ChatGPT) were used to assist with requirement breakdown, initial architecture, code scaffolding, and documentation. The implementation and analytical assumptions should be reviewed and tested before use in operational purchasing decisions.
