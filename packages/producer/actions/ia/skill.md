# ia

Decide where each L3 slot sits in its agent's IA tree (L1, L2) and what the slot is for: its contract in slot.json.

- Place a slot only when a page or another slot consumes it; a slot nothing reads is not placed.
- One slot, one purpose: if two candidates would answer different questions, they are two slots.
- Leaf ids are permanent once pinned; regroup by editing ia.json, never by renaming a leaf.
- Write the decision to `clossys/agents/<agent>/ia.json` and `clossys/agents/<agent>/<slot>/slot.json`; `clossys check` must pass.
