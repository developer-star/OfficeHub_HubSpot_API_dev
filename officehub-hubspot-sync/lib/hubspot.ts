interface HubSpotContactProperties {
  email: string;
  firstname?: string;
  lastname?: string;
  phone?: string;
  company?: string;
}
interface HubSpotContact {
  id: string;
  properties: HubSpotContactProperties;
}

async function hs<T>(path: string, init?: RequestInit): Promise<T> {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) throw new Error("Missing HubSpot token: HUBSPOT_TOKEN");
  const r = await fetch(`https://api.hubapi.com${path}`, {
    ...(init || {}),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`HubSpot ${path} ${r.status}: ${body}`);
  }
  return (await r.json()) as T;
}

// Contacts
export async function createContact(properties: HubSpotContactProperties): Promise<HubSpotContact> {
  return hs("/crm/v3/objects/contacts", { method: "POST", body: JSON.stringify({ properties }) });
}
export async function findContactByEmail(email: string): Promise<HubSpotContact | null> {
  const res = await hs<{ results: HubSpotContact[] }>("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
      properties: ["email", "firstname", "lastname", "phone", "company"],
      limit: 1
    })
  });
  return res.results?.[0] || null;
}
export async function updateContact(id: string, properties: HubSpotContactProperties): Promise<HubSpotContact> {
  return hs(`/crm/v3/objects/contacts/${id}`, { method: "PATCH", body: JSON.stringify({ properties }) });
}
export async function upsertContact(
  properties: HubSpotContactProperties
): Promise<{ contact: HubSpotContact; action: "created" | "updated" }> {
  try {
    const contact = await createContact(properties);
    return { contact, action: "created" };
  } catch (e: any) {
    const msg = e?.message || "";
    if (msg.includes("409")) {
      const existing = await findContactByEmail(properties.email);
      if (existing) {
        const updated = await updateContact(existing.id, properties);
        return { contact: updated, action: "updated" };
      }
    }
    throw e;
  }
}

// Companies
export async function findCompanyByName(name: string): Promise<string | null> {
  const res = await hs<{ results: Array<{ id: string }> }>("/crm/v3/objects/companies/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "name", operator: "EQ", value: name }] }],
      properties: ["name"],
      limit: 1
    })
  });
  return res.results?.[0]?.id || null;
}
export async function createCompany(properties: Record<string, any>): Promise<string> {
  const res = await hs<{ id: string }>("/crm/v3/objects/companies", {
    method: "POST",
    body: JSON.stringify({ properties })
  });
  return res.id;
}

// Deals
export async function createDeal(properties: Record<string, any>): Promise<string> {
  const res = await hs<{ id: string }>("/crm/v3/objects/deals", {
    method: "POST",
    body: JSON.stringify({ properties })
  });
  return res.id;
}

// Associations (v4 single-object association)
async function associate(
  from: "contacts" | "companies" | "deals",
  fromId: string,
  to: "contacts" | "companies" | "deals",
  toId: string
) {
  await hs(`/crm/v4/objects/${from}/${fromId}/associations/${to}/${toId}`, {
    method: "PUT",
    body: JSON.stringify({})
  });
}
export const associateContactToCompany = (contactId: string, companyId: string) =>
  associate("contacts", contactId, "companies", companyId);
export const associateDealToContact = (dealId: string, contactId: string) =>
  associate("deals", dealId, "contacts", contactId);
export const associateDealToCompany = (dealId: string, companyId: string) =>
  associate("deals", dealId, "companies", companyId);
