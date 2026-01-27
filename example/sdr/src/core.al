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
