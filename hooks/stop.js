#!/usr/bin/env node
/**
 * Claude Code Hook: Stop
 *
 * This hook runs when Claude finishes responding.
 * It extracts Claude's response and sends it to the TTS service.
 * Respects user configuration for auto-speak.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const API_URL = 'http://127.0.0.1:3456';
const CONFIG_FILE = path.join(os.homedir(), '.claude-voice', 'config.json');

// Load configuration
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {
    // Use defaults
  }
  return {
    tts: {
      autoSpeak: true,
      maxSpeechLength: 1500,
      skipCodeBlocks: true
    }
  };
}

async function sendToTTS(text, priority = false) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ text, priority });

    const req = http.request(`${API_URL}/tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data, 'utf8')
      },
      timeout: 5000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          resolve(response);
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

async function extractLastResponse(transcriptPath) {
  if (!fs.existsSync(transcriptPath)) {
    return null;
  }

  const fileStream = fs.createReadStream(transcriptPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lastAssistantMessage = null;

  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);

      // Look for assistant messages
      if (entry.type === 'assistant' && entry.message) {
        // Extract text content from the message
        if (entry.message.content) {
          const textContent = entry.message.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n');

          if (textContent) {
            lastAssistantMessage = textContent;
          }
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  return lastAssistantMessage;
}

// Extract text for TTS - remove marker but keep all content
function extractAbstract(text, config) {
  const marker = config.voiceOutput?.abstractMarker || '<!-- TTS -->';

  // Remove the marker but speak everything
  const cleaned = text.replace(marker, '').trim();
  return cleaned || null;
}

// Clean text for TTS (remove markdown, code, etc.)
function cleanForTTS(text) {
  let cleaned = text;

  // Remove code blocks (fenced)
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');

  // Remove code blocks (indented - 4 spaces or tab)
  cleaned = cleaned.replace(/^(?:    |\t).+$/gm, '');

  // Remove inline code
  cleaned = cleaned.replace(/`[^`]+`/g, '');

  // Remove images before links (![alt](url))
  cleaned = cleaned.replace(/!\[[^\]]*\]\([^)]+\)/g, '');

  // Convert links to just text ([text](url) -> text)
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Remove reference-style links [text][ref] and definitions [ref]: url
  cleaned = cleaned.replace(/\[[^\]]+\]\[[^\]]*\]/g, '');
  cleaned = cleaned.replace(/^\[[^\]]+\]:.*$/gm, '');

  // Remove HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, '');

  // Remove markdown headers (# ## ### etc) - keep the text
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');

  // Remove blockquotes (>) - keep the text
  cleaned = cleaned.replace(/^>\s*/gm, '');

  // Remove horizontal rules
  cleaned = cleaned.replace(/^[-*_]{3,}\s*$/gm, '');

  // Remove table formatting
  cleaned = cleaned.replace(/^\|.*\|$/gm, ''); // Table rows
  cleaned = cleaned.replace(/^[-:|]+$/gm, '');  // Table separators

  // Remove bullet points (- * +) at start of lines - keep the text
  cleaned = cleaned.replace(/^[\s]*[-*+]\s+/gm, '');

  // Remove numbered lists (1. 2. etc) - keep the text
  cleaned = cleaned.replace(/^[\s]*\d+\.\s+/gm, '');

  // Remove bold/italic/strikethrough markers
  cleaned = cleaned.replace(/[*_~]{1,3}/g, '');

  // Remove URLs
  cleaned = cleaned.replace(/https?:\/\/\S+/g, '');

  // Remove file paths (be less aggressive)
  cleaned = cleaned.replace(/(?:^|\s)(\/[\w\-./]+)/g, ' ');

  // Collapse multiple spaces
  cleaned = cleaned.replace(/  +/g, ' ');

  // Collapse multiple newlines to periods
  cleaned = cleaned.replace(/\n{2,}/g, '. ');
  cleaned = cleaned.replace(/\n/g, ' ');

  // Clean up multiple periods
  cleaned = cleaned.replace(/\.{2,}/g, '.');
  cleaned = cleaned.replace(/\.\s*\./g, '.');

  // Trim whitespace
  cleaned = cleaned.trim();

  return cleaned;
}

function summarizeForSpeech(text, config) {
  if (!text) return null;

  // First, try to extract abstract if voiceOutput is enabled
  if (config.voiceOutput?.enabled !== false) {
    const abstract = extractAbstract(text, config);
    if (abstract) {
      // Clean the abstract for TTS
      return cleanForTTS(abstract) || null;
    }
  }

  // Fallback: clean and truncate the full response
  const maxLength = config.tts?.maxSpeechLength || 5000;

  let cleaned = cleanForTTS(text);

  // Truncate to max length
  if (cleaned.length > maxLength) {
    const truncated = cleaned.substring(0, maxLength);
    const lastSentence = truncated.lastIndexOf('.');
    if (lastSentence > maxLength * 0.7) {
      cleaned = truncated.substring(0, lastSentence + 1);
    } else {
      cleaned = truncated + '...';
    }
  }

  return cleaned || null;
}

async function main() {
  const config = loadConfig();

  // Check if auto-speak is enabled
  if (!config.tts || config.tts.autoSpeak === false) {
    console.log(JSON.stringify({}));
    return;
  }

  // Read hook input from stdin
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  const hookData = JSON.parse(input);
  const { transcript_path } = hookData;

  if (!transcript_path) {
    console.log(JSON.stringify({}));
    return;
  }

  try {
    // Extract Claude's last response
    const lastResponse = await extractLastResponse(transcript_path);

    if (lastResponse) {
      // Summarize and clean for speech
      const speechText = summarizeForSpeech(lastResponse, config);

      if (speechText) {
        await sendToTTS(speechText);
      }
    }
  } catch {
    // Silently fail - we don't want to interrupt Claude Code
  }

  // Output empty response
  console.log(JSON.stringify({}));
}

main().catch(() => {
  console.log(JSON.stringify({}));
  process.exit(0); // Don't fail the hook
});
