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

export async function ensureOfficeHubFields() {
  const objects = ["contacts", "deals", "companies"];

  for (const obj of objects) {
    try {
      await hs(`/crm/v3/properties/${obj}/officehub_id`, { method: "GET" });
      console.log(`[hubspot] ${obj}.officehub_id already exists`);
    } catch {
      console.log(`[hubspot] creating ${obj}.officehub_id`);
      await hs(`/crm/v3/properties/${obj}`, {
        method: "POST",
        body: JSON.stringify({
          name: "officehub_id",
          label: "OfficeHub Lead ID",
          description: "Unique OfficeHub lead identifier for sync & updates.",
          groupName:
            obj === "contacts"
              ? "contactinformation"
              : obj === "deals"
              ? "dealinformation"
              : "companyinformation",
          type: "string",
          fieldType: "text",
        }),
      });
    }
  }
}

// Make hs<T> return a typed JSON so TS stops saying "unknown"
export async function hs<T = any>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`https://api.hubapi.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
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

// Search by officehub_id first
export async function findContactByOfficeHubId(officehubId: string): Promise<HubSpotContact | null> {
  const res = await hs<{ results: HubSpotContact[] }>("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            { propertyName: "officehub_id", operator: "EQ", value: officehubId }
          ]
        }
      ],
      properties: ["email", "firstname", "lastname", "phone", "company", "officehub_id"],
      limit: 1,
    }),
  });
  return res.results?.[0] || null;
}

// Upsert contact using officehub_id as primary match key
export async function upsertContact(
  properties: HubSpotContactProperties & { officehub_id?: string }
): Promise<{ contact: HubSpotContact; action: "created" | "updated" }> {
  try {
    // 1. Try to match by OfficeHub ID
    if (properties.officehub_id) {
      const existingById = await findContactByOfficeHubId(properties.officehub_id);
      if (existingById) {
        const updated = await updateContact(existingById.id, properties);
        return { contact: updated, action: "updated" };
      }
    }

    // 2. Fallback to match by email (old logic)
    const existingByEmail = await findContactByEmail(properties.email);
    if (existingByEmail) {
      const updated = await updateContact(existingByEmail.id, properties);
      return { contact: updated, action: "updated" };
    }

    // 3. If not found, create a new contact
    const contact = await createContact(properties);
    return { contact, action: "created" };
  } catch (e: any) {
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
type HSBatchCreateResponse = { results?: Array<any> };

const TYPE_ID: Record<string, number> = {
  "deals:contacts": 3,      // HUBSPOT_DEFINED
  "deals:companies": 341,   // HUBSPOT_DEFINED
  "contacts:companies": 931  // HUBSPOT_DEFINED (e.g., Billing Contact in your portal)
};

function associationCategoryFor(_: number) {
  // All three above are HubSpot-defined in your portal
  return "HUBSPOT_DEFINED";
}

export async function associate(
  from: "contacts" | "companies" | "deals",
  fromId: string,
  to: "contacts" | "companies" | "deals",
  toId: string
) {
  const key = `${from}:${to}`;
  const typeId = TYPE_ID[key];
  if (!typeId) {
    console.warn(`Unsupported association direction: ${from} → ${to}`);
    return;
  }

  const url = `/crm/v4/associations/${from}/${to}/batch/create`;
  const body = {
    inputs: [
      {
        from: { id: fromId },
        to: { id: toId },
        // v4 requires *types* when using numeric IDs
        types: [{ associationCategory: associationCategoryFor(typeId), associationTypeId: typeId }]
      }
    ]
  };

  try {
    const json = await hs<HSBatchCreateResponse>(url, { method: "POST", body: JSON.stringify(body) });
    console.log(
      `Associated ${from} → ${to} (typeId=${typeId})`,
      JSON.stringify(json ?? {}, null, 2)
    );
  } catch (err) {
    console.error(`Association failed ${from} → ${to} (typeId=${typeId})`, err);
  }
}

export const associateContactToCompany = (contactId: string, companyId: string) =>
  associate("contacts", contactId, "companies", companyId);

export const associateDealToContact = (dealId: string, contactId: string) =>
  associate("deals", dealId, "contacts", contactId);

export const associateDealToCompany = (dealId: string, companyId: string) =>
  associate("deals", dealId, "companies", companyId);
