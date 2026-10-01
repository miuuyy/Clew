# Agent

Clew uses AI as a structural partner for learning.

The model matters. Without it, building and maintaining a useful personal roadmap would take too much manual work. With it, you can ask for a large graph expansion, import messy notes, or audit missing foundations in minutes.

## What The Agent Sees

The assistant can work from:

- graph structure
- selected topic context
- prerequisite and frontier context
- progress and closure state
- recent chat history
- memory settings
- persona rules
- web search results when it asks for them

That context is the difference between a generic study chatbot and an assistant inside your learning workspace.

## What It Can Do

The agent works through a small set of Clew tools:

- read the graph and open a topic
- ask you a clarifying question with choices
- give you an inline quiz, graded on your machine
- propose graph ingest from source material
- propose graph expansion toward a goal
- build a closure test for a topic
- search the web when a question needs fresh sources

When the action changes the graph, the result is a proposal. You review it before it becomes state.

## Where It Runs

The agent runs on your ChatGPT plan through Sign in with ChatGPT. Your local Clew backend sends each request straight to OpenAI; there is no Clew server in the middle. Usage counts against your plan and the app limit you set in ChatGPT.

## Why This Is Agentic Enough

Clew has:

- persistent world state
- dynamic context assembly
- multiple action paths
- typed outputs
- human review before graph mutation
- rollback after accepted changes

That is a real learning loop. It does not need to pretend to be a broad autonomous agent platform.

## The Boundary

The right boundary is simple:

- AI drafts structure
- deterministic code validates contracts and policy
- the user accepts or rejects graph changes
- snapshots preserve recovery

That keeps the product powerful without making the graph feel opaque.

## Behavior Controls

Clew lets you tune the assistant through:

- model selection from your plan
- reasoning effort
- memory profile
- graph context inclusion
- progress context inclusion
- quiz context inclusion
- selected-topic context inclusion
- persona rules

Behavior is part of the workspace, not a hidden constant.
