module support.core

entity Customer {
    email Email @id,
    name String
}

entity SupportExecutive {
    email Email @id,
    name String,
    skills String[],
    @meta {"fullTextSearch": "*"}
}

entity Ticket {
    id UUID @id @default(uuid()),
    subject String,
    description String,
    status @enum("open", "inProgress", "closed") @default("open"),
    priority @enum("high", "medium", "low") @default("low"),
    createdOn DateTime @default(now()),
    @after {create afterCreateTicket @async}
}

event makeTicketHighPriority {
    ticketId UUID
}

workflow makeTicketHighPriority {
    {
	Ticket {
	    id? makeTicketHighPriority.ticketId,
	    priority "high"
	}
    }
}

event makeTicketMediumPriority {
    ticketId UUID
}

workflow makeTicketMediumPriority {
    {
	Ticket {
	    id? makeTicketMediumPriority.ticketId,
	    priority "medium"
	}
    }
}

entity EscalationQueueEntry {
    id UUID @id @default(uuid()),
    ticketId UUID
}

entity ExecutiveTicketAssignment {
    id UUID @id @default(uuid()),
    executiveEmail Email @indexed,
    ticketId UUID @indexed
}

relationship CustomerTicket contains(Customer, Ticket)

decision classifyTicket {
    case ("ticket.subject indicates 'urgent' or ticket.description is about 'payment'") {
        high
    }
    case ("ticket.subject indicates 'error' or ticket.description is abount an 'issue'") {
        medium
    }
    case ("for all other tickets") {
	low
    }
}

event lookupSupportExecutive {
    ticketSubject String
}

workflow lookupSupportExecutive {
    {
	support.core/SupportExecutive? lookupSupportExecutive.ticketSubject
    } @as [id];
    {
	SupportExecutive {
	    __path__? id.id
	}
    } @as [exec];
    exec
}

agent findSupportExecutive {
    instruction "Lookup a support executive who can handle the ticket based on its subject - {{subject}}",
    tools [support.core/lookupSupportExecutive]
}

agent ticketAssignment {
    role "You are an agent who assigns or escalates support tickets",
    instruction "When a new support ticket arrives, analyze its subject and description. 
If the ticket topic matches one of the support executive’s skills {{SupportExecutive.skills}}, assign it to that executive with email {{SupportExecutive.email}}.
Otherwise, escalate the ticket to the EscalationQueue.",
    tools [support.core/ExecutiveTicketAssignment, support.core/EscalationQueueEntry]
}

directive ticketAssignment.match {
    if ("the support executive’s skills match the ticket subject or keywords") {
	"assign the ticket to that executive"
    }
}

directive ticketAssignment.noMatch {
    if ("executive's skills do not match the ticket's subject") {
	"add the ticket to the EscalationQueue for manual review"
    }
}

scenario ticketAssignment.paymentFailure {
    if ("Ticket Id: '714a164e-1ebb-4ca3-97c5-c7a0bccdf8f4', subject: Payment failure reported by customer. Executive email - 'joe@acme.com, executive skills - payments,transactions,billing") {
	{assignTicketToExecutive {executiveEmail "joe@acme.com", ticketId "714a164e-1ebb-4ca3-97c5-c7a0bccdf8f4"}}
    }
}

scenario ticketAssignment.securityAlert {
    if ("Ticket Id: '30c2f915-16d6-4300-84e0-1b9041bb69fd', subject: Security alert: SSL certificate expired, Executive email - 'mat@acme.com', executive skills - networking") {
	{EscalationQueueEntry {ticketId "30c2f915-16d6-4300-84e0-1b9041bb69fd"}}
    }
}

glossaryEntry ticketAssignment.entry1 {
    name "escalation",
    meaning "the process of forwarding unresolved tickets to higher-level support"
}

glossaryEntry ticketAssignment.entry2 {
    name "assignment",
    meaning "linking a support ticket with a responsible executive"
}

glossaryEntry ticketAssignment.entry3 {
    name "skills",
    meaning "areas of technical or domain expertise used to route tickets"
}

flow ticketManager {
    classifyTicket --> "high" makeTicketHighPriority
    classifyTicket --> "medium" makeTicketMediumPriority
    classifyTicket --> "low" findSupportExecutive
    makeTicketHighPriority --> findSupportExecutive
    makeTicketMediumPriority --> findSupportExecutive
    findSupportExecutive --> ticketAssignment
}

agent ticketManager {
    role "You are an agent who classifies and assigns customer support tickets to executives"
}

workflow afterCreateTicket {
    {
	ticketManager {
	    message this
	}
    }
}
