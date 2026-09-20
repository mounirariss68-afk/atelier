import { and, eq } from "drizzle-orm";
import {
  db,
  atelierAdminPersonMappings,
  atelierPersons,
  atelierUsers,
  atelierPersonRelationshipClassifications,
  atelierOwnershipStructures,
  atelierOwnershipStakeholders,
  atelierOwnershipStructureLinks,
  atelierOwnershipInterests,
  atelierCommercialRights,
} from "@workspace/db";

const id = (p: string) => `seed1363_${p}`;
const today = "2026-01-01";
/** Idempotent opening economics seed. It only resolves people through stable mappings. */
export async function ensureAtelierOwnershipSeed(orgId = "aico") {
  type CanonicalPerson = {
    key: string;
    personId: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    displayName: string;
  };
  const userRows = await db
    .select({ id: atelierUsers.id, personId: atelierUsers.personId })
    .from(atelierUsers)
    .where(eq(atelierUsers.orgId, orgId));
  const userPersonIds = new Map(userRows.map((row) => [row.id, row.personId]));
  const people: CanonicalPerson[] = [
    { key: "mounir", personId: "p_mounir_ariss", firstName: "Mounir", middleName: null, lastName: "Ariss", displayName: "Mounir Ariss" },
    { key: "gokhan", personId: "p_gokhan_guney", firstName: "Gokhan", middleName: null, lastName: "Guney", displayName: "Gokhan Guney" },
    { key: "omer", personId: "p_omer_barbaros_yis", firstName: "Omer", middleName: "Barbaros", lastName: "Yis", displayName: "Omer Barbaros Yis" },
    { key: "bulent", personId: "p_bulent_egrilmez", firstName: "Bulent", middleName: null, lastName: "Egrilmez", displayName: "Bulent Egrilmez" },
  ];
  for (const person of people) {
    const personId = userPersonIds.get(person.personId) ?? person.personId;
    await db.insert(atelierPersons).values({ id: personId, orgId, firstName: person.firstName, middleName: person.middleName, lastName: person.lastName, displayName: person.displayName, sourceKind: "ownership_seed" }).onConflictDoNothing();
    await db.insert(atelierAdminPersonMappings).values({ id: id(`mapping_${person.key}`), orgId, stableKey: `equity-partner:${person.key}`, personId, metadata: { source: "task-1363-opening-structure" } }).onConflictDoUpdate({ target: [atelierAdminPersonMappings.orgId, atelierAdminPersonMappings.stableKey], set: { personId, updatedAt: new Date(), deletedAt: null } });
    const classificationId = id(`classification_${person.key}`);
    const classificationSet = { personId, relationshipType: "equity_partner", compensationBasis: "none", status: "active", effectiveFrom: today, source: "task-1363-opening-structure", provenanceId: `seed1363_${person.key}`, updatedAt: new Date(), deletedAt: null };
    const updated = await db
      .update(atelierPersonRelationshipClassifications)
      .set(classificationSet)
      .where(eq(atelierPersonRelationshipClassifications.id, classificationId))
      .returning({ id: atelierPersonRelationshipClassifications.id });
    if (!updated.length) {
      await db.insert(atelierPersonRelationshipClassifications).values({ id: classificationId, orgId, ...classificationSet }).onConflictDoUpdate({ target: [atelierPersonRelationshipClassifications.orgId, atelierPersonRelationshipClassifications.personId, atelierPersonRelationshipClassifications.effectiveFrom], set: classificationSet });
    }
  }
  const mappings = await db.select().from(atelierAdminPersonMappings).where(eq(atelierAdminPersonMappings.orgId, orgId));
  const byKey = new Map(mappings.map((x) => [x.stableKey, x.personId]));
  const structures = [
    ["holding", "Cognirise Holding", "holding", "planned"],
    ["dubai", "Cognirise Dubai", "entity", "incorporated"],
    ["saudi", "Cognirise Saudi Arabia", "entity", "planned"],
    ["europe", "Cognirise Europe", "territory", "planned"],
    ["turkiye", "Cognirise Türkiye", "territory", "planned"],
  ] as const;
  for (const [key, name, structureType, status] of structures) {
    await db
      .insert(atelierOwnershipStructures)
      .values({
        id: id(key),
        orgId,
        name,
        structureType,
        status,
        approvalStatus: "approved",
        approvedBy: "system",
        approvedAt: new Date(),
        effectiveFrom: today,
      })
        .onConflictDoNothing();
  }
  const stakeholderSpecs = [
    ["mounir", "Mounir Ariss"],
    ["gokhan", "Gokhan Guney"],
    ["omer", "Omer Barbaros Yis"],
    ["bulent", "Bulent Egrilmez"],
    ["ayman-external", "Dr. Ayman AlShelfan"],
    ["structure:holding", "Cognirise Holding"],
  ] as const;
  for (const [key, label] of stakeholderSpecs) {
    const personId = byKey.get(`equity-partner:${key}`) ?? byKey.get(key);
    await db
      .insert(atelierOwnershipStakeholders)
      .values({
        id: id(`holder_${key}`),
        orgId,
        label,
        stakeholderType: key === "ayman-external" ? "external_party" : key.startsWith("structure:") ? "entity" : "person",
        personId: personId ?? null,
        stableKey: key,
        externalRef: key === "ayman-external" ? "sponsor-saudi" : null,
      })
      .onConflictDoUpdate({
        target: [atelierOwnershipStakeholders.orgId, atelierOwnershipStakeholders.stableKey],
        set: { personId: personId ?? null },
      });
  }
  const links = [
    ["holding", "dubai"],
    ["holding", "saudi"],
    ["holding", "europe"],
    ["holding", "turkiye"],
  ];
  for (const [parent, child] of links)
    await db
      .insert(atelierOwnershipStructureLinks)
      .values({
        id: id(`link_${child}`),
        orgId,
        parentStructureId: id(parent),
        childStructureId: id(child),
        relationship: "owns",
        effectiveFrom: today,
        status: "approved",
        approvedBy: "system",
        approvedAt: new Date(),
      })
      .onConflictDoNothing();
  const interests: Array<[string, string, number, number, number]> = [
    ["holding", "mounir", 45, 45, 45],
    ["holding", "gokhan", 45, 45, 45],
    ["holding", "bulent", 10, 10, 10],
     ["dubai", "structure:holding", 100, 100, 100],
     ["saudi", "structure:holding", 49, 49, 100],
    ["saudi", "ayman-external", 51, 51, 0],
     ["europe", "structure:holding", 15, 15, 15],
    ["europe", "bulent", 85, 85, 85],
     ["turkiye", "structure:holding", 70, 70, 70],
    ["turkiye", "omer", 30, 30, 30],
  ];
  for (const [structure, holder, legalPct, votingPct, profitPct] of interests) {
    await db
      .insert(atelierOwnershipInterests)
      .values({
        id: id(`interest_${structure}_${holder}`),
        orgId,
        structureId: id(structure),
        stakeholderId: id(`holder_${holder}`),
        legalPct,
        votingPct,
        profitPct,
        status: "approved",
        effectiveFrom: today,
        approvedBy: "system",
        approvedAt: new Date(),
        pendingTerms: false,
      })
      .onConflictDoNothing();
  }
  await db
    .insert(atelierCommercialRights)
    .values({
      id: id("saudi_sponsor_right"),
      orgId,
      structureId: id("saudi"),
      holderStakeholderId: id("holder_ayman-external"),
      rightType: "sponsor",
      pendingTerms: true,
      status: "pending",
      effectiveFrom: today,
      terms: { reason: "Commercial rate and basis not supplied" },
    })
    .onConflictDoNothing();
}
