# Usage Guide

[简体中文使用指南](USAGE_GUIDE.zh-CN.md)

This guide is for the part of the workflow where you or another model prepare raw source material for graph ingest.

Clew does **not** want a polished final curriculum here. It wants clean, structured source material that can later be turned into a connected proposal.

## What this guide is for

Use this when you want to:

- prepare a topic dump manually
- ask another LLM to generate ingest-ready markdown
- keep large subject dumps from collapsing into one useless blob

## What Clew wants from raw source

Good ingest material is:

- written in the graph's language
- markdown
- topic-bounded
- compact but structured
- honest when information is missing

Bad ingest material is:

- giant prose blobs
- fake exact prerequisite graphs
- JSON pretending to be the final truth
- hundreds of disconnected buzzwords

## Recommended shape

Each topic block should ideally contain:

- topic title
- one short description line
- estimated time if reasonably inferable
- one to three useful resources if known
- a testing note only if it is reliable

Example:

```text
- Networking basics
  OSI model, IP, ports, routing, DNS, and packet flow
  Estimated time: 2h
  Resource: Cisco Skills for All - https://example.com/networking
  Resource: Wireshark intro - https://example.com/wireshark
  Testing: inspect a simple packet capture
```

## Good rules for source generation

- keep topic titles canonical and concise
- prefer stable, recognizable topic names
- include missing fundamentals instead of only advanced topics
- keep topic boundaries obvious
- omit fields that you cannot support confidently
- do not invent exact edges or graph IDs

## Prompt template

The copy-paste prompt for another LLM lives in [prompts/topic-ingest.md](prompts/topic-ingest.md). Replace `{{USER_REQUEST}}` with your subject or goal and paste the model output into Clew's ingest dialog.

## Anti-patterns

Do not give Clew source material like this:

```text
networking, linux, python, crypto, web security, malware, reverse engineering, labs, operating systems...
```

That destroys the very thing the graph builder needs: **clear topic boundaries**.
