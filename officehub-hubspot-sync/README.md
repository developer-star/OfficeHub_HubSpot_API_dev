# OfficeHub → HubSpot Daily Sync

Pulls OfficeHub leads and upserts them into HubSpot. Optional Company + Deal creation with associations.

## Endpoints
- `GET /api/health` – quick status
- `GET /api/sync-officehub?dryRun=1&hours=24` – fetch + summarize only (no HubSpot writes)
- `GET /api/sync-officehub` – full sync (requires HUBSPOT_TOKEN)

## Configure
Copy `.env.example` to `.env.local` and fill values. Then:
```bash
npm i
npm run dev
