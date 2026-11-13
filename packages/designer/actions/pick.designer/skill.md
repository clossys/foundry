# pick.designer

Pick one of a Designer slot's options as its agent seat, for the owner to confirm.

- Pick only among the slot's listed options (slot.json options); never create one here.
- Judge by the slot contract and the upstream pins; say in one line why this option meets them.
- Never replace an owner pick (basis picked); a bulk, planner or agent pin may be replaced.
- Record it with `clossys pick designer/<slot> <candidate-id> --by agent:<seat>`; check:slot-options must pass.
