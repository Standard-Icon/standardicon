# @standardicon/mcp

> **Early version.** This is an alpha. Names, sizes and defaults may still change before 1.0.0, so pin the version if you depend on it.

[The Standard Icon Set](https://standardicon.com) as an MCP server. It's optional: it's for AI apps that can't run commands, such as Claude Desktop. A coding agent that can run commands should use the [standardicon CLI](https://www.npmjs.com/package/standardicon) instead, which searches the same descriptions and also writes icon files and translates names from Lucide and other sets.

 Your AI agent can search the icons by meaning or by what they look like, and get the SVG at any size and weight. It runs locally and works offline: every icon ships inside the package.

## Set up

Claude Code:

```sh
claude mcp add standardicon -- npx -y @standardicon/mcp
```

Cursor (`.cursor/mcp.json`), Claude Desktop (`claude_desktop_config.json`), and most other clients:

```json
{
  "mcpServers": {
    "standardicon": { "command": "npx", "args": ["-y", "@standardicon/mcp"] }
  }
}
```

VS Code (`.vscode/mcp.json`):

```json
{
  "servers": {
    "standardicon": { "command": "npx", "args": ["-y", "@standardicon/mcp"] }
  }
}
```

## Tools

| Tool | What it does |
| --- | --- |
| `search_icons` | Finds icons by meaning ("delete"), name, or what they look like ("bell with a plus"). Each result says what the icon looks like and when to use it. |
| `get_icon` | Returns one icon as SVG markup, at a size from 16 to 48 and a weight from thin to black. Regular is the default. |
| `list_categories` | Lists the categories and how many icons each has. |
| `list_icons` | Lists every icon in a category. |

Icons draw in `currentColor`, so they take the color of the text around them. When the set doesn't have an icon, the server says so and the agent is told not to draw a substitute.

## License

MIT for the icons and this package.
