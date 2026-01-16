import { IfPattern, LiteralPattern } from '../../language/syntax.js';
import { trimQuotes } from '../util.js';

export const PlannerInstructions = `Agentlang is a very-high-level declarative language that makes it easy to define business applications as 'models'.
The model of a business application consists of entity definitions and workflows defined in "modules". A module is encoded in a syntax inspired by JavaScript and JSON. Example of a simple module follows:

\`\`\`agentlang
module erp

entity Employee {
   employeeId UUID @id @default(uuid()),
   firstName String,
   lastName String,
   salary Number,
   email Email @indexed
}
\`\`\`

The Employee entity is part of the "erp" module and it has four attributes: 'employeeId', 'firstName', 'lastName', 'salary' and 'email'.
The 'employeeId' attribute uniquely identifies an instance of the Employee entity and it's automatically filled-in by the system by calling the "uuid()" function.
Instead of the keyword 'entity', the keyword 'record' may also be used. The difference between an entity and a record is that -- instances of an entity is persisted to the database, instances of records are not.

This is an example of a record:

\`\`\`agentlang
record EmailMessage {
    to Email,
    from Email,
    subject String,
    body String
}
\`\`\`

Another major construct in Agentlang is the 'workflow'. Workflows contain "patterns" expressed in JSON format that encode CRUD operations on entities.
For example, here's is a workflow that creates a new instance of the Employee entity:

\`\`\`agentlang
{
  "workflow": {
    "event": "erp/createEmployee",
    "patterns": [
      {
        "create": "erp/Employee",
        "with": {
          "firstName": {
            "ref": "erp/createEmployee.firstName"
          },
          "lastName": {
            "ref": "erp/createEmployee.lastName"
          },
          "salary": {
            "ref": "erp/createEmployee.salary"
          },
          "email": {
            "ref": "erp/createEmployee.email"
          }
        }
      }
    ]
  }
}
\`\`\`

The attribute-values of the new Employee are derived from the "event" that triggers the workflow. In this example the event is called "createEmployee".
An event need not have an explicit schema, because its attributes can always be inferred from the workflow definition. But a model may also contain
explicit definitions of events, as follows,

\`\`\`agentlang
event createEmployee {
   firstName String,
   lastName String,
   salary Number,
   email Email
}
\`\`\`

A workflow attached to an event is invoked by creating an instance of the event, as shown in the following pattern:

\`\`\`json
{
  "create": "erp/createEmployee",
  "with": {
    "firstName": {
      "val": "Sam"
    },
    "lastName": {
      "val": "K"
    },
    "salary": {
      "val": 1400
    },
    "email": {
      "val": "samk@acme.com"
    }
  }
}
\`\`\`

This means a workflow can be invoked from another workflow, simply by having the event-creation pattern.

As you might have noticed, a CRUD JSON pattern can have two types of attribute values - references (denoted by 'ref') and literal values (denoted by 'val').
References makes sense only within a workflow, where you want to refer to the attributes of the workflow-event or some other instance available within
the workflow's context. When a standalone pattern needs to be generated, always provide attribute values as literal, i.e a string, number or boolean value
attached to the 'val' keyword in an object. Another option is the "expr" attribute, where a string that contains an arithmetic or logical expresion is
specified as the value for the attribute.

A pattern that can be used to query all instances of an entity is shown below:

\`\`\`json
{
  "query": "erp/Employee"
}
\`\`\`

Instances may be queried by conditions applied to attributes, some examples are:

\`\`\`json
{
  "query": "erp/Employee",
  "where": {
    "email": {
      "=": {"val": "samk@acme.com"}
    }
  }
}

{
  "query": "erp/Employee",
  "where": {
    "salary": {
      ">": {"val": 5000}
    }
  }
}
\`\`\

To select an employee with a given email AND salary:

\`\`\`json
{
  "query": "erp/Employee",
  "where": {
    "and": {
      "email": {
        "=": {"val": "samk@acme.com"}
      },
      "salary": {
        "=": {"val": 7800}
      }
    }
  }
}
\`\`\`

Similarly, you may also use the OR logical operator:

\`\`\`json
{
  "query": "erp/Employee",
  "where": {
    "or": {
      "email": {
        "=": {"val": "joej@acme.com"}
      }
    }
  }
}
\`\`\`

The following pattern shows how to update instances based on a condition:

\`\`\`json
{
  "update": "erp/Employee",
  "set": {
    "salary": {
      "expr": "salary + salary * 0.5"
    }
  },
  "where": {
    "email": {
      "=": {"val": "samk@acme.com"}
    }
  }
}
\`\`\`

Deleting an instance:

\`\`\`json
{
  "delete": "erp/Employee",
  "where": {
    "email": {
      "=": {"val": "samk@acme.com"}
    }
  }
}
\`\`\`

The default query operator is equals ('='). Other comparison operators supported by a query pattern are:

!=        - not-equals
<         - less-than
<=        - less-than or equals
>         - greater-than
>=        - greater-than or equals
in        - membership check (argument must be an array)
like      - search for a specified pattern in a attributes's text data
between   - between given values (argument must be an array)

Simple aggregate functions can be specified in queries, some examples are:

\`\`\`json
{
  "count": "erp/Employee",
  "where": {
    "salary": {
      "<=": {"val": 2000}
    },
  "into": "employeeCount"
  }
}
\`\`\`

The supported aggregate functions are: 'count', 'max', 'min', 'sum' and 'avg'.

Aggregate usage rule: Use count, sum, avg, min, max only when the user explicitly asks for totals, statistics, or summaries. Do not introduce aggregates implicitly.
Aggregate query results MUST be bound using 'as' (described later) or 'into'.

Entities in a module can be connected together in relationships. There are two types of relationships - 'contains' and 'between'.
'contains' relationship is for hierarchical data, as in a 'Library' entity containing 'Books'. 'between' relationship is for graph-like data,
like two 'Profiles' in a social media app is connected as friends. A 'between' relationship can be one of the following three types - 'one_one' (one-to-one),
'one_many' (one-to-many) and 'many_many' (many-to-many). 'many_many' is the default.

The following example shows how additional profile data for an employee could be defined as a new entity and attached to the 'Employee' entity as a between-relationship:

\`\`\`agentlang
entity Profile {
    id UUID @id @default(uuid()),
    address String @optional,
    photo URL @optional,
    dateOfBirth DateTime @optional
}

relationship EmployeeProfile between (erp/Employee, erp/Profile) @one_one
\`\`\`

The '@one_one' annotation means exactly one 'Employee' and 'Profile' can be related to each other via 'EmployeeProfile'.

Here's the 'createEmployee' workflow updated to create the 'Employee' with the his/her 'Profile' attached:

\`\`\`json
{
  "workflow": {
    "event": "erp/createEmployee",
    "patterns": [
      {
        "create": "erp/Employee",
        "with": {
          "firstName": {
            "ref": "erp/createEmployee.firstName"
          },
          "lastName": {
            "ref": "erp/createEmployee.lastName"
          },
          "salary": {
            "ref": "erp/createEmployee.salary"
          },
          "email": {
            "ref": "erp/createEmployee.email"
          }
        },
        "links": [
          {
            "relationship": "erp/EmployeeProfile",
            "create": "erp/Profile",
            "with": {
              "address": {
                "ref": "erp/createEmployee.address"
              },
              "photo": {
                "ref": "erp/createEmployee.photo"
              },
              "dateOfBirth": {
                "ref": "erp/createEmployee.dateOfBirth"
              }
            }
          }
        ]
      }
    ]
  }
}
\`\`\`

Pattern to link a new 'Employee' with an existing 'Profile':

\`\`\`json
{
  "create": "erp/Employee",
  "with": {
    "firstName": {
      "val": "Joe"
    },
    "lastName": {
      "val": "J"
    },
    "salary": {
      "val": 4500
    },
    "email": {
      "val": "jj@acme.com"
    }
  },
  "links": [
    {
      "relationship": "erp/EmployeeProfile",
      "query": "erp/Profile",
      "where": {
        "id": {
          "=": {
            "val": "0b60310b-750e-4df2-9612-fa9704345eff"
          }
        }
      }
    }
  ]
}
\`\`\`

To connect an existing instance of 'Employee' with an existing instance of 'Profile':

\`\`\`json
{
  "create": "erp/EmployeeProfile",
  "with": {
    "Employee": {
      "val": "56392e13-0d9a-42f7-b556-0d7cd9468a24"
    },
    "Profile": {
      "val": "0b60310b-750e-4df2-9612-fa9704345eff"
    }
  }
}
\`\`\`

The following pattern can be used to query an 'Employee' along with his 'Profile':

\`\`\`json
{
  "query": "erp/Employee",
  "where": {
    "employeeId": {
      "=": {
        "val": "56392e13-0d9a-42f7-b556-0d7cd9468a24"
      }
    }
  },
  "links": [
    {
      "relationship": "erp/EmployeeProfile",
      "query": "erp/Profile"
    }
  ]
}
\`\`\`

As an example of 'contains' relationships, consider modelling task-assignments for an 'Employee' as folllows:

\`\`\`agentlang
entity TaskAssignment {
    id UUID @id @default(uuid()),
    description String,
    assignmentDate DateTime @default(now())
}

relationship EmployeeTaskAssignment contains (erp/Employee, erp/TaskAssignment)
\`\`\`

The following workflow shows how to assign a new task to an Employee:

\`\`\`json
{
  "workflow": {
    "event": "erp/assignNewTask",
    "patterns": [
      {
        "query": "erp/Employee",
        "where": {
          "employeeId": {
            "=": {
              "ref": "erp/assignNewTask.employeeId"
            }
          }
        },
        "links": [
          {
            "relationship": "erp/EmployeeTaskAssignment",
            "create": "erp/TaskAssignment",
            "with": {
              "description": {
                "ref": "erp/assignNewTask.description"
              }
            }
          }
        ]
      }
    ]
  }
}
\`\`\`

The following workflow queries an Employee along with all his tasks:

\`\`\`json
{
  "workflow": {
    "event": "erp/getEmployeeTaskAssignments",
    "patterns": [
      {
        "query": "erp/Employee",
        "where": {
          "employeeId": {
            "=": {
              "ref": "erp/getEmployeeTaskAssignments.employeeId"
            }
          }
        },
        "links": [
          {
            "relationship": "erp/EmployeeTaskAssignment",
            "query": "erp/TaskAssignment"
          }
        ]
      }
    ]
  }
}
\`\`\`

This patterns returns the number of tasks under an 'Employee'. The result of the query will be returned in the temporary column named 'taskCount':

\`\`\`json
{
  "query": "erp/Employee",
  "where": {
    "employeeId": {
      "=": {
        "val": "56392e13-0d9a-42f7-b556-0d7cd9468a24"
      }
    }
  },
  "links": [
    {
      "relationship": "erp/EmployeeTaskAssignment",
      "count": "erp/TaskAssignment",
      "into": "taskCount"
    }
  ]
}
\`\`\`

In addition to the basic CRUD patterns, you can execute conditional-logic with the help of the 'if' pattern. An example follows,

\`\`\`json
{
  "workflow": {
    "event": "erp/incrementSalary",
    "patterns": [
      {
        "if": {
          "condition": {
            ">": [
              {
                "ref": "erp/incrementSalary.percentage"
              },
              {
                "val": 10
              }
            ]
          },
          "then": [
            {
              "update": "erp/Employee",
              "set": {
                "salary": {
                  "expr": "salary + salary * erp/incrementSalary.percentage"
                }
              },
              "where": {
                "employeeId": {
                  "=": "erp/incrementSalary.employeeId"
                }
              }
            }
          ],
          "else": [
            {
              "update": "erp/Employee",
              "set": {
                "salary": {
                  "expr": "salary + 1500"
                }
              },
              "where": {
                "employeeId": {
                  "=": "erp/incrementSalary.employeeId"
                }
              }
            }
          ]
        }
      }
    ]
  }
}
\`\`\`

Note the value passed to the 'salary' attribute - it's an arithmetic expression. All normal arithmetic expressions are supported by workflow patterns.

Another example of the 'if' pattern:

\`\`\`json
{
  "workflow": {
    "event": "mvd/validateLicense",
    "patterns": [
      {
        "create": "mvd/checkLicenseNumber",
        "with": {
          "number": {
            "ref": "mvd/validateLicense.number"
          }
        },
        "as": "response"
      },
      {
        "if": {
          "condition": {
            "=": [
              {
                "ref": "response"
              },
              {
                "val": "ok"
              }
            ]
          },
          "then": [
            {
              "val": "active"
            }
          ],
          "else": [
            {
              "val": "canceled"
            }
          ],
          "as": "newStatus"
        }
      },
      {
        "update": "mvd/license",
        "set": {
          "status": {
            "ref": "newStatus"
          }
        },
        "where": {
          "number": {
            "=": {
              "ref": "mvd/validateLicense.number"
            }
          }
        }
      }
    ]
  }
}
\`\`\`

Note the use of the 'as' keyword - this binds the result of a pattern to an 'alias', which is the same as a variable in other programming languages.

A successful query pattern will return an array of instances. The 'for' pattern can be used to iterate over an array. An example follows:

\`\`\`json
{
  "workflow": {
    "event": "erp/notifyEmployees",
    "patterns": [
      {
        "query": "erp/Employee",
        "where": {
          "salary": {
            ">": {
              "val": 1000
            }
          }
        },
        "as": "employees"
      },
      {
        "for": {
          "each": {
            "ref": "employees"
          },
          "as": "emp"
        },
        "do": [
          {
            "create": "erp/sendMail",
            "with": {
              "email": {
                "ref": "emp.email"
              },
              "body": {
                "val": "You are selected for an increment!"
              }
            }
          }
        ]
      }
    ]
  }
}
\`\`\`

Here the result of the query is bound to the alias named 'employees'. Any pattern can have an alias, including 'if' and 'for'. An alias can be used to refer to the attributes of the instance,
via the dot(.) notation. Aliases can also be used to destructure a query result - here's an example:

\`\`\`json
{
  "query": "erp/Employee",
  "where": {
    "salary": {
      ">": {
        "val": 1000
      }
    }
  },
  "as": [
    "emp1",
    "emp2"
  ]
}
\`\`\`

This alias will bind the first two instances to 'a' and 'b' and the rest of the instances to an array named 'xs':

\`\`\`json
{
  "query": "someModule/someEntity",
  "where": {
    "someIntAttribute": {
      ">": {
        "val": 1
      }
    }
  },
  "as": [
    "a",
    "b",
    "_",
    "xs"
  ]
}
\`\`\`

Make sure all references based on a preceding pattern is based either on an actual alias or the name of the workflow. 
Apply the following rules while deciding how to specify values in a generated pattern:

Value resolution priority (highest to lowest):
-----------------------------------------------
1. Literal values that can be resolved from the contex (val)
2. Aliases created by earlier patterns (ref)
3. Workflow event references (ref)

Workflow event references MUST only be used if no higher-priority source exists.

Also keep in mind these alias scope rules:

1. An alias is visible only to patterns that appear after it.
2. Aliases defined inside if.then, if.else, or for.do are not visible outside those blocks unless explicitly bound using as.
3. Reusing an alias name overwrites the previous binding.

A general rule regarding generating workflows - as much as possible, do not include references to the workflow event in the patterns. Try to
fill-in values from the available context. For example, if your instruction is "create a workflow to send an email to employee 101 with this message -
'please call me as soon as possible'", the best workflow to return is:

\`\`\`json
{
  "workflow": {
    "event": "erp/sendEmail",
    "patterns": [
      {
        "query": "erp/Employee",
        "where": {
          "id": {
            "=": {
              "val": 101
            }
          }
        },
        "as": [
          "emp"
        ]
      },
      {
        "create": "erp/Email",
        "with": {
          "to": {
            "ref": "emp.email"
          },
          "body": {
            "val": "please call me as soon as possible"
          }
        }
      }
    ]
  }
}
\`\`\`

because all the information needed is available in the context. If the instruction is "create a workflow to send an email by employee-id with this message -
'please call me as soon as possible'", then you can return:

\`\`\`json
{
  "workflow": {
    "event": "erp/sendEmail",
    "patterns": [
      {
        "query": "erp/Employee",
        "where": {
          "id": {
            "=": {
              "ref": "erp/sendEmail.employeeId"
            }
          }
        },
        "as": [
          "emp"
        ]
      },
      {
        "create": "erp/Email",
        "with": {
          "to": {
            "ref": "emp.email"
          },
          "body": {
            "val": "please call me as soon as possible"
          }
        }
      }
    ]
  }
}
\`\`\`

The point is, use the immediate context to fill-in values in generated patterns, as much as possible.

Also generate a workflow only if required explicitly by the user or the contextual information is incomplete. Otherwise, just return an array of patterns.
As an example, if the user request is "send an email to employee 101 with this message - 'please call me as soon as possible'", you must return:

\`\`\`json
{
  "patterns": [
    {
      "query": "erp/Employee",
      "where": {
        "id": {
          "=": {
            "val": 101
          }
        }
      },
      "as": [
        "emp"
      ]
    },
    {
      "create": "erp/Email",
      "with": {
        "to": {
          "ref": "emp.email"
        },
        "body": {
          "val": "please call me as soon as possible"
        }
      }
    }
  ]
}
\`\`\`


Agentlang also supports OLAP-style queries.

## Canonical Join Query Example

Example Agentlang model:

\`\`\`agentlang
module olapDemo;

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
\`\`\`

**Goal:**
Total revenue by year
(SQL: \`SELECT d.year, SUM(f.revenue) FROM sales_fact f JOIN date_dim d ON f.date_id=d.date_id GROUP BY d.year\`)

The workflow pattern that will produce the same result as the above SQL query follows:

\`\`\`json
{
  "query": "olapDemo/SalesFact",
  "joins": [
    {
      "entity": "olapDemo/DateDim",
      "on": {
        "date_id": {
          "=": {
            "ref": "SalesFact.date_id"
          }
        }
      }
    }
  ],
  "into": {
    "year": {
      "ref": "DateDim.year"
    },
    "total_revenue": {
      "sum": {
        "ref": "SalesFact.revenue"
      }
    }
  },
  "groupBy": [
    "DateDim.year"
  ],
  "orderByAsc": [
    "DateDim.year"
  ]
}
\`\`\`

For ordering the result in descending order, use the 'orderByDesc' key.

Before generating patterns, verify:

1. Envelope

   * Output is **only JSON**
   * Top-level key is **exactly one of**: \`patterns\` or \`workflow\`
   * Generated code MUST NOT be wrapped in markdown code block, i.e never return code wrapped in \`\`\`json and \`\`\`.

2. Workflow Decision

   * Use \`workflow\` **only if**:

     * user explicitly asked for a workflow, **or**
     * event name is given, **or**
     * required inputs are missing and must come from an event
   * Otherwise use \`patterns\`

3. Values

   * Each attribute uses **exactly one** of: \`val\`, \`ref\`, or \`expr\`
   * Value resolution order respected: \`val\` → alias \`ref\` → event \`ref\`

4. Aliases

   * Every \`ref\` points to:

     * a previously defined alias, **or**
     * the workflow event
   * No forward references
   * Alias scope respected (\`if\` / \`for\` do not leak unless \`as\` used)

5. Schema Safety

   * No fields, entities, or relationships not defined in the module
   * Correct module prefixes used

6. Patterns

   * Each pattern is valid standalone Agentlang JSON
   * Aggregates used **only if explicitly requested**

7. Clean Output

   * No comments
   * No explanatory text
   * No trailing commas
   * No invented defaults

**If any check fails → regenerate silently.**

Now consider the following module definition and generate appropriate patterns in response to the user instructions.
`;

export const FlowExecInstructions = `The following is the textual representation of a flowchart. 

checkOrder --> "ProductA" acceptOrder
checkOrder --> "ProductB" acceptOrder
checkOrder --> "ProductC" rejectOrder
acceptOrder --> sendPaymentLinkToCustomer
rejectOrder --> sendRejectionEmailToCustomer

Along with this flowchart, you'll be passed a "context", which contain the steps in the flowchart that was executed so far, along with
their results. Based on the context, you need to return the name of the step that needs to execute next. If you have reached the end
of the chart, return 'DONE'. 

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
