export const PlannerInstructions = `The model of a business application consists of entity definitions and workflows defined in "modules". They are encoded in JSON format.
Example of an entity definition is,

{
    "entity": {
        "name": "Erp/Employee",
        "attributes": {
            "employeeId": {
                "type": "UUID",
                "id": true,
                "default": "uuid()"
            },
            "firstName": {
                "type": "String"
            },
            "lastName": {
                "type": "String"
            },
            "salary": {
                "type": "Number"
            },
            "email": {
                "type": "Email",
                "indexed": true
            }
        }
    }
}

The Empoyee entity is part of the "Erp" module and it has four attributes: employeeId, firstName, lastName and email. The employeeId uniquely identifies an
Employee and it's automatically filled-in by the system by calling the "uuid()" function.
Workflows contains JSON "patterns" that perform CRUD operations on entities. For example, here's is a workflow that creates a new instance of the Employee entity:

{
    "workflow": {
        "event": "Erp/CreateEmployee",
        "patterns": [
            {
                "Erp/Employee": {
                    "firstName": "Erp/CreateEmployee.firstName",
                    "lastName": "Erp/CreateEmployee.lastName",
                    "salary": "Erp/CreateEmployee.salary",
                    "email": "Erp/CreateEmployee.email"
                }
            }
        ]
    }
}

The attribute-values of the new Employee derived from the "event" that triggers the workflow. Here the event is called "CreateEmployee".
An event need not have an explicit schema, because its attributes can always be inferred from the workflow definition. But a model may also contain
explicit definitions of events, as follows,

{
    "entity": {
        "name": "Erp/CreateEmployee",
        "attributes": {
            "firstName": {
                "type": "String"
            },
            "lastName": {
                "type": "String"
            },
            "salary": {
                "type": "Number"
            },
            "email": {
                "type": "Email"
            }
        }
    }
}

A workflow attached to an event is invoked by creating an instance of the event, e.g:

{
    "Erp/CreateEmployee": {
        "firstName": "Sam",
        "lastName": "K",
        "salary": 1400,
        "email": "samk@acme.com"
    }
}

This means a workflow can be invoked from another workflow, simply by adding the event-creation as a pattern.

Other than the create-pattern for entities and events, some of the most useful patterns (related to entities) that can appear in a workflow are:
1. Query - e.g {"Erp/Employee: {"employeeId?": "56392e13-0d9a-42f7-b556-0d7cd9468a24"}}. The attributes by which the query happens must end with a '?' character.
   To lookup all instances of an entity, use the syntax: {"EntityName?": {}}.
2. Update - e.g {"Erp/Employee: {"employeeId?": "56392e13-0d9a-42f7-b556-0d7cd9468a24", "firstName": "Joe"}}. This pattern updates the firstName of the employee
   with the given employeeId.
3. Upsert - e.g {"Erp/Employee: {"employeeId": "56392e13-0d9a-42f7-b556-0d7cd9468a24", "firstName": "Joe"}, "upsert": true}. The 'upsert' pattern will create a new
   instance, if the instance does not already exist.
4. Delete - e.g {"Erp/Employee: {"employeeId?": "56392e13-0d9a-42f7-b556-0d7cd9468a24"}, "delete": true}

In addition to the basic CRUD patterns, you can execute conditional-logic with the help of the 'if' pattern. An example follows,

{
    "workflow": {
        "event": "Erp/IncrementSalary",
        "patterns": [
            {
                "if": "Erp/IncrementSalary.percentage > 10",
                "then": [
                    {
                        "Erp/Employee": {
                            "employeeId?": "Erp/IncrementSalary.employeeId",
                            "salary": "salary + salary * Erp/IncrementSalary.percentage"
                        }
                    }
                ],
                "else": [
                    {
                        "Erp/Employee": {
                            "employeeId?": "Erp/IncrementSalary.employeeId",
                            "salary": "salary + 1500"
                        }
                    }
                ]
            }
        ]
    }
}

Now consider the following module definition and generate appropriate patterns in response to the user instructions.
`;
