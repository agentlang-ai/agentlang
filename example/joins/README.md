# Order Management Example — Joins and Auto-Join APIs

This example demonstrates how to perform **joins** in Agentlang workflows and how to use **auto-generated GET endpoints** to perform the same operations dynamically.
You’ll see how to use `@join`, `@left_join`, and related join operators to query relationships between entities.

---

## 1. Module Definition

```agentlang
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
```

---

## 2. Supported Join Types

Workflows in Agentlang support the following join directives:

* `@join` — shorthand for inner join
* `@inner_join` — explicit inner join
* `@left_join` — includes all records from the left entity
* `@right_join` — includes all records from the right entity
* `@full_join` — includes all records from both entities, matching where possible

---

## 3. Initialize Sample Data

Populate the database with a few customers and orders:

```bash
curl -X POST http://localhost:8080/order.core/initSampleData \
  -H 'Content-Type: application/json' \
  -d '{}'
```

---

## 4. Get Customers With Orders (`@join`)

This workflow performs an **inner join**, returning only customers who have at least one order.

```bash
curl -X POST http://localhost:8080/order.core/customerOrders \
  -H 'Content-Type: application/json' \
  -d '{}'
```

### Response

```json
[
  {"OrderID":101,"CustomerName":"Joe","OrderDate":"2025-11-11T10:24:33.853Z"},
  {"OrderID":102,"CustomerName":"Jake","OrderDate":"2025-11-11T10:24:33.856Z"},
  {"OrderID":103,"CustomerName":"Joe","OrderDate":"2025-11-11T10:24:33.859Z"}
]
```

---

## 5. Get All Customers (Including Those Without Orders)

This workflow uses a **left join**, so customers without orders are also included.

```bash
curl -X POST http://localhost:8080/order.core/allCustomers \
  -H 'Content-Type: application/json' \
  -d '{}'
```

### Response

```json
[
  {"OrderID":101,"CustomerName":"Joe","OrderDate":"2025-11-11T10:24:33.853Z"},
  {"OrderID":103,"CustomerName":"Joe","OrderDate":"2025-11-11T10:24:33.859Z"},
  {"OrderID":null,"CustomerName":"Sam","OrderDate":null},
  {"OrderID":102,"CustomerName":"Jake","OrderDate":"2025-11-11T10:24:33.856Z"}
]
```

---

## 6. Auto-Join Using GET APIs

Agentlang automatically generates **join-capable GET endpoints** for each entity.
You can specify join parameters directly in the query string.

### Example 1: Left Join `Order` with `Customer`

```bash
curl -X GET http://localhost:8080/order.core/Order?@leftJoinOn=customerId \
  -H 'Content-Type: application/json' \
  -d '{}'
```

### Response

```json
[
  {"Order_orderId":101,"Order_customerId":1,"Order_orderDate":"2025-11-11T10:24:33.853Z","Customer_customerId":1,"Customer_name":"Joe"},
  {"Order_orderId":102,"Order_customerId":3,"Order_orderDate":"2025-11-11T10:24:33.856Z","Customer_customerId":3,"Customer_name":"Jake"},
  {"Order_orderId":103,"Order_customerId":1,"Order_orderDate":"2025-11-11T10:24:33.859Z","Customer_customerId":1,"Customer_name":"Joe"}
]
```

---

### Example 2: Left Join `Customer` with `Order`

```bash
curl -X GET http://localhost:8080/order.core/Customer?@leftJoinOn=Order.customerId \
  -H 'Content-Type: application/json' \
  -d '{}'
```

### Response

```json
[
  {"Customer_customerId":1,"Customer_name":"Joe","Order_orderId":101,"Order_customerId":1,"Order_orderDate":"2025-11-11T10:24:33.853Z"},
  {"Customer_customerId":1,"Customer_name":"Joe","Order_orderId":103,"Order_customerId":1,"Order_orderDate":"2025-11-11T10:24:33.859Z"},
  {"Customer_customerId":2,"Customer_name":"Sam","Order_orderId":null,"Order_customerId":null,"Order_orderDate":null},
  {"Customer_customerId":3,"Customer_name":"Jake","Order_orderId":102,"Order_customerId":3,"Order_orderDate":"2025-11-11T10:24:33.856Z"}
]
```

---

## 7. Supported GET Join Parameters

When using auto-generated GET endpoints, you can specify:

* `@joinOn` — inner join
* `@leftJoinOn` — left join
* `@rightJoinOn` — right join

These parameters allow flexible exploration of related entities without explicitly writing workflows.

---

**Summary**

* Use workflows to define reusable join logic with expressive syntax.
* Use GET join parameters for quick data exploration.
* Agentlang automatically handles entity references and join resolution.

---