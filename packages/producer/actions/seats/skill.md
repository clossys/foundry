# seats

Decide who holds each decide step: an llm seat (model and prompt file), a human seat (procedure and the clossys command that records it), or both.

- A pick seat uses its agent's make-step llm.
- A human seat names a clossys command that exists; a seat with no command is open, never passing.
- Write a seat candidate `clossys/agents/producer/<step>/candidates/<step>-v<n>.json` and pin it; check:pipeline validates the seat.
