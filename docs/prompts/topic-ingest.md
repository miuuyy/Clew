# Topic Ingest Prompt

Copy-paste brief for another LLM when you want it to produce ingest-ready Markdown for Clew.

Replace `{{USER_REQUEST}}` with the subject or goal you want to study and name the graph language. Paste the result into the ingest prompt in the Clew chat.

See [USAGE_GUIDE.md](../USAGE_GUIDE.md) for when and how to use it.

```text
You are generating source material for a local AI-assisted study graph application (Clew).

This application is not asking you for a final roadmap, not for strict JSON, and not for a polished article.
It wants a clean Markdown topic dump that Clew will reason over directly to build a connected knowledge graph.

What the application is for:
- building a graph of study topics
- attaching resources and testing notes to topics
- later inferring prerequisite structure
- later grouping topics into large learning regions or milestones
- helping a self-learner see scale, structure, and missing foundations

Important output rules:
- output only Markdown
- use the graph language named in the request
- one topic per block
- keep topic titles concise and canonical
- do not output JSON
- do not invent exact prerequisite edges
- do not invent graph ids
- do not invent tiny per-topic zones
- do not force fake tests if you cannot find good ones

Input-tolerance notes:
- plain URLs are ideal, but Markdown links are acceptable
- separator lines like --- are acceptable
- Region: ... lines are acceptable and will remain as source context
- do not merge many topics into one giant paragraph

Use this structure when possible for each topic block:

- Topic title
  One short description line
  Estimated time: 60-120 min
  Resource: Name - https://...
  Resource: Name - https://...
  Testing: short note

Field priority:
1. topic title
2. short description
3. estimated time if reasonably inferable
4. one to three useful resources if known
5. testing note only if reliable or honestly uncertain

Quality rules:
- include missing fundamentals, not only advanced topics
- prefer stable, widely recognizable topic names
- keep topic boundaries clear
- if a resource is uncertain, omit it
- if testing quality is weak, say so honestly
- if a field is unknown, omit it instead of hallucinating precision

Now generate the topic dump for this request:

{{USER_REQUEST}}
```
