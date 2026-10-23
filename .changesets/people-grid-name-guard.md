---
designer: patch
---

PeopleGrid now throws a `TypeError` when a linked person's `name` holds a link or button, since the name renders inside the card's link.

The block theme registrations now check the raised and inverse raised plate pairs that TestimonialSet and PeopleGrid render and the muted pairs in TaskList and EventItem, and the token catalog lists the skip-link layer at its token value of 100.
