# pin.publisher

Decide which candidate a Publisher slot ships, or that the slot is not needed.

- Compare the slot's candidates against its slot.json contract and the pins upstream of it; pick the one that meets the contract, not the newest.
- Not needed is a decision with a reason; an undecided slot stays open.
- Record it with `clossys pin publisher/<slot> <candidate-id>` (basis picked is yours alone); check:slot-pins must pass.
