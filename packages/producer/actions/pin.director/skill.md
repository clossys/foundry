# pin.director

Decide which candidate a Director slot ships, or that the slot is not needed.

- Compare the slot's candidates against its slot.json contract and the pins upstream of it; pick the one that meets the contract, not the newest.
- Not needed is a decision with a reason; an undecided slot stays open.
- Record it with `clossys pin director/<slot> <candidate-id>` (basis picked is yours alone); check:slot-pins must pass.
