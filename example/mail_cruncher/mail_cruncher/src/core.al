module mail_cruncher.core

import "helpers.js" @as helpers

entity EmailDigest {
    id UUID @id @default(uuid()),
    sender String,
    subject String,
    receivedAt String,
    snippet String,
    processedAt DateTime @default(now())
}

// When a new email arrives via the gmail subscription, log it and save a digest
workflow @after create:gmail/Email {
    helpers.printEmail(gmail/Email.sender, gmail/Email.subject, gmail/Email.date, gmail/Email.body);
    {EmailDigest {sender gmail/Email.sender,
                  subject gmail/Email.subject,
                  receivedAt gmail/Email.date,
                  snippet gmail/Email.body}}
}

// Manually fetch and print recent emails
@public workflow FetchEmails {
    {gmail/Email? {}} @as emails;
    helpers.printEmailList(emails)
}

// Query saved digests
@public workflow ListDigests {
    {EmailDigest? {}}
}
