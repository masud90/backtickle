<!-- Fixture for Graphviz: a simple digraph, a cluster graph and a syntax error -->

# Graphs

## Simple

```dot
digraph Simple {
  Alpha -> Beta -> Gamma;
  Alpha -> Gamma [label="shortcut"];
}
```

## Clusters

```graphviz
digraph Clusters {
  subgraph cluster_front { label="Front end"; Browser -> Server; }
  subgraph cluster_back { label="Back end"; Server -> Database; }
}
```

## Syntax error

```dot
digraph Broken {
  Alpha -> ;
  Beta [label="open
}
```
