#!/bin/bash
#
# Quick script to install/uninstall Claude Code hooks
#

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

case "$1" in
    install)
        echo "Installing hooks..."
        node "$PROJECT_DIR/dist/cli.js" install-hooks
        ;;
    uninstall)
        echo "Uninstalling hooks..."
        node "$PROJECT_DIR/dist/cli.js" uninstall-hooks
        ;;
    *)
        echo "Usage: $0 {install|uninstall}"
        exit 1
        ;;
esac
