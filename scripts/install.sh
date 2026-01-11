#!/bin/bash
#
# Claude Voice Extension - Installation Script
#
# This script installs all dependencies and sets up the voice extension.

set -e

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║         Claude Voice Extension - Installation                ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

echo "Project directory: $PROJECT_DIR"
echo ""

# Check prerequisites
check_command() {
    if command -v "$1" &> /dev/null; then
        echo -e "${GREEN}✓${NC} $1 found"
        return 0
    else
        echo -e "${RED}✗${NC} $1 not found"
        return 1
    fi
}

echo "Checking prerequisites..."
echo ""

# Check Node.js
if ! check_command node; then
    echo -e "${RED}Node.js is required. Please install Node.js 18+ and try again.${NC}"
    echo "  brew install node"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Node.js 18+ is required. Current version: $(node -v)${NC}"
    exit 1
fi

# Check npm
check_command npm || exit 1

# Check Python3
if ! check_command python3; then
    echo -e "${YELLOW}Python3 not found. Local Whisper STT will not work.${NC}"
    echo "  brew install python@3.11"
fi

echo ""
echo "Installing Node.js dependencies..."
cd "$PROJECT_DIR"
npm install

echo ""
echo "Building TypeScript..."
npm run build

echo ""
echo "Installing Python dependencies (for local Whisper)..."
if command -v python3 &> /dev/null; then
    if command -v pip3 &> /dev/null; then
        pip3 install -r requirements.txt --user || {
            echo -e "${YELLOW}Warning: Failed to install Python dependencies.${NC}"
            echo "Local Whisper STT may not work. You can install manually:"
            echo "  pip3 install openai-whisper sounddevice numpy"
        }
    else
        echo -e "${YELLOW}pip3 not found. Skipping Python dependencies.${NC}"
    fi
else
    echo -e "${YELLOW}Skipping Python dependencies (Python3 not found).${NC}"
fi

echo ""
echo "Setting up configuration..."
CONFIG_DIR="$HOME/.claude-voice"
mkdir -p "$CONFIG_DIR"

if [ ! -f "$CONFIG_DIR/config.json" ]; then
    cp "$PROJECT_DIR/config/default.json" "$CONFIG_DIR/config.json"
    echo "Created default configuration at $CONFIG_DIR/config.json"
else
    echo "Configuration already exists at $CONFIG_DIR/config.json"
fi

echo ""
echo "Making CLI executable..."
chmod +x "$PROJECT_DIR/dist/cli.js"
chmod +x "$PROJECT_DIR/dist/index.js"

# Create symlink for global access
echo ""
echo "Creating global command link..."
LINK_PATH="/usr/local/bin/claude-voice"
if [ -L "$LINK_PATH" ] || [ -f "$LINK_PATH" ]; then
    echo "Removing existing link..."
    sudo rm -f "$LINK_PATH"
fi
sudo ln -s "$PROJECT_DIR/dist/cli.js" "$LINK_PATH" || {
    echo -e "${YELLOW}Could not create global link. You can run the CLI with:${NC}"
    echo "  node $PROJECT_DIR/dist/cli.js"
}

echo ""
echo "Installing Claude Code hooks..."
node "$PROJECT_DIR/dist/cli.js" install-hooks

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                   Installation Complete!                      ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo ""
echo "1. Set up API keys (optional, for cloud providers):"
echo "   export OPENAI_API_KEY='your-key'      # For OpenAI TTS/STT"
echo "   export ELEVENLABS_API_KEY='your-key'  # For ElevenLabs TTS"
echo "   export PICOVOICE_ACCESS_KEY='your-key' # For wake word (free at picovoice.ai)"
echo ""
echo "2. Start the voice extension:"
echo "   claude-voice start"
echo ""
echo "3. Test TTS:"
echo "   claude-voice test-tts 'Hello, world!'"
echo ""
echo "4. Check status:"
echo "   claude-voice status"
echo ""
echo "5. View/modify configuration:"
echo "   claude-voice config"
echo ""
echo "For wake word detection, get a free API key at https://picovoice.ai"
echo ""
