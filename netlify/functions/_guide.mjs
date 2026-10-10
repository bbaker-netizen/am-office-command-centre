/* A&M - what Claude knows about the command centre itself (2026-10-10).
   Kept here, in one place, so Claude's answers about how the app works stay in
   step with the app. Change this file whenever a page is added or changed. */

export const APP_GUIDE = `
THE COMMAND CENTRE, PAGE BY PAGE

It reads live from JobTread (jobs, quotes, timesheets, daily logs, schedule tasks, customers), QuickBooks Online (money, owed, payroll posting) and the shop's own inventory screens, every few minutes or when someone presses Refresh. Nothing is copied into a second list. Each person sees only the sections an admin gave them on People and access. Sections across the top (Overview, Office, Field, Assistants, Admin), pages underneath. The red or amber number on a section or page is how many things there need a decision. Long lists open closed with a count; press the title to open. Any job can be opened from any list: the job panel shows every JobTread field, quotes, the client's billing rules, the next SOP step and who owns it, and the job's Drive folder for people who connected Drive.

Overview: the one-screen summary. The worst item at the top, number tiles (cash in the bank, owed to A&M, A&M owes, quotes out, won not finished, done not billed, sales since 1 April; tiles can be dragged into any order), the seven pipeline steps (new leads to closing out; press one for its jobs), and Needs a decision, worst first, which clears itself when the cause is fixed in the source system.

OFFICE
Estimating: bids due in two weeks, quotes waiting on an answer, site visits coming up, where open quotes sit, win rate, leads not picked up, and the Lead clock (SOP Phase 1: a lead assigned within 4 business hours, an urgent site visit within 48 hours, planned within 5 business days; business hours 7 a.m. to 5 p.m. weekdays).
Dispatch: the Crew board (jobs on site and starting in two weeks; drag a person onto a job or tap a person then Add here; pick the crew lead and shop and site start times; a red name is double-booked; Work order prints a one-page A&M work order). The crew lives on the job's Site Work task in JobTread's schedule: the crew are the task's assigned people, so they see it in their own JobTread app, and the lead and start times are lines in the task's description. Also Emergencies and drying (time from opening to first on the clock, days running, last daily log, machines out), crew load for four weeks, jobs starting in two weeks, past the start date, and won with no date.
T&M and extras: T&M jobs (number ending -TM, or T&M in the name or notes) with hours this week and over three weeks, and a T&M sheet for this or last week built from JobTread timesheets for the client to sign; change orders (quotes in JobTread named Change order, CO 1, extra or additional work) and how long they have waited; jobs on site with hours and no approved quote.
Money (people who see Money): cash, owed to A&M and A&M owes by age, from QuickBooks, a cash forecast, work finished and not invoiced, and Invoicing deadlines.
Payroll (Money): each person's hours for the two-week pay period from JobTread timesheets, split into the buckets the bookkeeper posts to: service line (from the cost code: 51 Demolition, 53 Asbestos, 54 Lead, 55 Mould, 56 Sampling, 59 Restoration) by city (the job's Estimating branch, Edmonton or Calgary). Shop and office time stays in general payroll; ACES temps are shown separately and are not A&M payroll; open clock-ins wait until clocked out. Download the summary or detail, or type each person's payroll cost from the QuickBooks pay run and press Post to put the journal entry into QuickBooks (one per period, numbered PAYSPLIT-YYMMDD). Payroll settings hold the QuickBooks account for each bucket. Hours are still entered in QuickBooks payroll as before.
Buying (Money): purchase orders and supplier paperwork from JobTread, bills and spend from QuickBooks.
Clients: every JobTread client with jobs won and lost, quotes approved and waiting, win rate, what they owe in QuickBooks, and whether billing rules are on file; Gone quiet lists repeat clients with no new job in 90 days.
Records: data clean-up, such as jobs with statuses the app does not recognize or missing fields.

FIELD
Projects: every won job by project manager. Sites: what is on site, asbestos work with no notice of project, notices running out, starting this week, and Daily logs (every job with someone on the clock today or the last working day and whether a daily log was written in JobTread; SOP Phase 5 daily communication). Closeout: work done or nearly done, Invoicing deadlines, approved quotes in closeout, oldest first. Post mortem: the job post mortem form, posted to the job in JobTread as a pinned note when finished. Equipment: machines, shelf stock and gear on jobs from the shop screens. Shop: opens the shop's own screens (PIN sign-in); a Command centre button there comes back.

INVOICING DEADLINES (Closeout and Money)
Each client's billing rules live on the customer in JobTread, in eight fields: Invoice Email, Invoice Cut-off (a day of the month, Month end, or a rule like 5 working days before month end), PO Required, Subcontract Number Required, Holdback %, Billing Portal (Email, Ariba, Textura), Client Template Required, Billing Notes. Loaded from Craig's sheet Accounting info for invoicing on 2026-10-10 for 43 clients. To change a rule, change it on the customer in JobTread. The card lists finished work not yet invoiced, soonest cut-off first, and flags a missing PO, subcontract number, holdback, portal or client template.

ASSISTANTS
To send: emails the scheduled AI assistants wrote overnight (quote follow-ups, payment reminders, contract chasers, missing paperwork). Nothing is sent until a person presses Send; Discard throws it away; replies go to estimating@amabatement.com.

ADMIN (admins only)
People and access: everyone's account (work email, job title, the areas they see: Office, Money, Field, Assistants; and whether they can look, make changes, or manage people), Can ask Claude, temporary passwords, switching people off, and how long before an idle screen asks for the password again. HR system: not connected yet; it will feed tickets and training. Connections (Settings): JobTread key, QuickBooks, the robots' mailbox, Ask Claude, and the JobTread set-up check. Scorecards: the position-profile KPIs the systems can measure, for the monthly reviews: estimating, each project manager, field people over 14 days, office and billing, the shop. Safety, client satisfaction and team development are not measured here.

ALSO
Find (top bar): any job by number, name, client or address. Tour: the walkthrough again. My account: what you can see and do, your password, and Connect Google Drive. Ask Claude: this panel.

HOW A&M KEEPS THINGS
One system owns each fact. QuickBooks Online: money and the supplier list. JobTread: jobs, estimates, job costing, cost codes, customers, timesheets, daily logs, schedule. Google Drive: documents, in four shared drives (Operations, Finance, People and HR, Corporate); names are Client - Document type - YYYY-MM-DD, no version numbers; job folders are Job YY-NNNNN Client - Site, made by the Job Folder Creator. Encircle: site photos. Safety and training records will live in the HR system once it is chosen; A&M does not use SiteDocs. The inventory app: equipment and shelf stock. Never suggest keeping a second copy.

THE SOP AND THE ORG CHART
A&M's SOP Manual (version 3.0, September 2026) runs eight phases: 1 lead intake, 2 estimating and quoting (2A asbestos bulk sampling), 3 job award and turnover, 4 mobilization and site setup, 5 field execution, 6 quality control and final inspection, 7 demobilization and close-out, 8 billing and post mortem. Where the SOP says Canopy, A&M now uses JobTread and this command centre; where it scores the post mortem 1 to 5 per person, A&M now uses the post mortem page. A refreshed SOP and org chart are being prepared for Craig to approve. Each role has a position profile ("Your Role at A&M") with its steps, daily and weekly rhythm and KPIs.
`;

