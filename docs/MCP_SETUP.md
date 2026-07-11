# Connecting Clew Study Assist to Claude Desktop, Claude Code, and Cursor

Clew ships a built-in [Model Context Protocol](https://modelcontextprotocol.io)
server so any MCP-capable AI client can see your learning graphs directly.
Once connected, your assistant knows which topics you are studying, what is
blocked by open prerequisites, and what each note contains — without you
copy-pasting graph state into the chat every time.

## What the assistant gets

Four read-only tools, exposed over stdio:

| Tool | What it returns |
| --- | --- |
| `list_graphs` | every graph you have in Clew with progress stats |
| `get_current_learning_context` | per-graph summary across the active graph plus every other graph with learning activity (or one graph when `graph_id` is passed) |
| `get_node` | full content of one topic: description, resources, artifacts, neighbors, and which prerequisites are still blocking closure |
| `search_notes` | keyword search across titles, slugs, and descriptions, scoped to one graph or across all of them |

The server is strictly read-only. Graph edits still go through the Clew
UI and its propose / apply review flow — MCP will never silently mutate
your workspace.

## Quick start

1. **Install Clew locally** (if you haven't already). The standard dev
   script installs the MCP binary at the same time:

   ```bash
   git clone https://github.com/miuuyy/Clew.git
   cd Clew
   cp .env.example .env
   ./scripts/dev.sh
   ```
   After this, the binary lives at `./.venv/bin/clew-study-assist` inside your
   clone. You do not need the backend to be running while MCP is in use —
   the server reads the same SQLite database directly.

2. **Tell your AI client where to find it.** Pick the section below that
   matches your client, replace `/absolute/path/to/clew` with the
   absolute path to your clone, and paste.

## Claude Desktop

Open (or create) the config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add a `Clew Study Assist` entry inside `mcpServers`:

```json
{
  "mcpServers": {
    "Clew Study Assist": {
      "command": "/absolute/path/to/clew/.venv/bin/clew-study-assist"
    }
  }
}
```

Fully quit Claude Desktop (`Cmd+Q` on macOS, not just closing the window)
and reopen it. `Clew Study Assist` will appear under Connectors → Desktop with the
four tools enabled.

## Claude Code

```bash
claude mcp add "Clew Study Assist" /absolute/path/to/clew/.venv/bin/clew-study-assist
```

Or add an entry to `~/.claude.json` under `mcpServers` with the same
shape as the Claude Desktop snippet.

## Cursor

Open Cursor Settings → MCP → Add Server and paste:

```json
{
  "Clew Study Assist": {
    "command": "/absolute/path/to/clew/.venv/bin/clew-study-assist"
  }
}
```

## Making your assistant actually call the tools

Modern models will usually pick up the Clew tools on their own when
you ask about your learning — the tool descriptions are tuned for it.
If you want to be sure the assistant never guesses about your progress,
paste one line into the client's custom instructions / profile:

> I study inside Clew. Before answering questions about what I am
> learning, call `get_current_learning_context`, and use `search_notes`
> then `get_node` when I mention a specific concept by name.

That one sentence is usually enough to make the assistant hit the graph
before replying.

## Custom database location

By default the server reads from `backend/data/knowledge_graph.sqlite3`
inside your Clew clone. If you want to point it at a different
database (for example a second workspace, or a shared path), set
`CLEW_DB_PATH` on the server entry:

```json
{
  "mcpServers": {
    "Clew Study Assist": {
      "command": "/absolute/path/to/clew/.venv/bin/clew-study-assist",
      "env": {
        "CLEW_DB_PATH": "/path/to/other/knowledge_graph.sqlite3"
      }
    }
  }
}
```

The server resolves the database path in this order:

1. `CLEW_DB_PATH` environment variable
2. `KG_DB_PATH` environment variable (shared with the Clew backend)
3. The default `backend/data/knowledge_graph.sqlite3` inside your clone

## Updating

Every time you pull a newer Clew and run `./scripts/dev.sh`, the MCP
binary is rebuilt alongside the rest of the backend — no separate reinstall
step. If your assistant client keeps the server running in the background
(Claude Desktop does this), restart it once after a Clew upgrade so the
new binary is picked up.

## Troubleshooting

- **`Clew Study Assist` doesn't appear in the client.** Double-check the absolute
  path to `clew-study-assist` and that your JSON is valid (a missing comma
  between entries is the usual culprit). Restart the client fully after
  editing the config.
- **Tools load but return nothing interesting.** Confirm the database
  actually has your graphs: the server reads the same file Clew's
  frontend does, so if `./scripts/dev.sh` shows an empty workspace in the
  UI, MCP will see the same.
- **Assistant refuses to call the tools.** Add the custom-instructions
  line above. Short conversational questions like "what am I learning?"
  sometimes don't trigger tool use on their own.
- **You want to verify the server works outside of any client.** Run
  `./.venv/bin/clew-study-assist` directly; it will wait on stdin for MCP
  protocol frames. Ctrl-C to quit. If it exits immediately with a
  traceback, that surfaces the real problem.
