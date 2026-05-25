"""
CLI entry-point for the agent-identity Python SDK.

Usage examples:

  # Resolve a credential
  agent-identity resolve \\
    --base-url http://localhost:3001 \\
    --user-id user-abc \\
    --resource-id kb \\
    --resource-kind shared \\
    --provider anthropic \\
    --model claude-sonnet-4-20250514 \\
    --action read \\
    --trace-id t-001

  # Check sidecar health
  agent-identity health --base-url http://localhost:3001
"""
from __future__ import annotations

import argparse
import datetime
import json
import sys

from .client import AgentIdentityClient
from .models import AgentRequestContext


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="agent-identity",
        description="agent-identity CLI — credential resolution for AI agents",
    )
    parser.add_argument(
        "--base-url",
        default="http://localhost:3001",
        help="Sidecar base URL (default: http://localhost:3001)",
    )

    sub = parser.add_subparsers(dest="command", required=True)

    # ── health ────────────────────────────────────────────────────────────────
    sub.add_parser("health", help="GET /health and print the result")

    # ── resolve ───────────────────────────────────────────────────────────────
    r = sub.add_parser("resolve", help="POST /api/resolve")
    r.add_argument("--user-id", required=True)
    r.add_argument("--resource-id", required=True)
    r.add_argument("--resource-kind", required=True, choices=["shared", "personal"])
    r.add_argument(
        "--provider",
        required=True,
        choices=["openai", "anthropic", "gemini", "mistral", "local"],
    )
    r.add_argument("--model", required=True)
    r.add_argument("--action", required=True)
    r.add_argument("--trace-id", required=True)
    r.add_argument("--session-id", default=None)

    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    with AgentIdentityClient(base_url=args.base_url) as client:
        if args.command == "health":
            print(json.dumps(client.health(), indent=2))

        elif args.command == "resolve":
            ctx = AgentRequestContext(
                user_id=args.user_id,
                resource_id=args.resource_id,
                resource_kind=args.resource_kind,
                provider=args.provider,
                model=args.model,
                action=args.action,
                trace_id=args.trace_id,
                session_id=args.session_id,
                requested_at=datetime.datetime.now(datetime.timezone.utc),
            )
            result = client.resolve(ctx)
            print(json.dumps(result.model_dump(by_alias=True), default=str, indent=2))


if __name__ == "__main__":
    main()
    sys.exit(0)
