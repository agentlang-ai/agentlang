module issues.core

record Issue {
    description String,
    summary String,
    type @enum("bug", "task")
}

agent analyseUserMessage {
    instruction "Analyse the message and create a new issue based on it. If possible, add more information to the description",
    responseSchema issues.core/Issue
}

event createIssue extends Issue {
}

workflow createIssue {
    {
	jira/Issue {
            description createIssue.description,
            summary createIssue.summary,
            issue_type createIssue.type
	}
    }
}

agent issueCreator {
    instruction "Create an issue with description {{Issue.description}}, summary {{Issue.summary}} and type {{Issue.type}}",
    tools [issues.core/createIssue]
}

event notifyUser {
    summary String,
    description String,
    key String
}

workflow notifyUser {
    {
	slack/Message
	{
	    id notifyUser.key,
	    text "**" + notifyUser.summary + "**\n" + notifyUser.description,
	    userMessage false
	}
    }
}

agent replyToUser {
    instruction "Notify the user that the issue with summary {{summary}}, description {{description}} and key {{key}} is created.",
    tools [issues.core/notifyUser]
}

decision classifyMessage {
    case ("message looks like a bug, issue or task") {
        Issue
    }

    case ("message is not a bug or task report") {
	Other
    }
}

flow issueManager {
    classifyMessage --> "Issue" analyseUserMessage
    analyseUserMessage --> issueCreator
    issueCreator --> replyToUser
}

@public agent issueManager {
    role "You are an agent who analyses user messages and creates jira issues from it"
}

entity ProcessedMessage {
    ts String @id
}

workflow invokeIssueManager {
    {ProcessedMessage {ts invokeIssueManager.ts}}    
    {issueManager {message invokeIssueManager.text}}
}

workflow @after create:slack/Message {
    if (slack/Message.userMessage) {
	{ProcessedMessage {ts? slack/Message.ts}}
        @catch {not_found {invokeIssueManager {text slack/Message.text, ts slack/Message.ts}}}
    }
}
