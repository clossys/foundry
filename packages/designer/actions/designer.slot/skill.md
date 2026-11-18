# designer.slot

Answer one slot entry assigned to the Designer (loop.slot, the decide step): a requester names a slot the Designer tree does not hold; decide reuse or create.

- Read the entry first: `clossys request <id> --json` (from, target, why, rel) and its overlap check (`clossys request <id> --check` lists the Designer slots the need may already be).
- Reuse when a placed Designer slot already serves the need, even under another name: `clossys request <id> --decide reuse --slot designer/<slot>`.
- Reuse names a placed slot of the Designer only; a slot of another agent is the requester's to cite, never a reuse.
- Create only when no placed slot serves it. Propose one leaf under the L2 whose splitting rule it belongs to, with a kind the Designer holds, the leaf's inputs and a full contract of its kind (requirements naming registered criteria): `clossys request <id> --decide create --propose <slot id> --under <l1>/<l2> --kind <kind> --inputs <ref,...> --contract <file>`.
- A create is refused when a placed slot of the same L2 and kind family reads the same material (inputs equal, a subset or superset, or Jaccard 0.8 or more; when neither side has inputs, only if their contract requirements are equal; one side with no inputs is no overlap): cite that slot instead. Only when the material truly differs, add `--overlap-reason <why>`; the reason and the overlap ids go to the owner's sign.
- Never place the leaf here: the owner signs the new leaf, then `clossys request <id> --close` places it through `clossys ia` (overlap and contract gates) and links the requester.
- Never edit the requester's slot or another agent's tree; the close writes the link and the notify event.
