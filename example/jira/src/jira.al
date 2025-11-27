module jira

import "resolver.js" @as jr

entity Author {
    account_id String @optional,
    active Boolean @optional,
    display_name String @optional,
    email_address String @optional
}

entity Comment {
    id String @optional,
    created_at String @optional,
    updated_at String @optional,
    author Author @optional,
    body String @optional
}

entity Issue {
    id String @id,
    created_at String @optional,
    updated_at String @optional,
    key String @optional,
    summary String @optional,
    issue_type String @optional,
    status String @optional,
    assignee String @optional,
    url String @optional,
    web_url String @optional,
    project_id String @optional,
    project_key String @optional,
    project_name String @optional,
    comments Comment @optional,
    description String,
    labels String
}

resolver jira1 [jira/Issue] {
    create jr.createIssue,
    query jr.queryIssue,
    update jr.updateIssue,
    delete jr.deleteIssue,
    subscribe jr.subsIssues
}
