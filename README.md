# WindLens — UK Wind Forecast Intelligence

WindLens is a full-stack pilot dashboard for examining Great Britain (GB) national wind generation forecasts and their historical accuracy for day-ahead purchasing decisions made in January 2026.

**Live application:** https://asevew.vercel.app/

**Backend API:** https://windlens-api-2209.onrender.com/

## What it does

- Reads actual wind generation from Elexon BMRS `FUELHH`, filtered to `fuelType=WIND`.
- Reads forecast versions from `WINDFOR`.
- Selects the latest forecast for each delivery interval that was published on or before the configured decision cutoff.
- Matches forecasts to actual generation using the target `startTime`.
- Calculates mean absolute error (MAE), root mean squared error (RMSE), forecast bias, and coverage.
- Provides overview, forecast explorer, and accuracy analysis dashboards.

**Scope limitation:** These datasets do not contain total demand, market prices, thermal plant availability, or actual procurement positions. The dashboard quantifies wind forecast error; it does not calculate a complete procurement requirement or financial savings.

## Architecture

- `frontend/`: React + Vite dashboard, Recharts visualizations, and responsive styling.
- `backend/app/main.py`: FastAPI endpoints, Elexon API ingestion, forecast cutoff selection, and metric calculations.
- `backend/tests/`: Tests for metric calculations, timestamp parsing, incomplete actual-data buckets, and point-in-time forecast selection.
- `docker-compose.yml`: Local multi-service setup.
- `backend/Dockerfile`, `frontend/Dockerfile`: Container build configurations.
- `vercel.json`: Frontend deployment configuration.

## Data window and assumptions

- Decision dates: 1–31 January 2026.
- Delivery date: the calendar day after the decision date.
- Default decision cutoff: 12:00 Europe/London, configurable in the UI.
- Actual generation is selected for delivery dates 2 January–1 February 2026.
- Forecast history is retrieved from 25 December 2025 through 31 January 2026, allowing forecasts published before January to be considered when they were still the latest available at a January purchasing decision cutoff.
- Forecasts published after the selected decision cutoff are excluded to prevent look-ahead bias.
- The latest eligible forecast version is selected separately for each delivery interval.
- FUELHH actuals are half-hourly, while the observed WINDFOR target timestamps are hourly. Actual generation is aggregated into hourly averages using two half-hourly observations.
- Hourly actual buckets with fewer than two valid half-hourly observations are excluded rather than imputed.
- Missing forecast or actual values are not included in error metrics and reduce coverage.
- Coverage is the number of valid hourly forecast–actual pairs divided by 24 expected intervals per delivery day. The monthly denominator is 31 × 24 = 744 intervals.
- January in the UK uses GMT (UTC). Timestamps are parsed as timezone-aware values and displayed in Europe/London.
- Metric definitions:
  - Error = forecast − actual.
  - MAE = mean absolute error.
  - RMSE = square root of mean squared error.
  - Bias = mean signed error; positive bias indicates overforecasting.

These are explicit pilot assumptions, not a claim that 12:00 is the official UK market deadline. The assignment does not specify the precise operational cutoff. Confirm the required trading cutoff with the client before using this approach operationally.

## Data source APIs

- Actuals: https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream
- Forecasts: https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream
- API base used by the application: `https://data.elexon.co.uk/bmrs/api/v1`

The backend fetches data on the first request and caches it for the lifetime of the Python process. Restarting the backend forces a refresh. For a production service, a scheduled ETL job and persistent storage would provide more robust data management.

## Run locally with Docker

Prerequisite: Docker Desktop or Docker Engine with Docker Compose.

```bash
docker compose up --build
```

- Frontend: http://localhost:8080
- Backend health: http://localhost:8000/api/health
- API documentation: http://localhost:8000/docs

Stop services:

```bash
docker compose down
```

## Run without Docker

### Backend

```bash
cd backend
python -m venv .venv
```

Activate the environment:

```bash
# Windows
.venv\Scripts\activate

# macOS/Linux
source .venv/bin/activate
```

Install dependencies and start the API:

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

For local development, configure `VITE_API_BASE_URL` to the backend base URL, such as `http://localhost:8000`. Vite variables are embedded at build time. The backend's `CORS_ORIGINS` setting must include the frontend origin.

## API endpoints

- `GET /api/health` — health check.
- `GET /api/metadata` — loaded record counts, data window, and sources.
- `GET /api/overview?cutoff=12:00` — daily forecast/actual averages and summary metrics.
- `GET /api/forecasts?decisionDate=2026-01-15&cutoff=12:00` — interval-level forecast for the next delivery day.
- `GET /api/accuracy?cutoff=12:00` — monthly metrics and daily breakdown.

## Tests

From the project root:

```bash
cd backend
pip install -r requirements.txt
pip install pytest
python -m pytest tests/test_metrics.py -v
```

The current test suite contains six tests covering metric calculations, empty metric inputs, forecast selection before a cutoff, timestamp parsing, incomplete hourly actuals, and missing actuals.

## Deployment

### Frontend — Vercel

- Production URL: https://asevew.vercel.app/
- Root directory: `frontend/`
- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Environment variable: `VITE_API_BASE_URL`, set to the public backend base URL.

### Backend — Render

- Base URL: https://windlens-api-2209.onrender.com/
- Health endpoint: https://windlens-api-2209.onrender.com/api/health
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Environment variable: `CORS_ORIGINS`, configured to allow the deployed Vercel frontend origin and any required local development origins.

The frontend and backend have been deployed and their connectivity verified.

## AI tool disclosure

ChatGPT was used to assist with requirement breakdown, architecture planning, code scaffolding, implementation guidance, debugging, and documentation. The application was tested locally and after deployment. The analytical assumptions and limitations are documented above; the dashboard should not be treated as a complete procurement or financial decision system.
