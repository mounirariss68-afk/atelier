process.env.NODE_ENV = "test";
const { db, atelierUsers, atelierEmployees } = await import("@workspace/db");
const { eq } = await import("drizzle-orm");
const app = (await import("./src/app")).default;

const founders = await db.select({ id: atelierUsers.id, role: atelierUsers.role, email: atelierUsers.email }).from(atelierUsers).where(eq(atelierUsers.role, "founding_partner"));
console.log("founders:", founders.map(f => f.id));
const founderEmail = founders[0].email;
const [fPerson] = await db.select({ id: atelierEmployees.id }).from(atelierEmployees).where(eq(atelierEmployees.email, founderEmail));
console.log("founder person:", fPerson?.id);

const srv = app.listen(0);
const port = (srv.address() as any).port;
const cookie = `atelier_persona=${founders[0].id}`;

if (fPerson) {
  const r = await fetch(`http://localhost:${port}/api/atelier/roster/people/${fPerson.id}/access`, { headers: { cookie } });
  const j = await r.json();
  console.log("founder access:", r.status, "firmWide:", j.firmWide, "role:", j.role, "grants:", j.grants?.length);
}
// pick any non-founder person with a linked user, if exists
const people = await db.select({ id: atelierEmployees.id, email: atelierEmployees.email }).from(atelierEmployees);
for (const p of people) {
  if (p.email === founderEmail) continue;
  const r = await fetch(`http://localhost:${port}/api/atelier/roster/people/${p.id}/access`, { headers: { cookie } });
  const j = await r.json();
  console.log("other person", p.id, r.status, "firmWide:", j.firmWide, "role:", j.role, "grants:", j.grants?.length ?? j.hint);
  break;
}
srv.close();
process.exit(0);
