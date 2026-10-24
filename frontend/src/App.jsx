import React, { useEffect, useMemo, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis, BarChart, Bar
} from "recharts";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarDays,
  CheckCircle2, ChevronDown, Clock3, Cloud, Database, Gauge, RefreshCw,
  ShieldCheck, Wind, Zap
} from "lucide-react";

const API = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");
const fmt = (v, digits=0) => v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toLocaleString("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const dateLabel = (s) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
const timeLabel = (s) => new Date(s).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

function Kpi({label, value, suffix, note, icon: Icon, tone="blue"}) {
  return <div className="kpi">
    <div className="kpi-top"><span>{label}</span><span className={`icon-chip ${tone}`}><Icon size={17}/></span></div>
    <div className="kpi-value">{value}<small>{suffix || ""}</small></div>
    <div className="kpi-note">{note}</div>
  </div>;
}
function Panel({title, subtitle, children, action}) {
  return <section className="panel">
    <div className="panel-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>
    {children}
  </section>;
}
function Empty({message}) { return <div className="empty"><AlertTriangle size={20}/><span>{message}</span></div>; }

export default function App() {
  const [page, setPage] = useState("overview");
  const [cutoff, setCutoff] = useState("12:00");
  const [decisionDate, setDecisionDate] = useState("2026-01-15");
  const [overview, setOverview] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [explorer, setExplorer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");

  async function getJson(path) {
    const response = await fetch(`${API}${path}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || `Request failed (${response.status})`);
    return body;
  }
  async function loadMain() {
    setLoading(true); setError("");
    try {
      const [o, a] = await Promise.all([
        getJson(`/api/overview?cutoff=${encodeURIComponent(cutoff)}`),
        getJson(`/api/accuracy?cutoff=${encodeURIComponent(cutoff)}`)
      ]);
      setOverview(o); setAccuracy(a); setLastUpdated(o.loadedAt || "");
    } catch (e) {
      setError(`${e.message}. Confirm the backend is running and can reach the Elexon API.`);
    } finally { setLoading(false); }
  }
  async function loadExplorer() {
    setError("");
    try {
      const data = await getJson(`/api/forecasts?decisionDate=${decisionDate}&cutoff=${encodeURIComponent(cutoff)}`);
      setExplorer(data);
    } catch (e) { setError(e.message); setExplorer(null); }
  }
  useEffect(() => { loadMain(); }, [cutoff]);
  useEffect(() => { if (page === "explorer") loadExplorer(); }, [page, decisionDate, cutoff]);

  const summary = overview?.summary || {};
  const series = overview?.series || [];
  const intervalRows = explorer?.intervals || [];
  const chartRows = useMemo(() => series.map(r => ({...r, day: dateLabel(r.date)})), [series]);
  const errorRows = useMemo(() => (accuracy?.daily || []).map(r => ({
    day: dateLabel(r.deliveryDate), maeMW: r.maeMW, biasMW: r.biasMW, coveragePct: r.coveragePct
  })), [accuracy]);
  const matched = intervalRows.filter(r => r.actualMW != null);
  const avgForecast = matched.length ? matched.reduce((s,r)=>s+r.forecastMW,0)/matched.length : null;
  const avgActual = matched.length ? matched.reduce((s,r)=>s+r.actualMW,0)/matched.length : null;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Wind size={22}/></div><div><strong>WindLens</strong><span>ENERGY INTELLIGENCE</span></div></div>
      <div className="nav-label">WORKSPACE</div>
      <button className={`nav-item ${page==="overview"?"active":""}`} onClick={()=>setPage("overview")}><Gauge size={18}/> Overview</button>
      <button className={`nav-item ${page==="explorer"?"active":""}`} onClick={()=>setPage("explorer")}><CalendarDays size={18}/> Forecast explorer</button>
      <button className={`nav-item ${page==="accuracy"?"active":""}`} onClick={()=>setPage("accuracy")}><Activity size={18}/> Accuracy analysis</button>
      <div className="sidebar-bottom">
        <div className="source-status"><span className="status-dot"/><div><b>Elexon data source</b><small>Live API · Historical records</small></div></div>
        <div className="sidebar-foot">PILOT ANALYTICS<br/>GB NATIONAL WIND · JAN 2026</div>
      </div>
    </aside>

    <main className="main">
      <header className="topbar">
        <div className="breadcrumb">Analytics <span>/</span> <b>{page==="overview"?"Overview":page==="explorer"?"Forecast explorer":"Accuracy analysis"}</b></div>
        <div className="top-actions">
          <div className="period-pill"><span className="status-dot"/> Historical period: Jan 2026</div>
          <button className="refresh" onClick={loadMain} title="Refresh data"><RefreshCw size={16}/></button>
          <div className="avatar">WL</div>
        </div>
      </header>

      <div className="content">
        <div className="page-title">
          <div><div className="eyebrow">GB WIND GENERATION / DECISION SUPPORT</div>
            <h1>{page==="overview"?"Wind forecast overview":page==="explorer"?"Day-ahead forecast explorer":"Forecast accuracy"}</h1>
            <p>{page==="overview"?"A point-in-time view of forecast reliability for January purchasing decisions.":page==="explorer"?"Inspect the latest forecast that was available before a decision cutoff.":"Quantify forecast error using matched forecasts and actual generation."}</p>
          </div>
          <div className="cutoff-control"><label htmlFor="cutoff">DECISION CUTOFF</label><div className="select-wrap"><Clock3 size={15}/><select id="cutoff" value={cutoff} onChange={e=>setCutoff(e.target.value)}><option value="09:00">09:00 UK time</option><option value="12:00">12:00 UK time</option><option value="16:00">16:00 UK time</option><option value="18:00">18:00 UK time</option></select><ChevronDown size={14}/></div></div>
        </div>

        {error && <div className="error-banner"><AlertTriangle size={18}/><div><b>Data could not be loaded</b><p>{error}</p></div><button onClick={loadMain}>Retry</button></div>}
        {loading && <div className="loading-line"><span/> Loading historical Elexon data…</div>}

        {page==="overview" && <>
          <div className="kpi-grid">
            <Kpi label="Mean absolute error" value={fmt(summary.maeMW)} suffix=" MW" note="Average absolute forecast miss" icon={Activity} tone="blue"/>
            <Kpi label="Forecast RMSE" value={fmt(summary.rmseMW)} suffix=" MW" note="Penalizes larger errors" icon={Gauge} tone="violet"/>
            <Kpi label="Forecast bias" value={fmt(summary.biasMW)} suffix=" MW" note={summary.biasMW > 0 ? "Tends to overforecast wind" : summary.biasMW < 0 ? "Tends to underforecast wind" : "Forecast and actual average align"} icon={summary.biasMW > 0 ? ArrowUpRight : ArrowDownRight} tone="amber"/>
            <Kpi label="Matched coverage" value={fmt(summary.coveragePct,1)} suffix="%" note={`${fmt(summary.matchedIntervals)} matched hourly intervals`} icon={ShieldCheck} tone="green"/>
          </div>
          <Panel title="Forecast vs actual generation" subtitle="Average MW per delivery day · forecast selected as of the decision cutoff" action={<span className="legend-note"><i className="legend-blue"/> Forecast <i className="legend-green"/> Actual</span>}>
            {chartRows.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartRows} margin={{top:10,right:14,left:4,bottom:4}}><CartesianGrid strokeDasharray="3 3" stroke="#253247"/><XAxis dataKey="day" tick={{fill:"#8c9bb0",fontSize:11}} interval={4} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#8c9bb0",fontSize:11}} axisLine={false} tickLine={false} width={56}/><Tooltip contentStyle={{background:"#101b2c",border:"1px solid #293950",borderRadius:10,color:"#e8eef8"}}/><Line type="monotone" dataKey="forecastAvgMW" name="Forecast MW" stroke="#60a5fa" strokeWidth={2.5} dot={false} connectNulls={false}/><Line type="monotone" dataKey="actualAvgMW" name="Actual MW" stroke="#34d399" strokeWidth={2.5} dot={false} connectNulls={false}/></LineChart></ResponsiveContainer></div> : <Empty message="No chart data yet. The API will populate this panel when historical records load."/>}
            <div className="chart-foot"><span><i className="legend-blue"/> Forecast</span><span><i className="legend-green"/> Actual</span><span className="muted">Units: MW · UK local dates</span></div>
          </Panel>
          <div className="two-col">
            <Panel title="Daily forecast error" subtitle="Mean absolute error by delivery day">
              {errorRows.length ? <div className="small-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={errorRows}><CartesianGrid strokeDasharray="3 3" stroke="#253247"/><XAxis dataKey="day" tick={{fill:"#8c9bb0",fontSize:10}} interval={6} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#8c9bb0",fontSize:10}} axisLine={false} tickLine={false} width={48}/><Tooltip contentStyle={{background:"#101b2c",border:"1px solid #293950",borderRadius:10,color:"#e8eef8"}}/><Area type="monotone" dataKey="maeMW" name="MAE (MW)" stroke="#a78bfa" fill="#8b5cf6" fillOpacity={0.16}/></AreaChart></ResponsiveContainer></div> : <Empty message="Daily accuracy will appear after data loads."/>}
            </Panel>
            <Panel title="Buyer insights" subtitle="What forecast reliability means for purchasing decisions">
              <div className="insight-list">
                <div className="insight">
                  <span className="insight-icon amber">
                    <ArrowUpRight size={17}/>
                  </span>
                  <div>
                    <b>
                      {summary.biasMW > 0
                        ? "Wind generation tends to be overforecast"
                        : summary.biasMW < 0
                          ? "Wind generation tends to be underforecast"
                          : "No average forecast bias"}
                    </b>
                    <p>
                      {summary.biasMW == null
                        ? "Bias is unavailable because there are no matched intervals."
                        : `${fmt(Math.abs(summary.biasMW))} MW average ${
                            summary.biasMW > 0 ? "overforecast" : summary.biasMW < 0 ? "underforecast" : "bias"
                          } at the selected decision cutoff.`}
                    </p>
                  </div>
                </div>

                <div className="insight">
                  <span className="insight-icon blue">
                    <Zap size={17}/>
                  </span>
                  <div>
                    <b>Assess alternative supply needs</b>
                    <p>
                      If actual wind generation falls below forecast, the buyer may need
                      to assess other supply options against demand and existing positions.
                    </p>
                  </div>
                </div>

                <div className="insight">
                  <span className="insight-icon green">
                    <ShieldCheck size={17}/>
                  </span>
                  <div>
                    <b>Use this as a decision-support signal</b>
                    <p>
                      Wind forecast error alone cannot determine purchase volume or
                      financial exposure. Demand, market prices, and existing procurement
                      positions are also required.
                    </p>
                  </div>
                </div>
              </div>
            </Panel>
          </div>
        </>}

        {page==="explorer" && <div className="stack">
          <Panel title="Decision and delivery settings" subtitle="Choose a decision date in January; delivery is assumed to be the following day.">
            <div className="filter-row"><div className="field"><label htmlFor="decisionDate">PURCHASING DECISION DATE</label><input id="decisionDate" type="date" min="2026-01-01" max="2026-01-31" value={decisionDate} onChange={e=>setDecisionDate(e.target.value)}/></div><div className="field"><label>DELIVERY DATE</label><div className="readonly-field"><CalendarDays size={16}/>{new Date(`${decisionDate}T12:00:00Z`).toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"})} + 1 day</div></div><div className="field"><label>FORECAST ELIGIBILITY</label><div className="readonly-field"><ShieldCheck size={16}/> Published by {cutoff} UK time</div></div><button className="primary-button" onClick={loadExplorer}><RefreshCw size={15}/> Run analysis</button></div>
          </Panel>
          {explorer && <div className="kpi-grid compact">
            <Kpi label="Matched intervals" value={fmt(explorer.stats.matchedIntervals)} note="Out of 24 hourly periods" icon={Database} tone="blue"/>
            <Kpi label="Delivery-day MAE" value={fmt(explorer.stats.maeMW)} suffix=" MW" note="Matched intervals only" icon={Activity} tone="violet"/>
            <Kpi label="Forecast bias" value={fmt(explorer.stats.biasMW)} suffix=" MW" note="Forecast minus actual" icon={Gauge} tone="amber"/>
            <Kpi label="Coverage" value={fmt(explorer.stats.coveragePct,1)} suffix="%" note="Valid forecast-actual pairs" icon={CheckCircle2} tone="green"/>
          </div>}
          <Panel title="Hourly forecast detail" subtitle={explorer ? `Decision ${explorer.decisionDate} · delivery ${explorer.deliveryDate} · cutoff ${explorer.cutoffLocal} UK time` : "Select a date and run the analysis"}>
            {explorer && intervalRows.length ? <div className="table-scroll"><table><thead><tr><th>Delivery time (UK)</th><th>Published (UK)</th><th>Forecast (MW)</th><th>Actual (MW)</th><th>Error (MW)</th><th>Status</th></tr></thead><tbody>{intervalRows.map(row=><tr key={row.startTime}><td>{new Date(row.startTime).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Europe/London"})}</td><td>{timeLabel(row.publishTime)}</td><td>{fmt(row.forecastMW)}</td><td>{fmt(row.actualMW)}</td><td className={row.errorMW > 0 ? "positive" : row.errorMW < 0 ? "negative" : ""}>{fmt(row.errorMW)}</td><td>{row.forecastMW == null
  ? <span className="status-tag missing">Forecast missing</span>
  : row.actualMW == null
    ? <span className="status-tag missing">Actual missing</span>
    : <span className="status-tag good">Matched</span>}</td></tr>)}</tbody></table></div> : <Empty message="No eligible forecasts were returned for this selection. Try a later cutoff or inspect API data coverage."/>}
          </Panel>
        </div>}

        {page==="accuracy" && <>
          <div className="kpi-grid">
            <Kpi label="Mean absolute error" value={fmt(summary.maeMW)} suffix=" MW" note="Average absolute error" icon={Activity} tone="blue"/>
            <Kpi label="Root mean squared error" value={fmt(summary.rmseMW)} suffix=" MW" note="Sensitive to large misses" icon={Gauge} tone="violet"/>
            <Kpi label="Mean forecast bias" value={fmt(summary.biasMW)} suffix=" MW" note="Positive means overforecast" icon={ArrowUpRight} tone="amber"/>
            <Kpi label="Data coverage" value={fmt(summary.coveragePct,1)} suffix="%" note="Of expected 744 hourly intervals" icon={CheckCircle2} tone="green"/>
          </div>
          <Panel title="Daily MAE and bias" subtitle="Accuracy by delivery date, using the chosen decision cutoff">
            {errorRows.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={errorRows} margin={{top:10,right:10,left:4,bottom:4}}><CartesianGrid strokeDasharray="3 3" stroke="#253247"/><XAxis dataKey="day" tick={{fill:"#8c9bb0",fontSize:11}} interval={3} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#8c9bb0",fontSize:11}} axisLine={false} tickLine={false} width={55}/><Tooltip contentStyle={{background:"#101b2c",border:"1px solid #293950",borderRadius:10,color:"#e8eef8"}}/><Legend/><Bar dataKey="maeMW" name="MAE (MW)" fill="#8b5cf6" radius={[3,3,0,0]}/><Bar dataKey="biasMW" name="Bias (MW)" fill="#38bdf8" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer></div> : <Empty message="Daily metrics will appear when the API data loads."/>}
          </Panel>
          <Panel title="Metric definitions" subtitle="All metrics use matched hourly intervals only.">
            <div className="definition-grid"><div><b>MAE</b><code>mean(abs(forecast − actual))</code><p>Typical magnitude of forecast error, in MW.</p></div><div><b>RMSE</b><code>sqrt(mean(error²))</code><p>Penalizes large forecast misses more strongly.</p></div><div><b>Bias</b><code>mean(forecast − actual)</code><p>Positive indicates overforecasting; negative indicates underforecasting.</p></div><div><b>Coverage</b><code>matched / expected × 100</code><p>Shows the share of expected intervals with both forecast and actual data.</p></div></div>
          </Panel>
        </>}

        <footer className="footer"><span><Cloud size={14}/> Data source: Elexon BMRS · FUELHH + WINDFOR</span><span>{lastUpdated ? `Fetched ${new Date(lastUpdated).toLocaleString("en-GB")}` : "Waiting for data source"} · Demo pilot · January 2026</span></footer>
      </div>
    </main>
  </div>;
}
