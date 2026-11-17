---
clossys:
  schema: "clossys.candidate/1"
  id: "writer/narratives.legal-document/package:privacy-v1.md"
  agent: "writer"
  kind: "candidate"
  status: "draft"
  createdBy: {"actor": "package", "package": "@clossys/writer", "version": "0.6.0"}
  createdAt: "2026-11-16T00:00:00Z"
  refs: [{"to": "director/identity.naming.name", "key": "Name", "rel": "input"}, {"to": "facts", "rel": "input"}]
  slot: "writer/narratives.legal-document"
  record: "privacy"
  source: {"kind": "package-default", "ref": ["ia-target/writer.md#942-prose-narrativeslegal-document-record-privacy"]}
  rationale: [{"purpose": "package default", "why": "A draft template pending owner approval, not legal advice: every section binds owner facts, so it fails facts.owner until the consumer's facts.json holds them and can never be pinned with placeholders.", "sources": []}]
---

## en

# Privacy policy
Effective {fact:effective.date}.

### collect
{brand} collects {fact:data.collected}.

### use
We use this information to provide our service and to contact you about it.

### share
We share it only with the services that help us run our work: {fact:processors}.

### keep
We keep it for {fact:retention.years} years, then delete it.

### rights
You can ask to see, correct or delete your information.

### contact
Write to {fact:contact.privacy} with any question about this policy.

### change
If this policy changes, we will post the new version here with its effective date.
