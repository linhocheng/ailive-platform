export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: '#f8f9fa' }}>
      <header style={{ background: '#1a1a2e', color: '#fff', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <a href="/dashboard" style={{ color: '#e0e0ff', textDecoration: 'none', fontSize: 18, fontWeight: 700 }}>AILIVE</a>
        <span style={{ color: '#666', fontSize: 14 }}>後台管理</span>
      </header>
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>{children}</main>
    </div>
  );
}
