import { useEffect, useMemo, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { BrowserRouter, Link, Navigate, Route, Routes, useParams } from 'react-router-dom'

const EMPTY_FORM = {
  recipient_name: '',
  document_name: '',
  document_type: '',
  issue_date: '',
  metadata_text: '{"grade":"A"}',
}

const AUTH_KEY = 'ubdvs_auth'

function readStoredAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY)
    if (!raw) return { token: '', user: null }
    return JSON.parse(raw)
  } catch {
    return { token: '', user: null }
  }
}

function persistAuth(data) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(data))
}

function clearAuth() {
  localStorage.removeItem(AUTH_KEY)
}

async function apiFetch(path, token, options = {}) {
  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  const res = await fetch(path, { ...options, headers })
  const data = await res.json()
  return { ok: res.ok, status: res.status, data }
}

function StatCard({ title, value, detail }) {
  return (
    <article className="panel p-5">
      <p className="eyebrow">{title}</p>
      <p className="mt-3 text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-sm text-slate-600">{detail}</p>
    </article>
  )
}

function VerifyResult({ data }) {
  const valid = data?.status === 'valid'
  return (
    <section className="panel mt-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xl font-semibold text-slate-900">Verification Result</h3>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${valid ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
            }`}
        >
          {valid ? 'Valid' : 'Invalid'}
        </span>
      </div>
      <dl className="mt-4 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">Document ID</dt>
          <dd className="font-mono text-xs">{data.document_id}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Issuer</dt>
          <dd>{data.organization_name}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Recipient</dt>
          <dd>{data.recipient_name}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Document Type</dt>
          <dd>{data.document_type}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-slate-500">Hash</dt>
          <dd className="font-mono text-xs break-all">{data.hash}</dd>
        </div>
      </dl>
    </section>
  )
}

function LoginPage({ onAuth }) {
  const [mode, setMode] = useState('login')
  const [organizationName, setOrganizationName] = useState('')
  const [email, setEmail] = useState('admin@acme.edu')
  const [password, setPassword] = useState('admin123')
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')

    const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
    const payload =
      mode === 'login'
        ? { email, password }
        : { organization_name: organizationName, email, password }

    const { ok, data } = await apiFetch(path, '', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!ok) {
      setError(data.error || 'Auth failed')
      return
    }

    onAuth({ token: data.token, user: data.user })
  }

  return (
    <main className="min-h-screen p-4 sm:p-8">
      <section className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="panel p-8">
          <p className="eyebrow">Universal Document Verification</p>
          <h1 className="mt-3 text-4xl font-semibold text-slate-900">Certificate Management Platform</h1>
          <p className="mt-4 max-w-xl text-slate-600">
            Enterprise style issuer console with public verification. Smooth colors, clean structure, no chain layer.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <StatCard title="Issuer Access" value="Role Based" detail="Organization login required" />
            <StatCard title="Verification" value="Public + API" detail="ID or hash checks" />
            <StatCard title="Document Proof" value="SHA-256" detail="Tamper detection" />
            <StatCard title="Demo User" value="admin@acme.edu" detail="Password: admin123" />
          </div>
        </div>

        <form onSubmit={submit} className="panel p-7">
          <div className="mb-4 flex rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              className={`tab-button ${mode === 'login' ? 'tab-active' : ''}`}
              onClick={() => setMode('login')}
            >
              Login
            </button>
            <button
              type="button"
              className={`tab-button ${mode === 'register' ? 'tab-active' : ''}`}
              onClick={() => setMode('register')}
            >
              Register Org
            </button>
          </div>

          {mode === 'register' && (
            <input
              required
              className="field"
              placeholder="Organization name"
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
            />
          )}

          <div className="mt-3 grid gap-3">
            <input
              required
              className="field"
              placeholder="Work email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              required
              type="password"
              className="field"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
          <button type="submit" className="btn mt-4 w-full">{mode === 'login' ? 'Sign In' : 'Create Account'}</button>
        </form>
      </section>
    </main>
  )
}

function DashboardPage({ auth, onLogout }) {
  const token = auth.token
  const [form, setForm] = useState(EMPTY_FORM)
  const [issueError, setIssueError] = useState('')
  const [created, setCreated] = useState(null)
  const [documents, setDocuments] = useState([])
  const [logs, setLogs] = useState([])
  const [platforms, setPlatforms] = useState([])
  const [activePanel, setActivePanel] = useState('overview')
  const [verifyId, setVerifyId] = useState('')
  const [verifyResult, setVerifyResult] = useState(null)
  const [verifyError, setVerifyError] = useState('')

  const verificationUrl = useMemo(() => {
    if (!created?.document_id) return ''
    return `${window.location.origin}/verify/${created.document_id}`
  }, [created])

  const loadDocuments = async () => {
    const { ok, data } = await apiFetch('/api/documents', token)
    if (ok) {
      setDocuments(data.documents || [])
    }
  }

  const loadLogs = async () => {
    const { ok, data } = await apiFetch('/api/logs', token)
    if (ok) {
      setLogs(data.verification_logs || [])
    }
  }

  const loadPlatforms = async () => {
    const { ok, data } = await apiFetch('/api/platforms', token)
    if (ok) {
      setPlatforms(data.platforms || [])
    }
  }

  useEffect(() => {
    loadDocuments()
    loadLogs()
    loadPlatforms()
  }, [token])

  const handleIssue = async (e) => {
    e.preventDefault()
    setIssueError('')

    let metadata = {}
    try {
      metadata = form.metadata_text.trim() ? JSON.parse(form.metadata_text) : {}
    } catch {
      setIssueError('Metadata must be valid JSON.')
      return
    }

    const payload = {
      recipient_name: form.recipient_name.trim(),
      document_name: form.document_name.trim(),
      document_type: form.document_type.trim(),
      issue_date: form.issue_date,
      metadata,
    }

    const { ok, data } = await apiFetch('/api/document', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!ok) {
      setIssueError(data.error || 'Failed to issue document.')
      return
    }

    setCreated(data)
    setForm(EMPTY_FORM)
    loadDocuments()
    loadLogs()
    setActivePanel('overview')
  }

  const handleVerify = async (e) => {
    e.preventDefault()
    setVerifyError('')
    setVerifyResult(null)

    const id = verifyId.trim()
    if (!id) {
      setVerifyError('Enter document ID.')
      return
    }

    const { ok, data } = await apiFetch(`/api/verify/${id}`, '')

    if (!ok) {
      setVerifyError(data.error || 'Document not found.')
      return
    }

    setVerifyResult(data)
  }

  const panels = [
    { id: 'overview', label: 'Overview' },
    { id: 'issue', label: 'Issue Document' },
    { id: 'verify', label: 'Verify' },
    { id: 'logs', label: 'Audit Logs' },
    { id: 'platforms', label: 'Platforms' },
  ]

  return (
    <main className="min-h-screen p-4 sm:p-6">
      <div className="mx-auto grid w-full max-w-7xl gap-4 lg:grid-cols-[250px_1fr]">
        <aside className="panel p-4">
          <p className="eyebrow">Issuer Workspace</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-900">{auth.user.organization_name}</h2>
          <p className="mt-1 text-sm text-slate-600">{auth.user.email}</p>
          <nav className="mt-5 grid gap-2">
            {panels.map((panel) => (
              <button
                key={panel.id}
                type="button"
                className={`nav-item ${activePanel === panel.id ? 'nav-item-active' : ''}`}
                onClick={() => setActivePanel(panel.id)}
              >
                {panel.label}
              </button>
            ))}
          </nav>
          <button type="button" className="btn-secondary mt-6 w-full" onClick={onLogout}>Sign out</button>
        </aside>

        <section className="space-y-4">
          <header className="panel p-6">
            <p className="eyebrow">UBDVS Platform</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">Certificate Verification Console</h1>
            <p className="mt-2 text-slate-600">Structured console inspired by production certificate systems.</p>
          </header>

          {activePanel === 'overview' && (
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard title="Documents" value={documents.length} detail="Org scoped records" />
              <StatCard title="Verifications" value={logs.length} detail="Logged access checks" />
              <StatCard title="Platforms" value={platforms.length} detail="Enabled modules" />
              <StatCard title="Proof Type" value="SHA-256" detail="Integrity hash only" />
            </section>
          )}

          {activePanel === 'issue' && (
            <form onSubmit={handleIssue} className="panel p-6">
              <h2 className="text-2xl font-semibold text-slate-900">Issue New Certificate</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <input
                  required
                  value={form.recipient_name}
                  onChange={(e) => setForm({ ...form, recipient_name: e.target.value })}
                  placeholder="Recipient name"
                  className="field"
                />
                <input
                  required
                  value={form.document_name}
                  onChange={(e) => setForm({ ...form, document_name: e.target.value })}
                  placeholder="Certificate name"
                  className="field"
                />
                <input
                  required
                  value={form.document_type}
                  onChange={(e) => setForm({ ...form, document_type: e.target.value })}
                  placeholder="Type (Degree, License, etc.)"
                  className="field"
                />
                <input
                  required
                  type="date"
                  value={form.issue_date}
                  onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
                  className="field"
                />
              </div>
              <textarea
                value={form.metadata_text}
                onChange={(e) => setForm({ ...form, metadata_text: e.target.value })}
                placeholder="Metadata JSON"
                rows={5}
                className="field mt-3 font-mono text-xs"
              />
              {issueError && <p className="mt-2 text-sm text-red-700">{issueError}</p>}
              <button className="btn mt-4" type="submit">Issue Document</button>

              {created && (
                <div className="panel mt-5 p-4">
                  <h3 className="text-lg font-semibold text-slate-900">Issued Successfully</h3>
                  <p className="mt-2 text-sm text-slate-700">ID: <span className="font-mono text-xs">{created.document_id}</span></p>
                  <Link to={`/verify/${created.document_id}`} className="btn-link mt-1 inline-block">Open public page</Link>
                  <div className="mt-3 inline-block rounded-lg border border-slate-200 bg-white p-3">
                    <QRCodeCanvas value={verificationUrl} size={132} includeMargin />
                  </div>
                </div>
              )}
            </form>
          )}

          {activePanel === 'verify' && (
            <section className="panel p-6">
              <h2 className="text-2xl font-semibold text-slate-900">Verification Desk</h2>
              <form onSubmit={handleVerify} className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input
                  value={verifyId}
                  onChange={(e) => setVerifyId(e.target.value)}
                  placeholder="Document ID"
                  className="field"
                />
                <button className="btn">Verify</button>
              </form>
              {verifyError && <p className="mt-3 text-sm text-red-700">{verifyError}</p>}
              {verifyResult && <VerifyResult data={verifyResult} />}
            </section>
          )}

          {activePanel === 'logs' && (
            <section className="panel p-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-2xl font-semibold text-slate-900">Audit Logs</h2>
                <button type="button" className="btn-secondary" onClick={loadLogs}>Refresh</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-2 pr-3">Timestamp</th>
                      <th className="py-2 pr-3">Document</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2">Channel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id} className="border-t border-slate-200">
                        <td className="py-2 pr-3">{log.timestamp}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{log.document_id || 'N/A'}</td>
                        <td className="py-2 pr-3">{log.status}</td>
                        <td className="py-2">{log.channel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activePanel === 'platforms' && (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {platforms.map((item) => (
                <article key={item.name} className="panel p-5">
                  <p className="eyebrow">Module</p>
                  <h3 className="mt-2 text-lg font-semibold text-slate-900">{item.name}</h3>
                  <p className="mt-2 text-sm text-slate-600">{item.description}</p>
                  <p className="mt-3 text-xs uppercase tracking-[0.12em] text-emerald-700">{item.status}</p>
                </article>
              ))}
            </section>
          )}

          <section className="panel p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-slate-900">Organization Documents</h2>
              <button type="button" className="btn-secondary" onClick={loadDocuments}>Refresh</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-2 pr-4">ID</th>
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Recipient</th>
                    <th className="py-2 pr-4">Type</th>
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2">Public</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id} className="border-t border-slate-200">
                      <td className="py-2 pr-4 font-mono text-xs">{doc.id}</td>
                      <td className="py-2 pr-4">{doc.document_name}</td>
                      <td className="py-2 pr-4">{doc.recipient_name}</td>
                      <td className="py-2 pr-4">{doc.document_type}</td>
                      <td className="py-2 pr-4">{doc.issue_date}</td>
                      <td className="py-2">
                        <Link className="btn-link" to={`/verify/${doc.id}`}>Open verify</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </div>
    </main>
  )
}

function VerifyPage() {
  const { id } = useParams()
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const run = async () => {
      const { ok, data } = await apiFetch(`/api/verify/${id}`, '')
      if (!ok) {
        setError(data.error || 'Document not found.')
        return
      }
      setResult(data)
    }

    run()
  }, [id])

  return (
    <main className="min-h-screen p-4 sm:p-8">
      <section className="panel mx-auto mt-4 w-full max-w-3xl p-6">
        <p className="eyebrow">Public Verification</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Document {id}</h1>
        <Link to="/" className="btn-link mt-2 inline-block">Back to platform</Link>
        {error && <p className="mt-4 text-red-700">{error}</p>}
        {result && <VerifyResult data={result} />}
      </section>
    </main>
  )
}

function ProtectedRoute({ auth, children }) {
  if (!auth.token) return <Navigate to="/login" replace />
  return children
}

function App() {
  const [auth, setAuth] = useState(readStoredAuth)

  useEffect(() => {
    if (!auth.token) return
    const run = async () => {
      const { ok } = await apiFetch('/api/auth/me', auth.token)
      if (!ok) {
        clearAuth()
        setAuth({ token: '', user: null })
      }
    }
    run()
  }, [auth.token])

  const handleAuth = (data) => {
    persistAuth(data)
    setAuth(data)
  }

  const logout = () => {
    clearAuth()
    setAuth({ token: '', user: null })
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={auth.token ? <Navigate to="/" replace /> : <LoginPage onAuth={handleAuth} />} />
        <Route
          path="/"
          element={
            <ProtectedRoute auth={auth}>
              <DashboardPage auth={auth} onLogout={logout} />
            </ProtectedRoute>
          }
        />
        <Route path="/verify/:id" element={<VerifyPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
