export interface OfficeHubLead {
    id?: string;
    property_address?: string;
    tenantDetails?: {
        email?: string;
        first_name?: string;
        last_name?: string;
        phone_num?: string;
        mobile_num?: string;
        company_name?: string;
        address?: string;
    };
    companyDetails?: {
        name?: string;
        address?: string;
    };
}

interface OfficeHubResponse {
    status: string;      // "Success"
    message: string;     // "Success" | "No record found"
    errorCode: string;   // "200"
    leads: OfficeHubLead[];
}

function requiredEnv(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`Missing env: ${name}`);
    return v;
}

/** Fetch OfficeHub leads as JSON */
export async function fetchLeads(hours = 24, createdAfter?: string): Promise<OfficeHubLead[]> {
    const base = requiredEnv("OFFICEHUB_API_BASE"); // e.g. https://officehub--api.sandbox.my.salesforce-sites.com/api
    const apiKey = requiredEnv("OFFICEHUB_API_KEY");

    const params = new URLSearchParams();
    params.set("client", apiKey);
    // IMPORTANT: correct casing + value format
    params.set("modifiedIn", `LAST_N_HOURS:${hours}`);
    if (createdAfter) params.set("createdafter", createdAfter);

    const url = `${base}/services/apexrest/v1/leads?${params.toString()}`;
    console.log(`[officehub] GET ${url}`);

    const r = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json", "User-Agent": "OfficeHub-HubSpot-Sync/1.0" },
        cache: "no-store"
    });

    if (!r.ok) {
        const txt = await r.text();
        throw new Error(`OfficeHub ${r.status}: ${txt}`);
    }

    const data = (await r.json()) as OfficeHubResponse;
    // 🧩 DEBUG: print full JSON (only while testing)
    console.log("───────────────────────── OfficeHub RAW JSON ──────────────────────────");
    console.log(JSON.stringify(data, null, 2));
    console.log("─────────────────────────────── END JSON ───────────────────────────────");

    console.log(`[officehub] status=${data.status} code=${data.errorCode} msg="${data.message}" count=${data.leads?.length ?? 0}`);

    if (data.status !== "Success" || data.errorCode !== "200") {
        throw new Error(`OfficeHub returned error: ${data.status} (${data.errorCode}) ${data.message}`);
    }
    return data.leads ?? [];
}
