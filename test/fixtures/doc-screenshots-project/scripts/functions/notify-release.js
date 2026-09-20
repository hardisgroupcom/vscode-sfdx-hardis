// Fixture custom function for the documentation screenshots.
// Posts a release message and returns the id and permalink of what it posted.
const channel = process.env.SFDX_HARDIS_IN_CHANNEL;
const severity = process.env.SFDX_HARDIS_IN_SEVERITY;

console.log(`Posting a ${severity} release note to ${channel}`);

console.log(JSON.stringify({ messageId: "1758042000.001900", permalink: "https://mycompany.slack.com/archives/C12345/p1758042000001900" }));
