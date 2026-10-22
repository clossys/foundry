---
designer: patch
---

Meter, a labelled Spinner and the Banner dismiss button are now built on react-aria-components, so Meter exposes a meter role named by its visible value text and a labelled Spinner exposes an indeterminate progressbar role; the server entry keeps plain variants of all three. Meter takes an optional label that names the meter in place of its value text, a labelled Spinner stays inline without a CSS reset, and its aria-labelledby, aria-describedby and aria-details attributes now land on the named progress bar.
