/* A&M Inventory - the SOP, expressed as something the app can act on.

   Everything in this file is lifted from A&M's own two documents: the SOP
   Manual and the Restoration Division Process Flow. The wording is theirs. The
   phase names, the checklist items, the clocks and the gates are quoted, not
   invented, so that what the app asks for on a phone is the same thing the
   manual asks for on paper.

   Where a number is A&M's own working assumption rather than something the SOP
   states, it is marked `assumed: true` and shown on screen as a setting to be
   confirmed. That distinction matters. A ratio somebody typed once should never
   look like a regulation.

   Two things the SOP does not have, which are in here because they are real:

   1. Containment tear down. The manual takes a job from client walkthrough
      straight to equipment inventory, so the poly, the decon unit, the negative
      air and the signage physically come off site with nothing telling anyone
      to do it. That is where equipment actually gets left behind.

   2. Certificate testing on HEPA units and negative air. Neither document
      mentions it anywhere, and Alberta requires it. */

'use strict';

(function () {
  const SOP = (window.SOP = {});

  /* ------------------------------------------------------------- the phases
     Abatement, the eight phases, exactly as the SOP names them. Phase 2A is a
     side branch rather than a step in the line, and the SOP never resolves
     whether it is part of estimating or a small job of its own. */

  SOP.abatement = [
    { id: 'P1', name: 'Lead intake and qualification', who: 'Estimating Admin', inventory: false },
    { id: 'P2', name: 'Estimation and quoting', who: 'Estimator', inventory: 'priced' },
    { id: 'P2A', name: 'Asbestos bulk material sampling', who: 'Certified inspector', inventory: 'kit', branch: true },
    { id: 'P3', name: 'Job award and turnover', who: 'Estimating Admin, PM', inventory: false },
    { id: 'P4', name: 'Mobilization and site setup', who: 'PM, Logistics and Shop, Site Supervisor', inventory: 'out' },
    { id: 'P5', name: 'Field execution', who: 'Site Supervisor, Crew Chief', inventory: 'daily' },
    { id: 'P6', name: 'Quality control and final inspection', who: 'Site Supervisor, PM', inventory: false },
    { id: 'P7', name: 'Demobilization and close-out', who: 'Site Supervisor, Shop, Estimating Admin', inventory: 'back' },
    { id: 'P8', name: 'Billing and job post-mortem', who: 'Administrator, PM', inventory: 'cost' }
  ];

  SOP.restoration = [
    { id: 'R1', name: 'Emergency response and intake', who: 'Administrator or On-Call Manager', inventory: false },
    { id: 'R2', name: 'On-site assessment and emergency mitigation', who: 'Site Supervisor', inventory: 'out' },
    { id: 'R3', name: 'Estimation, scope development and authorization', who: 'PM', inventory: 'priced' },
    { id: 'R4', name: 'Drying and monitoring', who: 'Site Supervisor daily, PM oversight', inventory: 'daily' },
    { id: 'R5', name: 'Demolition and preparation', who: 'Site Supervisor or subcontractor', inventory: 'daily' },
    { id: 'R6', name: 'Reconstruction and finishing', who: 'Trades or subcontractors', inventory: false },
    { id: 'R7', name: 'Final inspection and client acceptance', who: 'PM', inventory: false },
    { id: 'R8', name: 'Final invoice and project closeout', who: 'Administrator, PM', inventory: 'back' },
    { id: 'R9', name: 'Post-mortem and continuous improvement', who: 'PM, Ops', inventory: 'cost' }
  ];

  SOP.phasesFor = division => division === 'restoration' ? SOP.restoration : SOP.abatement;
  SOP.phase = (division, id) => SOP.phasesFor(division).find(p => p.id === id) || null;

  /* --------------------------------------------------- pre-mobilization gate
     SOP Phase 4. Six items, quoted. Nothing is supposed to leave the shop until
     these are true, and the app will say so rather than block, because a crew
     standing in the shop at six in the morning is not the right place to fight
     about paperwork. It records who overrode it. */

  SOP.preMob = [
    { id: 'permits', text: 'Permits obtained and posted', appliesTo: 'all' },
    { id: 'nop', text: 'Notice of Project filed 72 hours prior', appliesTo: 'type3',
      note: 'The SOP requires this for Type 3 work only. It names no filing body and no owner.' },
    { id: 'equip', text: 'Equipment reserved: negative air machines, dehumidifiers, air movers', appliesTo: 'all' },
    { id: 'materials', text: 'Materials pulled from shop using the Mobilization List', appliesTo: 'all' },
    { id: 'crew', text: 'Crew assigned with appropriate certifications', appliesTo: 'all' },
    { id: 'briefed', text: 'Site Supervisor briefed on scope, hazards and client requirements', appliesTo: 'all' }
  ];

  /* Two gates the SOP states as conditions on the job rather than the shop, but
     which stop gear being useful if they are not true. Shown, not enforced. */
  SOP.beforeWork = [
    { id: 'contract', text: 'Contract signed. The SOP will not allow mobilization before this.' },
    { id: 'tom', text: 'Turnover meeting held, within 48 hours of the contract and never by email' }
  ];

  /* -------------------------------------------------------- containment tear
     The step the SOP does not have. This is the physical exit from site, and it
     is where the machines are standing when everyone starts packing up. */

  /* Cut back to the one line that earns its place, at A&M's request, pending a
     revised list. The others were the SOP's tear down steps, and a checklist
     that asks a crew to tick seven things they have already done gets ticked in
     one swipe without being read, which is worse than not asking. The sweep is
     the one that actually changes an outcome, because it is the step that finds
     the machine nobody remembers stashing.

     The old ids are left alone rather than renumbered: jobs already carry ticks
     against them, and those ticks are a record of what somebody confirmed on a
     real site. Adding lines back here brings that history back with them. */
  SOP.strike = [
    { id: 'sweep', text: 'Final sweep for anything left behind, closets and mechanical rooms included',
      note: 'This is the one that finds the gear. The install crew stashes it and the tear down crew never looks.' }
  ];

  /* ------------------------------------------------------------ what to take
     The SOP prices equipment at estimate and pulls it at mobilization, but it
     never says how many of anything. Restoration is the exception: it gives two
     real ratios, and those are quoted below. Everything else is A&M's own
     working default and is marked as such. */

  SOP.ratios = {
    airMoverPerSqFt:   { value: 125,  assumed: false, from: 'Restoration Phase 2: air movers, 1 per 100 to 150 sq ft' },
    dehuPerSqFt:       { value: 750,  assumed: false, from: 'Restoration Phase 2: dehumidifiers, 1 per 500 to 1000 sq ft' },
    negAirPerSqFt:     { value: 1000, assumed: true,  from: 'Not in the SOP. A&M default, set it against how the shop actually loads a containment.' },
    hepaVacPerCrew:    { value: 2,    assumed: true,  from: 'Not in the SOP. One HEPA vacuum per two on the crew.' },
    polySqFtPerRoll:   { value: 400,  assumed: true,  from: 'Not in the SOP. Coverage of one roll of 6mm poly, set it from the roll A&M buys.' },
    cordPerMachine:    { value: 1,    assumed: false, from: 'Craig, 20 Aug: one 50 foot cord per piece of equipment is the rule of thumb.' }
  };

  /* Containment classification drives everything physical. Quoted from Phase 2. */
  SOP.containment = {
    '1': { name: 'Type 1, low risk', build: 'Barrier tape and signage minimum', negAir: false, decon: false },
    '2': { name: 'Type 2, medium risk', build: 'Physical barriers, 6mm poly sheeting sealed at all penetrations', negAir: false, decon: false },
    '3': { name: 'Type 3, high risk', build: 'Full critical barrier, double walls, waste pass-through, three-chamber decontamination unit, negative air maintained', negAir: true, decon: true }
  };

  /* Works out what a job of this shape needs, in the shop's own groups. Returns
     suggestions to be argued with, never an order. */
  SOP.suggest = function (job, catalog) {
    const area = parseFloat(job.areaSqFt) || 0;
    const crew = parseInt(job.crewSize, 10) || 0;
    const r = SOP.ratios;
    const out = [];
    const add = (group, count, why, assumed) => {
      if (count > 0) out.push({ group, count: Math.ceil(count), why, assumed: !!assumed });
    };

    if (job.division === 'restoration') {
      add('Air Movers', area / r.airMoverPerSqFt.value, r.airMoverPerSqFt.from, false);
      add('Dehumidifiers', area / r.dehuPerSqFt.value, r.dehuPerSqFt.from, false);
      add('Extractors', area ? 1 : 0, 'Restoration Phase 2: all standing water extracted immediately', false);
      if (String(job.waterCategory) === '2' || String(job.waterCategory) === '3') {
        add('Air Scrubbers & Hydroxyl', 1, 'Restoration Phase 2: air scrubbers if Category 2 or 3 water, or smoke or odour', false);
      }
    } else {
      const c = SOP.containment[String(job.containment)] || null;
      if (c && c.negAir) {
        add('Negative Air', area / r.negAirPerSqFt.value || 1, r.negAirPerSqFt.from, true);
      }
      add('Vacuums', crew / r.hepaVacPerCrew.value, r.hepaVacPerCrew.from, true);
      if (c && c.decon) add('Showers, Heat & Water', 1, 'Type 3 needs a three-chamber decontamination unit', false);
      if (c && String(job.containment) !== '1') {
        add('Containment', Math.max(1, area / r.polySqFtPerRoll.value), r.polySqFtPerRoll.from, true);
      }
    }

    const machines = out.reduce((a, x) => a + x.count, 0);
    add('Power & Air', machines * r.cordPerMachine.value, r.cordPerMachine.from, false);
    return out;
  };

  /* Certificates owed by this job. Every unit needing a test costs one test on
     landing, and a job past thirty days owes a second round. Both facts come
     from Craig, and the second is supposed to be priced at bid time. */
  SOP.dopOwed = function (job, unitsOnJob, settings) {
    const per = (settings && settings.dopCostPerUnit) || 50;
    const after = (settings && settings.secondDopAfterDays) || 30;
    const needing = unitsOnJob.filter(u => u.dop);
    const days = job.createdAt ? Math.max(0, Math.round((Date.now() - new Date(job.createdAt)) / 86400000)) : 0;
    const rounds = days > after ? 2 : 1;
    return {
      units: needing.length,
      rounds,
      cost: needing.length * per * rounds,
      days,
      note: rounds === 2
        ? `Past ${after} days, so a second round is owed on every unit. The SOP does not mention this at all; it should be priced at bid.`
        : `One test per unit on this deployment. A transfer to another site starts a fresh obligation.`
    };
  };

  /* --------------------------------------------------------------- the clocks
     Every one of these is written into the SOP. They are not reminders the app
     invented; they are the manual's own deadlines, which is why they can be
     enforced without anybody having to agree to a new rule. */

  SOP.clocks = [
    { id: 'requisition', text: 'Material requisitions for the next day, in by 2:00 PM', at: '14:00', who: 'Site Supervisor', phase: 'P5' },
    { id: 'belowmin', text: 'Below minimum list, walked and confirmed', at: '15:00', who: 'Shop', phase: null },
    { id: 'signin', text: 'Daily sign-in sheet to the office before leaving site', at: null, who: 'Site Supervisor', phase: 'P5',
      note: 'No sign-in sheet means no one gets paid. The SOP calls this non-negotiable.' },
    { id: 'photos', text: 'Progress photos uploaded', at: null, who: 'Site Supervisor', phase: 'P5' },
    { id: 'eod', text: 'End of day report to the PM before leaving site', at: null, who: 'Site Supervisor', phase: 'P5' },
    { id: 'qc', text: 'PM quality control walk, within 24 hours of being told the job looks complete', at: null, who: 'PM', phase: 'P6' },
    { id: 'return', text: 'Equipment back by its expected return date', at: null, who: 'Shop', phase: 'P7' }
  ];

  /* The six things the SOP says a Site Supervisor tells the PM immediately. Two
     of them are things this app finds out first. */
  SOP.escalate = [
    'Any injury',
    'Unexpected asbestos or hazardous material',
    'Scope change or additional work',
    'Equipment failure affecting schedule',
    'Client complaint',
    'Containment breach'
  ];

  /* What the close-out package must contain, from Phase 7. The app owns three
     of these outright and can hand them over finished. */
  SOP.closeout = [
    { text: 'Signed contract and purchase order', owner: 'Admin' },
    { text: 'All daily sign-in sheets and FLHA forms', owner: 'Site' },
    { text: 'Before and after photos', owner: 'Site' },
    { text: 'Air clearance certificate', owner: 'PM' },
    { text: 'Waste disposal manifests', owner: 'Inventory', ours: true },
    { text: 'Client sign-off documentation', owner: 'PM' },
    { text: 'Final cost summary: labour, materials, equipment and disposal', owner: 'Inventory', ours: true, partial: 'labour comes from elsewhere' }
  ];

})();
