"use client";
import { useState } from "react";

type Result = {
  success: boolean;
  totalLeads: number;
  newContacts: number;
  updatedContacts: number;
  skippedNoEmail: number;
  companiesCreated: number;
  dealsCreated: number;
  errors: string[];
  timestamp: string;
  duration: number;
};

export default function Page() {
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  const call = async (path: string) => {
    setBusy(true);
    try {
      const r = await fetch(path);
      const j = await r.json();
      setRes(j);
    } catch (e: any) {
      setRes({
        success: false,
        totalLeads: 0,
        newContacts: 0,
        updatedContacts: 0,
        skippedNoEmail: 0,
        companiesCreated: 0,
        dealsCreated: 0,
        errors: [e?.message || String(e)],
        timestamp: new Date().toISOString(),
        duration: 0
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 800, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h1>OfficeHub → HubSpot Sync</h1>
      <p style={{ color: "#555" }}>Manual test controls</p>
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <button disabled={busy} onClick={() => call("/api/health")}>Health</button>
        <button disabled={busy} onClick={() => call("/api/sync-officehub?dryRun=1")}>Dry Run (no HubSpot writes)</button>
        <button disabled={busy} onClick={() => call("/api/sync-officehub")}>Run Sync</button>
      </div>

      {res && (
        <pre style={{ fontSize: 20, marginTop: 24, padding: 16, background: "#3b3939ff", borderRadius: 8, overflow: "auto" }}>
{JSON.stringify(res, null, 2)}
        </pre>
      )}
      <p style={{ marginTop: 16, color: "#666" }}>
        Check <b>Vercel → Functions → Logs</b> for detailed per-lead messages.
      </p>
    </main>
  );
}
