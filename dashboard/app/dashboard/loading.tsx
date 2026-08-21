export default function DashboardLoading() {
  return (
    <main className="dashboard-main" id="main-content" aria-busy="true" aria-label="Loading dashboard">
      <div className="loading-line loading-line-short" />
      <div className="loading-line loading-line-title" />
      <div className="metric-grid loading-grid">{Array.from({ length: 4 }).map((_, index) => <div className="metric-card loading-card" key={index} />)}</div>
      <div className="content-grid"><div className="panel loading-panel" /><div className="panel loading-panel" /></div>
    </main>
  );
}
