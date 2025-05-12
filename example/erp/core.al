module ErpCore

import "../../example/test.js" as testMod

entity Employee {
    email Email @id,
    firstName String @indexed,
    lastName String @optional,
    salary Number @default(4500.0) @indexed
}

event SendMail {
    email Email,
    body String
}

workflow CreateEmployee {
    {Employee {email CreateEmployee.email,
               firstName CreateEmployee.firstName,
               lastName CreateEmployee.lastName,
               salary CreateEmployee.basicSalary+1500*0.5}} as emp1;
    {Employee {salary?> 1000}} as [e1, e2, _, employees]
    for emp in employees {
        if (emp.salary > 1500) "hello" else "hi" as message;
        {SendMail
         {email emp.email,
          body message}}
    } as final_result;
    [emp1, e1, final_result]
}

