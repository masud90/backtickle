<!-- Fixture for phase2 XSS: Mermaid attacks -->

```mermaid
%%{init: {"securityLevel": "loose"}}%%
flowchart LR
    A[<img src=x onerror="window.__XSS_SENTINEL__ = true">]
    B[Node B]
    click A callback "x"
    click B "javascript:window.__XSS_SENTINEL__ = true"
```

```mermaid
flowchart LR
    A[Node A] --> B[Node B]
    classDef evil fill:red} body{display:none} x{
    class A evil
    style B fill:red} body{display:none} x{
```
