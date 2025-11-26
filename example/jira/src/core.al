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
    labels String[]
}

agent analyseIssue {
    instruction "Analyse the incoming issue and return a better description. Also return appropriate labels for the issue.
Labels should be selected from [\"featureRequest\", \"bug\", \"enhancement\"].
Note that an issue is identifdied by its `id` field and not by its key.",
    responseSchema issues.core/IssueTriageInfo
}

agent updateIssue {
    instruction "Update the issue by id {{IssueTriageInfo.id}} with the new description and label"
    tools [jira/Issue]
}

workflow @after create:jira/Issue {
    {issueTriager {message this}}
}
