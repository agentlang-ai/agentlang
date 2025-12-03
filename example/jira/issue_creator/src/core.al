module issues.core

record Issue {
    description String,
    summary String,
    type @enum("bug", "task")
}

agent analyseUserMessage {
    instruction "Analyse the message and create an issue from it. If possible, add more information to the description",
    responseSchema issues.core/Issue
}

event createIssue extends Issue {
}

workflow createIssue {
    {jira/Issue {
        description createIssue.description,
        summary createIssue.summary,
        issue_type createIssue.type}}
}

agent issueCreator {
    instruction "Create an issue with description {{Issue.description}}, summary {{Issue.summary}} and type {{Issue.type}}",
    tools [issues.core/createIssue]
}


flow issueManager {
    analyseUserMessage --> issueCreator
}

@public agent issueManager {
    role "You are an agent who analyses user messages and creates jira issues from it"
}

workflow @after create:slack/Message {
    {issueManager {message slack/Message.text}}
}
