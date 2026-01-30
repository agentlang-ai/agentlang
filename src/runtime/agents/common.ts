import { IfPattern, LiteralPattern } from '../../language/syntax.js';
import { trimQuotes } from '../util.js';

export const PlannerInstructions = `Agentlang is a very-high-level declarative language that makes it easy to define business applications as 'models'.
The model of a business application consists of entity definitions and workflows defined in "modules". 
A module is be encoded in a syntax inspired by JavaScript and JSON. Example of a simple module follows:

module Erp

entity Employee {
   employeeId UUID @id @default(uuid()),
   firstName String,
   lastName String,
   salary Number,
   email Email @indexed
}

The Empoyee entity is part of the "Erp" module and it has four attributes: 'employeeId', 'firstName', 'lastName', 'salary' and 'email'. 
The 'employeeId' attribute uniquely identifies an instance of the Employee entity and it's automatically filled-in by the system by calling the "uuid()" function. 
In the place of the keyword 'entity', the keyword 'record' may also be used. The difference between an entity and a record is that, 
instances of an entity is persisted to the database, instances of records are not.

This is an example of a record:

record EmailMessage {
    to Email,
    from Email,
    subject String,
    body String
}

Another major construct in Agentlang is the 'workflow'. Workflows contains JSON "patterns" that perform CRUD operations on entities. 
For example, here's is a workflow that creates a new instance of the Employee entity:

workflow CreateEmployee {
    {Erp/Employee {firstName CreateEmployee.firstName,
                   lastName CreateEmployee.lastName,
                   salary CreateEmployee.salary,
                   email CreateEmployee.email}}
}

The attribute-values of the new Employee are derived from the "event" that triggers the workflow. In this example the event is called "CreateEmployee".
An event need not have an explicit schema, because its attributes can always be inferred from the workflow definition. But a model may also contain
explicit definitions of events, as follows,

event CreateEmployee {
   firstName String,
   lastName String,
   salary Number,
   email Email
}

A workflow attached to an event is invoked by creating an instance of the event, e.g:

{Erp/CreateEmployee {firstName "Sam", lastName "K", salary 1400, email "samk@acme.com"}}

This means a workflow can be invoked from another workflow, simply by having the event-creation pattern.

Other than the create-pattern for entities and events, some of the most useful patterns (related to entities) that can appear in a workflow are:
1. Query - e.g: '{Erp/Employee {employeeId? "56392e13-0d9a-42f7-b556-0d7cd9468a24"}}'. The attributes by which the query happens must end with a '?' character.
   To lookup all instances of an entity, use the syntax: '{EntityName?: {}}'.
2. Update - e.g: '{Erp/Employee {employeeId? "56392e13-0d9a-42f7-b556-0d7cd9468a24", firstName "Joe"}}'. This pattern updates the firstName of the employee
   with the given employeeId.
3. Upsert - e.g: '{Erp/Employee {employeeId "56392e13-0d9a-42f7-b556-0d7cd9468a24", firstName "Joe"}, @upsert}'. The 'upsert' pattern will create a new
   instance, if the instance does not already exist.
4. Delete - e.g: 'delete {Erp/Employee {employeeId? "56392e13-0d9a-42f7-b556-0d7cd9468a24"}}'

The default query operator is equals. So an expression like 'employeeId? "56392e13-0d9a-42f7-b556-0d7cd9468a24"' means,
'where employeeId equals "56392e13-0d9a-42f7-b556-0d7cd9468a24"'. Other comparison operators has to be specified explicitly, as in
'{age?< 50}' - which means 'where age less-than 50'. The comparison operators supported by a query pattern are:

!=        - not-equals
<         - less-than
<=        - less-than or equals
>         - greater-than
>=        - greater-than or equals
in        - membership check (argument must be an array)
like      - string-ends-with?
between   - between given values (argument must be an array)

Two comparison expressions can be combined together by the logical operators 'or' and 'and'. The comparison and logical expressions produce a boolean
result, represented by 'true' or 'false'. A boolean value can be inversed by using the 'not' expression, e.g: 'not(some-value)'

In addition to the basic CRUD patterns, you can execute conditional-logic with the help of the 'if' pattern. An example follows,

workflow IncrementSalary {
    if (IncrementSalary.percentage > 10) {
        {Erp/Employee {employeeId IncrementSalary.employeeId, salary salary + salary * IncrementSalary.percentage}}
    } else {
        {Erp/Employee {employeeId IncrementSalary.employeeId, salary salary + 1500}}
    }
}

Note the value passed to the 'salary' attribute - it's an arithmetic expression. All normal arithmetic expressions are supported by workflow patterns.

Another example of the 'if' pattern:

workflow validateLicense {
    {checkLicenseNumber {number validateLicense.number}} @as response;
    if (response == "ok") {
        {license {number? validateLicense.number, status "active"}}
    } else {
        {license {number? validateLicense.number, status "canceled"}}
    }
}

Also note the use of the '@as' keyword - this binds the result of a pattern to an 'alias'.

A successful query pattern will return an array of instances. The 'for' pattern can be used to iterate over an array. An example follows:

workflow NotifyEmployees {
    {Erp/Employee {salary?> 1000}} @as employees;
    for emp in employees {
        {Erp/SendMail {email emp.email, body "You are selected for an increment!"}}
    }
}

Here the result of the query is bound to the alias named 'employees'. Any pattern can have an alias, including 'if' and 'for'. An alias can be used to refer to the attributes of the instance, 
via the dot(.) notation. Aliases can also be used to destructure a query result - here's an example:

workflow FindFirstTwoEmployees {
    {Erp/Employee {salary?> 1000}} @as [emp1, emp2];
    [emp1, emp2]
}

This alias will bind the first two instances to 'a' and 'b' and the rest of the instances to an array named 'xs':

{SomeEntity {id?> 1}} @as [a, b, _, xs]

Examples of binding aliases to 'if' and 'for':

if (IncrementSalary.percentage > 10) {
    {Erp/Employee {employeeId IncrementSalary.employeeId, salary salary + salary * IncrementSalary.percentage}}
} else {
    {Erp/Employee {employeeId IncrementSalary.employeeId, salary salary + 1500}}
} @as emp

for emp in employees {
    {Erp/SendMail {email emp.email, body "You are selected for an increment!"}}
} @as emails

Make sure all references based on a preceding pattern is based either on an actual alias or the name of the workflow. For example, the following sequence of patterns
are invalid, because the alias 'employee' is not defined:

{Employee {id? 101}};
{SendEmail {to employee.email, body "hello"}}

A fix for the reference-error is shown below:

{Employee {id? 101}} @as [employee];
{SendEmail {to employee.email, body "hello"}}

Note that the alias for the query is '[employee]' so that the resultset is destructured to select exactly one instance of Employee 
selected into the reference. You must follow this pattern if your goal is to select exactly a single instance.

Keep in mind that the only valid syntax for the 'if' condition is:

if (<expr>) {
    <patterns>
} else if (<expr>) {
    <patterns>
} else {
    <patterns>
}

The following usage is NOT valid:

<pattern> if (<expr>)

A pattern may execute asynchronously and its eventual result can be handled by patterns provided in the '@then' clause. An example is shown below:

{sendChatMessage {to "amy", "text" "hello"}} @as response @then {
    {saveResponse {from "amy", "text" response}}
}

If you are instructed that a particular event will be called asynchronously, always provide the patterns that follows in its '@then' clause. You must add the 
'@then' clause only if an event's documentation or instruction explicitly requires to do so.

Entities in a module can be connected together in relationships. There are two types of relationships - 'contains' and 'between'.
'Contains' relationship is for hierarchical data, as in a Library entity containing Books. 'Between' relationship is for graph-like data,
like two Profiles in a social media app is connected as friends. A 'between' relationship can be one of the following three types - 'one_one' (one-to-one),
'one_many' (one-to-many) and 'many_many' (many-to-many), which is the default.

The following example shows how additional profile data for an employee could be defined as a new entity and attached to the Employee entity as a between-relationship:

entity Profile {
    id UUID @id @default(uuid()),
    address String @optional,
    photo URL @optional,
    dateOfBirth DateTime @optional
}

relationship EmployeeProfile between (Erp/Employee, Erp/Profile) @one_one

The '@one_one' annotation means exactly one Employee and Profile can be related to each other via 'EmployeeProfile'.

Here's the 'CreateEmployee' workflow updated to create the Employee with the his/her Profile attached:

workflow CreateEmployee {
    {Erp/Employee {firstName CreateEmployee.firstName,
                   lastName CreateEmployee.lastName,
                   salary CreateEmployee.salary,
                   email CreateEmployee.email},
     Erp/EmployeeProfile {Erp/Profile {address CreateEmployee.address,
                                       photo CreateEmployee.photo,
                                       dateOfBirth CreateEmployee.dateOfBirth}}}
}

The following pattern can be user to query an Employee along with his Profile:

{Erp/Employee {employeeId? "56392e13-0d9a-42f7-b556-0d7cd9468a24"},
 Erp/EmployeeProfile {Erp/Profile? {}}}

As an example of 'contains' relaionships, consider modelling task-assignments for an Employee as folllows:

entity TaskAssignment {
    id UUID @id @default(uuid()),
    description String,
    assignmentDate DateTime @default(now())
}

relationship EmployeeTaskAssignment contains (Erp/Employee, Erp/TaskAssignment)

The following workflow shows how to assign a new task to an Employee:

workflow AssignNewTask {
    {Erp/Employee {employeeId? AssignNewTask.employeeId},
     Erp/EmployeeTaskAssignment {Erp/TaskAssignment {description AssignNewTask.description}}}
}

The following workflow queries an Employee along with all his tasks:

workflow GetEmployeeTaskAssignments {
    {Erp/Employee {employeeId? GetEmployeeTaskAssignments.employeeId},
     Erp/EmployeeTaskAssignment {Erp/TaskAssignment? {}}}
}

A general rule regarding generating workflows - as much as possible, do not include references to the workflow event in the patterns. Try to
fill-in values from the available context. For example, if your instruction is "create a workflow to send an email to employee 101 with this message - 
'please call me as soon as possible'", the best workflow to return is:

workflow sendEmail {
    {employee {id? 101}} @as emp;
    {email {to emp.email body "please call me as soon as possible"}}
}

because all the information needed is available in the context. If the instruction is "create a workflow to send an email by employee-id with this message - 
'please call me as soon as possible'", then you can return:

workflow sendEmail {
    {employee {id? sendEmail.employeeId}} @as emp;
    {email {to emp.email body "please call me as soon as possible"}}
}

The point is, use the immediate context to fill-in values in generated patterns, as much as possible.

Also generate a workflow only if required explicitly by the user or the contextual information is incomplete. Otherwise, just return an array of patterns.
As an example, if the user request is "send an email to employee 101 with this message - 'please call me as soon as possible'", you must return:

[{employee {id? 101}} @as emp;
 {email {to emp.email, body "please call me as soon as possible"}}]

You MUST separate each pattern in the array with a semi-colon (;)  and never use a comma (,) for this purpose.

Now consider the following module definition and generate appropriate patterns in response to the user instructions. You must return only valid patterns or workflows,
no other descriptive text or comments are needed.
`;

export const FlowExecInstructions = `The following is the textual representation of a flowchart. 

checkOrder --> "ProductA" acceptOrder
checkOrder --> "ProductB" acceptOrder
checkOrder --> "ProductC" rejectOrder
acceptOrder --> sendPaymentLinkToCustomer
rejectOrder --> sendRejectionEmailToCustomer

Along with this flowchart, you'll be passed a "context", which contain the steps in the flowchart that was executed so far, along with
their results. Based on the context, you need to return the step that needs to execute next. If you have reached the end of the chart, return 'DONE'.

At the beginning of the execution, the context will contain only the order information, say something like:

OrderNo: 101, Item: "ProductB", customerEmail: "manager@acme.com"

This means you have to return 'checkOrder' as the next step (i.e you move the root node of the flowchart).
After the step checkOrder executes, you'll be passed the following context:

orderNo: 101, Item: "ProductB", customerEmail: "manager@acme.com"
checkOrder --> "ProductB"

Now you can infer from the context that if the result of checkOrder is either "ProductA" or "ProductB", you must move to the step 'acceptOrder'.
So you return 'acceptOrder'. After this, you'll return the updated context as:

OrderNo: 101, Item: "ProductB", customerEmail: "manager@acme.com"
checkOrder --> "ProductB"
acceptOrder --> {orderNo: 101, customerEmail: "manager@acme.com", acceptedOn: "2025-07-01"}

You see that 'acceptOrder' has produced the result '{orderNo: 101, customerEmail: "manager@acme.com", acceptedOn: "2025-07-01"}' - but from the flowchart you know that, whatever the result of 'acceptOrder',
you have to move to the 'sendPaymentLinkToCustomer' step and so you return 'sendPaymentLinkToCustomer'.

The next context you'll see will be:

OrderNo: 101, Item: "ProductB", customerEmail: "manager@acme.com"
checkOrder --> "ProductB"
acceptOrder --> {orderNo: 101, customerEmail: "manager@acme.com", acceptedOn: "2025-07-01"}
sendPaymentLinkToCustomer --> "manager@acme.com"

The 'sendPaymentLinkToCustomer' has returned the customer email. You look at the flowchart and detect that, whatever the return value of
'sendPaymentLinkToCustomer' there is nothing else to do. So you return 'DONE'.

Generally a flowchart has the following two types of entries:
  1. a --> b, meaning after step 'a' do step 'b'.
  2. a --> "x" b - this means if 'a' returns the string "x", then do step 'b'.
The node 'b' can be a simple name of the next step or a complex pattern like: \`{acme.core/createProduct {productNo 19089, name "X200"}}\` or
\`{acme.core/createProduct {productNo 19089, name "X200"}} @as NewProductCreated\`. In all cases, you must return the complete step-specification
when you are required to produce the next step to execute. That is, return the spec -- complete with the enclosing \`{\` and \`}\` and the \`@as <alias>\` specification,
if that's provided.

If you detect that you have reached the end of the chart, return 'DONE'. Otherwise, return only the name of the next step. Never return
any additional description, direction or comments.

Note that a flow-step could be represented as a simple name, like 'checkOrder' or a complex object as in '{sendPaymentLinkToCustomer: {email: acceptOrder.customerEmail}}'.
Always return the full-specification of the flow-step; if it's a name - return the name, if it's an object - return the object.
`;

export const DecisionAgentInstructions = `Analyse a decision table with multiple cases along with the context to return one or more values.
A decision table will be a sequence of case-conditions as in,

case (condition1) {
  value1
}

case (condition2) {
  value2
}

The context will be some additional instructions and JSON-like data based on which you can evaluate the conditions and decide which values to return.
Let's consider an example:


analyseSalesReport --> {"Acme/salesReport": {"employeeId": 101, "employeeGrade": "A", "totalSalesAmount": 14000}}

case (totalSalesAmount > 10000) {
  giveIncrementToEmployee
}

case (totalSalesAmount > 15000) {
  promoteEmployee
}

case (totalSalesAmount < 10000 and employeeGrade == "A") {
  demoteEmployee
}


Given the above context and cases, you must return giveIncrementToEmployee - because the data in the context satisfies only the first case.
If the context is,

analyseSalesReport --> {"Acme/salesReport": {"employeeId": 101, "employeeGrade": "A", "totalSalesAmount": 16000}}

you must return giveIncrementToEmployee,promoteEmployee because the data satisfies the first two cases. You must return only the value of the 
case or cases you selected and no additional text or comments. If you decide to select more than one case, return the values separated by commas.
Also select the case that is the best match for the given context, no need to look for a perfect match for all values specified in the context.
Now apply the same analysis to the following context and cases provided by the user.
`;
export const EvalInstructions = `Consider the following request passed to an intelligent agent and its response. Rate the response on a scale of
1-5, where 1 being the lowest score (response unacceptable) and 5 being the highest score (best response). Also describe why you gave a particular score.
Reply in the JSON format {score: <score-for-the-response, summary: <your-reasons-for-giving-the-score>}`;

export type AgentCondition = {
  if: string;
  then: string;
  internal: boolean;
  ifPattern: IfPattern | undefined;
};

const AgentDirectives = new Map<string, AgentCondition[]>();

export function newAgentDirective(
  cond: string,
  then: string = '',
  internal: boolean = false,
  ifPattern: IfPattern | undefined = undefined
): AgentCondition {
  return { if: cond, then, internal, ifPattern };
}

export function newAgentDirectiveFromIf(ifPattern: IfPattern): AgentCondition {
  return newAgentDirective(ifPattern.toString(), '', false, ifPattern);
}

export function registerAgentDirectives(agentFqName: string, conds: AgentCondition[]) {
  AgentDirectives.set(agentFqName, conds);
}

export function getAgentDirectives(agentFqName: string): AgentCondition[] | undefined {
  return AgentDirectives.get(agentFqName);
}

export function getAgentDirectivesInternal(agentFqName: string): AgentCondition[] | undefined {
  return AgentDirectives.get(agentFqName)?.filter((ac: AgentCondition) => {
    return ac.internal;
  });
}

export function getAgentDirectivesJson(agentFqName: string): string | undefined {
  const conds = getAgentDirectivesInternal(agentFqName);
  if (conds && conds.length > 0) {
    const fmted = conds.map((c: AgentCondition) => {
      if (c.ifPattern) {
        return c.ifPattern.toString();
      } else {
        return { if: c.if, then: c.then };
      }
    });
    return JSON.stringify(fmted);
  }
  return undefined;
}

export function removeAgentDirectives(agentFqName: string) {
  AgentDirectives.delete(agentFqName);
}

export function addAgentDirective(agentFqName: string, newDirective: AgentCondition) {
  const dirs = getAgentDirectives(agentFqName) || new Array<AgentCondition>();
  dirs.push(newDirective);
  registerAgentDirectives(agentFqName, dirs);
}

export type AgentScenario = {
  user: string;
  ai: string;
  internal: boolean;
  ifPattern: IfPattern | undefined;
};

export function newAgentScenario(
  user: string,
  ai: string,
  internal: boolean = false,
  ifPattern: IfPattern | undefined = undefined
): AgentScenario {
  return { user, ai, internal, ifPattern };
}

export function newAgentScenarioFromIf(ifPattern: IfPattern): AgentScenario {
  if (ifPattern.isEmpty()) {
    ifPattern.condition = LiteralPattern.String('');
    return newAgentScenario('', '', false, ifPattern);
  } else {
    const user = trimQuotes(ifPattern.condition.toString());
    const ai = trimQuotes(ifPattern.body[0].toString());
    return newAgentScenario(user, ai, false, ifPattern);
  }
}

const AgentScenarios = new Map<string, AgentScenario[]>();

export function registerAgentScenarios(agentFqName: string, scenarios: AgentScenario[]) {
  AgentScenarios.set(agentFqName, scenarios);
}

export function getAgentScenarios(agentFqName: string): AgentScenario[] | undefined {
  return AgentScenarios.get(agentFqName);
}

export function getAgentScenariosJson(agentFqName: string): string | undefined {
  const scns = getAgentScenariosInternal(agentFqName);
  if (scns && scns.length > 0) {
    const fmtd = scns.map((scn: AgentScenario) => {
      return {
        user: scn.user,
        ai: scn.ai,
      };
    });
    return JSON.stringify(fmtd);
  }
  return undefined;
}

export function getAgentScenariosInternal(agentFqName: string): AgentScenario[] | undefined {
  return AgentScenarios.get(agentFqName)?.filter((asc: AgentScenario) => {
    return asc.internal;
  });
}

export function removeAgentScenarios(agentFqName: string) {
  AgentScenarios.delete(agentFqName);
}

export function addAgentScenario(agentFqName: string, newScn: AgentScenario) {
  const scns = getAgentScenarios(agentFqName) || new Array<AgentScenario>();
  scns.push(newScn);
  registerAgentScenarios(agentFqName, scns);
}

export type AgentGlossaryEntry = {
  name: string;
  meaning: string;
  synonyms: string | undefined;
  internal: boolean;
};

export function newAgentGlossaryEntry(
  name: string,
  meaning: string,
  synonyms: string | undefined,
  internal: boolean = false
): AgentGlossaryEntry {
  return { name, meaning, synonyms, internal };
}

const AgentGlossary = new Map<string, AgentGlossaryEntry[]>();

export function registerAgentGlossary(agentFqName: string, glossary: AgentGlossaryEntry[]) {
  AgentGlossary.set(agentFqName, glossary);
}

export function getAgentGlossary(agentFqName: string): AgentGlossaryEntry[] | undefined {
  return AgentGlossary.get(agentFqName);
}

export function getAgentGlossaryInternal(agentFqName: string): AgentGlossaryEntry[] | undefined {
  return AgentGlossary.get(agentFqName)?.filter((age: AgentGlossaryEntry) => {
    return age.internal;
  });
}

export function getAgentGlossaryJson(agentFqName: string): string | undefined {
  const gls = getAgentGlossaryInternal(agentFqName);
  if (gls && gls.length > 0) {
    const fmtd = gls.map((ge: AgentGlossaryEntry) => {
      return {
        name: ge.name,
        meaning: ge.meaning,
        synonyms: ge.synonyms,
      };
    });
    return JSON.stringify(fmtd);
  }
  return undefined;
}

export function removeAgentGlossary(agentFqName: string) {
  AgentGlossary.delete(agentFqName);
}

export function addAgentGlossaryEntry(agentFqName: string, newEntry: AgentGlossaryEntry) {
  const entries = getAgentGlossary(agentFqName) || new Array<AgentGlossaryEntry>();
  entries.push(newEntry);
  registerAgentGlossary(agentFqName, entries);
}

const AgentResponseSchema = new Map<string, string>();

export function registerAgentResponseSchema(agentFqName: string, responseSchema: string) {
  AgentResponseSchema.set(agentFqName, responseSchema);
}

export function getAgentResponseSchema(agentFqName: string): string | undefined {
  return AgentResponseSchema.get(agentFqName);
}

export function removeAgentResponseSchema(agentFqName: string) {
  AgentResponseSchema.delete(agentFqName);
}

const AgentScratchNames = new Map<string, Set<string>>();

export function registerAgentScratchNames(agentFqName: string, scratch: string[]) {
  AgentScratchNames.set(agentFqName, new Set(scratch));
}

export function getAgentScratchNames(agentFqName: string): Set<string> | undefined {
  return AgentScratchNames.get(agentFqName);
}

export function removeAgentScratchNames(agentFqName: string) {
  AgentScratchNames.delete(agentFqName);
}
