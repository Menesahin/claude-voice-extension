#!/usr/bin/env node
/**
 * Claude Code Hook: PostToolUse
 *
 * This hook runs after Claude Code executes a tool.
 * It provides voice announcements for tool completion/results.
 * Supports both "completion only" and "summarize results" modes.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const API_URL = 'http://127.0.0.1:3456';
const CONFIG_FILE = path.join(os.homedir(), '.claude-voice', 'config.json');

// Default configuration
const DEFAULT_CONFIG = {
  toolTTS: {
    enabled: true,
    mode: 'summarize',
    tools: {
      Read: true,
      Grep: true,
      Glob: false,
      Bash: true,
      Write: true,
      Edit: true,
      MultiEdit: true,
      WebFetch: false,
      WebSearch: false,
      Task: false,
      default: false
    },
    customMessages: {
      completion: 'Done.',
      error: 'Operation failed.'
    },
    announceErrors: true,
    maxSummaryLength: 100
  }
};

// Load configuration
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const userConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      return deepMerge(DEFAULT_CONFIG, userConfig);
    }
  } catch {
    // Use defaults on error
  }
  return DEFAULT_CONFIG;
}

// Deep merge helper
function deepMerge(target, source) {
  const result = { ...target };
  for (const key in source) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(source[key]) &&
        typeof target[key] === 'object' &&
        target[key] !== null
      ) {
        result[key] = deepMerge(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
  }
  return result;
}

// Send text to TTS service
async function sendToTTS(text, priority = false) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ text, priority });

    const req = http.request(`${API_URL}/tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data, 'utf8')
      },
      timeout: 3000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({ success: false });
        }
      });
    });

    req.on('error', () => resolve({ success: false }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false });
    });

    req.write(data);
    req.end();
  });
}

// Check if tool TTS is enabled for a specific tool
function isToolEnabled(config, toolName) {
  const toolConfig = config.toolTTS?.tools || {};

  // Check specific tool setting first
  if (Object.prototype.hasOwnProperty.call(toolConfig, toolName)) {
    return toolConfig[toolName];
  }

  // Fall back to default setting
  return toolConfig.default ?? false;
}

// Detect if tool execution was an error
function isToolError(toolResult) {
  if (!toolResult) return false;

  const resultStr = typeof toolResult === 'string'
    ? toolResult
    : JSON.stringify(toolResult);

  // Common error indicators
  const errorPatterns = [
    /error:/i,
    /failed/i,
    /exception/i,
    /not found/i,
    /permission denied/i,
    /exit code [1-9]/i,
    /command not found/i,
    /no such file/i
  ];

  return errorPatterns.some(pattern => pattern.test(resultStr));
}

// Summarizers for each tool type
const toolSummarizers = {
  Read: (input, result) => {
    const fileName = input.file_path ? path.basename(input.file_path) : 'file';
    const ext = path.extname(fileName).toLowerCase();

    const typeMap = {
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript React',
      '.js': 'JavaScript',
      '.jsx': 'JavaScript React',
      '.json': 'JSON',
      '.md': 'Markdown',
      '.py': 'Python',
      '.rs': 'Rust',
      '.go': 'Go',
      '.java': 'Java',
      '.c': 'C',
      '.cpp': 'C++',
      '.h': 'header',
      '.css': 'CSS',
      '.scss': 'SCSS',
      '.html': 'HTML',
      '.yaml': 'YAML',
      '.yml': 'YAML',
      '.toml': 'TOML',
      '.sh': 'shell',
      '.sql': 'SQL',
      '.vue': 'Vue',
      '.svelte': 'Svelte'
    };

    const fileType = typeMap[ext] || 'file';
    return `Read ${fileType} file ${fileName}.`;
  },

  Grep: (input, result) => {
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    const lines = resultStr.trim().split('\n').filter(l => l.trim());
    const matchCount = lines.length;

    if (matchCount === 0) {
      return 'No matches found.';
    }

    // Try to count unique files
    const files = new Set();
    lines.forEach(line => {
      const match = line.match(/^([^:]+):/);
      if (match) files.add(match[1]);
    });

    if (files.size > 1) {
      return `Found ${matchCount} matches in ${files.size} files.`;
    } else if (files.size === 1) {
      return `Found ${matchCount} matches in 1 file.`;
    }
    return `Found ${matchCount} matches.`;
  },

  Glob: (input, result) => {
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    const files = resultStr.trim().split('\n').filter(l => l.trim());
    if (files.length === 0) {
      return 'No files found.';
    }
    return `Found ${files.length} ${files.length === 1 ? 'file' : 'files'}.`;
  },

  Bash: (input, result) => {
    const command = input.command || '';
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

    // Check for exit code in result
    const exitCodeMatch = resultStr.match(/exit code[:\s]+(\d+)/i);
    if (exitCodeMatch && exitCodeMatch[1] !== '0') {
      return `Command failed with exit code ${exitCodeMatch[1]}.`;
    }

    // Common command patterns
    if (/^git\s+status/i.test(command)) {
      return 'Git status complete.';
    }
    if (/^git\s+commit/i.test(command)) {
      return 'Git commit complete.';
    }
    if (/^git\s+push/i.test(command)) {
      return 'Git push complete.';
    }
    if (/^git\s+pull/i.test(command)) {
      return 'Git pull complete.';
    }
    if (/^npm\s+install/i.test(command) || /^yarn\s+install/i.test(command) || /^pnpm\s+install/i.test(command)) {
      return 'Package installation complete.';
    }
    if (/^npm\s+test/i.test(command) || /^yarn\s+test/i.test(command) || /^pnpm\s+test/i.test(command)) {
      if (resultStr.includes('passed') || !resultStr.includes('failed')) {
        return 'Tests passed.';
      }
      return 'Tests completed with failures.';
    }
    if (/^npm\s+run\s+build/i.test(command) || /^yarn\s+build/i.test(command) || /^pnpm\s+build/i.test(command)) {
      return 'Build complete.';
    }

    return 'Command completed.';
  },

  Write: (input, result) => {
    const fileName = input.file_path ? path.basename(input.file_path) : 'file';
    return `Created ${fileName}.`;
  },

  Edit: (input, result) => {
    const fileName = input.file_path ? path.basename(input.file_path) : 'file';
    return `Updated ${fileName}.`;
  },

  MultiEdit: (input, result) => {
    const edits = input.edits || [];
    const fileCount = new Set(edits.map(e => e.file_path)).size;
    if (fileCount === 1) {
      const fileName = path.basename(edits[0]?.file_path || 'file');
      return `Made ${edits.length} edits to ${fileName}.`;
    }
    return `Made ${edits.length} edits across ${fileCount} files.`;
  },

  WebFetch: (input, result) => {
    try {
      const url = new URL(input.url);
      return `Fetched content from ${url.hostname}.`;
    } catch {
      return 'Web fetch complete.';
    }
  },

  WebSearch: (input, result) => {
    const query = input.query || '';
    const shortQuery = query.length > 30 ? query.substring(0, 30) + '...' : query;
    return `Search complete for "${shortQuery}".`;
  },

  TodoRead: (input, result) => {
    return 'Read todo list.';
  },

  TodoWrite: (input, result) => {
    const todos = input.todos || [];
    return `Updated ${todos.length} todo items.`;
  },

  Task: (input, result) => {
    return 'Task completed.';
  },

  // Default summarizer for unknown tools
  default: (input, result, toolName) => {
    return `${toolName} completed.`;
  }
};

// Generate summary based on tool type
function summarizeTool(toolName, toolInput, toolResult, config) {
  const summarizer = toolSummarizers[toolName] || toolSummarizers.default;

  try {
    let summary = summarizer(toolInput, toolResult, toolName);

    // Truncate if too long
    const maxLength = config.toolTTS?.maxSummaryLength || 100;
    if (summary.length > maxLength) {
      summary = summary.substring(0, maxLength - 3) + '...';
    }

    return summary;
  } catch {
    return config.toolTTS?.customMessages?.completion || 'Done.';
  }
}

// Main hook logic
async function main() {
  const config = loadConfig();

  // Check if tool TTS is enabled globally
  if (!config.toolTTS?.enabled) {
    console.log(JSON.stringify({}));
    return;
  }

  // Read hook input from stdin
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let hookData;
  try {
    hookData = JSON.parse(input);
  } catch {
    console.log(JSON.stringify({}));
    return;
  }

  const { tool_name, tool_input, tool_result } = hookData;

  // Check if TTS is enabled for this specific tool
  if (!isToolEnabled(config, tool_name)) {
    console.log(JSON.stringify({}));
    return;
  }

  // Determine what to speak
  let speechText;
  const isError = isToolError(tool_result);

  if (isError && config.toolTTS?.announceErrors) {
    // Handle error case
    if (config.toolTTS?.mode === 'summarize') {
      speechText = summarizeTool(tool_name, tool_input, tool_result, config);
    } else {
      speechText = config.toolTTS?.customMessages?.error || 'Operation failed.';
    }
  } else if (!isError) {
    // Handle success case
    if (config.toolTTS?.mode === 'summarize') {
      speechText = summarizeTool(tool_name, tool_input, tool_result, config);
    } else {
      // Completion mode - say tool name + "done"
      const completionWord = config.toolTTS?.customMessages?.completion || 'done.';
      speechText = `${tool_name} ${completionWord}`;
    }
  }

  // Send to TTS if we have something to say
  if (speechText) {
    try {
      await sendToTTS(speechText, false); // priority = false (normal queue)
    } catch {
      // Silently fail - don't interrupt Claude Code
    }
  }

  // Output empty response (hook doesn't modify behavior)
  console.log(JSON.stringify({}));
}

main().catch(() => {
  console.log(JSON.stringify({}));
  process.exit(0); // Don't fail the hook
});
