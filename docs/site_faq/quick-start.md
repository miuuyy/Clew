# Quick Start

Clew is for the moment when you know what you want to learn, but the path is too tangled to hold in your head.

The shortest version:

**Clew is roadmap.sh, but personalized and adaptive.**

It gives you a clear path to anything you want to learn, with AI doing the heavy structural work and you staying in control of what becomes part of the graph. It runs on your machine and uses your ChatGPT plan.

## What You Need

- a ChatGPT **Plus** or **Pro** plan for the AI features
- Python 3.11 or newer
- Node.js 20 or newer
- macOS or Linux (on Windows, use WSL)
- an OS credential store: Keychain on macOS, Secret Service on Linux

There is no account to create and no API key to copy.

## Install And Run

```bash
git clone https://github.com/miuuyy/Clew.git
cd Clew
cp .env.example .env
./scripts/dev.sh
```

The script creates a Python virtual environment, installs the frontend, and starts both servers:

- workspace: `http://127.0.0.1:5178`
- local API: `http://127.0.0.1:8787`

Stop everything with `./scripts/stop_dev.sh`.

## Sign In With ChatGPT

Open **Settings → ChatGPT → Sign in with ChatGPT**. Your browser opens the OpenAI consent page; approve it and you land back in Clew.

- Clew runs the agent on your ChatGPT plan. Usage counts against that plan.
- Tokens are stored in your OS credential store, never in a plain file.
- Set a weekly limit for Clew in ChatGPT **Settings → Usage → App limits**.
- The graph works before you sign in. Only the assistant needs it.

## The First Good Session

Do this once and you will understand the product:

1. open a graph
2. click a topic and look at the path around it
3. ask the assistant to expand toward a real target
4. review the proposal before applying it
5. apply it only if the structure makes sense
6. study one topic
7. close it with a quiz or mark it finished

That loop shows the core idea:

- AI makes the graph possible at useful scale
- the graph makes the subject legible
- review keeps the workspace yours
- progress stays attached to the structure

## Use Your Own Material

Clew is strongest when it is not starting from nothing.

Good inputs:

- a school syllabus
- an ML prerequisite list
- a course outline
- an Obsidian vault
- a messy list of things you know you need
- a target like "learn enough linear algebra for embeddings"

You do not need to prepare a perfect curriculum. Clew exists because perfect curriculum design is the expensive part.

## What To Try Next

- Import an Obsidian vault and see whether your notes form a real graph.
- Export a graph back to Obsidian as a markdown vault.
- Connect Clew Study Assist through MCP so Claude, Claude Code, or Cursor can read your current learning context.
- Switch between Midnight and Paper themes depending on whether you want the dark graph mood or a brighter daylight workspace.
- Pick a model and reasoning effort, tune memory, and write persona rules when you want the AI to behave differently.
