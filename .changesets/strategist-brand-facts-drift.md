---
strategist: minor
---

Add `checkBrandFactsDrift`, which reports a conflicting legal name, incorporation, jurisdiction, brand casing, domain, canonical origin, contact email or tagline in scanned files, and reports indeterminate instead of clean when it scanned nothing or cannot resolve taglines. The check runs in linear time per line and reads lines up to 16,384 characters; a longer line makes the result indeterminate, never clean. Detection is lexical: it catches only the forms listed under Residual risk, and a conflict stated any other way is not detected. An ignore marker silences its whole physical line.
