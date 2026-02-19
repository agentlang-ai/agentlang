module gmail

import "resolver.js" @as gmr

entity Attachments {
    filename String @optional,
    mime_type String @optional,
    size Number @optional,
    attachment_id String @optional
}

entity Email {
    id UUID @id @default(uuid()),
    sender String @optional,
    recipients String @optional,
    date String @optional,
    subject String @optional,
    body String @optional,
    thread_id String @optional,
    attachments Attachments @optional
}

entity LabelColor {
    text_color String @optional,
    background_color String @optional
}

entity Label {
    id UUID @id @default(uuid()),
    name String @optional,
    message_list_visibility String @optional,
    label_list_visibility String @optional,
    type String @optional,
    messages_total Number @optional,
    messages_unread Number @optional,
    threads_total Number @optional,
    threads_unread Number @optional,
    color LabelColor @optional
}

entity EmailInput {
    from String @optional,
    to String @optional,
    headers String @optional,
    subject String @optional,
    body String @optional
}

entity EmailSentOutput {
    id String @optional,
    thread_id String @optional
}

entity DocumentInput {
    thread_id String @optional,
    attachment_id String @optional
}

resolver gmail1 [gmail/Email] {
    create gmr.createEmail,
    query gmr.queryEmail,
    update gmr.updateEmail,
    delete gmr.deleteEmail
    subscribe gmr.subsEmails
}

resolver gmail2 [gmail/Label] {
    create gmr.createLabel,
    query gmr.queryLabel,
    update gmr.updateLabel,
    delete gmr.deleteLabel
}

resolver gmail3 [gmail/Attachments] {
    query gmr.queryAttachments
}

resolver gmail4 [gmail/EmailInput] {
    create gmr.sendEmail
}

resolver gmail5 [gmail/EmailSentOutput] {
    query gmr.queryEmailSent
}

resolver gmail6 [gmail/DocumentInput] {
    query gmr.fetchAttachment
}
