import { useEffect, useMemo, useRef, useState } from 'react'
import { jsPDF } from 'jspdf'
import { Html5QrcodeScanner } from 'html5-qrcode'
import QRCode from 'qrcode'
import { QRCodeCanvas } from 'qrcode.react'
import { Icon } from '@iconify/react'
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'

const EMPTY_FORM = {
  recipient_name: '',
  document_name: '',
  document_type: '',
  issue_date: '',
  metadata_text: '{"grade":"A"}',
}

const AUTH_KEY = 'ubdvs_auth'
const PUBLIC_VERIFY_BASE_KEY = 'ubdvs_public_verify_base_url'

function normalizeBaseUrl(value) {
  const raw = (value || '').trim()
  if (!raw) return ''
  return raw.replace(/\/+$/, '')
}

function readPublicVerifyBaseUrl() {
  const envBase = normalizeBaseUrl(import.meta.env.VITE_PUBLIC_VERIFY_BASE_URL || '')
  try {
    const stored = normalizeBaseUrl(localStorage.getItem(PUBLIC_VERIFY_BASE_KEY) || '')
    return stored || envBase || window.location.origin
  } catch {
    return envBase || window.location.origin
  }
}

function buildVerificationUrl(documentId, baseUrl) {
  const base = normalizeBaseUrl(baseUrl) || window.location.origin
  return `${base}/verify/${documentId}`
}

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

async function loadImageAsPngDataUrl(url, width, height) {
  const response = await fetch(url)
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)

  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = objectUrl
    })

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Canvas context unavailable')
    }

    context.drawImage(image, 0, 0, width, height)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function downloadCertificatePdf(
  doc,
  verificationUrl,
  template = CERTIFICATE_TEMPLATES[0],
  background = CERTIFICATE_BACKGROUNDS[0],
) {
  const accentRgb = hexToRgb(template.accent)
  const accentSoftRgb = hexToRgb(template.accentSoft)
  const backgroundRgb = hexToRgb(template.background)
  const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
    width: 240,
    margin: 1,
    color: { dark: template.accent, light: '#ffffff' },
  })

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })

  pdf.setFillColor(backgroundRgb.r, backgroundRgb.g, backgroundRgb.b)
  pdf.rect(0, 0, 842, 595, 'F')

  if (background?.asset) {
    try {
      const backgroundDataUrl = await loadImageAsPngDataUrl(background.asset, 770, 523)
      pdf.addImage(backgroundDataUrl, 'PNG', 36, 36, 770, 523)
    } catch {
      // If the background image fails, continue with solid template color.
    }
  }

  pdf.setFillColor(255, 255, 255)
  pdf.setGState(new pdf.GState({ opacity: 0.84 }))
  pdf.roundedRect(44, 88, 754, 463, 10, 10, 'F')
  pdf.setGState(new pdf.GState({ opacity: 1 }))

  pdf.setDrawColor(accentSoftRgb.r, accentSoftRgb.g, accentSoftRgb.b)
  pdf.setLineWidth(2)
  pdf.roundedRect(36, 36, 770, 523, 10, 10)

  pdf.setFillColor(accentRgb.r, accentRgb.g, accentRgb.b)
  pdf.roundedRect(36, 36, 770, 46, 10, 10, 'F')

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.setTextColor(255, 255, 255)
  pdf.text(template.header, 58, 64)

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

function PhotoFrame({ sources, alt, className = '', overlay, badge }) {
  const [sourceIndex, setSourceIndex] = useState(0)
  const currentSource = sources[sourceIndex] || sources[0]

  return (
    <article className={`photo-card ${className}`.trim()}>
      <img
        src={currentSource}
        alt={alt}
        className="photo-image"
        onError={() => {
          setSourceIndex((current) => Math.min(current + 1, sources.length - 1))
        }}
      />
      {(overlay || badge) && (
        <div className="photo-overlay photo-overlay-flex">
          <div>
            {badge && <p className="photo-badge">{badge}</p>}
            {overlay && <p className="mt-1 text-base font-semibold text-white">{overlay}</p>}
          </div>
        </div>
      )}
    </article>
  )
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <Icon icon="mdi:shield-star-outline" width="24" height="24" />
    </div>
  )
}

function InlineIcon({ icon, className = '' }) {
  return <Icon icon={icon} className={className} aria-hidden="true" />
}

const CERTIFICATE_TEMPLATES = [
  {
    id: 'classic',
    name: 'Classic Slate',
    note: 'Minimal and formal',
    accent: '#475569',
    accentSoft: '#cbd5e1',
    background: '#ffffff',
    header: 'UNIVERSAL DOCUMENT VERIFICATION SYSTEM',
  },
  {
    id: 'midnight',
    name: 'Midnight Blue',
    note: 'Premium dark frame',
    accent: '#334155',
    accentSoft: '#94a3b8',
    background: '#f8fafc',
    header: 'UBDVS CERTIFICATE',
  },
  {
    id: 'linen',
    name: 'Linen Gold',
    note: 'Soft warm contrast',
    accent: '#8c6d3b',
    accentSoft: '#e9d8b3',
    background: '#fffdf8',
    header: 'OFFICIAL VERIFICATION CERTIFICATE',
  },
]

const CERTIFICATE_BACKGROUNDS = [
  {
    id: 'royal',
    name: 'Royal Wash',
    note: 'Cool geometric layers',
    asset: '/certificate-bg-royal.svg',
  },
  {
    id: 'marble',
    name: 'Marble Gold',
    note: 'Warm elegant texture',
    asset: '/certificate-bg-marble.svg',
  },
  {
    id: 'grid',
    name: 'Aqua Grid',
    note: 'Structured modern lines',
    asset: '/certificate-bg-grid.svg',
  },
  {
    id: 'ink',
    name: 'Ink Flow',
    note: 'Soft abstract motion',
    asset: '/certificate-bg-ink.svg',
  },
]

function hexToRgb(hex) {
  const raw = hex.replace('#', '')
  const normalized = raw.length === 3 ? raw.split('').map((part) => part + part).join('') : raw
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  }
}

function ToastStack({ toasts, onDismiss }) {
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.tone}`}>
          <div>
            <p className="toast-title">{toast.title}</p>
            <p className="toast-copy">{toast.message}</p>
          </div>
          <button type="button" className="toast-dismiss" onClick={() => onDismiss(toast.id)} aria-label="Dismiss toast">
            <Icon icon="mdi:close" width="16" height="16" />
          </button>
        </div>
      ))}
    </div>
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

function LoginPage({ onAuth, notify }) {
  const navigate = useNavigate()
  const [mode, setMode] = useState('login')
  const [organizationName, setOrganizationName] = useState('')
  const [email, setEmail] = useState('admin@acme.edu')
  const [password, setPassword] = useState('admin123')
  const [error, setError] = useState('')
  const loginHeroSources = [
    'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1400&q=80',
    'https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=1400&q=80',
    '/hero-doc-visual.svg',
  ]
  const loginSecondarySources = [
    'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1521791055366-0d553872125f?auto=format&fit=crop&w=1200&q=80',
    '/certificate-visual.svg',
  ]

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
      notify(data.error || 'Authentication failed', 'error')
      return
    }

    onAuth({ token: data.token, user: data.user })
    notify(mode === 'login' ? 'Signed in successfully.' : 'Organization account created.', 'success')
    navigate('/dashboard')
  }

  return (
    <main className="auth-shell min-h-screen p-4 sm:p-8">
      <section className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="panel auth-hero-panel overflow-hidden p-8 sm:p-10">
          <div className="flex items-center gap-2">
            <BrandMark />
            <div>
              <p className="eyebrow">UBDVS</p>
              <h1 className="text-2xl font-semibold text-slate-900">Access the issuer console</h1>
            </div>
          </div>
          <p className="mt-4 max-w-xl text-sm text-slate-600">
            Login or register to issue certificates, manage QR verification, and keep the public proof page in sync.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <PhotoFrame
              sources={loginHeroSources}
              alt="Team reviewing credentials"
              badge="Issuer workflow"
              overlay="Real people reviewing verified records"
            />
            <PhotoFrame
              sources={loginSecondarySources}
              alt="Team sharing certificates"
              badge="Verification"
              overlay="Documents, QR, and trust in one place"
            />
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="auth-mini-card">
              <InlineIcon icon="mdi:account-lock-outline" className="icon-card-icon" />
              <div>
                <p className="auth-mini-title">Secure access</p>
                <p className="auth-mini-copy">Role-based login for issuers.</p>
              </div>
            </div>
            <div className="auth-mini-card">
              <InlineIcon icon="mdi:qrcode-scan" className="icon-card-icon" />
              <div>
                <p className="auth-mini-title">Instant verification</p>
                <p className="auth-mini-copy">Scan QR from any phone.</p>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-white/80 p-4 text-sm text-slate-600 shadow-sm">
            Use your organization account from the README, or create a new one here.
          </div>
        </div>

        <form onSubmit={submit} className="panel auth-form-panel p-7 sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Issuer Access</p>
              <h2 className="mt-2 text-3xl font-semibold text-slate-900">{mode === 'login' ? 'Login' : 'Create account'}</h2>
            </div>
            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
              Secure portal
            </div>
          </div>

          <div className="mt-4 flex rounded-2xl bg-slate-100 p-1">
            <button
              type="button"
              className={`tab-button ${mode === 'login' ? 'tab-active' : ''}`}
              onClick={() => setMode('login')}
            >
              <InlineIcon icon="mdi:login-variant" className="btn-icon" />
              Login
            </button>
            <button
              type="button"
              className={`tab-button ${mode === 'register' ? 'tab-active' : ''}`}
              onClick={() => setMode('register')}
            >
              <InlineIcon icon="mdi:account-plus-outline" className="btn-icon" />
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
          <button type="submit" className="btn auth-submit mt-5 w-full">
            <InlineIcon icon={mode === 'login' ? 'mdi:login-variant' : 'mdi:account-plus-outline'} className="btn-icon" />
            {mode === 'login' ? 'Sign in to dashboard' : 'Create organization'}
          </button>
          <Link to="/" className="btn-secondary auth-back mt-3 inline-flex w-full justify-center">
            <InlineIcon icon="mdi:home-outline" className="btn-icon" />
            Back to landing
          </Link>
        </form>
      </section>
    </main>
  )
}

function LandingPage() {
  const heroTeamSources = [
    'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1600&q=80',
    '/hero-doc-visual.svg',
  ]
  const docDeskSources = [
    'https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=1300&q=80',
    'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1300&q=80',
    '/certificate-visual.svg',
  ]
  const mobileCheckSources = [
    'https://images.unsplash.com/photo-1586880244406-556ebe35f282?auto=format&fit=crop&w=1300&q=80',
    'https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=1300&q=80',
    '/mobile-scan-visual.svg',
  ]
  const meetingSources = [
    'https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=1300&q=80',
    'https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=1300&q=80',
    '/feature-flow.svg',
  ]
  const recruiterSources = [
    'https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=1300&q=80',
    'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=1300&q=80',
    '/art-09-user.svg',
  ]
  const gradSources = [
    'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=1300&q=80',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=1300&q=80',
    '/art-07-download.svg',
  ]
  const officeSources = [
    'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1300&q=80',
    'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1300&q=80',
    '/feature-shield.svg',
  ]
  const supportSources = [
    'https://images.unsplash.com/photo-1573496799652-408c2ac9fe98?auto=format&fit=crop&w=1300&q=80',
    'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=1300&q=80',
    '/art-10-trust.svg',
  ]

  return (
    <main className="landing-shell min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <p className="eyebrow">UBDVS</p>
              <p className="text-sm font-semibold text-slate-900">Document Trust Platform</p>
            </div>
          </div>
          <div className="hidden items-center gap-6 md:flex">
            <a href="#features" className="landing-nav-link"><InlineIcon icon="mdi:star-outline" className="nav-link-icon" />Features</a>
            <a href="#workflow" className="landing-nav-link"><InlineIcon icon="mdi:timeline-clock-outline" className="nav-link-icon" />Workflow</a>
            <a href="#stories" className="landing-nav-link"><InlineIcon icon="mdi:account-group-outline" className="nav-link-icon" />Stories</a>
            <a href="#use-cases" className="landing-nav-link"><InlineIcon icon="mdi:briefcase-outline" className="nav-link-icon" />Use cases</a>
            <Link to="/scan" className="landing-nav-link"><InlineIcon icon="mdi:qrcode-scan" className="nav-link-icon" />Scan QR</Link>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/login" className="btn"><InlineIcon icon="mdi:login-variant" className="btn-icon" />Login</Link>
          </div>
        </nav>
      </header>

      <section className="mx-auto grid w-full max-w-6xl gap-6 px-4 pb-8 pt-10 sm:px-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="panel hero-panel p-8 sm:p-10">
          <p className="eyebrow">Professional certificate verification</p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight text-slate-900 sm:text-5xl">
            Real people. Real records. Real-time proof.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-600">
            UBDVS helps institutions issue trusted certificates and lets anyone verify authenticity in seconds from mobile.
          </p>

          <div className="mt-7 flex flex-wrap gap-2">
            <span className="logo-chip"><InlineIcon icon="mdi:shield-lock-outline" className="chip-icon" />Issuer login + roles</span>
            <span className="logo-chip"><InlineIcon icon="mdi:link-variant" className="chip-icon" />Public proof link</span>
            <span className="logo-chip"><InlineIcon icon="mdi:qrcode-scan" className="chip-icon" />QR + mobile scan</span>
            <span className="logo-chip"><InlineIcon icon="mdi:file-download-outline" className="chip-icon" />Downloadable PDF</span>
            <span className="logo-chip"><InlineIcon icon="mdi:clipboard-text-clock-outline" className="chip-icon" />Audit-ready logs</span>
          </div>

          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/login" className="btn"><InlineIcon icon="mdi:rocket-launch-outline" className="btn-icon" />Start issuing</Link>
            <Link to="/scan" className="btn-secondary"><InlineIcon icon="mdi:camera-outline" className="btn-icon" />Verify with camera</Link>
          </div>

          <div className="mt-7 rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <InlineIcon icon="mdi:label-multiple-outline" className="section-icon" />
              <p className="text-sm font-semibold text-slate-700">Trusted by teams that need simple verification, not heavy systems.</p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="logo-strip-item"><InlineIcon icon="logos:google-icon" className="partner-logo" /><span>Institutions</span></div>
              <div className="logo-strip-item"><InlineIcon icon="logos:microsoft-icon" className="partner-logo" /><span>Corporate</span></div>
              <div className="logo-strip-item"><InlineIcon icon="logos:nextjs-icon" className="partner-logo" /><span>Modern teams</span></div>
            </div>
          </div>

          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <div className="metric-pill">
              <InlineIcon icon="mdi:timer-sand" className="metric-icon" />
              <p className="metric-value">10s</p>
              <p className="metric-label">Average verify time</p>
            </div>
            <div className="metric-pill">
              <InlineIcon icon="mdi:shield-check-outline" className="metric-icon" />
              <p className="metric-value">QR + ID</p>
              <p className="metric-label">Dual verification path</p>
            </div>
            <div className="metric-pill">
              <InlineIcon icon="mdi:clock-outline" className="metric-icon" />
              <p className="metric-value">24/7</p>
              <p className="metric-label">Public verification access</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <PhotoFrame
            sources={heroTeamSources}
            alt="Professionals reviewing certificate records"
            className="photo-card-lg"
            badge="Trusted by operations teams"
            overlay="Live credential checks before approval"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <PhotoFrame sources={docDeskSources} alt="Official certificate on desk" badge="Document detail" />
            <PhotoFrame sources={mobileCheckSources} alt="Person using mobile phone for verification" badge="Mobile proof" />
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto w-full max-w-6xl px-4 pb-6 sm:px-6">
        <div className="grid gap-4 md:grid-cols-3">
          <article className="panel p-6">
            <p className="eyebrow">Issue</p>
            <InlineIcon icon="mdi:file-document-edit-outline" className="section-icon" />
            <h3 className="mt-2 text-xl font-semibold text-slate-900">Create certificate records</h3>
            <p className="mt-2 text-sm text-slate-600">Issuer teams generate records with secure IDs and immutable hash references.</p>
          </article>
          <article className="panel p-6">
            <p className="eyebrow">Secure</p>
            <InlineIcon icon="mdi:shield-lock-outline" className="section-icon" />
            <h3 className="mt-2 text-xl font-semibold text-slate-900">Attach QR and share publicly</h3>
            <p className="mt-2 text-sm text-slate-600">Every certificate includes a QR path for immediate authenticity checks.</p>
          </article>
          <article className="panel p-6">
            <p className="eyebrow">Verify</p>
            <InlineIcon icon="mdi:qrcode-scan" className="section-icon" />
            <h3 className="mt-2 text-xl font-semibold text-slate-900">Instant verification status</h3>
            <p className="mt-2 text-sm text-slate-600">Employers and institutions validate records with a phone or direct link.</p>
          </article>
        </div>
      </section>

      <section id="workflow" className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[0.95fr_1.05fr]">
        <PhotoFrame
          sources={meetingSources}
          alt="Team validating records in an office"
          className="photo-card-lg"
          badge="Workflow"
          overlay="One platform from issuance to public proof"
        />

        <div className="panel panel-soft p-7">
          <p className="eyebrow">How it works</p>
          <div className="mt-4 space-y-4">
            <div className="mini-panel">
              <p className="font-semibold text-slate-900">1. Organization signs in</p>
              <p className="mt-1 text-sm text-slate-600">Authorized staff create and manage official records in dashboard.</p>
            </div>
            <div className="mini-panel">
              <p className="font-semibold text-slate-900">2. Certificate is issued</p>
              <p className="mt-1 text-sm text-slate-600">Platform generates certificate ID, hash, QR, and downloadable PDF.</p>
            </div>
            <div className="mini-panel">
              <p className="font-semibold text-slate-900">3. Anyone can verify</p>
              <p className="mt-1 text-sm text-slate-600">Scan the QR from mobile or open verification URL to confirm status.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="stories" className="mx-auto w-full max-w-6xl px-4 pb-8 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-3">
          <PhotoFrame
            sources={recruiterSources}
            alt="Hiring team validating candidate records"
            badge="Corporate HR"
            overlay="Offer approvals with instant credential checks"
          />
          <PhotoFrame
            sources={gradSources}
            alt="Graduate with certificate"
            badge="Education"
            overlay="Students share QR-backed certificates with confidence"
          />
          <PhotoFrame
            sources={supportSources}
            alt="Verification support specialist"
            badge="Verification desk"
            overlay="Support teams resolve authenticity requests quickly"
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <article className="panel panel-soft p-6">
            <p className="eyebrow">Why teams choose UBDVS</p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-900">Purpose-built for trust-sensitive workflows</h3>
            <p className="mt-3 text-sm text-slate-600">
              From admissions to hiring and licensing, your team gets a practical workflow with a public proof page and clear status result.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="mini-panel">
                <p className="font-semibold text-slate-900">Single source of truth</p>
                <p className="mt-1 text-sm text-slate-600">Each issued record carries a unique ID and secure hash.</p>
              </div>
              <div className="mini-panel">
                <p className="font-semibold text-slate-900">Faster verifications</p>
                <p className="mt-1 text-sm text-slate-600">Phone camera scan directs verifiers straight to result page.</p>
              </div>
            </div>
          </article>

          <PhotoFrame
            sources={officeSources}
            alt="Operations room reviewing document dashboard"
            className="photo-card-lg"
            badge="Operations"
            overlay="Issue, track, and verify in one interface"
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <PhotoFrame
            sources={[
              'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1300&q=80',
              'https://images.unsplash.com/photo-1526948128573-703ee1aeb6fa?auto=format&fit=crop&w=1300&q=80',
              '/art-03-mobile.svg',
            ]}
            alt="Team handling digital documents"
            badge="Document desk"
            overlay="Clean workflows for digital paperwork"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <PhotoFrame
              sources={[
                'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=1200&q=80',
                'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1200&q=80',
                '/art-01-seal.svg',
              ]}
              alt="Professionals in a review meeting"
              badge="Review"
              overlay="Clear approvals for verification teams"
            />
            <PhotoFrame
              sources={[
                'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1200&q=80',
                'https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=1200&q=80',
                '/art-10-trust.svg',
              ]}
              alt="People discussing documents on a laptop"
              badge="Trust"
              overlay="Fast decisions backed by proof"
            />
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <article className="panel p-6">
            <p className="eyebrow">Speed</p>
            <h3 className="mt-2 text-lg font-semibold text-slate-900">Less clutter, more action</h3>
            <p className="mt-2 text-sm text-slate-600">A cleaner landing focuses on verification, not noise.</p>
          </article>
          <article className="panel p-6">
            <p className="eyebrow">Trust</p>
            <h3 className="mt-2 text-lg font-semibold text-slate-900">Real people, real process</h3>
            <p className="mt-2 text-sm text-slate-600">Use imagery that looks like actual operations teams and documents.</p>
          </article>
          <article className="panel p-6">
            <p className="eyebrow">Clarity</p>
            <h3 className="mt-2 text-lg font-semibold text-slate-900">No repeated art</h3>
            <p className="mt-2 text-sm text-slate-600">Every block uses a different visual so the page feels intentional.</p>
          </article>
        </div>
      </section>

      <section id="use-cases" className="mx-auto w-full max-w-6xl px-4 pb-12 sm:px-6">
        <div className="panel panel-soft p-7 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Use cases</p>
              <h2 className="mt-2 text-3xl font-semibold text-slate-900">Built for real verification teams</h2>
            </div>
            <Link to="/login" className="btn">Open issuer dashboard</Link>
          </div>

          <div className="mt-4 rounded-xl border border-violet-200/70 bg-violet-50/70 p-4">
            <p className="text-sm text-violet-900">
              Hotspot mode tip: open Certificate Studio, set public verification base URL to your laptop hotspot IP
              (for example http://192.168.43.1:5173), then regenerate QR.
            </p>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="mini-panel mini-panel-accent">
              <p className="font-semibold text-slate-900">Universities</p>
              <p className="mt-1 text-sm text-slate-600">Degree and transcript authentication.</p>
            </div>
            <div className="mini-panel mini-panel-accent">
              <p className="font-semibold text-slate-900">Corporate HR</p>
              <p className="mt-1 text-sm text-slate-600">Pre-hire credential verification.</p>
            </div>
            <div className="mini-panel mini-panel-accent">
              <p className="font-semibold text-slate-900">Government desks</p>
              <p className="mt-1 text-sm text-slate-600">Citizen-facing document checks.</p>
            </div>
            <div className="mini-panel mini-panel-accent">
              <p className="font-semibold text-slate-900">Training centers</p>
              <p className="mt-1 text-sm text-slate-600">Fast issuance with public trust.</p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="logo-strip-item"><InlineIcon icon="logos:google-cloud" className="partner-logo" /><span>Cloud ready</span></div>
            <div className="logo-strip-item"><InlineIcon icon="logos:slack-icon" className="partner-logo" /><span>Team friendly</span></div>
            <div className="logo-strip-item"><InlineIcon icon="logos:figma" className="partner-logo" /><span>Design clean</span></div>
            <div className="logo-strip-item"><InlineIcon icon="logos:nextjs-icon" className="partner-logo" /><span>Next logo style</span></div>
          </div>
        </div>
      </section>
    </main>
  )
}

function CertificatePanel({ selectedDoc, verificationUrl, notify }) {
  const [busy, setBusy] = useState(false)
  const [templateId, setTemplateId] = useState(CERTIFICATE_TEMPLATES[0].id)
  const [backgroundId, setBackgroundId] = useState(CERTIFICATE_BACKGROUNDS[0].id)
  const selectedTemplate = CERTIFICATE_TEMPLATES.find((template) => template.id === templateId) || CERTIFICATE_TEMPLATES[0]
  const selectedBackground = CERTIFICATE_BACKGROUNDS.find((background) => background.id === backgroundId) || CERTIFICATE_BACKGROUNDS[0]

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
    await downloadCertificatePdf(selectedDoc, verificationUrl, selectedTemplate, selectedBackground)
    setBusy(false)
    notify('Certificate PDF downloaded.', 'success')
  }

  const onQr = async () => {
    await downloadQrImage(selectedDoc.id, verificationUrl)
    notify('QR image downloaded.', 'success')
  }

  return (
    <section className="panel p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="section-title">Certificate Studio</h3>
          <p className="mt-1 text-sm text-slate-600">Choose a template before downloading the PDF.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={onQr}>Download QR</button>
          <button type="button" className="btn" onClick={onPdf} disabled={busy}>
            {busy ? 'Generating PDF...' : 'Download Certificate PDF'}
          </button>
        </div>
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-3">
        {CERTIFICATE_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            className={`template-card ${templateId === template.id ? 'template-card-active' : ''}`}
            onClick={() => setTemplateId(template.id)}
          >
            <span className="template-swatch" style={{ background: template.accent }} />
            <span className="template-card-body">
              <span className="template-card-title">{template.name}</span>
              <span className="template-card-note">{template.note}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="mb-5">
        <p className="mb-2 text-sm font-semibold text-slate-700">Background image packs</p>
        <div className="grid gap-3 md:grid-cols-4">
          {CERTIFICATE_BACKGROUNDS.map((background) => (
            <button
              key={background.id}
              type="button"
              className={`background-card ${backgroundId === background.id ? 'background-card-active' : ''}`}
              onClick={() => setBackgroundId(background.id)}
            >
              <img src={background.asset} alt={`${background.name} background`} className="background-thumb" />
              <span className="template-card-body">
                <span className="template-card-title">{background.name}</span>
                <span className="template-card-note">{background.note}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <article className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <div
          className="certificate-surface"
          style={{
            backgroundImage: `linear-gradient(180deg, rgba(255,255,255,0.78), rgba(255,255,255,0.9)), url(${selectedBackground.asset})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
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
        </div>
        <div className="visual-card">
          <img src="/feature-download.svg" alt="Certificate download preview" className="art-image" />
        </div>
      </article>
    </section>
  )
}

function DashboardPage({ auth, onLogout, notify }) {
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
  const [publicVerifyBaseUrl, setPublicVerifyBaseUrl] = useState(readPublicVerifyBaseUrl)
  const [publicVerifyBaseUrlDraft, setPublicVerifyBaseUrlDraft] = useState(readPublicVerifyBaseUrl)

  const selectedDoc = useMemo(
    () => documents.find((doc) => doc.id === selectedDocId) || documents[0] || null,
    [documents, selectedDocId],
  )

  const selectedVerificationUrl = useMemo(() => {
    if (!selectedDoc) return ''
    return buildVerificationUrl(selectedDoc.id, publicVerifyBaseUrl)
  }, [selectedDoc, publicVerifyBaseUrl])

  const confirmPublicVerifyBaseUrl = () => {
    const normalized = normalizeBaseUrl(publicVerifyBaseUrlDraft)
    if (!normalized) {
      notify('Enter a public verification URL first.', 'error')
      return
    }

    setPublicVerifyBaseUrl(normalized)
    try {
      localStorage.setItem(PUBLIC_VERIFY_BASE_KEY, normalized)
    } catch {
      // ignore storage errors and keep in-memory value
    }
    notify('Public verification URL saved.', 'success')
  }

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
      notify(data.error || 'Failed to issue document.', 'error')
      return
    }

    setForm(EMPTY_FORM)
    setActivePanel('certificates')
    setSelectedDocId(data.document_id)
    await loadDocuments()
    await loadLogs()
    notify('Certificate issued successfully.', 'success')
  }

  const handleVerify = async (e) => {
    e.preventDefault()
    setVerifyError('')
    setVerifyResult(null)

    const id = verifyId.trim()
    if (!id) {
      setVerifyError('Enter document ID.')
      notify('Enter document ID.', 'error')
      return
    }

    const { ok, data } = await apiFetch(`/api/verify/${id}`, '')

    if (!ok) {
      setVerifyError(data.error || 'Document not found.')
      notify(data.error || 'Document not found.', 'error')
      return
    }

    setVerifyResult(data)
    notify(`Verification ${data.status}.`, data.status === 'valid' ? 'success' : 'error')
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
          <BrandMark />
          <p className="text-sm font-medium text-slate-700">UBDVS Platform</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/scan" className="btn-secondary"><InlineIcon icon="mdi:qrcode-scan" className="btn-icon" />Mobile Scanner</Link>
          <button type="button" className="btn-secondary" onClick={() => { onLogout(); notify('Signed out.', 'info') }}><InlineIcon icon="mdi:logout-variant" className="btn-icon" />Sign out</button>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-7xl gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="panel p-4">
          <p className="eyebrow">Issuer Workspace</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-900">{auth.user.organization_name}</h2>
          <p className="mt-1 text-sm text-slate-600">{auth.user.email}</p>
          <img src="/feature-shield.svg" alt="Security illustration" className="mt-4 art-image art-image-small" />

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
            <div className="mt-4 grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
              <div>
                <h1 className="text-3xl font-semibold leading-tight text-slate-900 sm:text-4xl">
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
              </div>
              <div className="visual-card visual-card-tight">
                <img src="/feature-flow.svg" alt="Issuance workflow illustration" className="art-image" />
              </div>
            </div>
          </header>

          {activePanel === 'overview' && (
            <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-2">
                <StatCard title="Issued Certificates" value={documents.length} detail="Organization records" />
                <StatCard title="Verification Events" value={logs.length} detail="Public and API checks" />
                <StatCard title="Security Model" value="SHA-256" detail="Integrity proof per document" />
                <StatCard title="Active Modules" value={platforms.length} detail="Issuer + verify + audit" />
              </div>
              <div className="grid gap-4">
                <div className="visual-card">
                  <img src="/feature-download.svg" alt="Certificate download illustration" className="art-image" />
                </div>
                <div className="visual-card">
                  <img src="/art-04-chart.svg" alt="Verification analytics illustration" className="art-image" />
                </div>
              </div>
            </section>
          )}

          {activePanel === 'issue' && (
            <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="visual-card">
                <img src="/art-05-doc.svg" alt="Document illustration" className="art-image" />
              </div>
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
            </section>
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

                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="eyebrow">Public verification base URL (for mobile QR)</p>
                  <input
                    className="field mt-2"
                    placeholder="https://your-domain.com"
                    value={publicVerifyBaseUrlDraft}
                    onChange={(e) => setPublicVerifyBaseUrlDraft(e.target.value)}
                  />
                  <p className="mt-2 text-xs text-slate-600">
                    If your laptop uses localhost, set this to your LAN IP origin like
                    {' '}
                    <span className="font-mono">http://192.168.x.x:5173</span>
                    {' '}
                    so phone-scanned QR links open correctly.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary" onClick={() => setPublicVerifyBaseUrlDraft(window.location.origin)}>
                      Use current origin
                    </button>
                    <button type="button" className="btn" onClick={confirmPublicVerifyBaseUrl}>
                      Confirm URL
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Saved URL: <span className="font-mono">{publicVerifyBaseUrl || 'not set yet'}</span>
                  </p>
                </div>
              </section>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="visual-card"><img src="/art-02-stack.svg" alt="Document stack illustration" className="art-image" /></div>
                <div className="visual-card"><img src="/art-06-qr.svg" alt="QR illustration" className="art-image" /></div>
                <div className="visual-card"><img src="/art-07-download.svg" alt="Download illustration" className="art-image" /></div>
              </div>
              <CertificatePanel selectedDoc={selectedDoc} verificationUrl={selectedVerificationUrl} notify={notify} />
            </>
          )}

          {activePanel === 'verify' && (
            <section className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
              <div className="panel p-6">
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
              </div>
              <div className="grid gap-4">
                <div className="visual-card">
                  <img src="/feature-qr.svg" alt="QR verification illustration" className="art-image" />
                </div>
                <div className="visual-card">
                  <img src="/art-08-audit.svg" alt="Audit illustration" className="art-image" />
                </div>
              </div>
            </section>
          )}

          {activePanel === 'logs' && (
            <section className="panel p-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="section-title">Audit Logs</h2>
                <button type="button" className="btn-secondary" onClick={async () => { await loadLogs(); notify('Audit logs refreshed.', 'success') }}>Refresh</button>
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
              <div className="visual-card"><img src="/art-09-user.svg" alt="User module illustration" className="art-image" /></div>
              <div className="visual-card"><img src="/art-01-seal.svg" alt="Seal module illustration" className="art-image" /></div>
              <div className="visual-card"><img src="/art-10-trust.svg" alt="Trust module illustration" className="art-image" /></div>
            </section>
          )}

          <section className="panel p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="section-title">Organization Documents</h2>
              <button type="button" className="btn-secondary" onClick={async () => { await loadDocuments(); notify('Documents refreshed.', 'success') }}>Refresh</button>
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

function VerifyPage({ notify }) {
  const { id } = useParams()
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const run = async () => {
      const { ok, data } = await apiFetch(`/api/verify/${id}`, '')
      if (!ok) {
        setError(data.error || 'Document not found.')
        notify(data.error || 'Document not found.', 'error')
        return
      }
      setResult(data)
      notify('Public verification loaded.', 'success')
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
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="visual-card">
            <img src="/feature-shield.svg" alt="Verification security illustration" className="art-image" />
          </div>
          <div className="visual-card">
            <img src="/feature-qr.svg" alt="QR verification illustration" className="art-image" />
          </div>
        </div>
        {error && <p className="mt-4 text-red-700">{error}</p>}
        {result && <VerifyResult data={result} />}
      </section>
    </main>
  )
}

function MobileScannerPage({ notify }) {
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
        notify('QR code detected.', 'info')

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
        } else {
          notify('QR detected but no verification link found.', 'error')
        }
      },
      () => { },
    )

    scannerRef.current = scanner

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(() => { })
      }
    }
  }, [navigate])

  return (
    <main className="min-h-screen p-4 sm:p-8">
      <section className="panel mx-auto w-full max-w-3xl p-6">
        <p className="eyebrow">Mobile Verification Scanner</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Scan certificate QR code</h1>
        <p className="mt-2 text-sm text-slate-600">{notice}</p>

        <div className="mt-4 grid gap-4 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
          <div className="visual-card">
            <img src="/mobile-scan-visual.svg" alt="Mobile scanning illustration" className="art-image" />
          </div>
          <div id="qr-reader" className="qr-frame" />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="visual-card">
            <img src="/art-03-mobile.svg" alt="Mobile illustration" className="art-image" />
          </div>
          <div className="visual-card">
            <img src="/art-06-qr.svg" alt="QR illustration" className="art-image" />
          </div>
        </div>

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
  const [toasts, setToasts] = useState([])

  const notify = (message, tone = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const titleMap = {
      success: 'Success',
      error: 'Error',
      info: 'Update',
    }
    setToasts((current) => [...current, { id, title: titleMap[tone] || 'Update', message, tone }])
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
    }, 3400)
  }

  const dismissToast = (id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }

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
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={auth.token ? <Navigate to="/dashboard" replace /> : <LoginPage onAuth={handleAuth} notify={notify} />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute auth={auth}>
              <DashboardPage auth={auth} onLogout={logout} notify={notify} />
            </ProtectedRoute>
          }
        />
        <Route path="/scan" element={<MobileScannerPage notify={notify} />} />
        <Route path="/verify/:id" element={<VerifyPage notify={notify} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
