# Security

Please report vulnerabilities privately through GitHub: open the repository's Security tab and choose
"Report a vulnerability". Do not open a public issue for a security problem.

Backtickle never executes anything in a document, and its only network request of its own is the daily
update check, which asks the GitHub API for the newest release. The areas of most interest are the Markdown sanitizer, the content security policy, and the file
access grants.
