#!/bin/bash

# Yale Lock Manager - Git Initialization Script
# This script initializes the git repository and pushes to GitHub

set -e

echo "🔐 Yale Lock Manager - Git Initialization"
echo "=========================================="
echo ""

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo "❌ Error: git is not installed"
    exit 1
fi

# Check if already initialized
if [ -d ".git" ]; then
    echo "⚠️  Git repository already initialized"
    read -p "Do you want to continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
else
    # Initialize git repository
    echo "📦 Initializing git repository..."
    git init
fi

# Create .gitattributes for line endings
echo "📝 Creating .gitattributes..."
cat > .gitattributes << 'EOF'
# Auto detect text files and perform LF normalization
* text=auto

# Python files
*.py text eol=lf

# Shell scripts
*.sh text eol=lf

# Windows specific
*.bat text eol=crlf

# JSON/YAML
*.json text eol=lf
*.yaml text eol=lf
*.yml text eol=lf

# Markdown
*.md text eol=lf

# JavaScript
*.js text eol=lf
EOF

# Configure git
echo "⚙️  Configuring git..."
git config core.autocrlf false
git config core.eol lf

# Add all files
echo "📂 Adding files to git..."
git add .

# Check if there are changes to commit
if git diff --cached --quiet; then
    echo "⚠️  No changes to commit"
else
    # Initial commit
    echo "💾 Creating initial commit..."
    git commit -m "Initial commit - Yale Lock Manager v1.0.0.0

    - Full Yale lock control via Z-Wave JS
    - User code management (20 slots)
    - PIN and FOB/RFID support
    - Time-based access scheduling
    - Usage limits tracking
    - Real-time notifications
    - Lovelace dashboard card
    - HACS compatible"
fi

# Add GitHub remote
echo ""
echo "🌐 GitHub Configuration"
echo "----------------------"
read -p "GitHub username [Wayne-WECIT]: " GITHUB_USER
GITHUB_USER=${GITHUB_USER:-Wayne-WECIT}

REPO_URL="https://github.com/${GITHUB_USER}/HA-Yale-Lock.git"

# Check if remote already exists
if git remote | grep -q "^origin$"; then
    echo "📡 Updating remote origin to: $REPO_URL"
    git remote set-url origin "$REPO_URL"
else
    echo "📡 Adding remote origin: $REPO_URL"
    git remote add origin "$REPO_URL"
fi

# Rename branch to main if needed
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "🔄 Renaming branch to 'main'..."
    git branch -M main
fi

# Ask about pushing
echo ""
read -p "📤 Do you want to push to GitHub now? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "⬆️  Pushing to GitHub..."
    git push -u origin main
    
    # Create initial tag
    echo ""
    read -p "🏷️  Do you want to create version tag v1.0.0.0? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git tag -a v1.0.0.0 -m "Release v1.0.0.0 - Initial Release"
        git push origin v1.0.0.0
        echo "✅ Tag v1.0.0.0 created and pushed!"
    fi
    
    echo ""
    echo "✅ Repository initialized and pushed to GitHub!"
    echo ""
    echo "📋 Next steps:"
    echo "   1. Go to: https://github.com/${GITHUB_USER}/HA-Yale-Lock"
    echo "   2. Verify the repository contents"
    echo "   3. Add repository description and topics"
    echo "   4. Enable Issues and Discussions"
    echo "   5. Add to HACS (if not auto-detected)"
else
    echo ""
    echo "✅ Repository initialized locally!"
    echo ""
    echo "📋 To push later, run:"
    echo "   git push -u origin main"
    echo "   git tag -a v1.0.0.0 -m \"Release v1.0.0.0\""
    echo "   git push origin v1.0.0.0"
fi

echo ""
echo "🎉 Done!"
