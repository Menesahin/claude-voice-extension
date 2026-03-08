---
name: listen
description: Use when the user wants to speak a voice command. Trigger words include listen, dinle, voice, sesli komut, mikrofon, microphone, speak, konuş, söyle, ses, record, kayıt, "I want to say something", "bir şey söylemek istiyorum"
---

# Voice Listen - Activate Microphone

Immediately run this command without any preamble:

```bash
claude-voice listen
```

Then respond with ONLY: "Listening..." (nothing else). The voice extension handles everything:
1. Plays a ping sound
2. Records speech
3. Transcribes via STT
4. Injects the transcribed text as your next input

Do NOT add explanations, instructions, or extra text. Just run the command and say "Listening..."

If the command fails with "Daemon not running", run `claude-voice start` first, then retry `claude-voice listen`.
