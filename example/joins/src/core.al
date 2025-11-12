module order.core

entity Customer {
    customerId Int @id @unique,
    name String
}

entity Order {
    orderId Int @id @unique,
    customerId Int @ref(order.core/Customer.customerId),
    orderDate DateTime @default(now())
}

@public workflow customerOrders {
    {Order? {},
     @join Customer {customerId? Order.customerId},
     @into {OrderID Order.orderId, CustomerName Customer.name, OrderDate Order.orderDate}}
}

@public workflow allCustomers {
    {Customer? {},
     @left_join Order {customerId? Customer.customerId},
     @into {OrderID Order.orderId, CustomerName Customer.name, OrderDate Order.orderDate}}
}

@public workflow initSampleData {
    {Customer {customerId 1, name "Joe"}}
    {Customer {customerId 2, name "Sam"}}
    {Customer {customerId 3, name "Jake"}}

    {Order {orderId 101, customerId 1}}
    {Order {orderId 102, customerId 3}}
    {Order {orderId 103, customerId 1}}
}
