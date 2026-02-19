// Helper functions for printing email data

export async function printEmail(sender, subject, date, body) {
  const divider = '─'.repeat(60);
  console.log(divider);
  console.log(`  From:    ${sender || '(unknown)'}`);
  console.log(`  Subject: ${subject || '(no subject)'}`);
  console.log(`  Date:    ${date || '(no date)'}`);
  console.log(divider);
  const snippet = body ? body.substring(0, 200) : '(empty)';
  console.log(`  ${snippet}`);
  if (body && body.length > 200) {
    console.log(`  ... (${body.length - 200} more characters)`);
  }
  console.log(divider);
  console.log();
  return { printed: true };
}

export async function printEmailList(emails) {
  if (!emails || emails.length === 0) {
    console.log('No emails found.');
    return [];
  }

  console.log(`\n=== ${emails.length} email(s) found ===\n`);
  for (const email of emails) {
    const sender = email.lookup ? email.lookup('sender') : email.sender;
    const subject = email.lookup ? email.lookup('subject') : email.subject;
    const date = email.lookup ? email.lookup('date') : email.date;
    const body = email.lookup ? email.lookup('body') : email.body;
    await printEmail(sender, subject, date, body);
  }
  return emails;
}
