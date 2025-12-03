module issues.core

flow issueTriager {
    analyseIssue --> updateIssue
}

@public agent issueTriager {
    role "You are an agent who analyses and triages issues"
}

record IssueTriageInfo {
    id String,
    updatedDescritpion String,
    labels String
}

agent analyseIssue {
    instruction "Analyse the incoming issue and return a better description. Also return appropriate labels for the issue.
Labels should be selected from [\"featureRequest\", \"bug\", \"enhancement\"]. Is you select more than one label, return them comma-separated.
Note that an issue is identified by its `id` field and not by its key.",
    responseSchema issues.core/IssueTriageInfo
}

agent updateIssue {
    instruction "Update the issue by id {{IssueTriageInfo.id}} with the new description and label"
    tools [jira/Issue]
}

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

/*
workflow @after create:jira/Issue {
    {issueTriager {message this}}
}*/


