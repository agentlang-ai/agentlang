module Acme

entity Employee {
    email Email @id,
    firstName String @indexed,
    lastName String @optional,
    salary Number (@default=4500.0, @indexed)
}

event SendMail {
    email Email,
    body String
}

workflow CreateEmployee {
    {Employee {email "joe@acme.com", firstName "Joe", lastName "J", salary 1345.65*CreateEmployee.Incr}} as emp1;
    {Employee {salary?> 1000}} as [e1, e2, _, employees];
    for emp in employees {
        if (emp.salary > 1500) "hello" else "hi" as message;
        {SendMail
         {email emp.email,
          body message}}
    } as final_result;
    final_result
}

