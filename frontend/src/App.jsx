import { useEffect, useMemo, useRef, useState } from 'react'
import { jsPDF } from 'jspdf'
import { Html5QrcodeScanner } from 'html5-qrcode'
import QRCode from 'qrcode'
import { QRCodeCanvas } from 'qrcode.react'
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'

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

async function downloadCertificatePdf(doc, verificationUrl) {
  const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
    width: 240,
    margin: 1,
    color: { dark: '#0f172a', light: '#ffffff' },
  })

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })

  pdf.setFillColor(255, 255, 255)
  pdf.rect(0, 0, 842, 595, 'F')

  pdf.setDrawColor(203, 213, 225)
  pdf.setLineWidth(2)
  pdf.roundedRect(36, 36, 770, 523, 10, 10)

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.setTextColor(71, 85, 105)
  pdf.text('UNIVERSAL DOCUMENT VERIFICATION SYSTEM', 58, 74)

  pdf.setFontSize(34)
  pdf.setTextColor(15, 23, 42)
  pdf.text('Certificate of Verification', 58, 132)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(16)
  pdf.setTextColor(51, 65, 85)
  pdf.text('This certifies that the following record was issued by authorized organization.', 58, 170)

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(29)
  pdf.setTextColor(15, 23, 42)
  pdf.text(doc.recipient_name, 58, 232)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(15)
  pdf.setTextColor(30, 41, 59)
  pdf.text(`Document: ${doc.document_name}`, 58, 274)
  pdf.text(`Type: ${doc.document_type}`, 58, 304)
  pdf.text(`Issued by: ${doc.organization_name}`, 58, 334)
  pdf.text(`Issue date: ${doc.issue_date}`, 58, 364)

  pdf.setFont('courier', 'normal')
  pdf.setFontSize(11)
  pdf.setTextColor(71, 85, 105)
  pdf.text(`Document ID: ${doc.id}`, 58, 420)
  pdf.text(`Hash: ${doc.hash}`, 58, 442)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(11)
  pdf.setTextColor(100, 116, 139)
  pdf.text('Scan QR code to open public verification page.', 572, 418)
  pdf.addImage(qrDataUrl, 'PNG', 588, 236, 168, 168)

  pdf.save(`${doc.id}-certificate.pdf`)
}

async function downloadQrImage(docId, verificationUrl) {
  const dataUrl = await QRCode.toDataURL(verificationUrl, {
    width: 500,
    margin: 1,
    color: { dark: '#0f172a', light: '#ffffff' },
  })

  const link = document.createElement('a')
  link.href = dataUrl
  link.download = `${docId}-verification-qr.png`
  link.click()
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
          className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${
            valid ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
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
      setError(data.error || 'Authentication failed')
      return
    }

    onAuth({ token: data.token, user: data.user })
  }

  return (
    <main className="min-h-screen p-4 sm:p-8">
      <section className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="panel p-8 sm:p-10">
          <div className="flex items-center gap-2">
            <span className="brand-dot" />
            <p className="eyebrow">Universal Blockchain Document Verification System</p>
          </div>
          <h1 className="mt-4 text-4xl font-semibold leading-tight text-slate-900 sm:text-5xl">
            Global-grade Certificate Verification Experience
          </h1>
          <p className="mt-5 max-w-2xl text-slate-600">
            Automated issuance, QR verification, mobile scanning, and downloadable certificates in one platform.
          </p>

          <div className="mt-7 flex flex-wrap gap-2">
            <span className="logo-chip">Acme University</span>
            <span className="logo-chip">Gov Cert Board</span>
            <span className="logo-chip">Prime Skills Council</span>
            <span className="logo-chip">National Registry</span>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <StatCard title="Fraud Blocking" value="Hash Protected" detail="Tamper checks on every verification" />
            <StatCard title="Channels" value="Web + Mobile" detail="Scan QR from phone to verify instantly" />
            <StatCard title="Automation" value="Instant Issuance" detail="Generate ID, hash, and QR in one action" />
            <StatCard title="Demo Access" value="Ready" detail="admin@acme.edu / admin123" />
          </div>

          <Link to="/scan" className="btn-secondary mt-6 inline-flex">Open Mobile Scanner</Link>
        </div>

        <form onSubmit={submit} className="panel p-7 sm:p-8">
          <p className="eyebrow">Issuer Access</p>
          <h2 className="mt-2 text-3xl font-semibold text-slate-900">Sign in to Platform</h2>

          <div className="mt-5 flex rounded-xl bg-slate-100 p-1">
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
              Register
            </button>
          </div>

          {mode === 'register' && (
            <input
              required
              className="field mt-4"
              placeholder="Organization name"
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
            />
          )}

          <div className="mt-4 grid gap-3">
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
          <button type="submit" className="btn mt-5 w-full">{mode === 'login' ? 'Sign In' : 'Create Organization'}</button>
        </form>
      </section>
    </main>
  )
}

function CertificatePanel({ selectedDoc, verificationUrl }) {
  const [busy, setBusy] = useState(false)

  if (!selectedDoc) {
    return (
      <section className="panel p-6">
        <h3 className="section-title">Certificate Studio</h3>
        <p className="mt-2 text-sm text-slate-600">Issue document first, then certificate preview appears here.</p>
      </section>
    )
  }

  const onPdf = async () => {
    setBusy(true)
    await downloadCertificatePdf(selectedDoc, verificationUrl)
    setBusy(false)
  }

  const onQr = async () => {
    await downloadQrImage(selectedDoc.id, verificationUrl)
  }

  return (
    <section className="panel p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h3 className="section-title">Certificate Studio</h3>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={onQr}>Download QR</button>
          <button type="button" className="btn" onClick={onPdf} disabled={busy}>
            {busy ? 'Generating PDF...' : 'Download Certificate PDF'}
          </button>
        </div>
      </div>

      <article className="certificate-surface">
        <p className="eyebrow">Certificate of Verification</p>
        <h4 className="mt-2 text-3xl font-semibold text-slate-900">{selectedDoc.recipient_name}</h4>
        <p className="mt-3 text-slate-600">
          {selectedDoc.document_name} issued by {selectedDoc.organization_name}
        </p>
        <dl className="mt-6 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Document ID</dt>
            <dd className="font-mono text-xs">{selectedDoc.id}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Type</dt>
            <dd>{selectedDoc.document_type}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Issue Date</dt>
            <dd>{selectedDoc.issue_date}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Hash</dt>
            <dd className="font-mono text-xs break-all">{selectedDoc.hash}</dd>
          </div>
        </dl>
        <div className="mt-6 inline-block rounded-md border border-slate-200 bg-white p-2">
          <QRCodeCanvas value={verificationUrl} size={108} includeMargin />
        </div>
      </article>
    </section>
  )
}

function DashboardPage({ auth, onLogout }) {
  const token = auth.token
  const [form, setForm] = useState(EMPTY_FORM)
  const [issueError, setIssueError] = useState('')
  const [documents, setDocuments] = useState([])
  const [logs, setLogs] = useState([])
  const [platforms, setPlatforms] = useState([])
  const [activePanel, setActivePanel] = useState('overview')
  const [verifyId, setVerifyId] = useState('')
  const [verifyResult, setVerifyResult] = useState(null)
  const [verifyError, setVerifyError] = useState('')
  const [selectedDocId, setSelectedDocId] = useState('')

  const selectedDoc = useMemo(
    () => documents.find((doc) => doc.id === selectedDocId) || documents[0] || null,
    [documents, selectedDocId],
  )

  const selectedVerificationUrl = useMemo(() => {
    if (!selectedDoc) return ''
    return `${window.location.origin}/verify/${selectedDoc.id}`
  }, [selectedDoc])

  const loadDocuments = async () => {
    const { ok, data } = await apiFetch('/api/documents', token)
    if (ok) {
      const docs = data.documents || []
      setDocuments(docs)
      if (!selectedDocId && docs.length > 0) {
        setSelectedDocId(docs[0].id)
      }
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

    setForm(EMPTY_FORM)
    setActivePanel('certificates')
    setSelectedDocId(data.document_id)
    await loadDocuments()
    await loadLogs()
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
    { id: 'issue', label: 'Issue Certificate' },
    { id: 'certificates', label: 'Certificate Studio' },
    { id: 'verify', label: 'Verification' },
    { id: 'logs', label: 'Audit Logs' },
    { id: 'platforms', label: 'Platforms' },
  ]

  return (
    <main className="min-h-screen p-4 sm:p-6">
      <div className="mx-auto mb-4 flex w-full max-w-7xl items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="brand-dot" />
          <p className="text-sm font-medium text-slate-700">UBDVS Platform</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/scan" className="btn-secondary">Mobile Scanner</Link>
          <button type="button" className="btn-secondary" onClick={onLogout}>Sign out</button>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-7xl gap-4 lg:grid-cols-[260px_1fr]">
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
        </aside>

        <section className="space-y-4">
          <header className="panel p-6">
            <p className="eyebrow">Automated Document Verification</p>
            <h1 className="mt-2 text-3xl font-semibold leading-tight text-slate-900 sm:text-4xl">
              Fraud-resistant certificate issuance and verification
            </h1>
            <p className="mt-3 max-w-3xl text-slate-600">
              Trusted flow for issuers: create records, generate QR, let public users verify from web or mobile scan.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="logo-chip">Global reach</span>
              <span className="logo-chip">Public validation</span>
              <span className="logo-chip">Downloadable certificates</span>
              <span className="logo-chip">Audit-ready logs</span>
            </div>
          </header>

          {activePanel === 'overview' && (
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard title="Issued Certificates" value={documents.length} detail="Organization records" />
              <StatCard title="Verification Events" value={logs.length} detail="Public and API checks" />
              <StatCard title="Security Model" value="SHA-256" detail="Integrity proof per document" />
              <StatCard title="Active Modules" value={platforms.length} detail="Issuer + verify + audit" />
            </section>
          )}

          {activePanel === 'issue' && (
            <form onSubmit={handleIssue} className="panel p-6">
              <h2 className="section-title">Issue New Certificate</h2>
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
                  placeholder="Certificate title"
                  className="field"
                />
                <input
                  required
                  value={form.document_type}
                  onChange={(e) => setForm({ ...form, document_type: e.target.value })}
                  placeholder="Type (Diploma, License, etc.)"
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

              {issueError && <p className="mt-3 text-sm text-red-700">{issueError}</p>}
              <button className="btn mt-4" type="submit">Issue Certificate</button>
            </form>
          )}

          {activePanel === 'certificates' && (
            <>
              <section className="panel p-6">
                <h2 className="section-title">Pick Certificate</h2>
                <select
                  className="field mt-3"
                  value={selectedDoc?.id || ''}
                  onChange={(e) => setSelectedDocId(e.target.value)}
                >
                  {documents.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.id} - {doc.document_name} ({doc.recipient_name})
                    </option>
                  ))}
                </select>
              </section>
              <CertificatePanel selectedDoc={selectedDoc} verificationUrl={selectedVerificationUrl} />
            </>
          )}

          {activePanel === 'verify' && (
            <section className="panel p-6">
              <h2 className="section-title">Verification Desk</h2>
              <p className="mt-2 text-sm text-slate-600">Check by document ID or use mobile QR scanner.</p>
              <form onSubmit={handleVerify} className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input
                  value={verifyId}
                  onChange={(e) => setVerifyId(e.target.value)}
                  placeholder="Document ID"
                  className="field"
                />
                <button className="btn">Verify</button>
              </form>
              <Link to="/scan" className="btn-secondary mt-3 inline-flex">Open Mobile Scanner</Link>
              {verifyError && <p className="mt-3 text-sm text-red-700">{verifyError}</p>}
              {verifyResult && <VerifyResult data={verifyResult} />}
            </section>
          )}

          {activePanel === 'logs' && (
            <section className="panel p-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="section-title">Audit Logs</h2>
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
              <h2 className="section-title">Organization Documents</h2>
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
                    <th className="py-2">Action</th>
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
        <div className="mt-2 flex flex-wrap gap-2">
          <Link to="/" className="btn-secondary">Back to platform</Link>
          <Link to="/scan" className="btn-secondary">Scan another QR</Link>
        </div>
        {error && <p className="mt-4 text-red-700">{error}</p>}
        {result && <VerifyResult data={result} />}
      </section>
    </main>
  )
}

function MobileScannerPage() {
  const [decoded, setDecoded] = useState('')
  const [notice, setNotice] = useState('Camera opens when permission granted. Best on mobile browser.')
  const scannerRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    const scanner = new Html5QrcodeScanner(
      'qr-reader',
      {
        fps: 10,
        qrbox: { width: 220, height: 220 },
      },
      false,
    )

    scanner.render(
      (decodedText) => {
        setDecoded(decodedText)
        setNotice('QR detected. Redirecting if it matches verification URL...')

        let targetId = ''
        try {
          const parsed = new URL(decodedText)
          const parts = parsed.pathname.split('/').filter(Boolean)
          if (parts[0] === 'verify' && parts[1]) {
            targetId = parts[1]
          }
        } catch {
          const marker = '/verify/'
          if (decodedText.includes(marker)) {
            targetId = decodedText.split(marker)[1].split(/[?#]/)[0]
          }
        }

        if (targetId) {
          navigate(`/verify/${targetId}`)
        }
      },
      () => {},
    )

    scannerRef.current = scanner

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(() => {})
      }
    }
  }, [navigate])

  return (
    <main className="min-h-screen p-4 sm:p-8">
      <section className="panel mx-auto w-full max-w-3xl p-6">
        <p className="eyebrow">Mobile Verification Scanner</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Scan certificate QR code</h1>
        <p className="mt-2 text-sm text-slate-600">{notice}</p>

        <div id="qr-reader" className="qr-frame mt-4" />

        {decoded && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Decoded value</p>
            <p className="mt-1 break-all font-mono text-xs text-slate-700">{decoded}</p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Link to="/" className="btn-secondary">Back to platform</Link>
          <Link to="/login" className="btn-secondary">Back to login</Link>
        </div>
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
        <Route path="/scan" element={<MobileScannerPage />} />
        <Route path="/verify/:id" element={<VerifyPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
