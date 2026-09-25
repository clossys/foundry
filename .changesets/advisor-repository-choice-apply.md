---
advisor: minor
---

`applyRepositoryChoice(card, chosen)` checks a client's chosen ids against exactly the ids the repository-choice card offered, and returns the chosen repositories in the card's order, ready for `launcher --repositories`. An empty choice, an id the card did not offer, and an id chosen twice are refused with `repository-choice` findings that name a position only (#1179).
