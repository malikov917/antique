#!/bin/bash
# Update a Linear issue status via MCP (uses authenticated OAuth tokens)
# Usage: ./scripts/linear-update.sh <issue-id> <state-name>
# Example: ./scripts/linear-update.sh ANT-90 Done

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ISSUE_ID="${1:-}"
STATE_NAME="${2:-}"

if [ -z "$ISSUE_ID" ] || [ -z "$STATE_NAME" ]; then
  echo "Usage: $0 <issue-id> <state-name>"
  echo "Example: $0 ANT-90 Done"
  exit 1
fi

# Use Kimi's Python which has fastmcp installed
PYTHON="/Users/kanstantsinmalikau/.local/share/uv/tools/kimi-code/bin/python3"

$PYTHON - "$ISSUE_ID" "$STATE_NAME" << 'PYEOF'
import asyncio
import sys
import json

sys.path.insert(
    0,
    "/Users/kanstantsinmalikau/.local/share/uv/tools/kimi-code/lib/python3.13/site-packages",
)

from pathlib import Path
from fastmcp.client.auth.oauth import OAuth
from key_value.aio.stores.filetree import (
    FileTreeStore,
    FileTreeV1CollectionSanitizationStrategy,
    FileTreeV1KeySanitizationStrategy,
)

import fastmcp


def create_mcp_oauth_store():
    storage_dir = Path.home() / ".kimi" / "mcp-oauth"
    return FileTreeStore(
        data_directory=storage_dir,
        key_sanitization_strategy=FileTreeV1KeySanitizationStrategy(storage_dir),
        collection_sanitization_strategy=FileTreeV1CollectionSanitizationStrategy(storage_dir),
    )


async def main():
    issue_id = sys.argv[1]
    new_state = sys.argv[2]

    client = fastmcp.Client({
        "mcpServers": {
            "linear": {
                "url": "https://mcp.linear.app/mcp",
                "transport": "http",
                "auth": OAuth(
                    mcp_url="https://mcp.linear.app/mcp",
                    token_storage=create_mcp_oauth_store(),
                ),
            }
        }
    })

    async with client:
        # Fetch issue
        result = await client.call_tool("get_issue", {"id": issue_id})
        issue = json.loads(result.content[0].text)
        current_state = issue.get("status")
        team_id = issue.get("teamId")

        if current_state and current_state.lower() == new_state.lower():
            print(f"✅ {issue_id} is already in '{current_state}' — no change needed.")
            return

        # List available states for the team
        states_result = await client.call_tool(
            "list_issue_statuses", {"team": team_id}
        )
        states = json.loads(states_result.content[0].text)

        target = None
        for s in states:
            if s.get("name", "").lower() == new_state.lower():
                target = s
                break

        if not target:
            available = ", ".join(s["name"] for s in states)
            print(f"❌ State '{new_state}' not found. Available: {available}")
            sys.exit(1)

        # Update issue
        await client.call_tool(
            "save_issue",
            {"id": issue.get("id"), "stateId": target["id"]}
        )
        print(f"✅ Moved {issue_id} to '{target['name']}'")


asyncio.run(main())
PYEOF
