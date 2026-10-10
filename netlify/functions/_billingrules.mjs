/* Customer billing rules from Craig's sheet "Accounting info for invoicing",
   matched to JobTread customers and checked with Bruce on 2026-10-10. Loaded
   once into JobTread by Settings, Connections, Load billing rules. After that
   JobTread owns them: change a rule on the customer in JobTread, not here. */
export const BILLING_RULES = [
 {
  "accountId": "22PSLrsQNXw7",
  "customer": "Accent Infills",
  "from": "Accent",
  "Invoice Email": "heather@accentinfills.ca",
  "Billing Notes": "Phone 780-638-4943"
 },
 {
  "accountId": "22PSLrsVWC7N",
  "customer": "Alair Homes",
  "from": "Alair Homes",
  "Invoice Email": "invoiceedm@alairhomes.com",
  "Billing Portal": "Email",
  "Billing Notes": "Include the PM. Sherwood Park branch jobs go to invoices.shr@alairhomes.com"
 },
 {
  "accountId": "22PSLrskXBeM",
  "customer": "Alps Construction",
  "from": "Alps Construction",
  "Invoice Email": "inquiries@alpsconstruction.ca"
 },
 {
  "accountId": "22PSLrt5ymX9",
  "customer": "Atkinson Construction",
  "from": "Atkinson Construction",
  "Invoice Email": "irene@atkinsonconstruction.ca",
  "Billing Notes": "Phone 780-963-4472"
 },
 {
  "accountId": "22PSLrtScfhJ",
  "customer": "Belfor Restoration",
  "from": "Belfor",
  "Invoice Email": "edmonton.ap@ca.belfor.com",
  "Billing Notes": "Also copy tanya.vanschaik@ca.belfor.com"
 },
 {
  "accountId": "22PSLrtWZGmV",
  "customer": "Benjamin Matthew Contracting",
  "from": "Benjamin Matthew Contracting",
  "Invoice Email": "admin@benjaminmatthew.ca"
 },
 {
  "accountId": "22PSLruKfveU",
  "customer": "Caruana Interiors",
  "from": "Caruana",
  "Invoice Email": "info@caruanainteriors.ca",
  "PO Required": true,
  "Billing Notes": "Also jessica@caruanainteriors.ca. Phone 780-935-5831"
 },
 {
  "accountId": "22PSLrujDBxB",
  "customer": "City of Edmonton",
  "from": "City of Edmonton",
  "PO Required": true,
  "Billing Portal": "Ariba",
  "Billing Notes": "Invoice in Ariba and send a copy to the project manager. PO goes to General and Amir with the Ariba link"
 },
 {
  "accountId": "22PSLrumNnMY",
  "customer": "Clark Builders",
  "from": "Clark Builders",
  "Invoice Email": "accountspayable@clarkbuilders.com",
  "PO Required": true,
  "Subcontract Number Required": true,
  "Billing Notes": "PO or subcontract on every invoice. Under a subcontract, send to subcontracts.edm@clarkbuilders.com. Also gisela@clarkbuilders.com"
 },
 {
  "accountId": "22PSLrvDdX45",
  "customer": "Danuk Construction Ltd.",
  "from": "Danuk Construction",
  "Invoice Email": "reception@danuk.ca",
  "Invoice Cut-off": "Month end",
  "PO Required": true,
  "Billing Notes": "Copy the PM. Miss month end and payment slides to 60 days"
 },
 {
  "accountId": "22PSLrvLKXtk",
  "customer": "Delnor Construction",
  "from": "Delnor",
  "Invoice Email": "ap@delnor.ca",
  "Invoice Cut-off": "25",
  "Subcontract Number Required": true,
  "Billing Notes": "Include the PM. Also chantellek@delnor.ca"
 },
 {
  "accountId": "22PSLrvd8rMM",
  "customer": "Environmental Dynamics",
  "from": "EDL Environmental Dynamics",
  "Invoice Email": "AP@edl.ca"
 },
 {
  "accountId": "22PSLrvYLyEV",
  "customer": "Edmonton Public Schools",
  "from": "Edmonton Public School",
  "Invoice Email": "accounts.payable.invoices@epsb.ca",
  "PO Required": true
 },
 {
  "accountId": "22PSLrvbKSHv",
  "customer": "Ellisdon",
  "from": "Ellis Don",
  "Invoice Email": "nsinger@ellisdon.com",
  "Billing Notes": "Phone 780-444-3042 ext 76134"
 },
 {
  "accountId": "22PSLrvZ6Gyd",
  "customer": "E-Jac Contracting Ltd.",
  "from": "Ejac Contracting",
  "Invoice Email": "Admin@e-jac.ca"
 },
 {
  "accountId": "22PSLrvcK25x",
  "customer": "Emcee Construction and Management Ltd.",
  "from": "EMCEE",
  "Invoice Email": "ap@emceeconstruction.com",
  "Invoice Cut-off": "25",
  "Billing Notes": "Phone 780-497-2222 ext 231"
 },
 {
  "accountId": "22PSLrviDvYg",
  "customer": "Flynn Canada",
  "from": "Flynn Canada",
  "Billing Notes": "Goes to the specific PM and their assistant. Flynn Communications is a separate JobTread customer; still to be settled"
 },
 {
  "accountId": "22PSLrvh46mi",
  "customer": "First On Site",
  "from": "First on Site",
  "Invoice Email": "abpayables@firstonsite.ca",
  "PO Required": true,
  "Billing Notes": "Needs the PO and their Job ID"
 },
 {
  "accountId": "22PSLrvwcsZW",
  "customer": "Gateway Mechanical Services",
  "from": "Gateway Mechanical",
  "Invoice Email": "ap@gatewaymechanical.ca"
 },
 {
  "accountId": "22PSLrw3xgNB",
  "customer": "Goldbar Contractors Inc.",
  "from": "Goldbar Contractors",
  "Invoice Email": "invoices@goldbarinc.com",
  "PO Required": true,
  "Billing Notes": "Include the PM"
 },
 {
  "accountId": "22PSLrwAQebT",
  "customer": "Graham Construction & Engineering LP",
  "from": "Graham",
  "Invoice Email": "APInvoices@graham.ca",
  "Invoice Cut-off": "20",
  "Holdback %": 10.0,
  "Billing Notes": "Same rules on all three Graham customers (Bruce, 2026-10-10). Subcontracts: after the first progress invoice, drafts go to Brenda to send with a stat dec. Also Hong.Ly@graham.ca"
 },
 {
  "accountId": "22PSLrwBknE3",
  "customer": "Graham Design Builders LP",
  "from": "Graham",
  "Invoice Email": "APInvoices@graham.ca",
  "Invoice Cut-off": "20",
  "Holdback %": 10.0,
  "Billing Notes": "Same rules on all three Graham customers (Bruce, 2026-10-10). Subcontracts: after the first progress invoice, drafts go to Brenda to send with a stat dec. Also Hong.Ly@graham.ca"
 },
 {
  "accountId": "22PSLrwCfJEf",
  "customer": "Graham Infrastructure LP",
  "from": "Graham",
  "Invoice Email": "APInvoices@graham.ca",
  "Invoice Cut-off": "20",
  "Holdback %": 10.0,
  "Billing Notes": "Same rules on all three Graham customers (Bruce, 2026-10-10). Subcontracts: after the first progress invoice, drafts go to Brenda to send with a stat dec. Also Hong.Ly@graham.ca"
 },
 {
  "accountId": "22PSLrwTGBAY",
  "customer": "Interworks Contracting Ltd.",
  "from": "Interworks",
  "Invoice Email": "mail@interworkscontracting.ca"
 },
 {
  "accountId": "22PSLrwg4fFE",
  "customer": "Jen-Col Construction",
  "from": "Jen Col",
  "Invoice Email": "accounting@jen-col.com",
  "Invoice Cut-off": "5 working days before month end",
  "Holdback %": 10.0,
  "Client Template Required": "Jen-Col template",
  "Billing Notes": "Phone 780-968-4152"
 },
 {
  "accountId": "22PSLrxCiyZm",
  "customer": "Krawford Construction Company Inc.",
  "from": "Krawford Construction",
  "Invoice Email": "accountspayable@krawford.com",
  "Invoice Cut-off": "21",
  "Holdback %": 10.0,
  "Client Template Required": "Krawford template",
  "Billing Notes": "Also edm@krawford.com. Phone 780-436-4381"
 },
 {
  "accountId": "22PSLrxGFBtJ",
  "customer": "KSN Contracting Services",
  "from": "KSN Contracting",
  "Invoice Email": "accounting@ksncs.ca",
  "Invoice Cut-off": "25",
  "PO Required": true,
  "Holdback %": 10.0,
  "Billing Notes": "Also kawecki.kim@ksncs.ca"
 },
 {
  "accountId": "22PSLrcgMk6a",
  "customer": "1114367 AB LTD (Lamba)",
  "from": "Lamba",
  "Invoice Email": "kduke@lambafinancial.com",
  "Billing Notes": "Invoice must be made out to a specific Alberta number; ask Kathy"
 },
 {
  "accountId": "22PSLrxd7Biu",
  "customer": "Livetreo Construction",
  "from": "Live Treo",
  "Invoice Email": "ap@livetreo.ca",
  "Billing Notes": "Blue Quill: ap@bluequillapartments.ca. Westpark: ap@westparkridge.ca. Westwood Terrace: no email on file"
 },
 {
  "accountId": "22PSLryWtTdk",
  "customer": "Pagnotta Industries",
  "from": "Pagnotta",
  "Invoice Email": "subcontractors@pagnotta.ca",
  "Invoice Cut-off": "23"
 },
 {
  "accountId": "22PSLrygrC64",
  "customer": "Pelletier Construction Limited",
  "from": "Pelletier",
  "Invoice Email": "Invoice.yeg@pelletierconstruction.com",
  "Billing Notes": "Both Pelletier customers are the same company (same contact Daniel Pelletier, both created 2026-02-18 in the import, no jobs on either; QuickBooks has both too). Rules go on both; Jen to merge the duplicate. Phone 780-721-4522"
 },
 {
  "accountId": "22PSLryj9hs4",
  "customer": "Pelletier Construction Ltd.",
  "from": "Pelletier",
  "Invoice Email": "Invoice.yeg@pelletierconstruction.com",
  "Billing Notes": "Both Pelletier customers are the same company (same contact Daniel Pelletier, both created 2026-02-18 in the import, no jobs on either; QuickBooks has both too). Rules go on both; Jen to merge the duplicate. Phone 780-721-4522"
 },
 {
  "accountId": "22PSLrykVdhL",
  "customer": "Pemco Construction Ltd.",
  "from": "Pemco Construction",
  "Invoice Email": "liz@pemco.ab.ca",
  "PO Required": true,
  "Billing Notes": "Send to the assistant (Liz or Pauline) and the PM on the project, usually whoever sent the PO. Also jamey@pemco.ab.ca, Pauline@pemco.ab.ca"
 },
 {
  "accountId": "22PSLryq4jnL",
  "customer": "Petrocom Construction Ltd.",
  "from": "Petrocom Construction",
  "Invoice Email": "ap@petrocomconstruction.com",
  "Billing Notes": "Phone 780-481-5181"
 },
 {
  "accountId": "22PSLrybhihH",
  "customer": "PCL Construction",
  "from": "PCL Construction",
  "Billing Portal": "Textura",
  "Billing Notes": "Both JobTread jobs (26-00371, 26-00624) sit on PCL Construction Management Inc., so that is the client; rules copied to PCL Construction too. They open a progress claim draw in Textura and set when it closes. Textura notices go to amabatement@gmail.com, a personal-style address; moving to a company mailbox (agreed 2026-10-10)"
 },
 {
  "accountId": "22PSLrycY6pb",
  "customer": "PCL Construction Management Inc.",
  "from": "PCL Construction",
  "Billing Portal": "Textura",
  "Billing Notes": "Both JobTread jobs (26-00371, 26-00624) sit on PCL Construction Management Inc., so that is the client; rules copied to PCL Construction too. They open a progress claim draw in Textura and set when it closes. Textura notices go to amabatement@gmail.com, a personal-style address; moving to a company mailbox (agreed 2026-10-10)"
 },
 {
  "accountId": "22PSLryzEqAh",
  "customer": "Porscon Construction",
  "from": "Porscon",
  "Invoice Email": "accounts@porscon.com",
  "PO Required": true,
  "Billing Notes": "Reference the PO on the invoice and follow their terms. Also cabrowning@porscon.com"
 },
 {
  "accountId": "22PSLrz7ydkL",
  "customer": "Prologic Construction Ltd.",
  "from": "Prologic Construction",
  "Invoice Email": "ap@prologicconstruction.ca",
  "Invoice Cut-off": "25"
 },
 {
  "accountId": "22PSLrzEGY7r",
  "customer": "Quadrant Construction Ltd.",
  "from": "Quadrant Construction",
  "Invoice Email": "admin@quadrantconstruction.ca",
  "Billing Notes": "Phone 780-434-6411"
 },
 {
  "accountId": "22PSLrxsbjXV",
  "customer": "Midwest Property Management",
  "from": "Rent Mid West - Campus Tower",
  "Invoice Email": "rzukiwski@rentmidwest.com",
  "PO Required": true,
  "Billing Notes": "rentmidwest.com is Midwest Property Management's rental site, so the rules go on that customer; Campus Tower Suite Hotel left as it is. For Campus Tower work send to all four: rzukiwski, rdimaranan, limiller, ddirksen @rentmidwest.com. Needs a PO for the portion of work done"
 },
 {
  "accountId": "22PSLrzkeUnH",
  "customer": "ROWES Construction",
  "from": "Rowes",
  "Invoice Email": "accountspayable@rowes.ca",
  "Billing Notes": "Also admin@rowesrealty.ca. Phone 867-874-3243"
 },
 {
  "accountId": "22PSLs23Jutk",
  "customer": "Seagate Construction Inc.",
  "from": "Seagate",
  "Invoice Email": "accounting@seagatecontract.com",
  "Invoice Cut-off": "25",
  "PO Required": true,
  "Holdback %": 10.0,
  "Billing Notes": "Include the PM. Also reception@seagatecontract.com"
 },
 {
  "accountId": "22PSLs27kQqS",
  "customer": "ServiceMaster Restore",
  "from": "Service Master",
  "Invoice Email": "payables@servicemasterofedm.net"
 },
 {
  "accountId": "22PSLs2BTCzR",
  "customer": "Shignanski Construction",
  "from": "Shignanski",
  "Invoice Email": "muzi@shignanski.com",
  "Billing Notes": "Include the PM. Also send to projectcoordinator@Shignanski.com"
 },
 {
  "accountId": "22PSLs2PJGPz",
  "customer": "Soul Interiors",
  "from": "Soul Interiors",
  "Invoice Email": "projectmanager@soulinteriors.ca"
 },
 {
  "accountId": "22PSLs2SLTTZ",
  "customer": "Soul Mechanical Ltd.",
  "from": "Soul Mechanical",
  "Invoice Email": "office@soulmechanical.ca"
 },
 {
  "accountId": "22PSLs2e3AaB",
  "customer": "Strathcona County",
  "from": "Strathcona County",
  "Invoice Email": "Payables@strathcona.ca"
 }
];
