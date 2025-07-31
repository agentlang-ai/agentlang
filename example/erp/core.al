module ErpCore

import "../../example/test.js" @as testMod

entity Employee {
    email Email @id,
    firstName String @indexed,
    lastName String @optional,
    salary Int @default(4500.0) @indexed
}

event SendMail {
    email Email,
    body String
}

workflow CreateEmployee {
    {Employee {email CreateEmployee.email,
               firstName CreateEmployee.firstName,
               lastName CreateEmployee.lastName,
               salary CreateEmployee.basicSalary+1500*0.5}} @as emp1;
    {Employee {salary?> 1000}} @as employees
    for emp in employees {
        if (emp.salary > 1500) { "Level1" } else { "Level2" } @as message;
        {SendMail
         {email emp.email,
          body message}}
    } @as final_result;
    testMod.callHelloWorld() @as hello;
    [hello, emp1, final_result]
}

workflow SendMail {
    testMod.sendMail(SendMail.email, SendMail.body)
}