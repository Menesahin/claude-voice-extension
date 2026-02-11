---
name: listen
description: Use when the user wants to speak a voice command. Trigger words include listen, dinle, voice, sesli komut, mikrofon, microphone, speak, konuş, söyle, ses, record, kayıt, "I want to say something", "bir şey söylemek istiyorum"
---

# Voice Listen - Activate Microphone

When this skill is triggered, immediately run the following command to activate voice listening:

```bash
claude-voice listen
```

This activates the microphone and waits for the user to speak a command. The voice extension will:
1. Play a "ping" sound to indicate it's listening
2. Record the user's speech
3. Transcribe it using STT (speech-to-text)
4. Inject the transcribed text into the terminal

After running the command, tell the user you're listening and they can speak their command now.

If the command fails with "Daemon not running", run `claude-voice start` first, then retry `claude-voice listen`.
