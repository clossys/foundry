# writer.approve

Decide whether a Writer copy key is approved to ship.

- Approve the exact string as it renders, in its context; never approve a key you have not read in place.
- Approval is per key; a changed string needs a new approval.
- The decision is the key's `status` in its Writer candidate; `clossys check` must pass.
