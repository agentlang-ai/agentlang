module builder.core

record UserRequest {
    dataModelRequest String,
    workflowRequest String
}

agent requestClassifier {
    instruction "Analyze the user request and split it into two requests for data model generation and workflow generation",
    responseSchema builder.core/UserRequest
}

record Generated {
    code String
}
    
agent dataModelCreator {
    instruction "Analyze the user request and generate an appropriate data model. Example user request: 'Generate an app for managing my personal expenses'. Your response:

module personalExpense.core

entity Income {
    id UUID @id @default(uuid()),
    description String,
    amount Decimal,
    date DateTime @default(now())
}

entity Expense {
    id UUID @id @default(uuid()),
    description String,
    amount Decimal,
    date DateTime @default(now())
}

    Now generate the data-model for the request: '{{requestClassifier.dataModelRequest}}'.",
    validate agentlang/validateModule,
    responseSchema builder.core/Generated
}

agent workflowCreator {
    instruction "Analyze a data-model and generate workflows as per user request. For instance, if the data-model consists of an entity called Student:

entity Student {
    id Int @id,
    name String
}

and the user request is to generate a workflow to lookup all students with a particular name, you should return:

workflow lookupStudentsByName {
    {Student {name? lookupStudentsByName.name}}
}

Now based on the data-model \n{{dataModelCreator.code}}\n, generate workflows as per the user request: '{{requestClassifier.workflowRequest}}'.",
    responseSchema builder.core/Generated
}

agent appGenerator {
    instruction "Combine {{dataModelCreator.code}} and {{workflowCreator.code}} and return it as a single app specification"
}

flow appBuilder {
    requestClassifier --> dataModelCreator
    dataModelCreator --> workflowCreator
    workflowCreator --> appGenerator
}

@public agent appBuilder {
    role "You are an agent who generates a application with data-model and workflows"
}
