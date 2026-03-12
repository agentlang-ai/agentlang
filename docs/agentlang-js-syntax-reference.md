# Agentlang Language Reference

This document is the complete specification for Agentlang's JS-style syntax. It covers
the data model (entities, relationships), CRUD operations, query methods, workflow
logic (let-bindings, if/else, for-loops, arithmetic), and cross-entity analytics.
Every example shown here has a corresponding passing test.

Use this document to write Agentlang applications or to prompt an LLM that generates
them.

---

## 1. Modules

Every Agentlang file declares a module. All entities, relationships, and workflows
inside it belong to that module.

```
module SalesApp
```

Module names are identifiers. A single `/` is allowed to create a namespace:

```
module SalesApp/Core
```

When referencing an entity from outside its module, use the fully-qualified name:
`SalesApp/Core/Lead`. Inside the same module, the bare name `Lead` is sufficient.

---

## 2. Entities

Entities are the primary data structures. Each entity maps to a database table.

```
entity Lead {
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
```

### Attribute types

| Type      | Description                  | Example                   |
|-----------|------------------------------|---------------------------|
| `Int`     | Integer                      | `id Int @id`              |
| `Decimal` | Floating-point number        | `value Decimal`           |
| `String`  | Text                         | `name String`             |
| `Boolean` | true / false                 | `active Boolean`          |

### Attribute decorators

| Decorator              | Meaning                                                    |
|------------------------|------------------------------------------------------------|
| `@id`                  | Primary key                                                |
| `@default(value)`      | Default value. Use `@default(0)`, `@default("new")`, etc.  |
| `@enum("a", "b", "c")` | Restricts values to the listed strings                    |
| `@ref(Entity.attr)`   | Foreign key referencing another entity's attribute          |

### Foreign keys with @ref

`@ref` links an attribute to another entity's primary key. The referenced entity
must be specified with its fully-qualified name (module/Entity.attr):

```
entity Deal {
    id Int @id,
    leadId Int @ref(myModule/Lead.id),
    assignedTo String @ref(myModule/SalesRep.email),
    stage @enum("prospecting", "qualification", "proposal",
                "negotiation", "closed_won", "closed_lost") @default("prospecting"),
    value Decimal,
    probability Int @default(10)
}
```

### Naming rules

- Entity names: PascalCase (`Lead`, `SalesRep`, `LineItem`)
- Attribute names: camelCase (`leadContact`, `companySize`, `activeLeadCount`)
- Enum values: snake_case strings (`"trade_show"`, `"closed_won"`, `"mid_market"`)
  Hyphens are **not** allowed in enum values.

---

## 3. Relationships

Relationships define associations between entities.

### Between relationship (many-to-many)

```
entity Author {
    id Int @id,
    name String
}

entity Book {
    id Int @id,
    title String
}

relationship AuthorBook between(Author @as author, Book @as book)
```

### Contains relationship (parent-child / one-to-many)

```
entity SalesOrder {
    id Int @id,
    customer String
}

entity LineItem {
    id Int @id,
    product String,
    qty Int
}

relationship OrderItems contains(SalesOrder, LineItem)
```

---

## 4. CRUD Operations

All CRUD operations use `Entity.method({...})` syntax with JSON-style map arguments.

### Create

```
Lead.create({"id": 1, "source": "website", "leadContact": "jane@bigcorp.com",
             "companyName": "BigCorp", "companySize": 600, "industry": "saas"})
```

Returns the created entity instance.

### Find (single entity)

```
Lead.find({"id": 1})
```

Returns one entity matching the lookup attributes, or null/undefined if not found.

### Find all (query)

```
// All entities
Lead.find_all()

// With filter
Lead.find_all({"status": "qualified"})

// With comparison operator in filter
Employee.find_all({"salary>=": 60000})

// With filter + query options (orderBy, limit, offset)
Deal.find_all({"stage": "closed_won"}, {"orderBy": "value", "desc": true, "limit": 5})
```

Returns an array of entity instances.

### Update

Two arguments: lookup attributes, then new values.

```
Lead.update({"id": 1}, {"score": 70, "status": "qualified"})
```

### Upsert

Creates the entity if it doesn't exist, updates it otherwise.

```
Config.upsert({"key": "theme", "value": "dark"})
```

### Delete

```
Lead.delete({"id": 3})
```

### Complete CRUD reference

| Method                          | Returns    | Purpose                              |
|---------------------------------|------------|--------------------------------------|
| `E.create({"attrs"})`          | 1 entity   | Create a new entity                  |
| `E.find({"lookup"})`           | 1 entity   | Find by key/unique attribute         |
| `E.find_all()`                 | N entities | Query all records                    |
| `E.find_all({"filter"})`       | N entities | Query with filter                    |
| `E.find_all({"filter"}, opts)` | N entities | Query with filter + order/limit      |
| `E.update({"lookup"}, {"vals"})` | 1 entity | Update matching entity              |
| `E.upsert({"attrs"})`          | 1 entity   | Create or update                     |
| `E.delete({"lookup"})`         | --         | Delete matching entity               |

---

## 5. Query & Aggregate Methods

### Tier 1: Single-entity aggregates

These find the "best" or "worst" entity by one of its own attributes.

```
// Entity with the highest salary
Employee.with_max("salary")

// Entity with the lowest price, filtered
Product.with_min("price", {"category": "electronics"})

// Top 5 by salary
Employee.top(5, "salary")

// Bottom 3 by price, with filter
Product.bottom(3, "price", {"inStock": true})
```

| Method                            | Returns    | SQL equivalent                         |
|-----------------------------------|------------|----------------------------------------|
| `E.with_max(attr)`               | 1 entity   | `ORDER BY attr DESC LIMIT 1`          |
| `E.with_min(attr)`               | 1 entity   | `ORDER BY attr ASC LIMIT 1`           |
| `E.with_max(attr, filter)`       | 1 entity   | `WHERE ... ORDER BY attr DESC LIMIT 1` |
| `E.with_min(attr, filter)`       | 1 entity   | `WHERE ... ORDER BY attr ASC LIMIT 1`  |
| `E.top(n, attr)`                 | N entities | `ORDER BY attr DESC LIMIT n`           |
| `E.bottom(n, attr)`              | N entities | `ORDER BY attr ASC LIMIT n`            |
| `E.top(n, attr, filter)`         | N entities | `WHERE ... ORDER BY attr DESC LIMIT n` |
| `E.bottom(n, attr, filter)`      | N entities | `WHERE ... ORDER BY attr ASC LIMIT n`  |

### Tier 2: Cross-entity aggregates

These answer "which entity has the most/fewest/highest-sum of a **related** entity's
records?" The join is inferred from `@ref` annotations.

**Prerequisite:** The related entity must have an attribute decorated with
`@ref(E.primaryKey)`.

```
entity SalesRep {
    email String @id,
    firstName String,
    lastName String,
    repType @enum("enterprise", "mid_market", "smb")
}

entity Deal {
    id Int @id,
    assignedTo String @ref(myModule/SalesRep.email),   // <-- join key
    value Decimal
}
```

**Count-based:** rank by number of related records

```
// Rep with the most deals
SalesRep.with_max_count("Deal", "assignedTo")

// Rep with the fewest deals
SalesRep.with_min_count("Deal", "assignedTo")

// Rep with the most closed_won deals (filtered)
SalesRep.with_max_count("Deal", "assignedTo", {"stage": "closed_won"})

// Top 3 reps by deal count
SalesRep.top_by_count(3, "Deal", "assignedTo")
```

**Sum-based:** rank by sum of a related attribute

```
// Rep with the highest total pipeline value
SalesRep.with_max_sum("Deal.value", "assignedTo")

// Top 5 reps by total revenue
SalesRep.top_by_sum(5, "Deal.value", "assignedTo")
```

**Average-based:** rank by average of a related attribute

```
// Rep with the highest average deal size
SalesRep.with_max_avg("Deal.value", "assignedTo")
```

| Method                                          | Returns    | Ranks by               |
|-------------------------------------------------|------------|------------------------|
| `E.with_max_count(related, joinAttr, filter?)`  | 1 entity   | Most related records   |
| `E.with_min_count(related, joinAttr, filter?)`  | 1 entity   | Fewest related records |
| `E.with_max_sum(related.attr, joinAttr, filter?)` | 1 entity | Highest sum            |
| `E.with_min_sum(related.attr, joinAttr, filter?)` | 1 entity | Lowest sum             |
| `E.with_max_avg(related.attr, joinAttr, filter?)` | 1 entity | Highest average        |
| `E.with_min_avg(related.attr, joinAttr, filter?)` | 1 entity | Lowest average         |
| `E.top_by_count(n, related, joinAttr, filter?)` | N entities | Most related records   |
| `E.bottom_by_count(n, related, joinAttr, filter?)` | N entities | Fewest related records |
| `E.top_by_sum(n, related.attr, joinAttr, filter?)` | N entities | Highest sum          |
| `E.bottom_by_sum(n, related.attr, joinAttr, filter?)` | N entities | Lowest sum        |
| `E.top_by_avg(n, related.attr, joinAttr, filter?)` | N entities | Highest average      |
| `E.bottom_by_avg(n, related.attr, joinAttr, filter?)` | N entities | Lowest average    |

### Relationship methods

For `between` relationships, `link` and `unlink` manage associations:

```
// Given: relationship AuthorBook between(Author @as author, Book @as book)

AuthorBook.link(1, 10)      // associate author 1 with book 10
AuthorBook.unlink(1, 20)    // remove association
```

Arguments are the ID values of the two entities, in the order they appear in the
relationship definition.

---

## 6. Workflows

Workflows are named sequences of statements that implement business logic.
They are the primary unit of computation in Agentlang.

```
workflow CreateDeal {
    Deal.create({"id": CreateDeal.dealId, "leadId": CreateDeal.leadId,
                 "assignedTo": CreateDeal.repEmail, "value": CreateDeal.value})
}
```

### Workflow parameters

Workflows receive parameters through `WorkflowName.paramName` references:

```
workflow TopDeals {
    Deal.top(TopDeals.n, "value")
}
```

Invoking a workflow (from a test or another workflow):
```
{myModule/TopDeals {n 5}}
```

### Statements

Statements are separated by semicolons (`;`). The last statement's value is the
workflow's return value. Semicolons are required between statements but optional
after the last one.

```
workflow Example {
    Lead.create({"id": 1, "name": "Alice"});
    Lead.find({"id": 1})
}
```

---

## 7. Variable Binding

### let binding

`let` binds the result of a pattern (CRUD operation, expression, if-expression) to
a named variable for use in subsequent statements.

```
let lead = Lead.find({"id": 1});
let cheapest = Product.with_min("price");
let total = price * quantity;
```

### let with if-expression

`let` can bind the result of an if/else expression:

```
let status = if (lead.score >= 50) {"qualified"} else {"disqualified"};
```

### Destructuring

`let` supports array destructuring for methods that return multiple results:

```
let [first, second] = Student.top(2, "score");
// first and second are now individual entities

let [top] = {Entity? {}, @orderBy(value) @desc, @limit(1)};
// top is the first (and only) element
```

Special destructuring tokens:
- `_` skips a position: `let [_, second] = items`
- `__` captures the rest: `let [first, __, rest] = items`

### @as binding (legacy syntax, still supported)

The `@as` hint binds a statement's result after evaluation:

```
Lead.find({"id": 1}) @as lead;
Student.top(2, "score") @as [first, second];
```

`@as` supports the same destructuring as `let`. `let` is preferred for new code
because it reads more naturally and is easier for LLMs to generate correctly.

---

## 8. Control Flow

### if / else

```
if (condition) {
    // then branch (one or more statements separated by ;)
} else {
    // else branch
}
```

Conditions support comparison operators: `==`, `!=`, `<`, `<=`, `>`, `>=`.
Logical operators: `and`, `or`. Arithmetic: `+`, `-`, `*`, `/`.

**As an expression with let:**

```
let tier = if (lead.companySize >= 500) {"enterprise"}
           else {if (lead.companySize >= 50) {"mid_market"}
           else {"smb"}};
```

**Nested if/else chains:** There is no `else if` keyword. Nest `if` inside the `else`
block:

```
let score = if (source == "customer_referral") {30}
            else {if (source == "trade_show") {25}
            else {if (source == "linkedin") {15}
            else {10}}};
```

Each `else` block opens a new `{...}` containing another `if`.

### for loop

Iterates over an array, collecting results:

```
for item in Lead.find_all({"status": "new"}) {
    ScoreLead(item.id)
}
```

### return

Exits the workflow early with a value:

```
return "done"
```

### throw

Raises an error:

```
throw("Invalid input")
```

---

## 9. Expressions

### Arithmetic

```
let total = price * quantity;
let discounted = total - (total * 0.1);
let newCount = rep.activeLeadCount + 1;
```

Operators: `+`, `-`, `*`, `/`

### Comparison

```
lead.score >= 50
lead.industry == "saas"
deal.value != 0
```

Operators: `==`, `!=`, `<>`, `<`, `<=`, `>`, `>=`

### Logical

```
lead.score >= 50 and lead.status == "new"
source == "website" or source == "linkedin"
not(lead.active)
```

Operators: `and`, `or`, `not(...)`

### Attribute access

Access entity attributes with dot notation:

```
lead.companyName
rep.email
deal.value
```

### Map literals

Return structured data using JSON-style map literals:

```
{"first": first.name, "second": second.name, "total": total}
```

### Array literals

```
[item1, item2, item3]
```

---

## 10. Error Handling

### @catch

Handle errors from CRUD operations:

```
Lead.find({"id": 999}) @catch {
    not_found {"default_value"}
    error {"error occurred"}
}
```

### @empty

Handle null/empty results:

```
Lead.find({"id": 999}) @empty Lead.create({"id": 999, "name": "Fallback"})
```

---

## 11. Complete Example: B2B Sales Pipeline

This example models a complete B2B SaaS sales pipeline with lead intake,
scoring, qualification, routing, deal tracking, and analytics.

### Data model

```
module SalesApp

entity Lead {
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
    leadId Int @ref(SalesApp/Lead.id),
    assignedTo String @ref(SalesApp/SalesRep.email),
    stage @enum("prospecting", "qualification", "proposal",
                "negotiation", "closed_won", "closed_lost") @default("prospecting"),
    value Decimal,
    probability Int @default(10)
}

entity Activity {
    id Int @id,
    dealId Int @ref(SalesApp/Deal.id),
    activityBy String @ref(SalesApp/SalesRep.email),
    activityType @enum("call", "email", "meeting", "notes"),
    comments String
}
```

### Workflow: Lead deduplication

Check if a lead with the same email already exists before creating a new one.

```
workflow Dedup {
    let existing = Lead.find({"leadContact": Dedup.email});
    if (existing != 0) {"duplicate"} else {"new"}
}
```

### Workflow: Lead scoring

Score leads on four factors: source quality, company size, industry fit, and
contact title. Higher scores indicate better leads.

```
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
```

### Workflow: Lead qualification

Qualify or disqualify a lead based on its score.

```
workflow QualifyLead {
    let lead = Lead.find({"id": QualifyLead.leadId});
    let newStatus = if (lead.score >= 50) {"qualified"} else {"disqualified"};
    Lead.update({"id": QualifyLead.leadId}, {"status": newStatus});
    newStatus
}
```

### Workflow: Lead routing with load balancing

Route a qualified lead to the right sales rep tier (enterprise / mid-market / SMB)
based on company size, then pick the least-loaded rep within that tier.

```
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
```

### Workflow: Deal creation

```
workflow CreateDeal {
    Deal.create({"id": CreateDeal.dealId, "leadId": CreateDeal.leadId,
                 "assignedTo": CreateDeal.repEmail, "value": CreateDeal.value,
                 "probability": 10})
}
```

### Workflow: Deal stage advancement with auto probability

Move a deal to a new stage and automatically update its win probability.

```
workflow AdvanceDeal {
    let deal = Deal.find({"id": AdvanceDeal.dealId});

    let newProb = if (AdvanceDeal.newStage == "qualification") {25}
                  else {if (AdvanceDeal.newStage == "proposal") {50}
                  else {if (AdvanceDeal.newStage == "negotiation") {75}
                  else {if (AdvanceDeal.newStage == "closed_won") {100}
                  else {0}}}};

    Deal.update({"id": AdvanceDeal.dealId},
                {"stage": AdvanceDeal.newStage, "probability": newProb});
    newProb
}
```

### Workflow: Activity logging

```
workflow LogActivity {
    Activity.create({"id": LogActivity.activityId,
                     "dealId": LogActivity.dealId,
                     "activityBy": LogActivity.repEmail,
                     "activityType": LogActivity.aType,
                     "comments": LogActivity.comments})
}
```

### Workflow: Pipeline analytics

```
// Top N deals by value
workflow TopDeals {
    Deal.top(TopDeals.n, "value")
}

// Rep with the most deals (uses cross-entity count aggregate)
workflow BusiestRep {
    SalesRep.with_max_count("Deal", "assignedTo")
}

// Rep with the highest total pipeline value (uses cross-entity sum aggregate)
workflow TopRepByRevenue {
    SalesRep.with_max_sum("Deal.value", "assignedTo")
}
```

---

## 12. Syntax Quick Reference for Code Generation

When generating Agentlang code, follow these patterns exactly.

### Entity template

```
entity EntityName {
    id Int @id,
    name String,
    count Int @default(0),
    status @enum("active", "inactive") @default("active"),
    foreignKey Int @ref(Module/OtherEntity.id)
}
```

### Workflow template

```
workflow WorkflowName {
    // Bind results with let
    let entity = Entity.find({"id": WorkflowName.paramId});

    // Conditional logic with nested if/else
    let result = if (entity.attr == "value1") {"output1"}
                 else {if (entity.attr == "value2") {"output2"}
                 else {"default"}};

    // Arithmetic
    let computed = entity.numericAttr + 10;

    // CRUD operations
    Entity.update({"id": WorkflowName.paramId}, {"attr": result});

    // Return value (last expression)
    result
}
```

### Key rules

1. **Semicolons** separate statements. Required between statements, optional after
   the last.
2. **Enum values** use snake_case: `"closed_won"`, not `"closed-won"`.
3. **Module-qualified names** use a single `/`: `MyModule/Entity`. Never use more
   than one slash.
4. **@ref** always uses the fully-qualified entity path: `@ref(Module/Entity.attr)`.
5. **String arguments** in method calls are always double-quoted:
   `Entity.find({"key": "value"})`.
6. **Nested if/else** uses `else {if (...) {...} else {...}}` — there is no
   `else if` keyword.
7. **let vs @as**: Both bind results. `let x = expr` is preferred for new code.
   `expr @as x` is the legacy form and still works.
8. **Workflow parameters** are accessed as `WorkflowName.paramName`.
9. **Last expression** in a workflow body is the return value.
10. **Comments** use `//` for single-line, `/* */` for multi-line.
