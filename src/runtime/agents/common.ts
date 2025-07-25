export const PlannerInstructions = `Agentlang is a very-high-level declarative language that makes it easy to define business applications as 'models'.
The model of a business application consists of entity definitions and workflows defined in "modules". 
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

This is an example of a record:

record EmailMessage {
    to Email,
    from Email,
    subject String,
    body String
}

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
1. Query - e.g: '{Erp/Employee {employeeId? "56392e13-0d9a-42f7-b556-0d7cd9468a24"}}'. The attributes by which the query happens must end with a '?' character.
   To lookup all instances of an entity, use the syntax: '{EntityName?: {}}'.
2. Update - e.g: '{Erp/Employee {employeeId? "56392e13-0d9a-42f7-b556-0d7cd9468a24", firstName "Joe"}}'. This pattern updates the firstName of the employee
   with the given employeeId.
3. Upsert - e.g: '{Erp/Employee {employeeId "56392e13-0d9a-42f7-b556-0d7cd9468a24", firstName "Joe"}, @upsert}'. The 'upsert' pattern will create a new
   instance, if the instance does not already exist.
4. Delete - e.g: delete '{Erp/Employee {employeeId? "56392e13-0d9a-42f7-b556-0d7cd9468a24"}}'

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

Make sure all references based on a preceding pattern is based either on an actual alias or the name of the workflow. For example, the following sequence of patterns
are invalid, because the alias 'employee' is not defined:

{Employee {id? 101}};
{SendEmail {to employee.email, body "hello"}}

A fix for the reference-error is shown below:

{Employee {id? 101}} as employee;
{SendEmail {to employee.email, body "hello"}}

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
    {employee {id? 101}} as emp;
    {email {to emp.email body "please call me as soon as possible"}}
}

because all the information needed is available in the context. If the instruction is "create a workflow to send an email by employee-id with this message - 
'please call me as soon as possible'", then you can return:

workflow sendEmail {
    {employee {id? sendEmail.employeeId}} as emp;
    {email {to emp.email body "please call me as soon as possible"}}
}

The point is use the immediate context to fill-in values in generated patterns, as much as possible.

Also generate a workflow only if required explicitly by the user or the contextual information is incomplete. Otherwise, just return an array of patterns.
As an example, if the user request is "send an email to employee 101 with this message - 'please call me as soon as possible'", you must return:

[{employee {id? 101}} as emp;
 {email {to emp.email, body "please call me as soon as possible"}}]

Note that each pattern in the array is separated by a ; and not a comma(,).

Now consider the following module definition and generate appropriate patterns in response to the user instructions. You must return only valid patterns or workflows,
no other descriptive text or comments are needed.
`;
