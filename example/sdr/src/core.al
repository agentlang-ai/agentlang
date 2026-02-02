module sdr.core

record InboundEmailPayload {
    sender String,
    recipients String,
    subject String,
    body String,
    date String,
    threadId String,
    gmailOwnerEmail String,
    hubspotOwnerId String
}

record EmailQualificationResult {
    needsProcessing Boolean,
    reason String,
    category String @enum("business", "meeting", "sales", "automated", "newsletter", "spam", "unknown") @optional,
    sender String,
    recipients String,
    subject String,
    body String,
    date String,
    threadId String,
    gmailOwnerEmail String,
    hubspotOwnerId String
}

@public agent EmailQualificationAgent {
    llm "sonnet_llm",
    role "You are an intelligent email qualification agent who determines if an email requires sales engagement processing.",
    tools [sdr.core/InboundEmailPayload],
    instruction "You receive an InboundEmailPayload instance as input. Your job is to determine if this email needs sales processing.",
    retry classifyRetry,
    responseSchema sdr.core/EmailQualificationResult
}

record LeadIntelligence {
    primaryContactEmail String,
    primaryContactFirstName String,
    primaryContactLastName String,
    primaryContactRole String @enum("buyer", "user", "influencer", "champion", "unknown") @default("unknown"),
    allContactEmails String @optional,
    allContactNames String @optional,
    companyName String,
    companyDomain String,
    companyConfidence String @enum("high", "medium", "low", "none") @default("none"),
    emailSubject String,
    emailBody String,
    emailDate String,
    emailThreadId String,
    emailSender String,
    emailRecipients String,
    gmailOwnerEmail String,
    hubspotOwnerId String
}

@public agent LeadIntelligenceExtractor {
    llm "sonnet_llm",
    role "You are an expert at extracting structured lead intelligence from sales emails including contact details, company information, and relationship context.",
    tools [sdr.core/EmailQualificationResult],
    instruction "Extract contact and company information from instances of EmailQualificationResult",
    retry classifyRetry,
    responseSchema sdr.core/LeadIntelligence
}
