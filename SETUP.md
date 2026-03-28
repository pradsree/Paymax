# PayMax — Setup & Deployment Guide

## Files

```
paymax-app/
├── netlify.toml
├── public/index.html              ← PayMax frontend
├── netlify/functions/
│   ├── flight-search.js           ← Duffel cash flight search
│   ├── flight-book.js             ← Duffel booking
│   └── award-search.js            ← Seats.aero award availability
└── SETUP.md
```

---

## Step 1 — Duffel API key (required, free)

1. Sign up at https://app.duffel.com/join (1 min)
2. Dashboard → More → Developers → Access tokens → Create test token
3. Token starts with `duffel_test_...`

Duffel gives real flight prices from 300+ airlines.

---

## Step 2 — Seats.aero API key (optional)

For real award seat availability across 24 loyalty programs.

Personal use: Subscribe to Seats.aero Pro (~$10/mo) → Settings → API tab → Generate key

Shared app: Use "Login with Seats.aero" OAuth so each user connects their own account.
See: https://developers.seats.aero/reference/overview

---

## Step 3 — Deploy to Netlify

Drag the `paymax-app/` folder to https://app.netlify.com/drop

Or via CLI:
```
npm i -g netlify-cli && netlify deploy --prod
```

---

## Step 4 — Environment variables

In Netlify → Site settings → Environment variables:

| Variable             | Value                    | Required |
|----------------------|--------------------------|----------|
| DUFFEL_API_KEY       | duffel_test_DfayzL5VtRjc5JmUx3sNMiuSP3IOQK0ib_Jy16vHBt7 | Yes |
| SEATS_AERO_API_KEY   | Your Seats.aero key      | Optional |

Save → Trigger redeploy.

---

## Local dev

```bash
echo "DUFFEL_API_KEY=duffel_test_DfayzL5VtRjc5JmUx3sNMiuSP3IOQK0ib_Jy16vHBt7" > .env
echo "SEATS_AERO_API_KEY=..." >> .env
netlify dev   # http://localhost:8888
```

---

## Production booking

Switch `duffel_test_...` to `duffel_live_...` when ready.
Set up card payment collection: https://duffel.com/docs/guides/collecting-customer-card-payments

---

## Backlog

BACK-001/002: Plaid (bank + card sync)
BACK-003: AwardWallet partner API (loyalty balance sync)
BACK-009: Seats.aero (partially done — award search)
BACK-018: Rooms.aero / MaxMyPoint (hotel awards)
