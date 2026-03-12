import { assert, describe, test } from 'vitest';
import { doInternModule } from '../util.js';
import { Instance, isInstanceOfType } from '../../src/runtime/module.js';
import { parseAndEvaluateStatement } from '../../src/runtime/interpreter.js';

const m = 'slCore';

describe('sales-lead-data-model', () => {
  test('setup entities, relationships, and workflows', async () => {
    await doInternModule(
      m,
      `entity Lead {
          id Int @id,
          source @enum("website", "linkedin", "trade_show", "customer_referral"),
          sourceId String,
          leadContact String,
          leadContactTitle String,
          companyName String,
          companySize Int,
          industry String,
          score Int @default(0),
          status @enum("new", "qualified", "disqualified", "assigned") @default("new")
       }

       entity SalesRep {
          email String @id,
          firstName String,
          lastName String,
          repType @enum("enterprise", "mid_market", "smb"),
          activeLeadCount Int @default(0)
       }

       entity Deal {
          id Int @id,
          leadId Int @ref(${m}/Lead.id),
          assignedTo String @ref(${m}/SalesRep.email),
          stage @enum("prospecting", "qualification", "proposal", "negotiation", "closed_won", "closed_lost") @default("prospecting"),
          value Decimal,
          probability Int @default(10)
       }

       entity Activity {
          id Int @id,
          dealId Int @ref(${m}/Deal.id),
          activityBy String @ref(${m}/SalesRep.email),
          activityType @enum("call", "email", "meeting", "notes"),
          comments String
       }

       // --- Dedup: reject if a Lead with same email already exists ---
       workflow Dedup {
          let existing = Lead.find({"leadContact": Dedup.email});
          if (existing != 0) {"duplicate"} else {"new"}
       }

       // --- Score a lead based on source, company size, industry, and contact title ---
       workflow ScoreLead {
          let lead = Lead.find({"id": ScoreLead.leadId});

          // Source scoring: referrals and trade-shows score highest
          let sourceScore = if (lead.source == "customer_referral") {30}
                            else {if (lead.source == "trade_show") {25}
                            else {if (lead.source == "linkedin") {15}
                            else {10}}};

          // Company size scoring: enterprise (500+) highest
          let sizeScore = if (lead.companySize >= 500) {30}
                          else {if (lead.companySize >= 50) {20}
                          else {10}};

          // Industry scoring: target industries score highest
          let industryScore = if (lead.industry == "saas") {20}
                              else {if (lead.industry == "fintech") {20}
                              else {if (lead.industry == "healthtech") {20}
                              else {5}}};

          // Title disqualification: junior titles score 0
          let titleScore = if (lead.leadContactTitle == "intern") {0}
                           else {if (lead.leadContactTitle == "student") {0}
                           else {10}};

          let totalScore = sourceScore + sizeScore + industryScore + titleScore;
          Lead.update({"id": ScoreLead.leadId}, {"score": totalScore});
          totalScore
       }

       // --- Qualify: score >= 50 qualifies, otherwise disqualify ---
       workflow QualifyLead {
          let lead = Lead.find({"id": QualifyLead.leadId});
          let newStatus = if (lead.score >= 50) {"qualified"} else {"disqualified"};
          Lead.update({"id": QualifyLead.leadId}, {"status": newStatus});
          newStatus
       }

       // --- Route: assign lead to a rep based on company size and load ---
       workflow RouteLead {
          let lead = Lead.find({"id": RouteLead.leadId});

          // Determine rep tier by company size
          let tier = if (lead.companySize >= 500) {"enterprise"}
                     else {if (lead.companySize >= 50) {"mid_market"}
                     else {"smb"}};

          // Find the least-loaded rep of the right tier
          let rep = SalesRep.with_min("activeLeadCount", {"repType": tier});

          // Update rep's load counter and mark lead as assigned
          let newCount = rep.activeLeadCount + 1;
          SalesRep.update({"email": rep.email}, {"activeLeadCount": newCount});
          Lead.update({"id": RouteLead.leadId}, {"status": "assigned"});

          // Return the assigned rep email
          rep.email
       }

       // --- Create a deal from an assigned lead ---
       workflow CreateDeal {
          Deal.create({"id": CreateDeal.dealId, "leadId": CreateDeal.leadId, "assignedTo": CreateDeal.repEmail, "value": CreateDeal.value, "probability": 10})
       }

       // --- Advance a deal to the next stage with auto probability ---
       workflow AdvanceDeal {
          let deal = Deal.find({"id": AdvanceDeal.dealId});

          let newProb = if (AdvanceDeal.newStage == "qualification") {25}
                        else {if (AdvanceDeal.newStage == "proposal") {50}
                        else {if (AdvanceDeal.newStage == "negotiation") {75}
                        else {if (AdvanceDeal.newStage == "closed_won") {100}
                        else {0}}}};

          Deal.update({"id": AdvanceDeal.dealId}, {"stage": AdvanceDeal.newStage, "probability": newProb});
          newProb
       }

       // --- Log an activity against a deal ---
       workflow LogActivity {
          Activity.create({"id": LogActivity.activityId, "dealId": LogActivity.dealId, "activityBy": LogActivity.repEmail, "activityType": LogActivity.aType, "comments": LogActivity.comments})
       }

       // --- Pipeline summary: find top deals by value ---
       workflow TopDeals {
          Deal.top(TopDeals.n, "value")
       }

       // --- Rep with the most deals (busiest rep) ---
       workflow BusiestRep {
          SalesRep.with_max_count("Deal", "assignedTo")
       }

       // --- Rep with the highest total pipeline value ---
       workflow TopRepByRevenue {
          SalesRep.with_max_sum("Deal.value", "assignedTo")
       }`
    );
  });
});

describe('sales-lead-dedup', () => {
  test('dedup detects duplicate leads by email', async () => {
    // Create an initial lead
    await parseAndEvaluateStatement(
      `${m}/Lead.create({"id": 1, "source": "website", "sourceId": "https://acme.com/contact", "leadContact": "jane@bigcorp.com", "leadContactTitle": "VP Sales", "companyName": "BigCorp", "companySize": 600, "industry": "saas", "score": 0, "status": "new"})`
    );

    // Dedup check for existing email should return "duplicate"
    const dup = await parseAndEvaluateStatement(`{${m}/Dedup {email "jane@bigcorp.com"}}`);
    assert(dup === 'duplicate', `Expected "duplicate", got ${JSON.stringify(dup)}`);

    // Dedup check for new email should return "new"
    const fresh = await parseAndEvaluateStatement(`{${m}/Dedup {email "bob@newco.com"}}`);
    assert(fresh === 'new', `Expected "new", got ${JSON.stringify(fresh)}`);
  });
});

describe('sales-lead-scoring', () => {
  test('scores a high-quality website lead', async () => {
    // Lead 1: website, BigCorp, 600 employees, saas, VP Sales
    const score1 = await parseAndEvaluateStatement(`{${m}/ScoreLead {leadId 1}}`);
    // source=website(10) + size>=500(30) + industry=saas(20) + title=VP Sales(10) = 70
    assert(score1 == 70, `Expected 70, got ${score1}`);

    // Verify the lead's score was persisted
    const lead1: Instance = await parseAndEvaluateStatement(`${m}/Lead.find({"id": 1})`);
    assert(lead1.lookup('score') == 70, `Expected persisted score 70, got ${lead1.lookup('score')}`);
  });

  test('scores a referral from target industry highest', async () => {
    await parseAndEvaluateStatement(
      `${m}/Lead.create({"id": 2, "source": "customer_referral", "sourceId": "ref-alice", "leadContact": "cto@fintechco.com", "leadContactTitle": "CTO", "companyName": "FintechCo", "companySize": 800, "industry": "fintech", "score": 0, "status": "new"})`
    );
    const score2 = await parseAndEvaluateStatement(`{${m}/ScoreLead {leadId 2}}`);
    // source=referral(30) + size>=500(30) + industry=fintech(20) + title=CTO(10) = 90
    assert(score2 == 90, `Expected 90, got ${score2}`);
  });

  test('scores an intern lead low', async () => {
    await parseAndEvaluateStatement(
      `${m}/Lead.create({"id": 3, "source": "linkedin", "sourceId": "li-intern1", "leadContact": "intern@smallshop.com", "leadContactTitle": "intern", "companyName": "SmallShop", "companySize": 10, "industry": "retail", "score": 0, "status": "new"})`
    );
    const score3 = await parseAndEvaluateStatement(`{${m}/ScoreLead {leadId 3}}`);
    // source=linkedin(15) + size<50(10) + industry=retail(5) + title=intern(0) = 30
    assert(score3 == 30, `Expected 30, got ${score3}`);
  });
});

describe('sales-lead-qualification', () => {
  test('qualifies high-score leads and disqualifies low-score leads', async () => {
    // Lead 1 has score 70 — should qualify
    const status1 = await parseAndEvaluateStatement(`{${m}/QualifyLead {leadId 1}}`);
    assert(status1 === 'qualified', `Expected "qualified", got ${JSON.stringify(status1)}`);

    const lead1: Instance = await parseAndEvaluateStatement(`${m}/Lead.find({"id": 1})`);
    assert(lead1.lookup('status') === 'qualified');

    // Lead 3 has score 30 — should disqualify
    const status3 = await parseAndEvaluateStatement(`{${m}/QualifyLead {leadId 3}}`);
    assert(status3 === 'disqualified', `Expected "disqualified", got ${JSON.stringify(status3)}`);

    const lead3: Instance = await parseAndEvaluateStatement(`${m}/Lead.find({"id": 3})`);
    assert(lead3.lookup('status') === 'disqualified');
  });
});

describe('sales-lead-routing', () => {
  test('routes leads to correct rep tier with load balancing', async () => {
    // Create sales reps — two enterprise, one mid-market, one smb
    await parseAndEvaluateStatement(
      `${m}/SalesRep.create({"email": "alice@salesteam.com", "firstName": "Alice", "lastName": "Adams", "repType": "enterprise", "activeLeadCount": 0})`
    );
    await parseAndEvaluateStatement(
      `${m}/SalesRep.create({"email": "bob@salesteam.com", "firstName": "Bob", "lastName": "Brown", "repType": "enterprise", "activeLeadCount": 0})`
    );
    await parseAndEvaluateStatement(
      `${m}/SalesRep.create({"email": "carol@salesteam.com", "firstName": "Carol", "lastName": "Chen", "repType": "mid_market", "activeLeadCount": 0})`
    );
    await parseAndEvaluateStatement(
      `${m}/SalesRep.create({"email": "dan@salesteam.com", "firstName": "Dan", "lastName": "Davis", "repType": "smb", "activeLeadCount": 0})`
    );

    // Route lead 1 (BigCorp, 600 employees) — should go to enterprise rep
    const rep1 = await parseAndEvaluateStatement(`{${m}/RouteLead {leadId 1}}`);
    assert(
      rep1 === 'alice@salesteam.com' || rep1 === 'bob@salesteam.com',
      `Expected enterprise rep, got ${rep1}`
    );

    // Check lead status is now "assigned"
    const lead1: Instance = await parseAndEvaluateStatement(`${m}/Lead.find({"id": 1})`);
    assert(lead1.lookup('status') === 'assigned');

    // Route lead 2 (FintechCo, 800 employees) — should go to enterprise rep with lower load
    const rep2 = await parseAndEvaluateStatement(`{${m}/RouteLead {leadId 2}}`);
    assert(
      rep2 === 'alice@salesteam.com' || rep2 === 'bob@salesteam.com',
      `Expected enterprise rep, got ${rep2}`
    );
    // The two enterprise leads should be balanced across alice and bob
    assert(rep1 !== rep2, `Expected load balancing, but both went to ${rep1}`);

    // Create and route a mid-market lead
    await parseAndEvaluateStatement(
      `${m}/Lead.create({"id": 4, "source": "trade_show", "sourceId": "badge-42", "leadContact": "cfo@midco.com", "leadContactTitle": "CFO", "companyName": "MidCo", "companySize": 200, "industry": "healthtech", "score": 75, "status": "qualified"})`
    );
    const rep4 = await parseAndEvaluateStatement(`{${m}/RouteLead {leadId 4}}`);
    assert(rep4 === 'carol@salesteam.com', `Expected mid-market rep Carol, got ${rep4}`);
  });
});

describe('sales-deal-pipeline', () => {
  test('creates deals and advances through stages with auto probability', async () => {
    // Create deal for lead 1
    const deal1: Instance = await parseAndEvaluateStatement(
      `{${m}/CreateDeal {dealId 100, leadId 1, repEmail "alice@salesteam.com", value 50000}}`
    );
    assert(isInstanceOfType(deal1, `${m}/Deal`));
    assert(deal1.lookup('stage') === 'prospecting');
    assert(deal1.lookup('probability') == 10);

    // Create deal for lead 2
    await parseAndEvaluateStatement(
      `{${m}/CreateDeal {dealId 101, leadId 2, repEmail "bob@salesteam.com", value 120000}}`
    );

    // Create deal for lead 4 (mid-market)
    await parseAndEvaluateStatement(
      `{${m}/CreateDeal {dealId 102, leadId 4, repEmail "carol@salesteam.com", value 35000}}`
    );

    // Advance deal 100: prospecting → qualification (25%)
    const prob1 = await parseAndEvaluateStatement(
      `{${m}/AdvanceDeal {dealId 100, newStage "qualification"}}`
    );
    assert(prob1 == 25, `Expected probability 25, got ${prob1}`);

    // qualification → proposal (50%)
    const prob2 = await parseAndEvaluateStatement(
      `{${m}/AdvanceDeal {dealId 100, newStage "proposal"}}`
    );
    assert(prob2 == 50, `Expected probability 50, got ${prob2}`);

    // proposal → negotiation (75%)
    const prob3 = await parseAndEvaluateStatement(
      `{${m}/AdvanceDeal {dealId 100, newStage "negotiation"}}`
    );
    assert(prob3 == 75, `Expected probability 75, got ${prob3}`);

    // Verify stage persisted
    const deal100: Instance = await parseAndEvaluateStatement(`${m}/Deal.find({"id": 100})`);
    assert(deal100.lookup('stage') === 'negotiation');
    assert(deal100.lookup('probability') == 75);

    // negotiation → closed_won (100%)
    const prob4 = await parseAndEvaluateStatement(
      `{${m}/AdvanceDeal {dealId 100, newStage "closed_won"}}`
    );
    assert(prob4 == 100, `Expected probability 100 for closed_won, got ${prob4}`);

    // Close-lost on deal 102 (0%)
    const prob5 = await parseAndEvaluateStatement(
      `{${m}/AdvanceDeal {dealId 102, newStage "closed_lost"}}`
    );
    assert(prob5 == 0, `Expected probability 0 for closed_lost, got ${prob5}`);
  });
});

describe('sales-activity-tracking', () => {
  test('logs activities against deals', async () => {
    // Log a call
    await parseAndEvaluateStatement(
      `{${m}/LogActivity {activityId 1, dealId 100, repEmail "alice@salesteam.com", aType "call", comments "Initial discovery call"}}`
    );

    // Log an email
    await parseAndEvaluateStatement(
      `{${m}/LogActivity {activityId 2, dealId 100, repEmail "alice@salesteam.com", aType "email", comments "Sent proposal deck"}}`
    );

    // Log a meeting
    await parseAndEvaluateStatement(
      `{${m}/LogActivity {activityId 3, dealId 100, repEmail "alice@salesteam.com", aType "meeting", comments "Demo with engineering team"}}`
    );

    // Log activity for Bob's deal
    await parseAndEvaluateStatement(
      `{${m}/LogActivity {activityId 4, dealId 101, repEmail "bob@salesteam.com", aType "call", comments "Intro call with CTO"}}`
    );

    // Verify all activities were created
    const allActivities: Instance[] = await parseAndEvaluateStatement(`${m}/Activity.find_all()`);
    assert(allActivities.length === 4, `Expected 4 activities, got ${allActivities.length}`);

    // Find activities for deal 100
    const deal100Activities: Instance[] = await parseAndEvaluateStatement(
      `${m}/Activity.find_all({"dealId": 100})`
    );
    assert(deal100Activities.length === 3, `Expected 3 activities for deal 100, got ${deal100Activities.length}`);

    // Verify activity details
    const call: Instance = await parseAndEvaluateStatement(`${m}/Activity.find({"id": 1})`);
    assert(call.lookup('activityType') === 'call');
    assert(call.lookup('activityBy') === 'alice@salesteam.com');
  });
});

describe('sales-pipeline-analytics', () => {
  test('top deals by value', async () => {
    const topDeals: Instance[] = await parseAndEvaluateStatement(`{${m}/TopDeals {n 2}}`);
    assert(topDeals.length === 2, `Expected 2 top deals, got ${topDeals.length}`);
    // Deal 101 ($120k) should be first, Deal 100 ($50k) second
    assert(topDeals[0].lookup('value') == 120000, `Expected 120000, got ${topDeals[0].lookup('value')}`);
    assert(topDeals[1].lookup('value') == 50000, `Expected 50000, got ${topDeals[1].lookup('value')}`);
  });

  test('busiest rep by deal count', async () => {
    // Alice has deal 100, Bob has deal 101, Carol has deal 102 — all have 1 each
    // Create an extra deal for Alice to make her the busiest
    await parseAndEvaluateStatement(
      `${m}/Deal.create({"id": 103, "leadId": 1, "assignedTo": "alice@salesteam.com", "value": 25000, "probability": 10})`
    );

    const busiest: Instance = await parseAndEvaluateStatement(`{${m}/BusiestRep {}}`);
    assert(busiest.lookup('firstName') === 'Alice', `Expected Alice, got ${busiest.lookup('firstName')}`);
  });

  test('top rep by total pipeline value', async () => {
    // Alice: $50k + $25k = $75k, Bob: $120k, Carol: $35k
    const topRep: Instance = await parseAndEvaluateStatement(`{${m}/TopRepByRevenue {}}`);
    assert(topRep.lookup('firstName') === 'Bob', `Expected Bob (highest revenue), got ${topRep.lookup('firstName')}`);
  });
});
