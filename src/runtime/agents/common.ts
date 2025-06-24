export const PlannerInstructions = `The model of a business application consists of entity definitions and workflows defined in "modules". 
A module will be encoded in a syntax inspired by JavaScript and JSON. Example of a simple module definition is,

module Erp

entity Employee {
   employeeId UUID @id @default(uuid()),
   firstName String,
   lastName String,
   salary Number,
   email Email @indexed
}

The Empoyee entity is part of the "Erp" module and it has four attributes: employeeId, firstName, lastName, salary and email. The employeeId uniquely identifies an
Employee and it's automatically filled-in by the system by calling the "uuid()" function. (In the place of the keyword 'entity', the keyword 'record' may also be used.
The difference between an entity and a record is that, instances of an entity is persisted to the database, instances of records are not).
Workflows contains JSON "patterns" that perform CRUD operations on entities. For example, here's is a workflow that creates a new instance of the Employee entity:

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

This means a workflow can be invoked from another workflow, simply by adding the event-creation as a pattern.

Other than the create-pattern for entities and events, some of the most useful patterns (related to entities) that can appear in a workflow are:
1. Query - e.g: {Erp/Employee {employeeId? "56392e13-0d9a-42f7-b556-0d7cd9468a24"}}. The attributes by which the query happens must end with a '?' character.
   To lookup all instances of an entity, use the syntax: {EntityName?: {}}.
2. Update - e.g: {Erp/Employee {employeeId? "56392e13-0d9a-42f7-b556-0d7cd9468a24", firstName "Joe"}}. This pattern updates the firstName of the employee
   with the given employeeId.
3. Upsert - e.g: upsert {Erp/Employee {employeeId "56392e13-0d9a-42f7-b556-0d7cd9468a24", firstName "Joe"}}. The 'upsert' pattern will create a new
   instance, if the instance does not already exist.
4. Delete - e.g: delete {Erp/Employee {employeeId? "56392e13-0d9a-42f7-b556-0d7cd9468a24"}}

The default query operator is '=' (equals). So an expression like 'employeeId? "56392e13-0d9a-42f7-b556-0d7cd9468a24"' means,
'where employeeId equals "56392e13-0d9a-42f7-b556-0d7cd9468a24"'. Other comparison operators has to be specified explicitly, as in
'{age?< 50}' - which means 'where age less-than 50'. The comparison operators supported by a query pattern are:

=         - equals
<>        - not-equals
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

A successful query pattern will return an array of instances. The 'for' pattern can be used to iterate over an array. An example follows:

workflow NotifyEmployees {
    {Erp/Employee {salary?> 1000}} as employees;
    for emp in employees {
        {Erp/SendMail {email emp.email, body "You are selected for an increment!"}}
    }
}

Also note the use of the 'as' keyword - this binds the result of a pattern to an 'alias'. Here the result of the query is bound to the
alias named 'employees'. Any pattern can have an alias, including 'if' and 'for'. An alias can be used to refer to the attributes of the instance, 
via the dot(.) notation. Aliases can also be used to destructure a query result - here's an example:

workflow FindFirstTwoEmployees {
    {Erp/Employee {salary?> 1000}} as [emp1, emp2];
    [emp1, emp2]
}

This alias will bind the first two instances to 'a' and 'b' and the rest of the instances to an array named 'xs':

{SomeEntity {id?> 1}} as [a, b, _, xs]

Examples of binding aliases to 'if' and 'for':

if (IncrementSalary.percentage > 10) {
    {Erp/Employee {employeeId IncrementSalary.employeeId, salary salary + salary * IncrementSalary.percentage}}
} else {
    {Erp/Employee {employeeId IncrementSalary.employeeId, salary salary + 1500}}
} as emp

for emp in employees {
    {Erp/SendMail {email emp.email, body "You are selected for an increment!"}}
} as emails

Now consider the following module definition and generate appropriate patterns in response to the user instructions.
`;
