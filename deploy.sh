#!/bin/bash
# Usage: ./deploy.sh [function-name] [function-name2] ...
# Default: deploys swarm-bot
# Example: ./deploy.sh swarm-bot granola-poller
set -e
FUNCTIONS=${@:-swarm-bot}
supabase functions deploy $FUNCTIONS --no-verify-jwt
