/**
 * Demo data for trying the CRM out. Refuses to run if any accounts exist.
 *   npm run db:seed
 * Every demo login uses the password printed at the end.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { hash } from "@node-rs/argon2";
import { sql } from "drizzle-orm";
import * as t from "../src/lib/db/schema";
import { bdoFor } from "../src/lib/permissions";
import { loadEnv } from "./env";

loadEnv();
const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema: t });
const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(t.accounts);
if (n > 0) {
  console.error("The database already has accounts. Seed only runs on an empty database.");
  process.exit(1);
}
const PASSWORD = "Switchlink2026!";
const pw = await hash(PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
const day = 86400000;
const ago = (d: number) => new Date(Date.now() - d * day);

const [nairobi, coast] = await db.insert(t.teams).values([{ name: "Nairobi Field" }, { name: "Coast" }]).returning();
type NewPerson = { name: string; email: string; role: "AGENT" | "BDO" | "TEAM_LEADER" | "ADMIN"; teamId: string | null; reportsTo?: string };
const addPeople = (list: NewPerson[]) =>
  db.insert(t.users).values(list.map((u) => ({ ...u, reportsTo: u.reportsTo ?? null, passwordHash: pw, mustChangePassword: false }))).returning();

// Built top-down so each person can point at who they report to.
const [admin, joy, sharon] = await addPeople([
  { name: "Daniel Eshikumo", email: "daniel@test.com", role: "ADMIN", teamId: null },
  { name: "Joy Nakhumosi", email: "joy@test.com", role: "TEAM_LEADER", teamId: nairobi.id },
  { name: "Sharon Achola", email: "sharon@test.com", role: "TEAM_LEADER", teamId: coast.id },
]);
const [zacc, lind, henry, alum] = await addPeople([
  { name: "Zaddock Anyona", email: "zaddock@test.com", role: "BDO", teamId: nairobi.id, reportsTo: joy.id },
  { name: "Lindsey Erodanga", email: "lindsey@test.com", role: "BDO", teamId: nairobi.id, reportsTo: joy.id },
  { name: "Henry Okumu", email: "henry@test.com", role: "BDO", teamId: nairobi.id, reportsTo: joy.id },
  { name: "Daniel Alum", email: "alum@test.com", role: "BDO", teamId: coast.id, reportsTo: sharon.id },
]);
const [brian, mercy, ali] = await addPeople([
  { name: "Brian Kiptoo", email: "brian@test.com", role: "AGENT", teamId: nairobi.id, reportsTo: zacc.id },
  { name: "Mercy Wanjiru", email: "mercy@test.com", role: "AGENT", teamId: nairobi.id, reportsTo: lind.id },
  { name: "Ali Hassan", email: "ali@test.com", role: "AGENT", teamId: coast.id, reportsTo: alum.id },
]);

type Seed = {
  kind: "SCHOOL" | "CORPORATE" | "MERCHANT" | "INDIVIDUAL";
  name: string;
  owner: typeof zacc;
  status: "ONGOING_ENGAGEMENT" | "DOCUMENT_COLLECTION" | "ACTIVE";
  phone: string;
  pesi?: string;
  at: [number, number, string, string, string, string];
  stage: "NEW" | "CONTACTED" | "MEETING" | "PROPOSAL" | "NEGOTIATION" | "MOU" | "ONBOARDING" | "ACTIVE";
  product: "SNPL" | "SALARY_ADVANCE" | "QUICK_FINANCE";
  value?: number;
  limit?: number;
  draws?: number[];
};
// [lat, lng, road, area, town, county]
const seeds: Seed[] = [
  { kind: "MERCHANT", name: "Baraka Butchery", owner: zacc, status: "ACTIVE", phone: "0712639174", pesi: "2101", at: [-1.2834, 36.8253, "Moi Avenue", "Central Business District", "Nairobi", "Nairobi County"], stage: "ACTIVE", product: "QUICK_FINANCE", limit: 10000, draws: [4107, 3660, 3936, 5000, 2250, 3800] },
  { kind: "MERCHANT", name: "Upendo Hardware", owner: brian, status: "ACTIVE", phone: "0723616772", pesi: "2102", at: [-1.2921, 36.8219, "Tom Mboya Street", "Central Business District", "Nairobi", "Nairobi County"], stage: "ACTIVE", product: "QUICK_FINANCE", limit: 30000, draws: [14388, 22785, 39245, 3762, 4493, 4292, 42337, 2035, 39277] },
  { kind: "MERCHANT", name: "Mama Njeri Grocers", owner: mercy, status: "DOCUMENT_COLLECTION", phone: "0733123456", pesi: "4410", at: [-1.2647, 36.8031, "Waiyaki Way", "Westlands", "Nairobi", "Nairobi County"], stage: "ONBOARDING", product: "QUICK_FINANCE", limit: 15000 },
  { kind: "MERCHANT", name: "Kibera Tailors Collective", owner: henry, status: "ONGOING_ENGAGEMENT", phone: "0700112233", at: [-1.3133, 36.7876, "Kibera Drive", "Kibera", "Nairobi", "Nairobi County"], stage: "MEETING", product: "QUICK_FINANCE" },
  { kind: "INDIVIDUAL", name: "Grace Wambui", owner: lind, status: "ACTIVE", phone: "0711998877", pesi: "5521", at: [-1.2195, 36.8869, "Thika Road", "Kasarani", "Nairobi", "Nairobi County"], stage: "ACTIVE", product: "QUICK_FINANCE", limit: 5000, draws: [3200, 4100] },
  { kind: "INDIVIDUAL", name: "Peter Otieno", owner: henry, status: "ONGOING_ENGAGEMENT", phone: "0722445566", at: [-1.3001, 36.7695, "Ngong Road", "Karen", "Nairobi", "Nairobi County"], stage: "CONTACTED", product: "QUICK_FINANCE" },
  { kind: "SCHOOL", name: "Nairobi Scholars Academy", owner: zacc, status: "ACTIVE", phone: "0711284593", at: [-1.2864, 36.8172, "Kenyatta Avenue", "Central Business District", "Nairobi", "Nairobi County"], stage: "PROPOSAL", product: "SNPL", value: 4500000 },
  { kind: "SCHOOL", name: "Mombasa International Academy", owner: alum, status: "ACTIVE", phone: "0714926381", at: [-4.0435, 39.6682, "Moi Avenue", "Mombasa Island", "Mombasa", "Mombasa County"], stage: "ONBOARDING", product: "SNPL", value: 6000000 },
  { kind: "CORPORATE", name: "Savannah Logistics Ltd", owner: lind, status: "ONGOING_ENGAGEMENT", phone: "0720555111", at: [-1.3189, 36.8516, "Mombasa Road", "Industrial Area", "Nairobi", "Nairobi County"], stage: "NEGOTIATION", product: "SALARY_ADVANCE", value: 5000000 },
  { kind: "CORPORATE", name: "Coastline Hotels Group", owner: ali, status: "ACTIVE", phone: "0733777888", at: [-4.0547, 39.6636, "Nyali Road", "Nyali", "Mombasa", "Mombasa County"], stage: "ACTIVE", product: "SALARY_ADVANCE", value: 2200000 },
  { kind: "MERCHANT", name: "Joy's Own Boutique", owner: joy, status: "ACTIVE", phone: "0700999000", pesi: "7001", at: [-1.2766, 36.8122, "Kimathi Street", "Central Business District", "Nairobi", "Nairobi County"], stage: "ACTIVE", product: "QUICK_FINANCE", limit: 20000, draws: [8000] },
];

for (const [i, s] of seeds.entries()) {
  const created = ago(80 - i * 5);
  const [acc] = await db
    .insert(t.accounts)
    .values({ kind: s.kind, name: s.name, phone: s.phone, ownerId: s.owner.id, teamId: s.owner.teamId, status: s.status, pesiAccountNo: s.pesi ?? null, createdBy: s.owner.id, createdAt: created })
    .returning();
  if (s.kind === "MERCHANT") await db.insert(t.merchantProfiles).values({ accountId: acc.id, businessType: "Retail" });
  if (s.kind === "INDIVIDUAL") await db.insert(t.individualProfiles).values({ accountId: acc.id, idLast4: String(1000 + i * 37).slice(-4) });
  await db.insert(t.accountStatusHistory).values({ accountId: acc.id, toStatus: "ONGOING_ENGAGEMENT", changedBy: s.owner.id, changedAt: created, note: "Account registered" });
  if (s.status !== "ONGOING_ENGAGEMENT") await db.insert(t.accountStatusHistory).values({ accountId: acc.id, fromStatus: "ONGOING_ENGAGEMENT", toStatus: s.status, changedBy: s.owner.id, changedAt: ago(40 - i) });
  const [lat, lng, road, area, town, county] = s.at;
  await db.insert(t.locationCaptures).values({
    accountId: acc.id, agentId: s.owner.id, latitude: lat, longitude: lng, accuracyM: 12 + i, capturedAt: created,
    road, area, town, county, country: "Kenya", formatted: `${road}, ${area}, ${town}, ${county}, Kenya`, geocodeProvider: "demo", geocodeStatus: "DONE", geocodedAt: created,
  });
  const [opp] = await db
    .insert(t.opportunities)
    .values({ accountId: acc.id, product: s.product, stage: s.stage, ownerId: s.owner.id, estimatedValue: s.value ? String(s.value) : null, nextAction: s.stage === "ACTIVE" ? null : "Follow up on documents", nextActionDate: new Date(Date.now() + (i % 4) * day).toISOString().slice(0, 10), createdAt: created })
    .returning();
  await db.insert(t.opportunityStageHistory).values({ opportunityId: opp.id, toStage: "NEW", changedBy: s.owner.id, changedAt: created });
  if (s.stage !== "NEW") await db.insert(t.opportunityStageHistory).values({ opportunityId: opp.id, fromStage: "NEW", toStage: s.stage, changedBy: s.owner.id, changedAt: ago(30 - i) });
  await db.insert(t.activities).values([
    { accountId: acc.id, opportunityId: opp.id, type: "SITE_VISIT", description: "Introduced Switchlink products", status: "COMPLETED", completedAt: created, completedBy: s.owner.id, createdBy: s.owner.id, createdAt: created },
    { accountId: acc.id, opportunityId: opp.id, type: i % 2 ? "CALL" : "WHATSAPP", description: "Check in on next steps", status: "SCHEDULED", scheduledAt: new Date(Date.now() + ((i % 3) - 1) * day + 2 * 3600000), createdBy: s.owner.id },
  ]);
  if (s.limit) await db.insert(t.qfLimits).values({ accountId: acc.id, amount: String(s.limit), effectiveFrom: ago(90), setBy: admin.id });
  for (const [k, amount] of (s.draws ?? []).entries()) {
    await db.insert(t.disbursements).values({
      accountId: acc.id, product: "QUICK_FINANCE", amount: String(amount), disbursedAt: ago(35 - k * 4), creditedTo: s.owner.id, creditedBdoId: bdoFor(s.owner), creditedTeamId: s.owner.teamId, createdBy: admin.id, source: "MANUAL", notes: "Demo data",
    });
  }
  if (s.kind === "SCHOOL" || s.kind === "CORPORATE") {
    if (s.stage === "ACTIVE" || s.stage === "ONBOARDING") {
      await db.insert(t.disbursements).values({ accountId: acc.id, opportunityId: opp.id, product: s.product, amount: s.kind === "SCHOOL" ? "850000" : "420000", disbursedAt: ago(6), creditedTo: s.owner.id, creditedBdoId: bdoFor(s.owner), creditedTeamId: s.owner.teamId, createdBy: admin.id, source: "MANUAL", notes: "Demo data" });
    }
  }
  await db.insert(t.contacts).values({ accountId: acc.id, name: "Main contact", phone: s.phone, isDecisionMaker: true });
}
await client.end();
console.log(`Demo data loaded. Sign in as daniel@test.com (Admin), joy@test.com (Team Leader), zaddock@test.com (BDO) or brian@test.com (Agent under Zaddock). Password: ${PASSWORD}`);
