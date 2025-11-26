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
    label @enum("featureRequest", "bug", "enhancement")
}

agent analyseIssue {
    instruction "Analyse the incoming issue and return a better description. Also return an appropriate label for the issue",
    responseSchema issues.core/IssueTriageInfo
}

agent updateIssue {
    instruction "Update the issue by id {{IssueTriageInfo.id}} with the new description and label"
    tools [jira/Issue]
}

workflow @after create:jira/Issue {
    {issueTriager {message this}}
}
