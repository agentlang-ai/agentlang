export const CaptueAppIntentInstructions = `Analyse the product requirement from the user and return the intent, domains and core jobs of the app. For example, if the user request is \\"Generate an app for managing my personal accounts\\", you should return:

appName: Personal Accounts Manager
goals:
    - track accounts and balances
    - record income and expenses
    - understand spending

Format your response using markdown.
`

export const CoreObjectsIdentificationInstructions=`Analyse the domain and objective of an app and identify its core objects. For example, if the app is a 'Personal Accounts Manager' with the objective of tracking and reporting personal income and expenses, you should return the core objects as,

  Account
    name
    type (bank | cash | credit)
    balance

  Transaction
    date
    description
    amount
    account
    category

  Category
    name
`

export const GenerateUISpecInstructions = `Analyse the domain and core objects of an app and return a specification for its UI. For example, if the app is 'Personal Accounts Manager' with the objective of tracking and reporting personal income and expenses and its core objects are identified as

 Account
    name
    type (bank | cash | credit)
    balance

  Transaction
    date
    description
    amount
    account
    category

  Category
    name

then you should return the UI spec as,

nav
  Home
  Accounts
  Transactions
  Reports
  Settings

page Home
  header
    title "Overview"

  section Balances
    list Accounts
      item
        text = account.name
        amount = account.balance format=currency

  section QuickActions
    button "Add Transaction" @click=newTransaction
    button "Add Account" @click=newAccount

  section RecentActivity
    list Transactions limit=5
      item
        text = transaction.description
        amount = transaction.amount
        meta = transaction.date

page Accounts
  header
    title "Accounts"
    button primary "Add Account" @click=newAccount

  list Accounts
    item @click=openAccount(id)
      text = account.name
      tag = account.type
      amount = account.balance format=currency

page AccountDetail
  header
    title = account.name
    amount = account.balance format=currency

  section Transactions
    table Transactions filter=account.id
      column "Date" bind=date
      column "Description" bind=description
      column "Amount" bind=amount format=currency
      row @click=openTransaction(id)

page TransactionForm
  form @submit=saveTransaction
    select Account = transaction.account required
    date Date = transaction.date required
    input Description = transaction.description
    input Amount = transaction.amount type=number required
    select Category = transaction.category
    button primary "Save"

page Reports
  header
    title "Reports"

  section SpendingByCategory
    chart pie
      data = transactions.groupBy(category).sum(amount)

  section MonthlyTrend
    chart line
      x = month(date)
      y = sum(amount)

page Settings
  section Categories
    list Categories
      item
        text = category.name
        action delete @click=deleteCategory(id)

    button "Add Category" @click=newCategory
`

export const GenerateApiSpecInstructions = `Analyse the domain, core objects and the UI spec for an app and return a specification for its backend API. For example, if the app is 'Personal Accounts Manager' for tracking and reporting of personal income and expenses and its core objects are identified as

 Account
    name
    type (bank | cash | credit)
    balance

  Transaction
    date
    description
    amount
    account
    category

  Category
    name

and its UI spec is,

nav
  Home
  Accounts
  Transactions
  Reports
  Settings

page Home
  header
    title "Overview"

  section Balances
    list Accounts
      item
        text = account.name
        amount = account.balance format=currency

  section QuickActions
    button "Add Transaction" @click=newTransaction
    button "Add Account" @click=newAccount

  section RecentActivity
    list Transactions limit=5
      item
        text = transaction.description
        amount = transaction.amount
        meta = transaction.date

page Accounts
  header
    title "Accounts"
    button primary "Add Account" @click=newAccount

  list Accounts
    item @click=openAccount(id)
      text = account.name
      tag = account.type
      amount = account.balance format=currency

page AccountDetail
  header
    title = account.name
    amount = account.balance format=currency

  section Transactions
    table Transactions filter=account.id
      column "Date" bind=date
      column "Description" bind=description
      column "Amount" bind=amount format=currency
      row @click=openTransaction(id)

page TransactionForm
  form @submit=saveTransaction
    select Account = transaction.account required
    date Date = transaction.date required
    input Description = transaction.description
    input Amount = transaction.amount type=number required
    select Category = transaction.category
    button primary "Save"

page Reports
  header
    title "Reports"

  section SpendingByCategory
    chart pie
      data = transactions.groupBy(category).sum(amount)

  section MonthlyTrend
    chart line
      x = month(date)
      y = sum(amount)

page Settings
  section Categories
    list Categories
      item
        text = category.name
        action delete @click=deleteCategory(id)

    button "Add Category" @click=newCategory

then you should return the API spec as,

resource Account
  GET    /accounts
  POST   /accounts
  GET    /accounts/{id}
  PUT    /accounts/{id}
  DELETE /accounts/{id}

resource Transaction
  GET    /transactions
    filter: accountId, categoryId, dateFrom, dateTo
  POST   /transactions
  GET    /transactions/{id}
  PUT    /transactions/{id}
  DELETE /transactions/{id}

resource Category
  GET    /categories
  POST   /categories
  DELETE /categories/{id}

resource Reports
  GET /reports/spending-by-category
    params: from, to
  GET /reports/monthly-trend
    params: from, to
`

export const GenerateDataModelInstructions=`Consider the notation defined below that makes it easy to define business applications as 'models'.
The model captures the core objects of an application's domain as entities. Example of a simple entity that represents an Employee is given below:

\`\`\`
entity Employee {
   employeeId UUID @id @default(uuid()),
   firstName String,
   lastName String,
   salary Number,
   email Email @indexed
}
\`\`\`

It has four attributes: 'employeeId', 'firstName', 'lastName', 'salary' and 'email'. 
The 'employeeId' attribute uniquely identifies an instance of the Employee entity and it's automatically filled-in by the system by calling the "uuid()" function.
Another function that can be used with '@default' is 'now()', which will return the current date-time as a string.

The valid types of attributes are: String, Int, Number, Decimal, Float, Email, Date, Time, DateTime, Boolean, UUID, URL, Password, Map and Any.
You may also declare an array type using the [] suffix, for example: String[]. Note that there's no type named Array.

The various properties that can be attached to an attribute are:

@id -- uniquely identifies an instance of the entity
@default -- the default value an entity can take. examples: @default(true), @default(101)
@optional -- a value for attribute is optional
@unique -- the attribute value must be unique across all instances of the entity
@enum -- the value must belong to a given set
@ref -- a foreign-key reference

An example that demonstrates all these properties in action:

\`\`\`
entity Product {
    productNumber Int @id,
    productName String @unique,
    price Decimal @default(450.0),
    description String @optional,
    dateAddedToInventory DateTime @default(now()) @indexed
}

entity Order {
    orderId Int @id,
    productNumber @ref(Product),
    orderDate DateTime @default(now()),
    orderQty Int @default(1),
    orderType @enum("cash", "credit")
}
\`\`\`

Entities can be connected together in relationships. There are two types of relationships - 'contains' and 'between'.
A 'contains' relationship is for modelling hierarchical data, as in a Library entity containing Books. A 'between' relationship is for graph-like data,
like for connecting two Profiles in a social media app as friends. A 'between' relationship can be one of the following three types - 'one_one' (one-to-one),
'one_many' (one-to-many) and 'many_many' (many-to-many, which is the default).

The following example shows how additional profile data for an employee could be defined as a new entity and attached to the Employee entity as a between-relationship:

\`\`\`
entity Profile {
    id UUID @id @default(uuid()),
    address String @optional,
    photo URL @optional,
    dateOfBirth DateTime @optional
}

relationship EmployeeProfile between (Employee, Profile) @one_one
\`\`\`

The '@one_one' annotation means exactly one Employee and Profile can be related to each other via 'EmployeeProfile'.

As an example of 'contains' relationships, consider modelling task-assignments for an Employee as follows:

\`\`\`
entity TaskAssignment {
    id UUID @id @default(uuid()),
    description String,
    assignmentDate DateTime @default(now())
}

relationship EmployeeTaskAssignment contains (Employee, TaskAssignment)
\`\`\`
`

export const GenerateWorklowInstructions = `Carefully analyse the following data-model specification expressed as entities and their relationships. A REST API speicification for the same data-model is given after that. You have to generate 'workflows' in a javascript-like syntax to encode the logic for the APIs. The 'arguments' required to run the workflows has to be declared as an 'event' structure. You don't have to generate workflows for GET, POST, PUT or DELETE of entities (either directly or via relationships) because those workflows will be automatically generated.

The example data-model follows:

entity Employee {
  id Int @id,
  name String,
  salary Decimal
}

entity Task {
  id Int @id,
  description String
}

relationship EmployeeTask between(Employee, Task)

The API spec may look like:

GET /employee/<id>
GET /employees
POST /employee
DELETE /employee/<id>
POST /employeeTask/<id>
GET /employeeTasks/<id>
GET /countTasksForEmployee/<id>
GET /totalNumberOfEmployees/<id>

and so on...

You don't have to generate workflows for any of the normal CRUD operations. That means, you only have to generate workflows for 'countTasksForEmployee' and
'totalNumberOfEmployees'.

The workflows you need to generate will be:

@public event countTasksForEmployee {
    employeeId Int
}

workflow countTasksForEmployee {
    {Task? {},
     EmployeeTask {Employee {id? countTasks.employeeId}},
     @into{n @count(Task.id)}}
}

@public event countEmployees {}

workflow countEmployees {
    {Employee? {},
     @into{n @count(Employee.id)}}
}

An event is made up of attributes that specify the input for the corresponding workflow. For example, the 'countTasksForEmployee' event has a single attribute named 'employeeId' of type Int. The valid types of attributes are: String, Int, Number, Decimal, Float, Email, Date, Time, DateTime, Boolean, UUID, URL, Password, Map and Any. You may also declare an array type using the [] suffix, for example: String[]. Note that there's no type named Array.

A workflow is made up of 'patterns'. A simple pattern to query an employee (or any entity) by the 'name' attribute (or any attribute) is:

{Employee {name? "Jose"}}

By default the query uses the equals (=) operator. You may use any operator from the following set as required:

= - equals
<> or != - not-equals
< - less-than
<= - less-than-or-equals
> - greater-than
>= - greater-than-or-equals
in - set-membership check
like - string pattern check
between - range check

For example, the following pattern will return all employees with id greater than 10:

{Employee {id?> 10}}

and the following will return all employees whose id is between 10 and 20:

{Employee {id?between [10, 20]}}

The following query will return all employees whose name starts with 'Mat':

{Employee {name?like "Mat%"}}

If you precede a query with the 'delete' keyword, all instances that resulted from that query will be deleted.
For example, to delete the employee with id 101, you can say:

delete {Employee {id? 101}}

The pattern to create a new instance of an entity is:

{Employee {id 101, name "Jake J", salary 5000}}

To ignore the create operation if the employee already exists:

{Employee {id 101, name "Jake J", salary 5000}, @upsert}

The following pattern will update the name of an existing employee:

{Employee {id? 101, name "Jake G"}}

The result of any pattern can be bound to an alias, as in:

{Employee? {}} @as all_employees

Here 'all_employees' is an alias bound to the result of the query pattern (which fetches all employees, by the way).

IMPORTANT: It's invalid to use an alias in a CRUD pattern. For example, the following pattern will generate an error: '{all_employees @count(all_employees)}'. Also it's invalid to specify an aggregate function like @count outside of a query pattern.
IMPORTANT: It's invalid to mix the query-all syntax with attribute-based queries. For instance, this pattern will raise an error: '{Employee? {id? 101}}'.

There's a pattern that lets you iterate over the result:

for emp in all_employees {
    {countTasksForEmployee {employeeId emp.id}}
}

The result 'for' itself will be an array of all the results of the 'countTasksForEmployee' workflow.

Note the proper way to bind an alias to the result of 'for':

for emp in all_employees {
    {countTasksForEmployee {employeeId emp.id}}
} @as result

There's also an 'if' pattern that can be used to evaluate conditions:

@public event incrementSalary {
 employeeId Int
}

workflow incrementSalary {
    // lookup the employee by id
    {Employee {id? incrementSalary.employeeId}} @as [emp];

    // decide incrementPercentage based on the current salary
    if (emp.salary >= 1000) { .1 }
    else if (emp.salary >= 5000) { .2 }
    else { .5 }
    @as incrementPercentage;

    // update the employee's salary
    {Employee {id? incrementSalary.employeeId, salary emp.salary + emp.salary * incrementPercentage}}
}

Note the proper way to bind an alias to the final result of 'if':

if (a < b) {
   1
} else if (a > b) {
   2
} else {
   3
} @as n

when the 'if' condition is evaluated the alias 'n' will be bound to either 1, 2 or 3.

The comparison operators you can use in 'if' conditions are: '==', '!=', '<', '<=', '>' and '>='. The logical operators are 'and' and 'or'.
IMPORTANT: The C-like logical operators '&&' and '||' are INVALID. Instead you must use 'and' and 'or'.

Also notice the way the 'emp' alias is defined in the workflow 'incrementSalary'. It uses the destructuring notation to bind to the first element of the result.
Hers's another example of destructuring where the first two instances are extracted and returned:

workflow FindFirstTwoEmployees {
    {Employee {salary?> 1000}} @as [emp1, emp2];
    [emp1, emp2]
}

The pattern shown below will bind the first two instances to 'emp1' and 'emp2' and the rest of the instances to an array named 'emps':

{Employee {id?> 1}} @as [emp1, emp2, _, emps]

As you might've already noted, entities in a data-model could be connected together in relationships. There are two types of relationships - 'contains' and 'between'.
A 'contains' relationship is for hierarchical data, as in a Library entity containing Books. A 'between' relationship is for graph-like data,
like two Profiles in a social media app connected as friends. A 'between' relationship can be one of the following three types - 'one_one' (one-to-one),
'one_many' (one-to-many) and 'many_many' (many-to-many, which is the default).

The following example shows how additional profile data for an employee could be defined as a new entity and attached to the Employee entity as a between-relationship:

entity Profile {
    id UUID @id @default(uuid()),
    address String @optional,
    photo URL @optional,
    dateOfBirth DateTime @optional
}

relationship EmployeeProfile between (Employee, Profile) @one_one

The '@one_one' annotation means exactly one Employee and Profile can be related to each other via 'EmployeeProfile'.

Sometimes you may have to generate patterns that create or query entity instances via relationships. Here's an example workflow that creates an Employee with his/her Profile attached:

@public event createEmployee {
   id Int,
   name String,
   salary Decimal,
   address String @optional,
   photo String @optional,
   dateOfBirth DateTime @optional
}

workflow createEmployee {
    {Employee {id createEmployee.id,
               name createEmployee.name,
               salary createEmployee.salary},
     EmployeeProfile {Profile {address createEmployee.address,
                               photo createEmployee.photo,
                               dateOfBirth createEmployee.dateOfBirth}}}
}

Note that the event generated has marked address, photo and dateOfBirth with the @optional property, taking a cue from the corresponding entity declaration. Entity attributes may have other properties (like @indexed, @id etc), you can ignore all those. @optional is the only entity-level property that you may consider while generating events.
 
The following pattern can be used to query an Employee along with his Profile:

{Employee {id? 123},
 EmployeeProfile {Profile? {}}}

As an example of 'contains' relationships, consider modelling the relationship between a department and an employee:

entity Department {
    id UUID @id @default(uuid()),
    name String @unique
}

relationship DepartmentAssignment contains (Department, Employee)

The following example workflow shows how to assign a new Employee to a Department:

@public event addNewEmloyeeToDepartment {
    departmentId UUID,
    employeeId Int,
    employeeName String,
    employeeSalary Decimal,
    employeeAddress String,
    employeePhoto String,
    employeeDateOfBirth DateTime
}

workflow addNewEmloyeeToDepartment {
 {Department {id? addNewEmloyeeToDepartment.departmentId}
  DepartmentAssignment {Employee {id addNewEmloyeeToDepartment.employeeId,
                                  name addNewEmloyeeToDepartment.employeeName,
                                  salary addNewEmloyeeToDepartment.employeeSalary},
                        EmployeeProfile {Profile {address addNewEmloyeeToDepartment.employeeAddress,
                                                  photo addNewEmloyeeToDepartment.employeePhoto,
                                                  dateOfBirth addNewEmloyeeToDepartment.employeeDateOfBirth}}}}
}

The following workflow queries Department along with all its employees:

@public event getAllEmployeesInDepartment {
    departmentId UUID
}

workflow getAllEmployeesInDepartment {
    {Department {id? getAllEmployeesInDepartment.departmentId},
     DepartmentAssignment {Employee? {}}}
}

You can create a Javascript-like map to return arbitray structured results from a workflow. For example, the following workflow shows how to return specific values extracted from an Employee and an associated Profile:

@public event FindEmployeeProfileDetails {
    employeeId Int
}

workflow FindEmployeeProfileDetails {
    {Employee {id? FindEmployeeProfileDetails.employeeId},
     EmployeeProfile {Profile? {}}} @as [emp];

    // As the related instances is returned as an array,
    // use destructuring to extract the first profile instance.
    emp.EmployeeProfile @as [profile];

    {"name": emp.firstName + " " + emp.lastName,
     "email": emp.email,
     "salary": emp.salary,
     "address": profile.address,
     "DOB": profile.dateOfBirth}
}

IMPORTANT: The keys in a map MUST BE string-literals. The values can be any CRUD patterns, references (e.g 'emp.email'), numeric, string, boolean (true, false) or array literals (of the form [value1, value2, ...].

Complex workflows that perform SQL-like joins can be generated. The following is a motivating example that you can learn from:

entity SalesFact {
  id UUID @id @default(uuid()),
  sale_id Int @indexed,
  date_id Int,
  product_id Int,
  region_id Int,
  revenue Decimal,
  quantity Int
}

entity DateDim {
  id UUID @id @default(uuid()),
  date_id Int,
  year Int,
  quarter Int,
  month Int
}

entity ProductDim {
  id UUID @id @default(uuid()),
  product_id Int,
  category String,
  product String
}

entity RegionDim {
  id UUID @id @default(uuid()),
  region_id Int,
  country String,
  state String,
  city String
}

// Total Revenue by Year
// SELECT d.year, SUM(f.revenue) AS total_revenue
// FROM sales_fact f
// JOIN date_dim d ON f.date_id = d.date_id
// GROUP BY d.year
// ORDER BY d.year
workflow totalRevenueByYear {
{SalesFact? {},
 @join DateDim {date_id? SalesFact.date_id},
 @into {year DateDim.year, total_revenue @sum(SalesFact.revenue)},
 @groupBy(DateDim.year),
 @orderBy(DateDim.year)}}

// Drill down - revenue by year, quarter and month.
// SELECT d.year, d.quarter, d.month, SUM(f.revenue) AS total_revenue
// FROM sales_fact f
// JOIN date_dim d ON f.date_id = d.date_id
// GROUP BY d.year, d.quarter, d.month
// ORDER BY d.year, d.quarter, d.month
workflow revenueByYearQuarterMonth {
 {SalesFact? {},
  @join DateDim {date_id? SalesFact.date_id},
  @into {year DateDim.year, quarter DateDim.quarter, month DateDim.month, total_revenue @sum(SalesFact.revenue)},
  @groupBy(DateDim.year, DateDim.quarter, DateDim.month),
  @orderBy(DateDim.year, DateDim.quarter, DateDim.month)}}

// Slice - revenue for a Single Year (e.g., 2024)
// SELECT p.category, SUM(f.revenue) AS revenue
// FROM sales_fact f
// JOIN product_dim p ON f.product_id = p.product_id
// JOIN date_dim d ON f.date_id = d.date_id
// WHERE d.year = 2024
// GROUP BY p.category
workflow revenueForYear {
 {SalesFact? {},
  @join ProductDim {product_id? SalesFact.product_id},
  @join DateDim {date_id? SalesFact.date_id},
  @into {category ProductDim.category, revenue @sum(SalesFact.revenue)},
  @where {DateDim.year? revenueForYear.year},
  @groupBy(ProductDim.category)}}

// Dice - revenue for a particular category (e.g 'Electronics') in a country during a year.
// SELECT r.state, SUM(f.revenue) AS revenue
// FROM sales_fact f
// JOIN product_dim p ON f.product_id = p.product_id
// JOIN region_dim r ON f.region_id = r.region_id
// JOIN date_dim d ON f.date_id = d.date_id
// WHERE d.year = 2024 AND p.category = 'Electronics' AND r.country = 'India'
workflow categoryRevenueForYear {
 {SalesFact? {},
  @join ProductDim {product_id? SalesFact.product_id},
  @join RegionDim {region_id? SalesFact.region_id},
  @join DateDim {date_id? SalesFact.date_id},
  @into {state RegionDim.state, revenue @sum(SalesFact.revenue)},
  @where {ProductDim.category categoryRevenueForYear.category,
          RegionDim.country categoryRevenueForYear.country,
          DateDim.year? categoryRevenueForYear.year},
  @groupBy(RegionDim.state, SalesFact.revenue),
  @orderBy(revenue)}}

The keywords @join, @into, @where, @groupBy and @orderBy has to be given (if specified) in the exact order shown in the examples above.
You may also do @inner_join, @left_join, @right_join and @full_join instead of @join (as required).

IMPORTANT: The only argument-format supported for all joins is - {<attribute>?<optional-comparison-operator> <reftable.attribute>}. No additional comparisons (comma-separated) are allowed. That means - the following pattern will result in an error: {SalesFact? {}, @join ProductDim {product_id? SalesFact.product_id, category "A-91"}}. Instead you must pass only a single argument to the join, as in: {SalesFact? {}, @join ProductDim {product_id? SalesFact.product_id}}
`

export const GenerateAgentsInstructions = `Your job is to generate specifications for AI agents that interact with a data-model. For example, consider the data-model and associated workflows given below:

entity Employee {
  id Int @id,
  name String,
  salary Decimal
}

entity Task {
  id Int @id,
  description String
}

relationship EmployeeTask between(Employee, Task)

@public event countTasksForEmployee {
    employeeId Int
}

workflow countTasksForEmployee {
    {Task? {},
     EmployeeTask {Employee {id? countTasks.employeeId}},
     @into{n @count(Task.id)}}
}

@public event countEmployees {}

workflow countEmployees {
    {Employee? {},
     @into{n @count(Employee.id)}}
}

You may decide to generate the following agent specifications based on the above:

agent EmployeeAgent {
    role "You are an automated-agent who traslates and executes textual instructions pertaining to employee data",
    instruction "Take appropriate actions on employee-related data based on user instructions.",
    tools [Employee, Task, EmployeeTask, countTasksForEmployee, countEmployees]
}
`
export const AssembleAppInstructions = `Assemble the given data-model and workflows into a final application module. A sample module is given below:

module Blog.Core

entity Profile {
    id UUID @id @default(uuid()),
    address String @optional,
    email Email,
    photo URL @optional,
    DOB DateTime @optional
}

entity User {
    id UUID @id @default(uuid()),
    name String @indexed
}

relationship UserProfile between (Blog.Core/User, Blog.Core/Profile) @one_one

@public event CreateUser extends Profile {
    name String
}

workflow CreateUser {
    {User {name CreateUser.name},
     UserProfile {Profile {email CreateUser.email}},
     UserPost {Post {title "hello, world"}}}
}

agent UserAgent {
    role "You are an automated-agent who translates and executes textual instructions pertaining to user data",
    instruction "Take appropriate actions on user-related data based on client instructions.",
    tools [Profile, User, CreateUser]
}
`
