module employee.chat

entity Employee {
    id UUID @id @default(uuid()),
    name String,
    salary Decimal @indexed
}

@public agent employeeManager {
    instruction "You manage employee records creation and queries",
    tools [employee.chat/Employee]
}
