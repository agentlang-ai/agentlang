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
    instruction "Based on the user request, create a new customer.",
    tools [acme.core/Customer]
}

agent createProduct {
    instruction "Based on the user request, create a product.",
    tools [acme.core/Product]
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
