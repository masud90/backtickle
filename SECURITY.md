# Security

Please report vulnerabilities privately through GitHub: open the repository's Security tab and choose
"Report a vulnerability". Do not open a public issue for a security problem.

Backtickle never executes anything in a document and makes no network requests of its own, so the
areas of most interest are the Markdown sanitizer, the content security policy, and the file
access grants.
