import { NextRequest, NextResponse } from "next/server";
import { fetchLeads } from "@/lib/officehub";
import {
  upsertContact,
  findCompanyByName,
  createCompany,
  createDeal,
  associateContactToCompany,
  associateDealToCompany,
  associateDealToContact
} from "@/lib/hubspot";
import { ensureOfficeHubFields } from "@/lib/hubspot";

export const runtime = "nodejs";

type SyncResult = {
  success: boolean;
  totalLeads: number;
  totalWithEmail: number;
  totalWithoutEmail: number;
  newContacts: number;
  updatedContacts: number;
  skippedNoEmail: number;
  companiesCreated: number;
  dealsCreated: number;
  errors: string[];
  timestamp: string;
  duration: number;
};

function has(name: string) {
  return !!process.env[name];
}
function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

let hubspotFieldsChecked = false;

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }

await ensureOfficeHubFields();

async function run(req: NextRequest) {
  if (!hubspotFieldsChecked) {
    await ensureOfficeHubFields();
    hubspotFieldsChecked = true;
  }

  const started = Date.now();
  const errors: string[] = [];

  // Query params
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const hours = Number(url.searchParams.get("hours") || process.env.SYNC_LOOKBACK_HOURS || "24");
  const createdAfter = process.env.OFFICEHUB_CREATED_AFTER || undefined;

  // OfficeHub envs required
  try {
    must("OFFICEHUB_API_BASE");
    must("OFFICEHUB_API_KEY");
  } catch (e: any) {
    return NextResponse.json({ success: false, errors: [e?.message || String(e)] }, { status: 500 });
  }

  // HubSpot token required ONLY if not dryRun
  if (!dryRun && !has("HUBSPOT_TOKEN")) {
    return NextResponse.json({ success: false, errors: ["Missing env: HUBSPOT_TOKEN"] }, { status: 500 });
  }

  try {
    const leads = await fetchLeads(hours, createdAfter);

    // Count emails
    const totalWithEmail = leads.filter(l => !!l.tenantDetails?.email?.trim()).length;
    const totalWithoutEmail = leads.length - totalWithEmail;

    // DRY RUN: just report counts
    if (dryRun) {
      const result: SyncResult = {
        success: true,
        totalLeads: leads.length,
        totalWithEmail,
        totalWithoutEmail,
        newContacts: 0,
        updatedContacts: 0,
        skippedNoEmail: totalWithoutEmail,
        companiesCreated: 0,
        dealsCreated: 0,
        errors: [],
        timestamp: new Date().toISOString(),
        duration: Date.now() - started
      };
      return NextResponse.json(result, { status: 200 });
    }

    let newContacts = 0;
    let updatedContacts = 0;
    let skippedNoEmail = 0;
    let companiesCreated = 0;
    let dealsCreated = 0;

    const PIPELINE = process.env.HUBSPOT_DEALS_PIPELINE_ID || "";
    const DEALSTAGE = process.env.HUBSPOT_DEALS_STAGE_ID || "";

    for (const lead of leads) {
      try {
        const t = lead.tenantDetails || {};
        // Generate real or fake email (for sandbox testing)
        const email =
          t.email?.trim() ||
          `${(t.first_name || "unknown").toLowerCase()}_${lead.id}@example.com`;

        const hadRealEmail = !!t.email?.trim();
        if (!hadRealEmail) {
          console.log(`⚠️ Lead ${lead.id} missing email, using placeholder ${email}`);
          skippedNoEmail++;
        }

        const props = {
          email,
          firstname: (t.first_name || "").trim(),
          lastname: (t.last_name || "").trim() || "OfficeHub",
          phone: (t.mobile_num || t.phone_num || "").trim(),
          company: (t.company_name || "").trim(),
          officehub_id: lead.id, // <-- Add this line
        };

        // Contact upsert
        const { action, contact } = await upsertContact(props);
        if (action === "created") newContacts++;
        else updatedContacts++;


        // Company create + associate (if company name present)
        let companyId: string | null = null;
        if (props.company) {
          companyId = await findCompanyByName(props.company);
          if (!companyId) {
            companyId = await createCompany({
              name: props.company,
              address: t.address || lead.property_address || ""
            });
            companiesCreated++;
          }
          try { await associateContactToCompany(contact.id, companyId!); } catch { }
        }

        // Deal create + associate (optional)
        if (PIPELINE && DEALSTAGE) {
          const dealName = `OfficeHub Lead – ${(props.firstname + " " + props.lastname).trim()}`.replace(/\s+/g, " ");
          const dealId = await createDeal({ dealname: dealName, pipeline: PIPELINE, dealstage: DEALSTAGE, officehub_id: lead.id, });
          dealsCreated++;
          try { await associateDealToContact(dealId, contact.id); } catch { }
          if (companyId) { try { await associateDealToCompany(dealId, companyId); } catch { } }
        }

        // Polite delay to avoid rate limits
        await new Promise(r => setTimeout(r, 150));
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (errors.length < 5) errors.push(msg);
        console.error("[sync] lead error:", msg);
      }
    }

    const result: SyncResult = {
      success: errors.length === 0,
      totalLeads: leads.length,
      totalWithEmail,
      totalWithoutEmail,
      newContacts,
      updatedContacts,
      skippedNoEmail,
      companiesCreated,
      dealsCreated,
      errors,
      timestamp: new Date().toISOString(),
      duration: Date.now() - started
    };
    return NextResponse.json(result, { status: result.success ? 200 : 207 });

  } catch (e: any) {
    return NextResponse.json(
      {
        success: false,
        totalLeads: 0,
        totalWithEmail: 0,
        totalWithoutEmail: 0,
        newContacts: 0,
        updatedContacts: 0,
        skippedNoEmail: 0,
        companiesCreated: 0,
        dealsCreated: 0,
        errors: [e?.message || String(e)],
        timestamp: new Date().toISOString(),
        duration: Date.now() - started
      },
      { status: 500 }
    );
  }
}
