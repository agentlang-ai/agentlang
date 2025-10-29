module acme.core

entity Customer {
    email Email @id,
    name String,
    phone String
}

entity Product {
    id Int @id,
    name String,
    price Number
}

entity Failure {
    message String
}

decision classifyUserRequest {
    case ("request refers to customer") {
        Customer
    }

    case ("request refers to product") {
        Product
    }

    case ("request refers to employee, or anything other than customer or product") {
        Other
    }
}

agent createCustomer {
    instruction "Using the data provided by the user, create a new customer.",
    tools "FlowTest/Customer"
}

agent createProduct {
    instruction "Using the data provided by the user, create a product.",
    tools "FlowTest/Product"
}

event reportFailure {
    message String
}

workflow reportFailure {
    {Failure {message reportFailure.message}}
}

flow customerProductManager {
    classifyUserRequest --> "Product" createProduct
    classifyUserRequest --> "Customer" createCustomer
    classifyUserRequest --> "Other" reportFailure
}

@public agent customerProductManager {
    role "You are a product and customer manager"
}
