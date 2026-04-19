# UBDVS (Simple Version)

Simple document issuance + verification system.
No blockchain.
Stack: React (Vite + Tailwind) + Flask.

## Features

- Organization login/register
- Organization issues document with metadata
- Backend computes SHA-256 hash proof
- Public verification by document ID
- Public verification API by hash
- QR code generated for verification URL
- Mobile QR scanner page (`/scan`) for phone camera verification
- Certificate studio with downloadable PDF certificate
- Downloadable QR image for print and sharing
- Verification attempts logged

## Project Structure

- `frontend/` React + Vite + Tailwind UI
- `backend/` Flask API

## Run Backend

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Backend runs on `http://127.0.0.1:5000`.

## Run Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://127.0.0.1:5173`.
Vite proxy forwards `/api/*` to Flask.

## Main API

- `POST /api/auth/register` create org account
- `POST /api/auth/login` sign in
- `GET /api/auth/me` current user
- `POST /api/document` issue document
- `GET /api/documents` list documents
- `GET /api/verify/<document_id>` verify by ID
- `GET /api/public/verify/<hash>` verify by hash
- `GET /api/logs` read verification logs

## Frontend Routes

- `/login` issuer login/register
- `/` issuer platform dashboard
- `/scan` camera-based QR scanner
- `/verify/:id` public verification page

## Demo Login

- Email: `admin@acme.edu`
- Password: `admin123`

## Notes

- Storage is in-memory (demo mode).
- Restart backend -> data resets.
- For production, replace in-memory store with DB.
# udvs
