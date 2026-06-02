# Dealer Recon — Automotive Dealership Information System

> Full-stack SaaS platform for floorplan reconciliation and month-end financial reporting across multi-rooftop automotive dealer groups.

---

## The Problem

Automotive dealerships manage floorplan financing across dozens or hundreds of vehicles simultaneously — reconciling their internal records against bank statements (BOA, Dealertrack) is a manual, error-prone process that routinely takes a dealership's accounting team **hours per day** using disconnected spreadsheets. Mistakes go undetected until month-end, when exception review with the CFO becomes a fire drill.

I identified this problem through **direct onsite discovery sessions** with dealership accounting staff — walking the floor, mapping their actual workflows, and translating manual human processes into structured business logic before writing a single line of code.

---

## What It Does

- **Automated data ingestion** — Parses BOA and Dealertrack CSV/XLS exports and normalizes them into a unified PostgreSQL schema
- **VIN-anchored matching engine** — Matches bank records to dealership inventory line-by-line using VIN6 keys, flagging exceptions where records diverge
- **Carry-forward exception tracking** — Unresolved exceptions persist across reconciliation runs with clerk review workflow and audit trail
- **CFO-ready exports** — Generates Hurst FP Rec-style XLS exports and month-end reports in the exact format dealership leadership expects
- **Real-time dashboard** — Live reconciliation status, account summaries, and exception queue accessible from any browser
- **Multi-run history** — Full run history with diff tracking for compliance and review

**Result:** Reconciliation prep time reduced from hours to minutes. Month-end close becomes a review, not a recovery.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Vite, Tailwind CSS |
| Backend | Node.js, Express, REST API |
| Database | PostgreSQL 16 |
| ORM / Migrations | Prisma ORM |
| Language | TypeScript throughout |
| Infrastructure | Docker Compose (local), GitHub Actions CI/CD |
| Export | XLS/CSV generation via ExcelJS |

---

## Architecture Overview

```
CSV/XLS Upload → Ingestion Parser → Normalization Layer → PostgreSQL
                                                              ↓
                                                    VIN-Anchored Matcher
                                                              ↓
                                          Exception Engine ← Carry-Forward Store
                                                              ↓
                                             React Dashboard ← REST API
                                                              ↓
                                                  XLS Export / Month-End Report
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/upload` | Upload BOA or Dealertrack source file |
| `POST` | `/api/reconcile` | Run reconciliation against current data |
| `GET` | `/api/exceptions` | List all active exceptions |
| `PUT` | `/api/exceptions/:id` | Update exception status/notes |
| `DELETE` | `/api/exceptions/:id` | Resolve/remove exception |
| `GET` | `/api/accounts/summary` | Account-level reconciliation summary |
| `GET` | `/api/export/csv` | Export exception report as CSV |
| `GET` | `/api/reports/month-end` | Generate month-end close report |
| `GET` | `/api/reports/history` | Full reconciliation run history |

---

## Local Development

### Prerequisites
- Node.js 18+
- Docker Desktop
- PostgreSQL 16 (via Docker Compose)

### Setup

```bash
git clone https://github.com/tcompy1/dealer-recon.git
cd dealer-recon

# Start the database
docker compose up -d

# Install dependencies
npm install

# Run migrations
npx prisma migrate dev

# Seed reference data
npx prisma db seed

# Start dev server
npm run dev
```

The app will be available at `http://localhost:3000`. API runs on port `3001`.

### Environment Variables

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dealer_recon
PORT=3001
NODE_ENV=development
```

---

## Project Status

Active development — shipping production releases with a live dealership client.

- 7+ production releases with zero data loss across schema migrations
- Ongoing feature work: multi-rooftop support, role-based access control, automated bank statement email ingestion

---

## Background

This project started from a gap I noticed while spending a decade working inside and alongside automotive dealerships as a P&C insurance agent building comprehensive policy packages for dealer groups. The accounting workflows were manual, disconnected, and error-prone in a way that software could clearly solve — so I built it.

---

*For questions or collaboration: [linkedin.com/in/trentcompton1](https://linkedin.com/in/trentcompton1) · trentcompton88@gmail.com*
