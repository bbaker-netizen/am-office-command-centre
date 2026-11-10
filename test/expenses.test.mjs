/* The Expenses page rules, on claims and bills copied from JobTread on
   2026-11-10 (trimmed to the fields that matter).
   Run: node test/expenses.test.mjs */
import { strict as assert } from "node:assert";
import { buildExpenses, parseCards, findLast4, cardOfBill, isClaimBooking, branchOfJob } from "../netlify/functions/_expenses.mjs";

let n = 0; const ok = m => { n++; console.log("ok", m); };
const J = (number, branch, name = "Job " + number) => ({ id: "j" + number, number, name, closedOn: null, branch });
const photo = [{ url: "https://x", storageId: "p" }];
const kmSub = (id, person, job, v, created = "2026-10-30T10:00:00Z") => ({ id, createdAt: created, user: { name: person }, job, values: v });
const kind = (r, k) => r.exceptions.filter(e => e.kind === k);

const cards = parseCards(["0740 Mark", "1375 Amir", "9726 Craig", "Other (last 4 in Notes)"]);
assert.deepEqual(cards.map(c => c.last4), ["0740", "1375", "9726"]);
ok("the card list is read from the shop form dropdown, and \"Other\" is not a card");

assert.deepEqual(findLast4("Card 9726"), ["9726"]);
assert.deepEqual(findLast4("paid on visa ending in 1375"), ["1375"]);
assert.deepEqual(findLast4("9726"), ["9726"]);
assert.deepEqual(findLast4("Todd McMullen 7712 Saskatchewan Drive"), []);
ok("a card number is found when written on purpose; a street number is not a card");

assert.equal(cardOfBill({ description: "Card 0740", payments: [{ description: "9726" }] }).from, "payment reference");
assert.ok(isClaimBooking({ description: "", payments: [{ description: "Pay to Jen Garrison Personal" }] }));
ok("the payment Ref # wins over the description, and a bill paid to someone personally is a claim, not a card");

assert.equal(branchOfJob(J("26-00000", "Edmonton")), "No branch");
assert.equal(branchOfJob(J("26-00672", "")), "No branch");
ok("overhead jobs and jobs with no Estimating branch land in \"No branch\"");

const km = [
  /* Tyler, 26 Oct: the same trip approved twice on Davis. */
  kmSub("a", "Tyler Olson", J("26-20036", ""), { "Date of trips": "2026-10-26", "Trip details": "-11540 140st to 9752 80 ave 11km", "Start odometer reading": 298700, "End odometer reading": 298711, "Regular km (no trailer)": 11, "Trailer km": 0, "Amount owed": 7.7, "Approved regular km": 11, "Approved trailer km": 0, "Status": ["Approved"] }),
  kmSub("b", "Tyler Olson", J("26-20036", ""), { "Date of trips": "2026-10-26", "Trip details": "-11540 140st to 9752 80 ave 11km", "Start odometer reading": 298800, "End odometer reading": 298811, "Regular km (no trailer)": 11, "Trailer km": 0, "Amount owed": 7.7, "Approved regular km": 11, "Approved trailer km": 0, "Status": ["Approved"] }),
  /* Tyler, 26 and 27 Oct: odometer back to 299,900 the next day. */
  kmSub("c", "Tyler Olson", J("26-00672", ""), { "Date of trips": "2026-10-26", "Trip details": "-9752 80ave to 3739 Erlanger 22km", "Start odometer reading": 299900, "End odometer reading": 299940, "Regular km (no trailer)": 40, "Trailer km": 0, "Amount owed": 28, "Approved regular km": 40, "Approved trailer km": 0, "Status": ["Approved"] }),
  kmSub("d", "Tyler Olson", J("26-20078-OLD", ""), { "Date of trips": "2026-10-27", "Trip details": "11540 140st to 14007 Beuna Vista 7km", "Start odometer reading": 299900, "End odometer reading": 299915, "Regular km (no trailer)": 15, "Trailer km": 0, "Amount owed": 10.5, "Approved regular km": 15, "Approved trailer km": 0, "Status": ["Approved"] }),
  /* Tyler, sent back with no photos: already dealt with, not an exception. */
  kmSub("e", "Tyler Olson", J("26-20009", "Edmonton"), { "Date of trips": "2026-11-02", "Trip details": "-shop to site 22km", "Start odometer reading": 302500, "End odometer reading": 302544, "Regular km (no trailer)": 44, "Trailer km": 0, "Status": ["Sent back"] }),
  /* Tyler, dated 13 Nov, sent in 8 Nov, no photos. */
  kmSub("f", "Tyler Olson", J("26-20086", "Edmonton"), { "Date of trips": "2026-11-13", "Trip details": "-shop to site 7km", "Start odometer reading": 303500, "End odometer reading": 303514, "Regular km (no trailer)": 14, "Trailer km": 0 }, "2026-11-08T03:20:38Z"),
  /* Tyler, 9 Nov: odometer shows 115 km, 22 claimed. */
  kmSub("g", "Tyler Olson", J("26-20210", "Edmonton"), { "Date of trips": "2026-11-09", "Trip details": "-shop to site 22km", "Start odometer reading": 303145, "End odometer reading": 303260, "Start odometer photo": photo, "End odometer photo": photo, "Regular km (no trailer)": 22, "Trailer km": 0 }, "2026-11-10T05:59:26Z"),
  /* Richard: trip meter readings, approved with the approved km left blank. */
  kmSub("h", "Richard Woniala", J("26-20100", "Edmonton"), { "Date of trips": "2026-10-30", "Trip details": "16 Guilford to shop and back", "Start odometer reading": 904, "End odometer reading": 973, "Start odometer photo": photo, "End odometer photo": photo, "Regular km (no trailer)": 69, "Trailer km": 0, "Added to job budget in JobTread": true, "Status": ["Approved"] }),
  kmSub("i", "Richard Woniala", J("26-20100", "Edmonton"), { "Date of trips": "2026-11-02", "Trip details": "From shop to 16 Guilford", "Start odometer reading": 56, "End odometer reading": 87, "Start odometer photo": photo, "End odometer photo": photo, "Regular km (no trailer)": 31, "Trailer km": 0, "Added to job budget in JobTread": true, "Status": ["Approved"] }),
  /* A typed amount that does not match. */
  kmSub("j", "Tyler Olson", J("26-20084", "Edmonton"), { "Date of trips": "2026-10-14", "Trip details": "-shop to 10153 122st 8km", "Start odometer reading": 298100, "End odometer reading": 298110, "Regular km (no trailer)": 8, "Trailer km": 2, "Amount owed": 5.6, "Approved regular km": 8, "Approved trailer km": 2, "Status": ["Approved"], "Added to job budget in JobTread": true })
];
const reimb = [
  /* Maxim, 2 Nov: a reimbursement whose notes say it went on Craig's card. */
  { id: "r1", createdAt: "2026-11-02T16:39:51Z", user: { name: "Maxim" }, job: J("26-20097", "Edmonton"), values: { "Date of purchase": "2026-11-02", "Store or vendor": "UFA", "Total": 70.41, "Notes": "Payment made on company main cc 9726", "Receipt photo": photo, "Status": ["Submitted"] } }
];
const shop = [
  { id: "s1", createdAt: "2026-10-28T20:09:52Z", user: { name: "Maxim" }, job: null, values: { "Branch": ["Edmonton"], "Date of purchase": "2026-10-28", "Store or vendor": "Trail tire", "What is it for": "Ford f350", "Total": 1279.9, "Paid with": ["Company card"], "Company card used": ["9726 Craig"], "Status": ["Paid"] } },
  { id: "s2", createdAt: "2026-10-29T10:00:00Z", user: { name: "Maxim" }, job: null, values: { "Branch": ["Calgary"], "Date of purchase": "2026-10-29", "Total": 50, "Paid with": ["Company card"], "Status": ["Submitted"] } }
];
const bills = [
  { id: "b1", name: "Expense 26-00657-2", status: "approved", date: "2026-10-05", cost: 804.92, description: "Todd McMullen 7712 Saskatchewan Drive", vendor: "Integrity Waste", job: J("26-00657", "Edmonton"), codes: ["51400"], payments: [] },
  { id: "b2", name: "Expense 26-00109-11", status: "draft", date: "2026-10-05", cost: 179.2, description: "", vendor: "TEST Jen", test: true, job: J("26-00109", "Edmonton"), codes: ["51200"], payments: [] },
  { id: "b3", name: "Expense 26-00000-1", status: "draft", date: "2026-10-06", cost: 98.84, description: "Card 9726", vendor: "Esso", job: J("26-00000", ""), codes: ["51100"], payments: [] },
  { id: "b4", name: "Expense 26-20108-2", status: "draft", date: "2026-10-26", cost: 39.88, description: "Card 9726", vendor: "Home Depot", job: J("26-20108", "Edmonton"), codes: ["0000"], payments: [] },
  { id: "b5", name: "Expense 26-00109-2", status: "approved", date: "2026-10-02", cost: 939.73, description: "", vendor: "U Haul", job: J("26-00109", "Edmonton"), codes: ["51200"], payments: [{ description: "Pay to Jen Garrison Personal" }] },
  { id: "b6", name: "Expense 26-20033-2", status: "draft", date: "2026-10-22", cost: 257.23, description: "Visa 4242", vendor: "Home Depot", job: J("26-20033", ""), codes: ["53200"], payments: [] }
];
const r = buildExpenses({ cards, km, reimb, shop, bills, noBranchJobs: [J("26-00672", ""), J("26-00000", ""), J("99-00001", "")] }, { today: "2026-11-10" });

assert.equal(kind(r, "duplicate_trip").length, 1);
assert.equal(kind(r, "duplicate_trip")[0].id, "b");
ok("Tyler's 26 October trip approved twice on Davis is caught");

const seq = kind(r, "odometer_sequence");
assert.equal(seq.length, 1); assert.equal(seq[0].id, "d");
ok("the odometer going back to 299,900 the next day is caught, and Richard's trip meter is not");

assert.equal(kind(r, "future_date")[0].id, "f");
assert.deepEqual(kind(r, "no_photos").map(e => e.id), ["f"]);
ok("a claim dated in the future and a November claim without photos are caught; the one already sent back is not");

assert.equal(kind(r, "odometer_gap")[0].id, "g");
ok("115 km on the odometer against 22 km claimed is caught");

assert.deepEqual(kind(r, "no_approved_km").map(e => e.id).sort(), ["h", "i"]);
ok("Richard's claims approved with the approved km blank are flagged, and paid on the km claimed");

const mm = kind(r, "amount_mismatch");
assert.equal(mm.length, 1); assert.equal(mm[0].id, "j");
assert.match(mm[0].detail, /\$7\.40/);
ok("a typed amount that leaves out the trailer km is caught ($5.60 typed, $7.40 owed)");

assert.equal(kind(r, "reimb_on_card")[0].id, "r1");
ok("Maxim's reimbursement that says it went on card 9726 is caught before it is paid twice");

assert.ok(kind(r, "closed_job").some(e => e.id === "d"));
ok("a claim on a -OLD job is flagged");

assert.ok(kind(r, "no_card").some(e => e.id === "b1"));
assert.ok(!kind(r, "no_card").some(e => e.id === "b5"));
assert.equal(kind(r, "test_bill")[0].id, "b2");
assert.equal(kind(r, "overhead_bill")[0].id, "b3");
assert.equal(kind(r, "uncategorized")[0].id, "b4");
assert.equal(kind(r, "unknown_card")[0].id, "b6");
assert.equal(kind(r, "shop_no_card")[0].id, "s2");
ok("bills: street address is not a card, personal payback is not a card bill, test, overhead, 0000, unknown card, shop with no card");

assert.deepEqual(kind(r, "no_branch").map(e => e.job), ["26-00672"]);
ok("open jobs with no branch are listed, leaving out the overhead and test jobs");

const ty = r.payout.find(p => p.person === "Tyler Olson");
assert.equal(ty.total, 61.3);
assert.equal(ty.byBranch["No branch"], 53.9);
assert.equal(ty.byBranch["Edmonton"], 7.4);
const ri = r.payout.find(p => p.person === "Richard Woniala");
assert.equal(ri.total, 70);
assert.ok(!r.payout.some(p => p.person === "Maxim"));
ok("payout: approved and not paid only, km worked out here, split by branch; submitted claims wait");

const oct = r.months.find(m => m.month === "2026-10");
assert.equal(oct.card["Edmonton"], Math.round((804.92 + 39.88) * 100) / 100);
assert.equal(oct.card["No branch"], 257.23);
assert.equal(oct.shop["Edmonton"], 1279.9);
ok("branch totals by month of the trip or purchase, with a No branch column");

const craig = r.cardSpend.find(c => c.last4 === "9726");
assert.equal(craig.holder, "Craig");
assert.equal(craig.total, Math.round((98.84 + 39.88 + 1279.9) * 100) / 100);
assert.ok(r.cardSpend.some(c => c.last4 === "4242" && /not on the card list/i.test(c.holder)));
ok("card spend by holder, including shop purchases; an unknown card is named as such");

console.log(`\n${n} expenses checks passed`);
