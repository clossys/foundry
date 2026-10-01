---
strategist: patch
---

The brand-facts drift check's jurisdiction place scan does bounded work per line: a place is read from at most 256 characters after each phrase, and at most 16 differing places are collected per line. Places past that cap on the same line are not reported.
