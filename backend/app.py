from __future__ import annotations

import secrets
import hashlib
import json
from functools import wraps
from datetime import UTC, datetime
from uuid import uuid4

from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)
CORS(app)

DOCUMENTS: dict[str, dict] = {}
VERIFICATION_LOGS: list[dict] = []
USERS: dict[str, dict] = {
    "admin@acme.edu": {
        "id": "ORG-ACME-ADMIN",
        "email": "admin@acme.edu",
        "organization_name": "Acme University",
        "role": "org_admin",
        "password_hash": generate_password_hash("admin123"),
    }
}
TOKENS: dict[str, str] = {}


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def issue_token(email: str) -> str:
    token = secrets.token_urlsafe(32)
    TOKENS[token] = email
    return token


def resolve_user_from_auth_header() -> dict | None:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None

    token = auth_header.removeprefix("Bearer ").strip()
    email = TOKENS.get(token)
    if not email:
        return None
    return USERS.get(email)


def auth_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = resolve_user_from_auth_header()
        if not user:
            return jsonify({"error": "Unauthorized"}), 401
        request.current_user = user
        return fn(*args, **kwargs)

    return wrapper


def build_hash_payload(record: dict) -> str:
    payload = {
        "organization_name": record["organization_name"],
        "recipient_name": record["recipient_name"],
        "document_name": record["document_name"],
        "document_type": record["document_type"],
        "issue_date": record["issue_date"],
        "metadata": record["metadata"],
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def compute_hash(record: dict) -> str:
    return hashlib.sha256(build_hash_payload(record).encode("utf-8")).hexdigest()


def add_verification_log(document_id: str | None, status: str, channel: str) -> None:
    VERIFICATION_LOGS.append(
        {
            "id": str(uuid4()),
            "document_id": document_id,
            "timestamp": utc_now(),
            "status": status,
            "channel": channel,
        }
    )


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "service": "ubdvs-api"})


@app.post("/api/auth/register")
def register():
    data = request.get_json(silent=True) or {}
    organization_name = str(data.get("organization_name", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))

    if not organization_name or not email or not password:
        return jsonify({"error": "organization_name, email, password required"}), 400

    if email in USERS:
        return jsonify({"error": "Account already exists"}), 409

    USERS[email] = {
        "id": f"ORG-{uuid4().hex[:8].upper()}",
        "email": email,
        "organization_name": organization_name,
        "role": "org_admin",
        "password_hash": generate_password_hash(password),
    }

    token = issue_token(email)
    return jsonify(
        {
            "token": token,
            "user": {
                "id": USERS[email]["id"],
                "email": email,
                "organization_name": organization_name,
                "role": "org_admin",
            },
        }
    )


@app.post("/api/auth/login")
def login():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))

    user = USERS.get(email)
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid credentials"}), 401

    token = issue_token(email)
    return jsonify(
        {
            "token": token,
            "user": {
                "id": user["id"],
                "email": user["email"],
                "organization_name": user["organization_name"],
                "role": user["role"],
            },
        }
    )


@app.get("/api/auth/me")
@auth_required
def me():
    user = request.current_user
    return jsonify(
        {
            "id": user["id"],
            "email": user["email"],
            "organization_name": user["organization_name"],
            "role": user["role"],
        }
    )


@app.get("/api/platforms")
@auth_required
def platforms():
    return jsonify(
        {
            "platforms": [
                {
                    "name": "Issuer Console",
                    "description": "Create and manage organization documents",
                    "status": "active",
                },
                {
                    "name": "Verification Gateway",
                    "description": "Public and API-based authenticity checks",
                    "status": "active",
                },
                {
                    "name": "Audit Log Center",
                    "description": "Trace verification activity for compliance",
                    "status": "active",
                },
            ]
        }
    )


@app.post("/api/document")
@auth_required
def create_document():
    user = request.current_user
    data = request.get_json(silent=True) or {}

    required_fields = [
        "recipient_name",
        "document_name",
        "document_type",
        "issue_date",
    ]

    missing = [field for field in required_fields if not str(data.get(field, "")).strip()]
    if missing:
        return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400

    metadata = data.get("metadata", {})
    if not isinstance(metadata, dict):
        return jsonify({"error": "metadata must be a JSON object"}), 400

    document_id = f"DOC-{uuid4().hex[:10].upper()}"

    record = {
        "id": document_id,
        "organization_name": user["organization_name"],
        "recipient_name": data["recipient_name"].strip(),
        "document_name": data["document_name"].strip(),
        "document_type": data["document_type"].strip(),
        "issue_date": data["issue_date"],
        "metadata": metadata,
        "owner_email": user["email"],
        "created_at": utc_now(),
    }

    record_hash = compute_hash(record)
    record["hash"] = record_hash
    DOCUMENTS[document_id] = record

    return (
        jsonify(
            {
                "message": "Document issued successfully",
                "document_id": document_id,
                "hash": record_hash,
                "verification_url": f"/verify/{document_id}",
            }
        ),
        201,
    )


@app.get("/api/documents")
@auth_required
def list_documents():
    user = request.current_user
    docs = sorted(
        [
            item
            for item in DOCUMENTS.values()
            if item["organization_name"] == user["organization_name"]
        ],
        key=lambda item: item["created_at"],
        reverse=True,
    )
    return jsonify({"documents": docs})


@app.get("/api/verify/<document_id>")
def verify_document(document_id: str):
    record = DOCUMENTS.get(document_id)
    if not record:
        add_verification_log(document_id, "invalid", "public")
        return jsonify({"error": "Document not found"}), 404

    current_hash = compute_hash(record)
    status = "valid" if current_hash == record["hash"] else "invalid"
    add_verification_log(document_id, status, "public")

    return jsonify(
        {
            "status": status,
            "document_id": record["id"],
            "organization_name": record["organization_name"],
            "recipient_name": record["recipient_name"],
            "document_name": record["document_name"],
            "document_type": record["document_type"],
            "issue_date": record["issue_date"],
            "metadata": record["metadata"],
            "hash": record["hash"],
            "verified_at": utc_now(),
        }
    )


@app.get("/api/public/verify/<document_hash>")
def verify_by_hash(document_hash: str):
    for record in DOCUMENTS.values():
        if record["hash"] == document_hash:
            current_hash = compute_hash(record)
            status = "valid" if current_hash == record["hash"] else "invalid"
            add_verification_log(record["id"], status, "api")
            return jsonify(
                {
                    "status": status,
                    "document_id": record["id"],
                    "organization_name": record["organization_name"],
                    "document_name": record["document_name"],
                    "issue_date": record["issue_date"],
                    "hash": record["hash"],
                }
            )

    add_verification_log(None, "invalid", "api")
    return jsonify({"error": "No document found for given hash"}), 404


@app.get("/api/logs")
@auth_required
def get_logs():
    user = request.current_user
    allowed_doc_ids = {
        doc["id"]
        for doc in DOCUMENTS.values()
        if doc["organization_name"] == user["organization_name"]
    }
    logs = [
        log for log in VERIFICATION_LOGS if not log["document_id"] or log["document_id"] in allowed_doc_ids
    ]
    return jsonify({"verification_logs": logs})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
